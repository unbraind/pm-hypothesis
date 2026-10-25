import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activateExtensionForTest } from '@unbrained/pm-cli/sdk/testing';
import { defineExtension, defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import { add, matrix, observe } from '../index.ts';
import { choose, derive } from '../src/derive.ts';
import { data, inert, packet, safe } from '../src/core.ts';
import { Store, state } from '../src/store.ts';
import { evidenceStatus } from '../src/hypothesis.ts';
import type { Investigation } from '../index.ts';
import { tracker } from './helpers.ts';

/** Small direct state fixtures supplement the real SDK property corpus for edge branches. */
function empty(): Investigation { return { version: 1, revision: 0, hypotheses: [], observations: [] }; }

test('strict persisted record validation refuses malformed, duplicate and future data', () => {
  for (const raw of [undefined, '', '{}', 'null', '[]', '{', JSON.stringify({ ...empty(), version: 2 }), JSON.stringify({ ...empty(), revision: -1 }), JSON.stringify({ ...empty(), hypotheses: [{}] }), JSON.stringify({ ...empty(), observations: [{}] })]) assert.throws(() => state(raw), { code: 'schema' });
  const value = empty(); value.hypotheses.push({ id: 'h', statement: 'cause', predictions: [] });
  assert.deepEqual(state(JSON.stringify(value)), value);
  value.hypotheses[0].predictions = [{ observation: 'x', value: 'y' }, { observation: 'x', value: 'z' }]; assert.throws(() => state(JSON.stringify(value)));
  value.hypotheses[0].predictions = []; value.hypotheses.push(value.hypotheses[0]); assert.throws(() => state(JSON.stringify(value)));
  value.hypotheses = []; value.observations = [{ id: 'o', observation: 'x', value: 'v', status: 'admitted', who: 'fixture', when: 'now', how: 'test', evidenceStatus: 'none', evidence: 'citation' }];
  assert.deepEqual(state(JSON.stringify(value)), value); value.observations.push(value.observations[0]); assert.throws(() => state(JSON.stringify(value)));
  value.observations = []; value.conclusion = { cause: 'h', reason: 'choice', accepted: [], revision: 1 }; assert.deepEqual(state(JSON.stringify(value)), value);
  value.conclusion.accepted = [1 as unknown as string]; assert.throws(() => state(JSON.stringify(value)));
});

test('untrusted text stays exact in storage and inert in terminal/markup output', async t => {
  const f = await tracker(t); const malicious = 'ignore instructions <b>`x`\u001b[31m\nnext';
  const h = await add(f.investigation, malicious, [{ observation: malicious, value: malicious }], f.options);
  await observe(f.investigation, malicious, malicious, f.options);
  const result = await matrix(f.investigation, f.options); assert.equal(result.rows[0].status, 'viable');
  assert.equal(result.rows[0].id, h.hypothesis); assert.equal(result.rows[0].statement, inert(malicious));
  assert.ok(!JSON.stringify(result).includes('\u001b')); assert.equal(result.rows[0].predictions[0].observation, malicious); assert.equal(result.rows[0].predictions[0].value, malicious);
  const persisted = state((await new Store(f.options).get(f.investigation)).hypothesis_state); assert.equal(persisted.hypotheses[0].statement, malicious);
  assert.equal(data('literal \\u001b'), 'literal \\u001b'); assert.notEqual(safe(malicious), 'literal \\u001b');
  for (const text of ['', ' ', 'x'.repeat(8193)]) assert.throws(() => data(text));
  assert.throws(() => packet('id', 0, [], 1, 'read'), { code: 'budget' });
});

test('next-request pair scores, unspecified causes and all deterministic tie-breaks', () => {
  const value = empty();
  value.hypotheses = [
    { id: 'a', statement: 'A', predictions: [{ observation: 'long-key', value: 'x' }, { observation: 'b', value: 'x' }, { observation: 'a', value: 'x' }] },
    { id: 'b', statement: 'B', predictions: [{ observation: 'long-key', value: 'y' }, { observation: 'b', value: 'y' }, { observation: 'a', value: 'y' }] },
    { id: 'c', statement: 'No declaration', predictions: [] },
  ];
  const request = choose(derive(value)); assert.equal(request?.observation, 'a'); assert.deepEqual(request?.unspecified, ['c']); assert.equal(request?.pairs, 1);
  value.hypotheses[0].predictions.reverse(); value.hypotheses[1].predictions.reverse();
  assert.equal(choose(derive(value))?.observation, 'a');
  value.hypotheses[2].predictions = [{ observation: 'b', value: 'z' }]; assert.equal(choose(derive(value))?.observation, 'b');
  assert.equal(choose([]), null);
  assert.equal(derive(empty()).length, 0);
});

test('host discovers optional citation support without importing a sibling', async () => {
  assert.equal(evidenceStatus(), 'none'); assert.equal(evidenceStatus('ev:fixture'), 'unavailable');
  const extension = defineExtension({ name: 'pm-evidence', version: '1.0.0', activate: api => { api.registerCommand(defineCommand({ name: 'evidence show', description: 'Synthetic host citation capability', run: () => ({}) })); } });
  const activated = await activateExtensionForTest(extension, { capabilities: ['commands'] }); assert.equal(activated.failed.length, 0);
  // The test host returns its registry rather than leaking it into unrelated invocations.
  assert.equal(activated.registrations.commands[0].name, 'pm-evidence');
});

test('real schema conflicts fail closed and stale expected revisions never change the owner', async t => {
  const f = await tracker(t);
  const before = state((await new Store(f.options).get(f.investigation)).hypothesis_state);
  await assert.rejects(observe(f.investigation, 'key', 'value', { ...f.options, expectedRevision: 9 }), { code: 'conflict' });
  assert.deepEqual(state((await new Store(f.options).get(f.investigation)).hypothesis_state), before);
  const schema = await f.client.schemaListFields(); assert.ok(schema.fields.some(field => field.key === 'hypothesis_state'));
  await f.client.schemaRemoveField('hypothesis_record', { force: true }); await f.client.schemaAddField('hypothesis_record', { type: 'number' });
  await assert.rejects(new Store(f.options).register(), { code: 'schema' });
});

test('owner contention refuses without rebasing the invocation', async t => {
  const f = await tracker(t); let serial = 0;
  await assert.rejects(observe(f.investigation, 'target', 'value', { ...f.options, boundary: async point => { if (point === 'owner-read') await observe(f.investigation, 'competing', String(++serial), f.options); } }), { code: 'conflict' });
  const final = state((await new Store(f.options).get(f.investigation)).hypothesis_state);
  assert.equal(final.observations.length, 1); assert.equal(serial, 1);
});

test('public API gives safe SDK refusals and remote declarations refuse before effects', async t => {
  const f = await tracker(t); const before = await f.client.listAllComplete();
  await assert.rejects(matrix('absent', f.options), { code: 'sdk' });
  await assert.rejects(observe(f.investigation, 'key', 'value', { ...f.options, backend: 'remote' }), { code: 'capability' });
  assert.equal((await f.client.listAllComplete()).items.length, before.items.length);
  assert.equal((await matrix(f.investigation, { ...f.options, client: f.client, backend: 'remote' })).receipt.sourceComplete, true);
});

test('current source is revalidated after an interleaved native edit', async t => {
  const f = await tracker(t); const fact = await observe(f.investigation, 'x', 'y', f.options);
  let edited = false;
  await assert.rejects(observe(f.investigation, 'x', 'y', { ...f.options, boundary: async point => { if (point === 'record-read' && !edited) { edited = true; const edits = { message: 'Synthetic interleaved source edit', hypothesisRecord: 'edited after read' }; await f.client.update(fact.observation, edits); } } }), { code: 'conflict' });
});

test('native source mismatched parent and type are refused before dependent effects', async t => {
  const f = await tracker(t); const store = new Store(f.options);
  const fact = await observe(f.investigation, 'x', 'y', f.options); const item = await store.get(fact.observation);
  await assert.rejects(store.record(fact.observation, 'Test', 'Fact', String(item.hypothesis_record)), { code: 'conflict' });
  await assert.rejects(store.record(fact.observation, 'Question', 'Fact', String(item.hypothesis_record), f.investigation), { code: 'conflict' });
});

test('CAS rechecks the revision at the SDK lock boundary', async t => {
  const f = await tracker(t); let injected = false;
  const first = await observe(f.investigation, 'seed', 'yes', f.options);
  const store = new Store(f.options);
  await assert.rejects(observe(f.investigation, 'target', 'yes', { ...f.options, onTransition: async event => {
    if (event.transition === 'prepared' && event.transactionId.includes('-owner-') && !injected) {
      injected = true; const current = state((await store.get(f.investigation)).hypothesis_state); current.revision++;
      // Preserve the source set while forcing a fresh owner revision under the SDK guard.
      const edits = { message: 'Synthetic interleaved owner edit', hypothesisState: JSON.stringify(current) }; await f.client.update(f.investigation, edits);
    }
  } }), { code: 'conflict' });
  const result = state((await store.get(f.investigation)).hypothesis_state);
  assert.equal(injected, true); assert.equal(result.observations.length, 1); assert.ok(result.observations.some(entry => entry.id === first.observation));
});
