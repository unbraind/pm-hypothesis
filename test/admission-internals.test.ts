import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { commitItemMutations, clearActiveExtensionHooks, mutateWorkspaceJsonWithHistory, readSettings, runWithActiveExtensions, readFileIfExists, setActiveExtensionHooks, writeFileAtomic } from '@unbrained/pm-cli/sdk';
import { admissionSchema, sameSchema, usableSource, usableStatus, validateBatch } from '../src/admission.ts';
import { Store, state } from '../src/store.ts';
import { Attempts } from '../src/attempts.ts';
import { digest } from '../src/core.ts';
import { add, matrix, observe, open } from '../index.ts';
import { durable, emptyTracker, incident, tracker } from './helpers.ts';

/** SDK registry roles, rather than a local list of status labels, control source use. */
test('native registry: aliases, unknown projections and every terminal role are resolved by the SDK', async t => {
  const f = await tracker(t); let schema = await admissionSchema(f.client, f.workspace);
  assert.equal(usableStatus(undefined, schema), false); assert.equal(usableStatus('not-registered', schema), false); assert.equal(usableStatus('cancelled', schema), false); assert.equal(usableStatus('open', schema), true);
  const projected = (await f.client.get(f.investigation, { fields: 'id,type' })).item; assert.equal(usableSource(projected, schema), false);
  const nativeRoles = [...new Set(schema.statuses.definitions.flatMap(status => status.roles))].filter(role => role.startsWith('terminal') || role.startsWith('default_c'));
  for (const [index, role] of nativeRoles.entries()) { await f.client.schemaAddStatus(`native_role_${index}`, { role: [role], force: true }); schema = await admissionSchema(f.client, f.workspace); assert.equal(usableStatus(`native_role_${index}`, schema), false); }
  const remote = await admissionSchema(f.client, 'unused-remote-root', true); assert.equal(usableStatus('open', remote), true); assert.throws(() => sameSchema(remote, { ...remote, signature: 'changed' }), { code: 'conflict' });
});

test('native preview refuses native required fields and incompatible metadata without source writes', async t => {
  const f = await incident(t);
  await f.client.schemaAddField('native_required', { type: 'string', requiredOnCreate: true, requiredTypes: ['Test'] });
  const before = await durable(f.workspace); await assert.rejects(observe(f.investigation, 'required-probe', 'yes', f.options), { code: 'validation' }); assert.deepEqual(await durable(f.workspace), before);
  await f.client.schemaRemoveField('native_required'); await f.client.schemaAddField('hypothesis_record', { type: 'number', force: true });
  const changed = await durable(f.workspace); await assert.rejects(matrix(f.investigation, f.options), { code: 'schema' }); await assert.rejects(add(f.investigation, 'New explanation', [{ observation: 'probe', value: 'yes' }], f.options), { code: 'schema' }); assert.deepEqual(await durable(f.workspace), changed);
});

test('native preview does not adopt a committed journal as fresh validation', async t => {
  const f = await tracker(t); const input = { pmRoot: f.workspace, author: 'fixture', transactionId: 'native-completed-preview', mutations: [{ op: 'create' as const, id: 'hyp-native-preview', options: { type: 'Test', title: 'Native preview target', createMode: 'progressive' } }] };
  await commitItemMutations(input); const before = await durable(f.workspace); await assert.rejects(validateBatch(input), { code: 'conflict' }); assert.deepEqual(await durable(f.workspace), before);
});

test('native commit still evaluates extension guards excluded from preview', async t => {
  const f = await tracker(t); let calls = 0;
  await runWithActiveExtensions({ path: f.workspace }, async () => {
  setActiveExtensionHooks({ beforeCommand: [], afterCommand: [], onWrite: [], onRead: [], onIndex: [], beforeMutation: [{ layer: 'project', name: 'native-fixture', run: () => { calls++; throw Error('Synthetic native mutation guard'); } }] });
  try {
    const input = { pmRoot: f.workspace, author: 'fixture', transactionId: 'native-live-guard', mutations: [{ op: 'create' as const, id: 'hyp-live-guard', options: { type: 'Test', title: 'Native guarded target', createMode: 'progressive' } }] };
    const preview = await validateBatch(input); assert.ok(preview.unresolved_commit_constraints.includes('extension_mutation_guards_and_hooks')); assert.equal(calls, 0);
    const before = await durable(f.workspace); await assert.rejects(commitItemMutations(input)); assert.ok(calls > 0); assert.deepEqual(await durable(f.workspace), before);
  } finally { clearActiveExtensionHooks(); }
  });
});

