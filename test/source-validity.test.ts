import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitWorkspaceTransaction, WorkspaceTransactionInterruptedError } from '@unbrained/pm-cli/sdk';
import { conclude, matrix, nextRequest, observe, open, resumePacket, show } from '../index.ts';
import { join } from 'node:path';
import { cp, rm } from 'node:fs/promises';
import { digest, packet } from '../src/core.ts';
import { Store, state } from '../src/store.ts';
import { incident, durable } from './helpers.ts';

/** A single real source with a recorded decision exercises every read/use surface. */
test('observation source schema and provenance are validated at every decision use', async t => {
  const f = await incident(t); const source = await observe(f.investigation, 'install', 'passed', f.options);
  await conclude(f.investigation, f.b, 'Previously supported decision', { ...f.options, acceptViable: [f.c] });
  const native = await new Store(f.options).get(source.observation); const original = JSON.parse(String(native.hypothesis_record)) as Record<string, unknown>;
  const malformed = ['{', 'null', '[]', '42', '"text"', '{}'];
  const fields: [string, unknown][] = [['extra', 'unregistered'], ['kind', 'other'], ['id', 'other'], ['investigation', 'other'], ['observation', 42], ['value', false], ['who', null], ['how', []], ['status', 'other'], ['when', 42], ['when', 'invalid-date'], ['when', '2026-13-50T00:00:00Z'], ['evidence', false], ['status', 'withdrawn'], ['observation', 'edited-key'], ['value', 'edited-value'], ['who', 'edited-reporter'], ['how', 'edited-method'], ['when', '2026-10-24T00:00:00Z'], ['evidence', 'ev:changed'], ['status', 'disputed']];
  for (const raw of [...malformed, ...fields.map(([key, value]) => JSON.stringify({ ...original, [key]: value }))]) {
    const update = { hypothesisRecord: raw, message: 'Synthetic invalid source variant' }; await f.client.update(source.observation, update);
    const result = await matrix(f.investigation, f.options);
    assert.equal(result.rows.find(row => row.id === f.a)?.status, 'unknown');
    assert.equal(result.receipt.sourceIssues?.returned[0]?.id, source.observation);
  }
  const checkpoint = await durable(f.workspace);
  await assert.rejects(conclude(f.investigation, f.b, 'Cannot reuse invalid support', { ...f.options, acceptViable: [f.a, f.c] }), { code: 'conflict' });
  assert.deepEqual(await durable(f.workspace), checkpoint);
  const current = await show(f.investigation, f.options); assert.equal(current.conclusion, undefined); assert.equal(current.invalidConclusion?.reason, 'Previously supported decision'); assert.equal(current.conclusionValid, false);
  assert.equal((await nextRequest(f.investigation, f.options)).request?.observation, 'install');
  const resumed = await resumePacket(f.investigation, f.options); assert.ok(resumed.rows.some(row => row.kind === 'invalid-source')); assert.ok(resumed.rows.some(row => row.kind === 'conclusion' && row.stale));
});

test('native closure, withdrawal status, wrong type and parent invalidate fact use', async t => {
  const f = await incident(t); const fact = await observe(f.investigation, 'install', 'passed', f.options);
  await f.client.create({ id: 'hyp-foreign', type: 'Issue', title: 'Other investigation', createMode: 'progressive' });
  for (const update of [{ type: 'Issue' }, { type: 'Test', parent: 'hyp-foreign' }, { parent: f.investigation }]) {
    await f.client.update(fact.observation, update);
    assert.equal((await matrix(f.investigation, f.options)).rows.find(row => row.id === f.a)?.status, 'type' in update && update.type === 'Issue' || 'parent' in update && update.parent === 'hyp-foreign' ? 'unknown' : 'eliminated');
  }
  await f.client.close(fact.observation, 'Retired source');
  assert.equal((await matrix(f.investigation, f.options)).receipt.sourceIssues?.returned[0]?.reason, 'withdrawn');
  await f.client.reopen(fact.observation, 'Restore source');
  await f.client.schemaAddStatus('withdrawn', { description: 'Synthetic source withdrawal', role: ['active'] });
  await f.client.update(fact.observation, { status: 'withdrawn' });
  assert.equal((await matrix(f.investigation, f.options)).rows.find(row => row.id === f.a)?.status, 'unknown');
});

