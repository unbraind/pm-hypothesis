import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkspaceTransactionInterruptedError } from '@unbrained/pm-cli/sdk';
import { add, matrix, nextRequest, observe, open } from '../index.ts';
import { digest } from '../src/core.ts';
import { Attempts } from '../src/attempts.ts';
import { Store, state } from '../src/store.ts';
import { durable, emptyTracker, incident, tracker } from './helpers.ts';

/** Replay the original fixture declaration through the actual public command API. */
function originalDeclaration(f: Awaited<ReturnType<typeof incident>>) { return add(f.investigation, 'Dependency install failed', [{ observation: 'install', value: 'failed' }, { observation: 'tests', value: 'absent' }], f.options); }

/** Native validation must fail before even the owner's admission can be written. */
test('native admission: removed Test type refuses without admission or compensation', async t => {
  const f = await incident(t); await f.client.schemaRemoveType('Test'); const before = await durable(f.workspace);
  await assert.rejects(observe(f.investigation, 'probe', 'yes', f.options)); assert.deepEqual(await durable(f.workspace), before);
});

test('native admission: a withdrawn existing hypothesis refuses before ownership changes', async t => {
  const f = await incident(t); await f.client.schemaAddStatus('withdrawn', { role: ['active'] }); await f.client.update(f.a, { status: 'withdrawn' });
  const owner = state((await new Store(f.options).get(f.investigation)).hypothesis_state); owner.hypotheses = owner.hypotheses.filter(h => h.id !== f.a); const edit = { hypothesisState: JSON.stringify(owner), message: 'Synthetic unadmitted native source' }; await f.client.update(f.investigation, edit);
  const before = await durable(f.workspace);
  await assert.rejects(originalDeclaration(f), { code: 'conflict' });
  assert.deepEqual(await durable(f.workspace), before);
});

for (const field of ['statement', 'predictions'] as const) test(`replay declaration: edited owner ${field} refuses with both intent digests`, async t => {
  const f = await incident(t); const owner = state((await new Store(f.options).get(f.investigation)).hypothesis_state); const original = owner.hypotheses.find(h => h.id === f.a)!;
  if (field === 'statement') original.statement = 'Changed explanation'; else original.predictions[0].value = 'changed';
  const edit = { hypothesisState: JSON.stringify(owner), message: 'Synthetic owner declaration edit' }; await f.client.update(f.investigation, edit); const before = await durable(f.workspace);
  await assert.rejects(originalDeclaration(f), error => { assert.ok(error instanceof Error && 'code' in error && error.code === 'declaration_mismatch'); assert.ok('details' in error); const details = error.details as { storedDigest: string; requestedDigest: string }; assert.notEqual(details.storedDigest, details.requestedDigest); return true; });
  assert.deepEqual(await durable(f.workspace), before);
});

test('issue 5: public values and structured provenance are exact machine data', async t => {
  const f = await tracker(t); const left = await add(f.investigation, 'Below <threshold>', [{ observation: 'latency<500ms', value: '<500ms' }], f.options);
  await add(f.investigation, 'Above threshold', [{ observation: 'latency<500ms', value: '>500ms' }], f.options);
  const request = (await nextRequest(f.investigation, f.options)).request!; const selected = request.groups.find(g => g.hypotheses.includes(left.hypothesis))!;
  await observe(f.investigation, request.observation, selected.value, { ...f.options, how: '<raw>\\u003c\nmethod' });
  const result = await matrix(f.investigation, f.options); const row = result.rows.find(r => r.id === left.hypothesis)!;
  assert.equal(row.status, 'viable'); assert.equal(row.statement, 'Below <threshold>'); const eliminated = result.rows.find(r => r.witnesses.some(w => w.prediction.observation === request.observation))!; assert.equal(eliminated.witnesses[0].observation.how, '<raw>\\u003c\nmethod');
});

test('issue 6: interrupted first attachment revalidates an unrelated native edit', async t => {
  const f = await emptyTracker(t); await f.client.create({ id: 'hyp-owner', type: 'Issue', title: 'Original owner', createMode: 'progressive' });
  let interrupted = '';
  await assert.rejects(open('Attached investigation', { ...f.options, item: 'hyp-owner', onTransition: async event => { if (event.transition === 'prepared') { interrupted = event.transactionId; throw new WorkspaceTransactionInterruptedError(); } } }), WorkspaceTransactionInterruptedError);
  await f.client.update('hyp-owner', { title: 'Unrelated edit' });
  let resumed = ''; await assert.doesNotReject(open('Attached investigation', { ...f.options, item: 'hyp-owner', onTransition: async event => { resumed = event.transactionId; } }));
  const attempts = await new Attempts(f.workspace, 'hyp-owner').read(); assert.equal(attempts.find(entry => entry.id === interrupted)?.status, 'superseded'); assert.equal(attempts.find(entry => entry.id === interrupted)?.supersededBy, resumed);
  assert.notEqual(resumed, interrupted); assert.equal((await f.client.get('hyp-owner')).item.title, 'Unrelated edit');
  const before = await durable(f.workspace); await open('Attached investigation', { ...f.options, item: 'hyp-owner' }); assert.deepEqual(await durable(f.workspace), before);
});


