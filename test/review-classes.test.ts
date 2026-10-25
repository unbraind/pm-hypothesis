import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acquireLockLease } from '@unbrained/pm-cli/sdk';
import { add, open, conclude, matrix, nextRequest, observe, resumePacket, show } from '../index.ts';
import type { Boundary, ObserveOptions } from '../index.ts';
import { Store, state } from '../src/store.ts';
import { incident } from './helpers.ts';

/** A source fault must leave the atomic owner and its derived matrix untouched. */
async function sourceRefusal(t: Parameters<typeof incident>[0], mutate: (fixture: Awaited<ReturnType<typeof incident>>, id: string) => Promise<unknown>) {
  const f = await incident(t); const before = await matrix(f.investigation, f.options);
  await assert.rejects(observe(f.investigation, 'install', 'passed', { ...f.options, boundary: async point => {
    if (point === 'record-written') {
      const source = (await f.client.listAllComplete()).items.find(item => item.type === 'Test'); assert.ok(source);
      await mutate(f, source.id);
    }
  } }), { code: 'conflict' });
  assert.deepEqual(await matrix(f.investigation, f.options), before);
}

test('admission refuses source edits after record-written without changing the matrix', t => sourceRefusal(t, editSource));

test('next-request identities round trip without display escaping', async t => {
  const f = await incident(t); const key = '<probe>';
  await add(f.investigation, 'Probe yes', [{ observation: key, value: '<yes>' }], f.options);
  await add(f.investigation, 'Probe no', [{ observation: key, value: '<no>' }], f.options);
  // Install has a larger group in the original incident; observe it first.
  await observe(f.investigation, 'install', 'passed', f.options);
  const request = await nextRequest(f.investigation, f.options); assert.equal(request.request?.observation, key);
  assert.ok(request.request);
  await observe(f.investigation, request.request.observation, request.request.groups[0].value, f.options);
  const value = state((await new Store(f.options).get(f.investigation)).hypothesis_state);
  assert.equal(value.observations.at(-1)?.observation, key);
  assert.equal((await nextRequest(f.investigation, f.options)).request, null);
});

test('bounded conclusion restoration names a complete reader that returns its content', async t => {
  const f = await incident(t); const reason = 'R'.repeat(8000);
  await conclude(f.investigation, f.b, reason, { ...f.options, acceptViable: [f.a, f.c] });
  const packet = await resumePacket(f.investigation, { ...f.options, budget: 300 });
  assert.ok(packet.receipt.omitted > 0); assert.ok(!packet.rows.some(row => row.kind === 'conclusion'));
  assert.match(packet.receipt.restore, /hypothesis show/);
  assert.equal((await show(f.investigation, f.options)).conclusion?.reason, reason);
});

/** Edit through the real native SDK, without a package writer lock or mock. */
async function editSource(f: Awaited<ReturnType<typeof incident>>, id: string) {
  const edit = { message: 'Synthetic source interleaving', hypothesisRecord: 'Edited provenance' };
  await f.client.update(id, edit);
}

for (const operation of ['observe', 'withdraw', 'conclude']) {
  const points = operation === 'observe' ? ['record-read', 'record-written', 'owner-read', 'admission-ready', 'owner-written', 'complete'] as const : ['owner-read', 'admission-ready', 'owner-written', 'complete'] as const;
  for (const point of points) for (const source of ['hypothesis', 'observation']) test(`${operation} source CAS: ${source} edit at ${point}`, async t => {
    const f = await incident(t); const seed = await observe(f.investigation, 'seed', 'yes', f.options);
    const before = await matrix(f.investigation, f.options); let injected = false;
    const options = { ...f.options, boundary: async (boundary: Boundary) => {
      if (boundary === point && !injected) { injected = true; await editSource(f, source === 'hypothesis' ? f.a : seed.observation); }
    } };
    const action = () => operation === 'observe' ? observe(f.investigation, 'install', 'passed', options) : operation === 'withdraw' ? observe(f.investigation, '', '', { ...options, withdraw: seed.observation }) : conclude(f.investigation, f.b, 'Explicit choice', { ...options, acceptViable: [f.a, f.c] });
    if (point === 'owner-written' || point === 'complete') {
      await action(); assert.equal((await matrix(f.investigation, f.options)).revision, before.revision + 1);
    } else {
      await assert.rejects(action(), { code: 'conflict' }); assert.deepEqual(await matrix(f.investigation, f.options), before);
    }
    assert.equal(injected, true);
  });
}