test('legacy acquisition time remains valid and replays without writing', async t => {
  const f = await incident(t); const result = await observe(f.investigation, 'install', 'passed', f.options); const store = new Store(f.options);
  const native = await store.get(result.observation); const value = state((await store.get(f.investigation)).hypothesis_state);
  const raw = JSON.parse(String(native.hypothesis_record)) as Record<string, unknown>; delete raw.when;
  const fact = value.observations[0]; assert.equal(typeof native.created_at, 'string'); fact.when = String(native.created_at);
  const sourceEdit = { hypothesisRecord: JSON.stringify(raw), message: 'Synthetic legacy source' }; await f.client.update(result.observation, sourceEdit);
  const ownerEdit = { hypothesisState: JSON.stringify(value), message: 'Synthetic legacy admission' }; await f.client.update(f.investigation, ownerEdit);
  assert.equal((await matrix(f.investigation, f.options)).rows.find(row => row.id === f.a)?.status, 'eliminated');
  const checkpoint = await durable(f.workspace); await observe(f.investigation, 'install', 'passed', f.options);
  assert.deepEqual(await durable(f.workspace), checkpoint);
});

test('interrupted owner-first batch cannot eliminate until its source exists; explicit retry converges', async t => {
  const f = await incident(t); let interrupted = false;
  await assert.rejects(observe(f.investigation, 'install', 'passed', { ...f.options, onTransition: event => {
    if (event.transition === 'step_applied' && event.stepId?.startsWith('1-')) { interrupted = true; throw new WorkspaceTransactionInterruptedError(); }
  } }));
  assert.equal(interrupted, true); assert.equal((await matrix(f.investigation, f.options)).rows.find(row => row.id === f.a)?.status, 'unknown');
  await assert.rejects(conclude(f.investigation, f.b, 'Pending source is unusable', { ...f.options, acceptViable: [f.a, f.c] }), { code: 'conflict' });
  await observe(f.investigation, 'install', 'passed', f.options); const checkpoint = await durable(f.workspace);
  await observe(f.investigation, 'install', 'passed', f.options); assert.deepEqual(await durable(f.workspace), checkpoint);
  assert.equal((await matrix(f.investigation, f.options)).rows.find(row => row.id === f.a)?.status, 'eliminated');
});

test('retries never resurrect deleted native observations or investigations', async t => {
  const f = await incident(t); const fact = await observe(f.investigation, 'install', 'passed', f.options); await f.client.delete(fact.observation);
  const checkpoint = await durable(f.workspace);
  await assert.rejects(observe(f.investigation, 'install', 'passed', f.options), { code: 'conflict' }); assert.deepEqual(await durable(f.workspace), checkpoint);
  await f.client.delete(f.investigation); const deleted = await durable(f.workspace);
  await assert.rejects(open('Synthetic CI failure', f.options), { code: 'conflict' }); assert.deepEqual(await durable(f.workspace), deleted);
});

test('history absence remains a precondition when duplicate absence reads are combined', async t => {
  const f = await incident(t); const fact = await observe(f.investigation, 'install', 'passed', f.options); await f.client.delete(fact.observation);
  const store = new Store(f.options); const checkpoint = await durable(f.workspace);
  for (const pair of [[{ id: fact.observation, item: undefined, historyAbsent: true as const }, { id: fact.observation, item: undefined }], [{ id: fact.observation, item: undefined }, { id: fact.observation, item: undefined, historyAbsent: true as const }]]) {
    await assert.rejects(store.withSources(pair, async () => assert.fail('retired identity cannot pass an absence guard')), { code: 'conflict' });
  }
  assert.deepEqual(await durable(f.workspace), checkpoint);
});

