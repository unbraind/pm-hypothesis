import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkspaceTransactionInterruptedError } from '@unbrained/pm-cli/sdk';
import { add, conclude, matrix, observe, open } from '../index.ts';
import type { Investigation, Options } from '../index.ts';
import { Attempts } from '../src/attempts.ts';
import { digest } from '../src/core.ts';
import { Store, state } from '../src/store.ts';
import { durable, incident } from './helpers.ts';
import { referenceRows } from './reference.ts';

const TIME = '2026-10-26T00:00:00.000Z';
const kinds = ['fresh', 'attach', 'add', 'observe', 'withdraw', 'conclude'] as const;
const single = ['prepared', 'step_applied:1', 'step_recorded:1', 'committing', 'committed'];

test('recovery state machine: every native journal boundary with unrelated and conflicting edits', { concurrency: 4 }, async t => {
  let cases = 0; const pending: Promise<void>[] = [];
  for (const kind of kinds) for (const point of kind === 'add' || kind === 'observe' ? [...single, 'step_applied:2', 'step_recorded:2'] : single) for (const peer of ['unrelated', 'conflicting'] as const) pending.push(t.test(`${kind}/${point}/${peer}`, async sub => {
    cases++; const f = await incident(sub); const seed = await observe(f.investigation, 'seed', 'yes', { ...f.options, when: TIME }); const store = new Store(f.options);
    const target = kind === 'attach' ? 'hyp-attachment' : kind === 'fresh' ? `hyp-inv-${digest(['Fresh recovery', undefined])}` : f.investigation;
    if (kind === 'attach') await f.client.create({ id: target, type: 'Issue', title: 'Native attachment', createMode: 'progressive' });
    const before = kind === 'attach' || kind === 'fresh' ? undefined : state((await store.get(target)).hypothesis_state);
    const expected: Investigation = structuredClone(before ?? { version: 1, revision: 0, hypotheses: [], observations: [] });
    const sourceId = kind === 'add' ? `${target}-h-${digest(['Recovery explanation', [{ observation: 'recovery', value: 'yes' }], undefined])}` : `${target}-o-${digest(['install', 'passed', 'admitted', 'fixture', 'explicit investigator report', TIME, undefined, undefined])}`;
    if (kind === 'add') { expected.hypotheses.push({ id: sourceId, statement: 'Recovery explanation', predictions: [{ observation: 'recovery', value: 'yes' }] }); expected.revision++; }
    if (kind === 'observe') { expected.observations.push({ id: sourceId, observation: 'install', value: 'passed', status: 'admitted', who: 'fixture', when: TIME, how: 'explicit investigator report', evidenceStatus: 'none' }); expected.revision++; }
    if (kind === 'withdraw') { expected.observations.find(row => row.id === seed.observation)!.status = 'withdrawn'; expected.revision++; }
    if (kind === 'conclude') { expected.revision++; expected.conclusion = { cause: f.b, reason: 'Recovery decision', accepted: [f.a, f.c].sort(), revision: expected.revision }; }
    const run = (options: Options) => {
      if (kind === 'fresh') return open('Fresh recovery', options);
      if (kind === 'attach') return open('Attachment', { ...options, item: target });
      if (kind === 'add') return add(target, 'Recovery explanation', [{ observation: 'recovery', value: 'yes' }], options);
      if (kind === 'observe') return observe(target, 'install', 'passed', { ...options, when: TIME });
      if (kind === 'withdraw') return observe(target, '', '', { ...options, withdraw: seed.observation });
      return conclude(target, f.b, 'Recovery decision', { ...options, acceptViable: [f.a, f.c] });
    };
    let applied = 0; let interrupted = ''; let reached = false;
    await assert.rejects(run({ ...f.options, onTransition: async event => {
      if (event.transition === 'step_applied') applied++;
      const boundary = event.transition === 'step_applied' || event.transition === 'step_recorded' ? `${event.transition}:${applied}` : event.transition;
      if (boundary === point) { interrupted = event.transactionId; reached = true; throw new WorkspaceTransactionInterruptedError(); }
    } }), WorkspaceTransactionInterruptedError);
    assert.ok(reached); const partial = applied > 0 ? structuredClone(expected) : before === undefined ? undefined : structuredClone(before);
    const current = await store.optional(target); assert.deepEqual(current?.hypothesis_state === undefined ? undefined : state(current.hypothesis_state), partial);
    const invalid = new Set<string>(); if (applied === 1 && (kind === 'add' || kind === 'observe')) invalid.add(sourceId);
    if (partial !== undefined) assert.deepEqual((await matrix(target, { ...f.options, budget: 1000000 })).rows, referenceRows(partial, invalid));
    if (current === undefined) { const creation = { id: target, type: 'Question', title: 'Peer title', hypothesisRecord: JSON.stringify({ kind: 'investigation', id: target, title: peer === 'unrelated' ? 'Fresh recovery' : 'Other intent' }), createMode: 'progressive' }; await f.client.create(creation); }
    else if (peer === 'unrelated') await f.client.update(target, { title: 'Peer title', message: 'Unrelated native edit after interruption' });
    if (peer === 'conflicting') {
      if (kind === 'fresh') { const edit = { hypothesisRecord: 'Conflicting investigation intent', message: 'Conflicting native edit' }; await f.client.update(target, edit); }
      else if (kind === 'attach') await f.client.update(target, { type: 'Task' });
      else if (kind === 'conclude') { const edit = { hypothesisRecord: 'Conflicting cause intent', message: 'Conflicting native edit' }; await f.client.update(f.b, edit); }
      else {
        const changed = structuredClone(partial ?? before!);
        if (kind === 'add') { const h = changed.hypotheses.find(row => row.id === sourceId); if (h) h.statement = 'Peer declaration'; else changed.hypotheses.push({ id: sourceId, statement: 'Peer declaration', predictions: [{ observation: 'recovery', value: 'yes' }] }); }
        if (kind === 'observe') { const fact = changed.observations.find(row => row.id === sourceId); if (fact) fact.value = 'peer-value'; else changed.observations.push({ id: sourceId, observation: 'install', value: 'peer-value', status: 'admitted', who: 'fixture', when: TIME, how: 'explicit investigator report', evidenceStatus: 'none' }); }
        if (kind === 'withdraw') changed.observations = changed.observations.filter(row => row.id !== seed.observation);
        const edit = { hypothesisState: JSON.stringify(changed), message: 'Conflicting declaration after interruption' }; await f.client.update(target, edit);
      }
      const checkpoint = await durable(f.workspace); await assert.rejects(run(f.options), error => { assert.ok(error instanceof Error && 'code' in error && ['conflict', 'declaration_mismatch'].includes(String(error.code))); return true; }); assert.deepEqual(await durable(f.workspace), checkpoint);
    } else {
      await run(f.options); assert.deepEqual(state((await store.get(target)).hypothesis_state), expected);
      assert.equal((await f.client.get(target, { fields: 'title' })).item.title, 'Peer title');
      assert.deepEqual((await matrix(target, { ...f.options, budget: 1000000 })).rows, referenceRows(expected, new Set()));
      const settled = await durable(f.workspace); await run(f.options); assert.deepEqual(await durable(f.workspace), settled);
      const attempts = await new Attempts(f.workspace, target).read(); const prior = attempts.find(row => row.id === interrupted)!;
      assert.ok(['superseded', 'satisfied'].includes(prior.status)); if (prior.status === 'superseded') { const newer = attempts.find(row => row.id === prior.supersededBy)!; assert.notEqual(newer.precondition, prior.precondition); }
    }
  }));
  await Promise.all(pending);
  assert.equal(cases, 68);
});