test('native source writer queues through the SDK owner mutation instead of racing admission', async t => {
  const f = await incident(t); let competing: Promise<unknown> | undefined; let edited = false;
  await observe(f.investigation, 'install', 'passed', { ...f.options, onTransition: event => {
    if (event.transactionId.includes('-owner-')) {
      if (event.transition === 'prepared') competing = editSource(f, f.a).then(() => { edited = true; });
      if (event.transition === 'step_recorded') assert.equal(edited, false);
    }
  } });
  assert.ok(competing); await competing; assert.equal(edited, true);
  assert.equal((await matrix(f.investigation, f.options)).rows.find(row => row.id === f.a)?.status, 'eliminated');
});

test('source lock contention refuses without admission and releases acquired leases', async t => {
  const f = await incident(t);
  const held = [f.a, f.b, f.c].sort().at(-1); assert.ok(held);
  const lock = await acquireLockLease(f.workspace, held, 1800, 'competing-native'); const previous = process.env.PM_LOCK_WAIT_MS;
  try {
    process.env.PM_LOCK_WAIT_MS = '0';
    await assert.rejects(observe(f.investigation, 'install', 'passed', f.options), { code: 'conflict' });
    assert.equal(state((await new Store(f.options).get(f.investigation)).hypothesis_state).observations.length, 0);
  } finally { await lock.release(); if (previous === undefined) delete process.env.PM_LOCK_WAIT_MS; else process.env.PM_LOCK_WAIT_MS = previous; }
  await observe(f.investigation, 'install', 'passed', f.options);
});

test('hypothesis source shape and canonical owner identities are validated on resumed admission', async t => {
  const f = await incident(t);
  await f.client.update(f.a, { parent: f.b });
  await assert.rejects(observe(f.investigation, 'x', 'y', f.options), { code: 'conflict' });
  await f.client.update(f.a, { parent: f.investigation, type: 'Test' });
  await assert.rejects(observe(f.investigation, 'x', 'y', f.options), { code: 'conflict' });
  await f.client.create({ id: 'hyp-alias', type: 'Issue', title: 'Alias source', createMode: 'progressive' });
  const alias = await open('Alias', { ...f.options, item: 'alias' }); assert.equal(alias.investigation, 'hyp-alias');
  const h = await add('alias', 'Alias explanation', [{ observation: 'x', value: 'y' }], f.options);
  await observe('alias', 'x', 'y', f.options);
  assert.equal((await matrix('alias', f.options)).investigation, 'hyp-alias');
  await conclude('alias', h.hypothesis, 'Alias conclusion', f.options);
});

test('unchanged admission revalidates the current owner after a competing revision', async t => {
  const f = await incident(t); await observe(f.investigation, 'seed', 'yes', f.options); let injected = false;
  await assert.rejects(observe(f.investigation, 'seed', 'yes', { ...f.options, boundary: async point => {
    if (point === 'admission-ready' && !injected) { injected = true; await observe(f.investigation, 'other', 'yes', f.options); }
  } }), { code: 'conflict' });
  assert.equal(injected, true);
});

test('removed observation sources refuse under the same admission precondition', t => sourceRefusal(t, (fixture, id) => fixture.client.delete(id)));

test('acquisition inputs remain bound to the exact source when caller options change', async t => {
  const f = await incident(t);
  const options: ObserveOptions = { ...f.options, evidence: 'citation-original', when: '2026-10-25T00:00:00Z', boundary: async point => {
    if (point === 'record-written') { options.evidence = 'citation-later'; options.when = '2026-10-26T00:00:00Z'; options.author = 'later-actor'; }
  } };
  const result = await observe(f.investigation, 'install', 'passed', options);
  const value = state((await new Store(f.options).get(f.investigation)).hypothesis_state);
  const fact = value.observations.find(entry => entry.id === result.observation); assert.ok(fact);
  assert.equal(fact.evidence, 'citation-original'); assert.equal(fact.when, '2026-10-25T00:00:00Z');
  const raw = JSON.parse(String((await f.client.get(result.observation, { full: true })).item.hypothesis_record)) as { evidence: string; when: string };
  assert.equal(fact.evidence, raw.evidence); assert.equal(fact.when, raw.when);
});