test('authoritative reads never interpret an SDK budget summary as investigation data', async t => {
  const f = await tracker(t);
  await assert.doesNotReject(async () => {
    for (let index = 0; index < 4; index++) await add(f.investigation, `Long source ${index}`, [{ observation: 'large-probe', value: `${index}` + 'x'.repeat(4000) }], f.options);
    await observe(f.investigation, 'large-probe', '0' + 'x'.repeat(4000), f.options);
    const result = await matrix(f.investigation, { ...f.options, budget: 1000000 }); assert.equal(result.rows.filter(row => row.status === 'eliminated').length, 3); assert.equal(result.rows.filter(row => row.status === 'viable').length, 1);
    const native = await new Store(f.options).get(f.investigation); assert.ok(String(native.hypothesis_state).length > 16000);
  });
});

/** Collation-equivalent Unicode keys remain distinct byte identities in a canonical prediction set. */
test('replay declaration: canonical Unicode prediction order has one intent', async t => {
  const f = await tracker(t); const predictions = [{ observation: '\u00e9', value: 'composed' }, { observation: 'e\u0301', value: 'combining' }];
  const original = await add(f.investigation, 'Exact Unicode declaration', predictions, f.options); const before = await durable(f.workspace);
  const replayed = await add(f.investigation, 'Exact Unicode declaration', [...predictions].reverse(), f.options); assert.equal(replayed.hypothesis, original.hypothesis); assert.deepEqual(await durable(f.workspace), before);
  const owner = state((await new Store(f.options).get(f.investigation)).hypothesis_state); owner.hypotheses[0].predictions.reverse(); const edit = { hypothesisState: JSON.stringify(owner), message: 'Equivalent prediction-order edit' }; await f.client.update(f.investigation, edit);
  const changed = await durable(f.workspace); await assert.doesNotReject(add(f.investigation, 'Exact Unicode declaration', predictions, f.options)); assert.deepEqual(await durable(f.workspace), changed);
});

/** Native records with missing optional payloads still receive an exact typed declaration conflict. */
test('replay declaration: a missing native declaration returns both digests without writes', async t => {
  const f = await tracker(t); const statement = 'Reserved native explanation'; const predictions = [{ observation: 'probe', value: 'yes' }]; const id = `${f.investigation}-h-${digest([statement, predictions, undefined])}`;
  await f.client.create({ id, parent: f.investigation, type: 'Question', title: 'Native source without declaration', createMode: 'progressive' }); const before = await durable(f.workspace);
  await assert.rejects(add(f.investigation, statement, predictions, f.options), error => { assert.ok(error instanceof Error && 'code' in error && error.code === 'declaration_mismatch' && 'details' in error); const details = error.details as { storedDigest: string; requestedDigest: string }; assert.match(details.storedDigest, /^[0-9a-f]{24}$/); assert.notEqual(details.storedDigest, details.requestedDigest); return true; }); assert.deepEqual(await durable(f.workspace), before);
});

/** Replaying an original intent never reverses its explicit withdrawal or creates a second fact. */
test('replay declaration: withdrawn observations remain withdrawn with identical durable bytes', async t => {
  const f = await incident(t); const options = { ...f.options, when: '2026-10-26T00:00:00.000Z', operationId: 'withdrawn-replay' };
  const fact = await observe(f.investigation, 'install', 'passed', options); const withdrawn = await observe(f.investigation, '', '', { ...f.options, withdraw: fact.observation }); const before = await durable(f.workspace);
  const replay = await observe(f.investigation, 'install', 'passed', options); assert.equal(replay.observation, fact.observation); assert.equal(replay.revision, withdrawn.revision); assert.deepEqual(await durable(f.workspace), before);
  const owner = state((await new Store(f.options).get(f.investigation)).hypothesis_state); assert.equal(owner.observations.length, 1); assert.equal(owner.observations[0].status, 'withdrawn'); assert.ok((await matrix(f.investigation, f.options)).rows.every(row => row.status === 'unknown' && row.witnesses.length === 0));
});

/** Native TOON rejects malformed UTF-16, so invalid inputs must refuse before domain storage. */
test('native admission: malformed Unicode refuses with typed input errors and no writes', async t => {
  const f = await tracker(t); const before = await durable(f.workspace);
  for (const unit of ['\ud800', '\udfff']) {
    await assert.rejects(add(f.investigation, 'Invalid Unicode key', [{ observation: 'probe-' + unit, value: 'yes' }], f.options), { code: 'invalid' });
    await assert.rejects(observe(f.investigation, 'probe', 'value-' + unit, f.options), { code: 'invalid' }); assert.deepEqual(await durable(f.workspace), before);
  }
});