test('attempt lineage is atomic, rejects corruption and preserves superseded plans without journal access', async t => {
  const f = await tracker(t); const log = new Attempts(f.workspace, 'hyp-runtime-only'); const path = join(f.workspace, 'runtime', 'pm-hypothesis', `${digest('hyp-runtime-only')}.json`);
  assert.deepEqual(await log.read(), []); await log.committed('fixture', 'absent'); await log.satisfied('fixture', 'absent'); assert.equal(await readFileIfExists(path), null);
  const first = { id: 'first', intent: 'intent', precondition: 'old', constraints: ['concurrent_tracker_changes'], status: 'planned' as const };
  await log.plan('fixture', first); await log.plan('fixture', { ...first, id: 'second', precondition: 'new' }); await log.committed('fixture', 'second');
  await log.plan('fixture', { ...first, id: 'other', intent: 'other-intent' }); await log.plan('fixture', { ...first, id: 'third' }); await log.satisfied('fixture', 'other-intent'); await log.committed('fixture', 'first');
  const rows = await log.read(); assert.equal(rows.find(row => row.id === 'first')?.status, 'committed'); assert.equal(rows.find(row => row.id === 'first')?.supersededBy, undefined); assert.equal(rows.find(row => row.id === 'other')?.status, 'satisfied');
  const saved = await readFileIfExists(path); const variants: unknown[] = ['invalid-json', {}, [null], [{ ...first, id: 42 }], [{ ...first, intent: 42 }], [{ ...first, precondition: 42 }], [{ ...first, constraints: false }], [{ ...first, constraints: [42] }], [{ ...first, status: 'other' }], [{ ...first, supersededBy: 42 }]];
  for (const value of variants) { await writeFileAtomic(path, typeof value === 'string' ? value : JSON.stringify(value)); await assert.rejects(log.read(), { code: 'schema' }); }
  await writeFileAtomic(path, saved!); assert.deepEqual(await log.read(), rows);
});


test('schema removal during a captured field projection is a typed conflict without writes', async t => {
  const f = await incident(t); let checkpoint = await durable(f.workspace);
  await assert.rejects(observe(f.investigation, 'field-race', 'yes', { ...f.options, boundary: async point => { if (point === 'owner-read') { await f.client.schemaRemoveField('hypothesis_record', { force: true }); checkpoint = await durable(f.workspace); } } }), { code: 'conflict' });
  assert.deepEqual(await durable(f.workspace), checkpoint);
});

/** Native lifecycle previews include conditional matches, rather than only creation schema. */
test('native preview reports a stale native match as a typed conflict without writes', async t => {
  const f = await tracker(t); const before = await durable(f.workspace);
  await assert.rejects(validateBatch({ pmRoot: f.workspace, author: 'fixture', transactionId: 'native-stale-match', mutations: [{ op: 'update', id: f.investigation, match: { key: 'updated_at', value: 'stale-revision' }, options: { title: 'Refused stale update' } }] }), { code: 'conflict' });
  assert.deepEqual(await durable(f.workspace), before);
});