test('workspace writer contention refuses before effects and releases the retention gate', async t => {
  const f = await incident(t); let release!: () => void; let ready!: () => void;
  const entered = new Promise<void>(resolve => { ready = resolve; }); const blocked = new Promise<void>(resolve => { release = resolve; });
  const peer = commitWorkspaceTransaction({ pmRoot: f.workspace, author: 'peer', transactionId: 'hold-workspace', steps: [{ id: 'hold', inspect: async () => ({ state: 'pending' as const }), apply: async () => { ready(); await blocked; }, compensate: async () => undefined }] });
  await entered; const previous = process.env.PM_LOCK_WAIT_MS; const checkpoint = await durable(f.workspace);
  try { process.env.PM_LOCK_WAIT_MS = '0'; await assert.rejects(observe(f.investigation, 'install', 'passed', f.options), { code: 'conflict' }); assert.deepEqual(await durable(f.workspace), checkpoint); }
  finally { if (previous === undefined) delete process.env.PM_LOCK_WAIT_MS; else process.env.PM_LOCK_WAIT_MS = previous; release(); await peer; }
});

test('source identity binds canonical native ids even if both declarations and payloads use an alias', async t => {
  const f = await incident(t); const fact = await observe(f.investigation, 'install', 'passed', f.options); const store = new Store(f.options);
  const value = state((await store.get(f.investigation)).hypothesis_state); const native = await store.get(fact.observation); const raw = JSON.parse(String(native.hypothesis_record)) as Record<string, unknown>;
  const alias = fact.observation.replace(/^hyp-/, ''); raw.id = alias; value.observations[0].id = alias;
  const owner = { hypothesisState: JSON.stringify(value), message: 'Synthetic owner alias' }; const source = { hypothesisRecord: JSON.stringify(raw), message: 'Synthetic source alias' };
  await f.client.update(f.investigation, owner); await f.client.update(fact.observation, source);
  const full = await show(f.investigation, f.options);
  assert.deepEqual(full.sourceIssues, [{ id: alias, kind: 'observation', reason: 'payload' }]);
  assert.ok(full.rows.every(row => row.witnesses.length === 0));
  await assert.rejects(conclude(f.investigation, f.b, 'Alias cannot bypass identity checks', { ...f.options, acceptViable: [f.a, f.c] }), { code: 'conflict' });
});

test('unreferenced valid native sources preserve explicit or legacy acquisition time on admission', async t => {
  const f = await incident(t); const how = 'explicit investigator report';
  for (const [index, when] of [undefined, '2026-10-24T00:00:00Z'].entries()) {
    const operationId = `orphan-${index}`; const id = `${f.investigation}-o-${digest(['orphan', 'yes', 'admitted', 'fixture', how, undefined, undefined, operationId])}`;
    const raw = JSON.stringify({ kind: 'observation', id, investigation: f.investigation, observation: 'orphan', value: 'yes', status: 'admitted', who: 'fixture', how, when });
    const create = { id, type: 'Test', title: 'Existing source context', parent: f.investigation, hypothesisRecord: raw, createMode: 'progressive' }; await f.client.create(create);
    const native = await new Store(f.options).get(id);
    assert.equal((await observe(f.investigation, 'orphan', 'yes', { ...f.options, operationId })).observation, id);
    const admitted = (await show(f.investigation, f.options)).observations.find(fact => fact.id === id); assert.equal(admitted?.when, when ?? native.created_at);
  }
});

