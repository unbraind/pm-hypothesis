import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { WorkspaceTransactionInterruptedError } from '@unbrained/pm-cli/sdk';
import { add, conclude, matrix, observe } from '../index.ts';
import type { Options, Boundary } from '../index.ts';
import { Store, state } from '../src/store.ts';
import { incident } from './helpers.ts';

/** Plan operations against real tracker data, without a mocked SDK or cached mutation. */
async function setup(t: Parameters<typeof incident>[0], operation: string) {
  const f = await incident(t);
  const original = await observe(f.investigation, 'lint', 'failed', f.options);
  const run = (options: Options) => operation === 'observe' ? observe(f.investigation, 'install', 'passed', options) : operation === 'withdraw' ? observe(f.investigation, '', '', { ...options, withdraw: original.observation }) : conclude(f.investigation, f.b, 'Explicit provisional choice', { ...options, acceptViable: [f.a, f.c] });
  const competitor = () => observe(f.investigation, 'runner', 'linux', { ...f.options, operationId: 'competing' });
  const check = async () => {
    const value = state((await new Store(f.options).get(f.investigation)).hypothesis_state);
    assert.equal(new Set(value.observations.map(entry => entry.id)).size, value.observations.length);
    assert.equal(value.observations.filter(entry => entry.observation === 'runner').length, 1);
    if (operation === 'observe') assert.equal(value.observations.filter(entry => entry.observation === 'install').length, 1);
    if (operation === 'withdraw') assert.equal(value.observations.find(entry => entry.id === original.observation)?.status, 'withdrawn');
    if (operation === 'conclude') assert.equal(value.conclusion?.cause, f.b);
    const rows = (await matrix(f.investigation, f.options)).rows;
    assert.equal(rows.find(row => row.id === f.a)?.status, operation === 'observe' ? 'eliminated' : 'unknown');
    return value;
  };
  return { ...f, run, competitor, check };
}
/** Verify that repeated recovery reads the current durable outcome and adds no records. */
async function convergence(f: Awaited<ReturnType<typeof setup>>) {
  await f.competitor(); await f.run(f.options); const after = await f.check();
  await f.run(f.options); assert.deepEqual(await f.check(), after);
}
describe('conditional recovery boundaries', { concurrency: 4 }, () => {
const operations = ['observe', 'withdraw', 'conclude'];
for (const operation of operations) {
  const boundaries: Boundary[] = operation === 'observe' ? ['record-read', 'plan-ready', 'owner-read', 'admission-ready', 'owner-written', 'record-written', 'complete'] : ['owner-read', 'admission-ready', 'owner-written', 'complete'];
  for (const boundary of boundaries) {
    test(`${operation}: interleaving at ${boundary} preserves both writers`, async t => {
      const f = await setup(t, operation); let injected = false;
      const action = f.run({ ...f.options, boundary: async point => { if (point === boundary && !injected) { injected = true; await f.competitor(); } } });
      if (boundary === 'owner-written' || boundary === 'record-written' || boundary === 'complete') await action;
      else { await assert.rejects(action, { code: 'conflict' }); await f.run(f.options); }
      assert.equal(injected, true); await f.check();
    });
    test(`${operation}: crash at ${boundary}, competing writer, rerun converges`, async t => {
      const f = await setup(t, operation); let crashed = false;
      await assert.rejects(f.run({ ...f.options, boundary: async point => { if (point === boundary) { crashed = true; throw new WorkspaceTransactionInterruptedError(); } } }));
      assert.equal(crashed, true); await convergence(f);
    });
  }
  for (const transition of ['prepared', 'step_applied', 'step_recorded', 'committing', 'committed'] as const) {
    for (const target of operation === 'observe' ? ['source', 'owner'] : ['owner']) {
      test(`${operation}: SDK ${target} ${transition} queues competing conditional writer`, async t => {
        const f = await setup(t, operation); let pending: Promise<unknown> | undefined;
        await f.run({ ...f.options, onTransition: async event => { if (event.transition === transition && (event.stepId === undefined || event.stepId.startsWith(target === 'owner' ? '1-' : '2-')) && pending === undefined) pending = f.competitor().catch(error => { assert.equal(error.code, 'conflict'); }); } });
        assert.ok(pending); await pending; await f.competitor(); await f.check();
      });
      test(`${operation}: SDK ${target} ${transition} crash revalidates current state`, async t => {
        const f = await setup(t, operation); let interrupted = false;
        await assert.rejects(f.run({ ...f.options, onTransition: event => { if (event.transition === transition && (event.stepId === undefined || event.stepId.startsWith(target === 'owner' ? '1-' : '2-'))) { interrupted = true; throw new WorkspaceTransactionInterruptedError(); } } }));
        assert.equal(interrupted, true); await convergence(f);
      });
    }
  }
}

test('conditional conclusion rechecks alternatives after another investigator adds a cause', async t => {
  const f = await incident(t); let injected = false;
  await assert.rejects(conclude(f.investigation, f.b, 'Must recheck', { ...f.options, acceptViable: [f.a, f.c], boundary: async point => { if (point === 'owner-read' && !injected) { injected = true; await add(f.investigation, 'New competing cause', [{ observation: 'runner', value: 'macos' }], f.options); } } }), { code: 'conflict' });
  assert.equal(state((await new Store(f.options).get(f.investigation)).hypothesis_state).conclusion, undefined);
});

test('changing native source prevents every dependent owner mutation', async t => {
  const f = await incident(t); let mutated = false;
  const factsBefore = state((await new Store(f.options).get(f.investigation)).hypothesis_state).observations.length;
  const idResult = await observe(f.investigation, 'install', 'passed', f.options);
  const edits = { message: 'Synthetic native edit', hypothesisRecord: 'edited source' }; await f.client.update(idResult.observation, edits);
  await assert.rejects(observe(f.investigation, 'install', 'passed', { ...f.options, boundary: async () => { mutated = true; } }), { code: 'conflict' });
  assert.equal(state((await new Store(f.options).get(f.investigation)).hypothesis_state).observations.length, factsBefore + 1);
  assert.equal(mutated, false);
});

});