/** A registered terminal default cannot silently create unusable source records. */
test('native registry workflow: terminal creation defaults refuse both investigations and hypotheses', async t => {
  const f = await tracker(t); const predictions = [{ observation: 'existing-probe', value: 'yes' }]; await add(f.investigation, 'Existing active source', predictions, f.options); const settings = await readSettings(f.workspace); assert.ok(settings.schema.files.workflows); const filePath = join(f.workspace, settings.schema.files.workflows);
  await mutateWorkspaceJsonWithHistory({ pmRoot: f.workspace, filePath, author: 'fixture', op: 'fixture-schema-workflow', lockTtlSeconds: settings.locks.ttl_seconds, lockWaitMs: settings.locks.wait_ms, mutate: raw => {
    assert.ok(raw); const current = JSON.parse(raw) as { workflow: Record<string, string> }; current.workflow.open_status = 'canceled'; return { raw: JSON.stringify(current), result: undefined };
  } });
  const before = await durable(f.workspace); await assert.doesNotReject(add(f.investigation, 'Existing active source', predictions, f.options)); await assert.rejects(open('Refused terminal investigation', f.options), { code: 'conflict' }); await assert.rejects(add(f.investigation, 'Refused terminal source', [{ observation: 'probe', value: 'yes' }], f.options), { code: 'conflict' }); assert.deepEqual(await durable(f.workspace), before);
});

/** Embedded mutation callers share native batch validation even without a public command intent. */
test('shared conditional helper: native revision update and current-state no-op both use the same schema snapshot', async t => {
  const f = await tracker(t); const store = new Store(f.options);
  const updated = await store.mutate(f.investigation, () => 'Embedded investigator revision'); assert.equal(updated.value.revision, 1); assert.equal(state((await store.get(f.investigation)).hypothesis_state).revision, 1);
  const settled = await durable(f.workspace); await store.mutate(f.investigation, () => undefined); assert.deepEqual(await durable(f.workspace), settled);
  await f.client.update(f.investigation, { type: 'Task' }); const changed = await durable(f.workspace); await assert.rejects(store.mutate(f.investigation, () => 'Invalid owner'), { code: 'invalid' }); assert.deepEqual(await durable(f.workspace), changed);
});

/** Opening existing context must not silently repair a peer's native schema edit. */
test('native bootstrap: installed fields preserve removed native types on existing and fresh opens', async t => {
  const f = await tracker(t); await f.client.schemaRemoveType('Test'); const before = await durable(f.workspace); await open('Existing context', { ...f.options, item: f.investigation }); assert.deepEqual(await durable(f.workspace), before);
  await f.client.schemaRemoveType('Question'); const changed = await durable(f.workspace); await assert.rejects(open('Missing native Question', f.options), { code: 'validation' }); assert.deepEqual(await durable(f.workspace), changed);
});

test('native bootstrap: incompatible fields fail before any native type registration', async t => {
  const f = await emptyTracker(t); await f.client.schemaAddField('hypothesis_state', { type: 'number' }); const before = await durable(f.workspace); await assert.rejects(open('Refused setup', f.options), { code: 'schema' }); assert.deepEqual(await durable(f.workspace), before);
});

/** A partial first installation can recover without replacing an existing valid field definition. */
test('native bootstrap: partial SDK field setup resumes without replacing its registered declaration', async t => {
  const f = await emptyTracker(t); await f.client.schemaAddType('Question', { folder: 'questions' }); await f.client.schemaAddField('hypothesis_state', { type: 'string', description: 'Preserved field declaration' });
  const opened = await open('Recovered package setup', f.options); const fields = (await f.client.schemaListFields()).fields; assert.equal(fields.find(field => field.key === 'hypothesis_state')?.description, 'Preserved field declaration'); assert.equal(fields.find(field => field.key === 'hypothesis_record')?.type, 'string');
  const before = await durable(f.workspace); assert.equal((await open('Recovered package setup', f.options)).investigation, opened.investigation); assert.deepEqual(await durable(f.workspace), before);
});

/** Create-only embedded batches also bind their full intent without inventing an update match. */
test('shared conditional helper: standalone native initialization preserves create-only intent on replay', async t => {
  const f = await tracker(t); const store = new Store(f.options); const first = await store.initialize('hyp-embedded-root', 'Embedded investigation', true); assert.equal(first.id, 'hyp-embedded-root');
  assert.equal(state((await store.get(first.id)).hypothesis_state).revision, 0); const before = await durable(f.workspace); await store.initialize(first.id, 'Embedded investigation', true); assert.deepEqual(await durable(f.workspace), before);
});