test('owner provenance cannot be changed and then silently reused by the same intent', async t => {
  const f = await incident(t); const when = '2026-10-25T00:00:00Z'; await observe(f.investigation, 'install', 'passed', { ...f.options, when });
  const store = new Store(f.options); const original = state((await store.get(f.investigation)).hypothesis_state);
  for (const [key, value] of [['observation', 'changed'], ['value', 'changed'], ['who', 'changed'], ['how', 'changed'], ['when', '2026-10-24T00:00:00Z'], ['evidence', 'ev:changed']] as const) {
    const changed = structuredClone(original); changed.observations[0][key] = value;
    const update = { hypothesisState: JSON.stringify(changed), message: 'Synthetic changed owner provenance' }; await f.client.update(f.investigation, update);
    const checkpoint = await durable(f.workspace);
    await assert.rejects(observe(f.investigation, 'install', 'passed', { ...f.options, when }), { code: 'conflict' }); assert.deepEqual(await durable(f.workspace), checkpoint);
  }
});

test('unrelated SDK tracker errors remain errors and mismatched investigation identities refuse', async t => {
  const f = await incident(t); await observe(f.investigation, 'seed', 'yes', f.options);
  const duplicate = join(f.workspace, 'tests', `${f.a}.toon`);
  try { await cp(join(f.workspace, 'questions', `${f.a}.toon`), duplicate, { errorOnExist: true, force: false }); await assert.rejects(new Store(f.options).optional(f.a)); }
  finally { await rm(duplicate, { force: true }); }
  const update = { hypothesisRecord: 'Changed investigation identity', message: 'Synthetic root provenance edit' }; await f.client.update(f.investigation, update);
  const checkpoint = await durable(f.workspace);
  await assert.rejects(open('Synthetic CI failure', f.options), { code: 'conflict' }); assert.deepEqual(await durable(f.workspace), checkpoint);
});

test('bounded issue receipts restore all omitted issues and the next request', async t => {
  const f = await incident(t); const observed = await observe(f.investigation, 'install', 'passed', f.options);
  for (const id of [f.a, f.b, f.c, observed.observation]) { const update = { hypothesisRecord: 'Invalid payload', message: 'Synthetic bounded issue context' }; await f.client.update(id, update); }
  const full = await show(f.investigation, f.options); const restore = `pm hypothesis show '${f.investigation}' --json`;
  const allIssues = packet(f.investigation, full.revision, [], 1000000, restore, full.sourceIssues);
  const bounded = await matrix(f.investigation, { ...f.options, budget: allIssues.estimatedTokens - 1 });
  assert.ok((bounded.receipt.sourceIssues?.omitted ?? 0) > 0); assert.equal(bounded.receipt.complete, false);
  assert.equal(bounded.receipt.restore, restore); assert.equal(full.sourceIssues.length, 4); assert.equal(full.request, null);
});


test('recorded conclusions cannot claim a missing cause, lost acknowledgments or an eliminated cause', async t => {
  const f = await incident(t); await conclude(f.investigation, f.b, 'Reference decision', { ...f.options, acceptViable: [f.a, f.c] });
  const store = new Store(f.options); const original = state((await store.get(f.investigation)).hypothesis_state); assert.ok(original.conclusion);
  for (const patch of [{ cause: 'hyp-missing' }, { accepted: [] }, { accepted: [f.b, f.a, f.c] }]) {
    const value = { ...original, conclusion: { ...original.conclusion, ...patch } }; const update = { hypothesisState: JSON.stringify(value), message: 'Synthetic altered decision' }; await f.client.update(f.investigation, update);
    assert.equal((await show(f.investigation, f.options)).conclusionValid, false);
    assert.ok((await resumePacket(f.investigation, f.options)).rows.some(row => row.kind === 'conclusion' && row.stale));
  }
  const restored = { hypothesisState: JSON.stringify(original), message: 'Restore reference decision' }; await f.client.update(f.investigation, restored);
  assert.equal((await show(f.investigation, f.options)).conclusionValid, true);
  await observe(f.investigation, 'install', 'passed', f.options);
  const current = state((await store.get(f.investigation)).hypothesis_state); assert.ok(current.conclusion); current.conclusion.cause = f.a; current.conclusion.revision = current.revision;
  const update = { hypothesisState: JSON.stringify(current), message: 'Synthetic eliminated decision' }; await f.client.update(f.investigation, update);
  assert.equal((await show(f.investigation, f.options)).conclusionValid, false);
});
