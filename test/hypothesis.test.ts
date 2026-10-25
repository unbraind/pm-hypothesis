import assert from 'node:assert/strict';
import { test } from 'node:test';
import { open, add, observe, matrix, nextRequest, resumePacket, conclude, tokens } from '../index.ts';
import { Store, state } from '../src/store.ts';
import { incident, tracker } from './helpers.ts';

/** Compare disposition maps without depending on deterministic item hash ordering. */
function statuses(rows: { id: string; status: string }[]) { return Object.fromEntries(rows.map(row => [row.id, row.status])); }

test('acceptance: only contradictions eliminate, independent facts affect exact causes, withdrawal restores exact witnesses', async t => {
  const f = await incident(t); const query = () => matrix(f.investigation, f.options);
  assert.deepEqual(Object.values(statuses((await query()).rows)), ['unknown', 'unknown', 'unknown']);
  const next = await nextRequest(f.investigation, f.options); assert.equal(next.request?.observation, 'install'); assert.equal(next.request?.pairs, 2);
  const unrelated = await observe(f.investigation, 'runner', 'linux', f.options); assert.ok((await query()).rows.every(row => row.status === 'unknown'));
  const install = await observe(f.investigation, 'install', 'passed', { ...f.options, how: 'Synthetic CI log', evidence: 'citation:fixture' });
  assert.equal(install.evidenceStatus, 'unavailable');
  assert.deepEqual(statuses((await query()).rows), { [f.a]: 'eliminated', [f.b]: 'unknown', [f.c]: 'unknown' });
  const tests = await observe(f.investigation, 'tests', 'failed', f.options);
  const lint = await observe(f.investigation, 'lint', 'passed', f.options);
  let rows = (await query()).rows; assert.deepEqual(statuses(rows), { [f.a]: 'eliminated', [f.b]: 'viable', [f.c]: 'eliminated' });
  assert.equal(rows.find(row => row.id === f.a)?.witnesses.length, 2);
  assert.equal((await nextRequest(f.investigation, f.options)).request, null);
  const withdrawing = await observe(f.investigation, '', '', { ...f.options, withdraw: install.observation });
  rows = (await query()).rows; assert.equal(rows.find(row => row.id === f.a)?.status, 'eliminated'); assert.equal(rows.find(row => row.id === f.b)?.status, 'unknown');
  await observe(f.investigation, '', '', { ...f.options, withdraw: tests.observation });
  rows = (await query()).rows; assert.deepEqual(statuses(rows), { [f.a]: 'unknown', [f.b]: 'unknown', [f.c]: 'eliminated' });
  assert.equal((await observe(f.investigation, '', '', { ...f.options, withdraw: tests.observation })).revision, withdrawing.revision + 1);
  const native = await f.client.get(install.observation, { full: true }); assert.equal(native.item.type, 'Test'); assert.equal(native.item.parent, f.investigation);
  assert.equal((await f.client.get(f.a, { full: true })).item.parent, f.investigation);
  assert.ok((await f.client.get(f.investigation, { full: true })).item.comments?.length);
  assert.ok(unrelated.observation !== lint.observation);
});

test('admission, repeated facts, conflicting facts and bounded resume preserve honest receipts', async t => {
  const f = await incident(t);
  await observe(f.investigation, 'install', 'passed', { ...f.options, status: 'disputed' });
  assert.ok((await matrix(f.investigation, f.options)).rows.every(row => row.status === 'unknown'));
  const a = await observe(f.investigation, 'install', 'passed', f.options);
  assert.equal((await observe(f.investigation, 'install', 'passed', f.options)).revision, a.revision);
  await observe(f.investigation, 'install', 'failed', f.options);
  assert.ok((await matrix(f.investigation, f.options)).rows.every(row => row.status === 'eliminated'));
  const full = await resumePacket(f.investigation, { ...f.options, budget: 10000 }); assert.equal(full.receipt.complete, true);
  const limited = await resumePacket(f.investigation, { ...f.options, budget: 300 }); assert.equal(limited.receipt.complete, false); assert.ok(limited.receipt.omitted > 0); assert.ok(tokens(limited) <= 300);
  await assert.rejects(resumePacket(f.investigation, { ...f.options, budget: 1 }), { code: 'budget' });
  for (const budget of [0, -1, 0.5, Infinity, 1000001]) await assert.rejects(matrix(f.investigation, { ...f.options, budget }), { code: 'invalid' });
});

