import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { decodeToon } from '@unbrained/pm-cli/sdk/testing';
import { add, conclude, nextRequest, observe, resumePacket, show } from '../index.ts';
import type { Boundary, Hypothesis, Investigation, Observation } from '../index.ts';
import { wire } from '../src/core.ts';
import { Store, state } from '../src/store.ts';
import { durable, incident } from './helpers.ts';
import { referenceRows, referenceRequest } from './reference.ts';

const TIME = '2026-10-26T00:00:00.000Z';
/** Native source image, independent of the mutable owner declaration. */
interface Source { declaration: Hypothesis | Observation; type: string; status: string; closed: boolean }

describe('extended admission sequences', { concurrency: 3 }, () => {
for (const seed of [20261026, 1597, 5006]) test(`admission state machine seed ${seed}: schema, status, replay and transport operations`, async t => {
  const f = await incident(t); await observe(f.investigation, 'install', 'passed', { ...f.options, when: TIME }); await conclude(f.investigation, f.b, 'Initial reference decision', { ...f.options, acceptViable: [f.c] }); const store = new Store(f.options); let rng = seed; let checks = 0; let refusals = 0; let roundTrips = 0;
  const random = (max: number) => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng % max; };
  const model = state((await store.get(f.investigation)).hypothesis_state); const sources = new Map<string, Source>();
  const registered = new Set(['Question', 'Test']); const roles = new Map<string, string[]>([['open', ['active', 'default_open']], ['withdrawn', ['active']], ['canceled', ['terminal', 'terminal_canceled', 'default_cancel']], ['review_lane', ['active']]]); let payloadRegistered = true;
  await f.client.schemaAddStatus('withdrawn', { role: ['active'] }); await f.client.schemaAddStatus('review_lane', { role: ['active'] });
  for (const entry of [...model.hypotheses, ...model.observations]) sources.set(entry.id, { declaration: structuredClone(entry), type: 'statement' in entry ? 'Question' : 'Test', status: 'open', closed: false });
  const original = structuredClone(model.hypotheses.find(h => h.id === f.a)!); let history = await durable(f.workspace);
  /** The model interprets schema/status edits independently of production admission helpers. */
  const invalid = () => new Set([...sources].filter(([id, image]) => {
    const current = [...model.hypotheses, ...model.observations].find(row => row.id === id)!;
    const changed = 'statement' in current && 'statement' in image.declaration && (current.statement !== image.declaration.statement || JSON.stringify([...current.predictions].sort((a, b) => a.observation.localeCompare(b.observation, 'en'))) !== JSON.stringify(image.declaration.predictions));
    return changed || !payloadRegistered || !registered.has(image.type) || image.type !== ('statement' in current ? 'Question' : 'Test') || image.closed || image.status === 'withdrawn' || (roles.get(image.status) ?? []).some(role => role.startsWith('terminal') || role === 'default_close' || role === 'default_cancel');
  }).map(([id]) => id));
  /** Compare every public decision surface, exact owner state, native identities and history prefixes. */
  const check = async () => {
    checks++; const bad = invalid(); const expected = referenceRows(model, bad); const now = await durable(f.workspace);
    for (const filename of Object.keys(history).filter(name => name.startsWith('history/'))) assert.ok(now[filename]?.startsWith(history[filename]));
    history = now; assert.deepEqual(state((await store.get(f.investigation)).hypothesis_state), model);
    // show returns the complete matrix, decision, request and observations in one SDK snapshot.
    const full = await show(f.investigation, f.options);
    assert.deepEqual(full.rows, expected); assert.equal(full.revision, model.revision); assert.deepEqual(full.observations, model.observations);
    assert.deepEqual(full.sourceIssues.map(issue => issue.id).sort(), [...bad].sort()); assert.deepEqual(full.request, referenceRequest(expected));
    const live = expected.filter(row => row.status === 'unknown' || row.status === 'viable'); const decision = model.conclusion;
    const validDecision = decision !== undefined && decision.revision === model.revision && bad.size === 0 && live.some(row => row.id === decision.cause) && JSON.stringify(live.filter(row => row.id !== decision.cause).map(row => row.id).sort()) === JSON.stringify(decision.accepted);
    assert.equal(full.conclusionValid, validDecision); assert.deepEqual(full.conclusion ?? full.invalidConclusion, model.conclusion);
    if (checks % 7 === 0) {
      const packet = await resumePacket(f.investigation, f.options); assert.ok(packet.estimatedTokens <= 1500);
      for (const row of packet.rows) { if (row.kind === 'next') assert.deepEqual(row.request, referenceRequest(expected)); if (row.kind === 'witness') assert.ok(!bad.has(row.observation)); }
    }
    const items = (await f.client.listAllComplete()).items; assert.deepEqual(items.map(item => item.id).sort(), [f.investigation, ...[...sources].filter(([, source]) => registered.has(source.type)).map(([id]) => id)].sort());
    for (const native of items.filter(item => item.id !== f.investigation)) { const source = sources.get(native.id)!; assert.equal(native.type, source.type); assert.equal(native.status, source.status); assert.equal(native.parent, f.investigation); }
  };
  /** Every refusal is checked against the complete peer-only durable checkpoint. */
  const refuse = async (action: () => Promise<unknown>, code?: string) => {
    const before = await durable(f.workspace); await assert.rejects(action, error => { assert.ok(error instanceof Error && 'code' in error); if (code !== undefined) assert.equal(error.code, code); return true; });
    refusals++; assert.deepEqual(await durable(f.workspace), before); await check();
  };
  /** Append a known fact in the model only after a successful public operation. */
  const fact = (id: string, key: string, value: string) => { const record: Observation = { id, observation: key, value, status: 'admitted', who: 'fixture', when: TIME, how: 'explicit investigator report', evidenceStatus: 'none' }; model.observations.push(record); model.revision++; sources.set(id, { declaration: structuredClone(record), type: 'Test', status: 'open', closed: false }); };
  /** Native owner edits change the declaration but do not silently rewrite its source. */
  const owner = async () => { const edit = { hypothesisState: JSON.stringify(model), message: 'Model owner declaration edit' }; await f.client.update(f.investigation, edit); await check(); };
  /** Produce real output and feed it back unchanged, including long and TOON-significant values. */
  const roundTrip = async (format: 'sdk' | 'json' | 'toon') => {
    const alphabet = ['<', '>', '`', ':', '[', ']', '#', '|', '\\u003c', '\n', '\\', '"', '雪', '🧪'];
    const key = `model-${roundTrips}-` + Array.from({ length: 6 }, () => alphabet[random(alphabet.length)]).join('');
    const yes = roundTrips % 3 === 2 ? '<' + '雪'.repeat(2000) : 'yes-' + key; const no = 'no-' + key;
    for (const [statement, value] of [[`Model left ${roundTrips}`, yes], [`Model right ${roundTrips}`, no]]) { const result = await add(f.investigation, statement, [{ observation: key, value }], f.options); const h = { id: result.hypothesis, statement, predictions: [{ observation: key, value }] }; model.hypotheses.push(h); model.revision++; sources.set(h.id, { declaration: structuredClone(h), type: 'Question', status: 'open', closed: false }); await check(); }
    const direct = await nextRequest(f.investigation, f.options); const output = format === 'sdk' ? direct : (format === 'json' ? JSON.parse(wire(direct, 'json')) : decodeToon(wire(direct, 'toon'))) as typeof direct;
    const request = output.request!; assert.equal(request.observation, key); const selected = request.groups.find(group => group.value === yes)!; assert.ok(selected);
    const result = await observe(f.investigation, request.observation, selected.value, { ...f.options, when: TIME }); fact(result.observation, key, yes); roundTrips++; await check();
  };
  const scenarios: (() => Promise<void>)[] = [
    async () => { await f.client.schemaRemoveType('Test', { force: true }); registered.delete('Test'); await check(); await refuse(() => observe(f.investigation, 'missing-native-type', 'yes', f.options), 'validation'); await f.client.schemaAddType('Test', { folder: 'tests' }); registered.add('Test'); await check(); },
    async () => { await f.client.schemaRenameType('Test', 'Measurement', { migrationId: `rename-${seed}` }); registered.delete('Test'); registered.add('Measurement'); for (const source of sources.values()) if (source.type === 'Test') source.type = 'Measurement'; await check(); await refuse(() => observe(f.investigation, 'renamed-native-type', 'yes', f.options), 'validation'); await f.client.schemaRenameType('Measurement', 'Test', { migrationId: `restore-${seed}` }); registered.delete('Measurement'); registered.add('Test'); for (const source of sources.values()) if (source.type === 'Measurement') source.type = 'Test'; await check(); },
    async () => { await f.client.schemaRemoveField('hypothesis_record', { force: true }); payloadRegistered = false; await check(); await refuse(() => observe(f.investigation, 'missing-native-field', 'yes', f.options), 'validation'); await f.client.schemaAddField('hypothesis_record', { type: 'string' }); payloadRegistered = true; await check(); },
    async () => { const h = model.hypotheses.find(row => row.id === f.a)!; h.statement = `Peer statement ${seed}`; await owner(); await refuse(() => add(f.investigation, original.statement, original.predictions, f.options), 'declaration_mismatch'); h.statement = original.statement; await owner(); const before = await durable(f.workspace); await add(f.investigation, original.statement, [...original.predictions].reverse(), f.options); assert.deepEqual(await durable(f.workspace), before); await check(); h.predictions[0].value = 'peer-value'; await owner(); await refuse(() => add(f.investigation, original.statement, original.predictions, f.options), 'declaration_mismatch'); h.predictions = structuredClone(original.predictions); await owner(); },
    async () => { for (const status of ['withdrawn', 'canceled', 'review_lane']) { await f.client.update(f.a, { status }); sources.get(f.a)!.status = status; await check(); if (status === 'review_lane') { await f.client.schemaAddStatus(status, { role: ['terminal_done'], force: true }); roles.set(status, ['terminal_done']); await check(); } await refuse(() => add(f.investigation, original.statement, original.predictions, f.options), 'conflict'); if (status === 'canceled') await f.client.reopen(f.a, 'Model source restored'); else await f.client.update(f.a, { status: 'open' }); sources.get(f.a)!.status = 'open'; if (status === 'review_lane') { await f.client.schemaAddStatus(status, { role: ['active'], force: true }); roles.set(status, ['active']); } await check(); } },
    async () => { await f.client.close(f.a, 'Model terminal source'); sources.get(f.a)!.closed = true; sources.get(f.a)!.status = 'closed'; roles.set('closed', ['terminal', 'terminal_done', 'default_close']); await check(); await refuse(() => add(f.investigation, original.statement, original.predictions, f.options), 'conflict'); await f.client.reopen(f.a, 'Model source restored'); sources.get(f.a)!.closed = false; sources.get(f.a)!.status = 'open'; await check(); },
    async () => { await f.client.update(f.b, { status: 'review_lane' }); sources.get(f.b)!.status = 'review_lane'; await check(); for (const role of ['terminal', 'terminal_done', 'terminal_canceled']) { await f.client.schemaAddStatus('review_lane', { role: [role], force: true }); roles.set('review_lane', [role]); await check(); await refuse(() => conclude(f.investigation, f.c, 'Cannot conclude using terminal support', f.options), 'conflict'); } await f.client.schemaAddStatus('review_lane', { role: ['active'], force: true }); roles.set('review_lane', ['active']); await f.client.update(f.b, { status: 'open' }); sources.get(f.b)!.status = 'open'; await check(); },
    async () => { const before = await durable(f.workspace); await assert.rejects(f.client.schemaAddStatus('open', { role: ['terminal'], force: true })); assert.deepEqual(await durable(f.workspace), before); await check(); },
    ...(['sdk', 'json', 'toon'] as const).map(format => () => roundTrip(format)),
  ];
  for (let index = scenarios.length - 1; index > 0; index--) { const other = random(index + 1); [scenarios[index], scenarios[other]] = [scenarios[other], scenarios[index]]; }
  await check();
  for (const scenario of scenarios) await scenario();
  await f.client.update(f.a, { status: 'review_lane' }); sources.get(f.a)!.status = 'review_lane'; await check();
  const fault = seed === 20261026 ? 'remove-type' : seed === 1597 ? 'rename-type' : 'status-role';
  for (const point of ['record-read', 'plan-ready', 'owner-read', 'admission-ready', 'owner-written', 'record-written', 'complete'] as Boundary[]) {
    let checkpoint = await durable(f.workspace); let injected = false; let committed = false; const key = `boundary-${seed}-${point}`;
    const post = (boundary: Boundary) => ['owner-written', 'record-written', 'complete'].includes(boundary);
    const operation = observe(f.investigation, key, 'yes', { ...f.options, when: TIME, boundary: async boundary => {
      if (post(boundary) && !committed) { committed = true; const got = await store.get(f.investigation); const savedState = state(got.hypothesis_state); const saved = savedState.observations.find(row => row.observation === key)!; fact(saved.id, key, 'yes'); }
      if (point === boundary) {
        injected = true;
        if (fault === 'remove-type') { await f.client.schemaRemoveType('Test', { force: true }); registered.delete('Test'); }
        else if (fault === 'rename-type') { await f.client.schemaRenameType('Test', 'Measurement', { migrationId: `boundary-${seed}-${point}` }); registered.delete('Test'); registered.add('Measurement'); for (const source of sources.values()) if (source.type === 'Test') source.type = 'Measurement'; }
        else { await f.client.schemaAddStatus('review_lane', { role: ['terminal'], force: true }); roles.set('review_lane', ['terminal']); }
      }
      checkpoint = await durable(f.workspace);
    } });
    if (post(point)) await operation; else { await assert.rejects(operation, { code: 'conflict' }); refusals++; }
    assert.ok(injected); assert.deepEqual(await durable(f.workspace), checkpoint); await check();
    if (fault === 'remove-type') { await f.client.schemaAddType('Test', { folder: 'tests' }); registered.add('Test'); }
    else if (fault === 'rename-type') { await f.client.schemaRenameType('Measurement', 'Test', { migrationId: `boundary-restore-${seed}-${point}` }); registered.delete('Measurement'); registered.add('Test'); for (const source of sources.values()) if (source.type === 'Measurement') source.type = 'Test'; }
    else { await f.client.schemaAddStatus('review_lane', { role: ['active'], force: true }); roles.set('review_lane', ['active']); }
    await check();
  }
  await f.client.update(f.a, { status: 'open' }); sources.get(f.a)!.status = 'open'; await check();
  const survivors = referenceRows(model, invalid()).filter(row => row.status === 'unknown' || row.status === 'viable'); const chosen = survivors[0];
  await conclude(f.investigation, chosen.id, 'Model decision', { ...f.options, acceptViable: survivors.slice(1).map(row => row.id) }); model.revision++; model.conclusion = { cause: chosen.id, reason: 'Model decision', accepted: survivors.slice(1).map(row => row.id).sort(), revision: model.revision }; await check();
  assert.equal((await show(f.investigation, f.options)).conclusionValid, true);
  console.log(JSON.stringify({ seed, checks, refusals, roundTrips }));
});

});