test('conclusions refuse unacknowledged survivors, stale facts, missing causes and stale revisions', async t => {
  const f = await incident(t);
  await assert.rejects(conclude(f.investigation, f.b, 'Needs alternatives', f.options), { code: 'viable' });
  await assert.rejects(conclude(f.investigation, 'absent', 'Invalid cause', f.options), { code: 'invalid' });
  const result = await conclude(f.investigation, f.b, 'Provisional explicit choice', { ...f.options, acceptViable: [f.a, f.c] });
  assert.equal((await conclude(f.investigation, f.b, 'Provisional explicit choice', { ...f.options, acceptViable: [f.c, f.a] })).revision, result.revision);
  assert.ok((await resumePacket(f.investigation, f.options)).rows.some(row => row.kind === 'conclusion' && !row.stale));
  await observe(f.investigation, 'install', 'passed', f.options);
  assert.ok((await resumePacket(f.investigation, f.options)).rows.some(row => row.kind === 'conclusion' && row.stale));
  await assert.rejects(conclude(f.investigation, f.a, 'Contradicted cause', f.options), { code: 'invalid' });
  await assert.rejects(conclude(f.investigation, f.b, 'Old revision', { ...f.options, expectedRevision: 0 }), { code: 'conflict' });
  await conclude(f.investigation, f.b, 'Updated explicit choice', { ...f.options, acceptViable: [f.c] });
});

test('open attaches only native owners, recovers its own identity and validates predictions', async t => {
  const f = await tracker(t);
  assert.equal((await open('Synthetic CI failure', f.options)).investigation, f.investigation);
  await f.client.create({ id: 'hyp-issue', type: 'Issue', title: 'Synthetic issue', createMode: 'progressive' });
  assert.equal((await open('Attached', { ...f.options, item: 'hyp-issue' })).investigation, 'hyp-issue');
  assert.equal((await open('Attached', { ...f.options, item: 'hyp-issue' })).investigation, 'hyp-issue');
  await f.client.create({ id: 'hyp-task', type: 'Task', title: 'Synthetic task' });
  await assert.rejects(open('Attached', { ...f.options, item: 'hyp-task' }), { code: 'invalid' });
  await assert.rejects(add(f.investigation, '', [], f.options));
  await assert.rejects(add(f.investigation, 'Invalid', [], f.options));
  await assert.rejects(add(f.investigation, 'Invalid', [{ observation: 'x', value: 'y' }, { observation: 'x', value: 'z' }], f.options));
  await assert.rejects(observe(f.investigation, '', '', { ...f.options, withdraw: 'missing' }), { code: 'missing' });
  await assert.rejects(observe(f.investigation, 'x', 'y', { ...f.options, when: 'invalid' }), { code: 'invalid' });
  await observe(f.investigation, 'x', 'y', { ...f.options, when: '2026-10-25T00:00:00Z' });
  const repeated = await add(f.investigation, 'Repeated', [{ observation: 'x', value: 'y' }], f.options);
  assert.equal((await add(f.investigation, 'Repeated', [{ observation: 'x', value: 'y' }], f.options)).revision, repeated.revision);
  const store = new Store(f.options); const raw = (await store.get(f.investigation)).hypothesis_state; assert.equal(state(raw).version, 1);
});

test('separate investigations admit identical explanations and facts without cross-owner collisions', async t => {
  const f = await tracker(t);
  const first = f.investigation;
  const second = (await open('Synthetic CI failure', { ...f.options, operationId: 'second-incident' })).investigation;
  assert.notEqual(first, second);
  for (const investigation of [first, second]) {
    await add(investigation, 'Same cause', [{ observation: 'same', value: 'fact' }], f.options);
    await observe(investigation, 'same', 'fact', f.options);
    assert.equal((await matrix(investigation, f.options)).rows[0].status, 'viable');
  }
});
