import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { after, describe, test } from 'node:test';
import { add, conclude, nextRequest, observe, open, resumePacket, show } from '../index.ts';
import type { Boundary, Hypothesis, Investigation, MatrixRow, Observation, Options, Prediction } from '../index.ts';
import { Store, state } from '../src/store.ts';
import { incident, durable } from './helpers.ts';
import { checkedMatrix, referenceRows, referenceRequest as request } from './reference.ts';

const WHEN = '2026-10-25T12:00:00.000Z';
const POINTS: Boundary[] = ['record-read', 'plan-ready', 'owner-read', 'admission-ready', 'owner-written', 'record-written', 'complete'];
const FAULTS = ['type', 'parent', 'payload', 'provenance', 'deletion', 'owner'] as const;
/** Independent native image retained by the reference state machine. */
interface Image { type: string; parent: string; raw: string }
/** The reference tracks sealed intent separately from peer-mutated native data. */
interface Source { kind: 'hypothesis' | 'observation'; expected: Image; current: Image | undefined }
/** Commands operate on supplied data, not values read back from the implementation. */
type Intent = { kind: 'observe' | 'admit'; key: string; value: string; operation: string; status: 'admitted' | 'disputed' } | { kind: 'add'; statement: string; predictions: Prediction[]; operation: string } | { kind: 'withdraw'; id: string } | { kind: 'conclude'; cause: string; accepted: string[]; reason: string } | { kind: 'open' };
/** Current validity is independent of the production validator and its receipts. */
function valid(source: Source): boolean { return source.current !== undefined && isDeepStrictEqual(source.current, source.expected); }
/** Apply the independent oracle to currently-valid native images. */
function rows(model: Investigation, sources: Map<string, Source>): MatrixRow[] { return referenceRows(model, new Set([...sources].filter(([, source]) => !valid(source)).map(([id]) => id))); }
/** Reconstruct the documented immutable envelope from reference declarations. */
function image(investigation: string, entry: Hypothesis | Observation): Image {
  const fact = 'status' in entry;
  const object = fact ? { kind: 'observation', id: entry.id, investigation, observation: entry.observation, value: entry.value, status: entry.status === 'disputed' ? 'disputed' : 'admitted', who: entry.who, how: entry.how, when: entry.when, evidence: entry.evidence } : { kind: 'hypothesis', id: entry.id, investigation, statement: entry.statement, predictions: entry.predictions };
  return { type: fact ? 'Test' : 'Question', parent: investigation, raw: JSON.stringify(object) };
}

/** A conclusion requires every active observation and every hypothesis source. */
function invalidBasis(model: Investigation, sources: Map<string, Source>): boolean { return [...model.hypotheses, ...model.observations.filter(fact => fact.status !== 'withdrawn')].some(entry => !valid(sources.get(entry.id)!)); }

describe('source model sequences', { concurrency: 3 }, () => {
const covered = new Set<string>(); let activeSeeds = 0; after(() => assert.equal(covered.size, activeSeeds * 14));
for (const [seedIndex, seed] of [0x5eed, 0xc0ffee, 720251025].entries()) test(`reference model seed ${seed}: 28 commands, all seven boundaries`, async t => {
  activeSeeds++;
  const f = await incident(t); await observe(f.investigation, 'install', 'passed', { ...f.options, when: WHEN, operationId: 'repeat' });
  await f.client.create({ id: 'hyp-foreign', type: 'Issue', title: 'Foreign synthetic parent', createMode: 'progressive' });
  const store = new Store(f.options); const model = state((await store.get(f.investigation)).hypothesis_state); const sources = new Map<string, Source>(); let rng = seed;
  const random = (max: number) => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng % max; };
  for (const entry of [...model.hypotheses, ...model.observations]) { const expected = image(f.investigation, entry); sources.set(entry.id, { kind: 'status' in entry ? 'observation' : 'hypothesis', expected, current: { ...expected } }); }
  const original = model.observations[0].id; let commands = 0; let history = await durable(f.workspace);
  /** Verify all public decision surfaces, native records, owner state and history prefixes. */
  const check = async () => {
    const currentFiles = await durable(f.workspace);
    for (const [file, bytes] of Object.entries(history)) if (file.startsWith('history/')) assert.ok(currentFiles[file]?.startsWith(bytes), 'history remains append-only');
    history = currentFiles;
    const liveIds = (await f.client.listAllComplete()).items.map(item => item.id).sort();
    assert.deepEqual(liveIds, [f.investigation, 'hyp-foreign', ...[...sources].filter(([, source]) => source.current !== undefined).map(([id]) => id)].sort());
    const expected = rows(model, sources); const bad = [...sources].filter(([, source]) => !valid(source)).map(([id]) => id).sort();
    await checkedMatrix(f.investigation, f.options, model, expected, new Set(bad));
    const next = await nextRequest(f.investigation, f.options); assert.deepEqual(next.request, request(expected)); assert.deepEqual(next.sourceIssues.map(issue => issue.id).sort(), bad);
    const full = await show(f.investigation, f.options); assert.deepEqual(full.rows, expected); assert.deepEqual(full.observations, model.observations);
    const broken = invalidBasis(model, sources);
    assert.deepEqual(full.conclusion, broken ? undefined : model.conclusion); assert.deepEqual(full.invalidConclusion, broken ? model.conclusion : undefined);
    assert.equal(full.conclusionValid, model.conclusion !== undefined && !broken && model.conclusion.revision === model.revision);
    const packet = await resumePacket(f.investigation, f.options); assert.ok(packet.estimatedTokens <= 1500);
    for (const row of packet.rows) {
      if (row.kind === 'witness') { assert.ok(valid(sources.get(row.observation)!)); assert.equal(model.observations.find(o => o.id === row.observation)?.status, 'admitted'); }
      if (row.kind === 'next') assert.deepEqual(row.request, request(expected));
      if (row.kind === 'conclusion') assert.equal(row.stale, broken || model.conclusion?.revision !== model.revision);
    }
    for (const [id, source] of sources) {
      const native = await store.optional(id);
      if (source.current === undefined) assert.equal(native, undefined);
      else { assert.ok(native); assert.equal(native.type, source.current.type); assert.equal(native.parent, source.current.parent); assert.equal(native.hypothesis_record, source.current.raw); }
    }
  };
  /** Generate intents from reference survivors, including acknowledged conclusions. */
  const intent = (step: number, point?: Boundary): Intent => {
    const fresh = point === 'record-read' || point === 'plan-ready' || point === 'record-written' || point === 'owner-written' || point === 'admission-ready';
    const choice = point === 'complete' ? 5 : fresh ? random(2) : random(6);
    if (choice === 0) return { kind: 'observe', key: ['install', 'tests', 'lint'][random(3)], value: ['passed', 'failed', 'absent'][random(3)], operation: `s${seed}-${step}`, status: random(4) ? 'admitted' : 'disputed' };
    if (choice === 1) return { kind: 'add', statement: `Model cause ${seed}/${step}`, predictions: [{ observation: 'install', value: random(2) ? 'passed' : 'failed' }], operation: `h${seed}-${step}` };
    if (choice === 2) return { kind: 'withdraw', id: model.observations[random(model.observations.length)].id };
    if (choice === 3) { const live = rows(model, sources).filter(row => row.status === 'unknown' || row.status === 'viable'); return { kind: 'conclude', cause: live[0]?.id ?? f.a, accepted: live.slice(1).map(row => row.id).sort(), reason: `Reference decision ${step}` }; }
    if (choice === 4 && !valid(sources.get(original)!)) return { kind: 'open' };
    if (choice === 4) return { kind: 'admit', key: 'install', value: 'passed', operation: 'repeat', status: 'admitted' };
    return { kind: 'open' };
  };
  /** Apply only the specified logical operation; opaque native identities come from its result. */
  const apply = async (action: Intent) => {
    const native = state((await store.get(f.investigation)).hypothesis_state);
    let added: Hypothesis | Observation | undefined;
    if (action.kind === 'add') {
      const id = native.hypotheses.find(h => h.statement === action.statement)?.id; assert.ok(id);
      if (!model.hypotheses.some(h => h.id === id)) { added = { id, statement: action.statement, predictions: action.predictions }; model.hypotheses.push(added); model.revision++; }
    } else if (action.kind === 'observe' || action.kind === 'admit') {
      const id = action.kind === 'admit' ? original : native.observations.find(o => o.observation === action.key && !model.observations.some(old => old.id === o.id))?.id; assert.ok(id);
      if (!model.observations.some(o => o.id === id)) { added = { id, observation: action.key, value: action.value, status: action.status, who: 'fixture', when: WHEN, how: 'explicit investigator report', evidenceStatus: 'none' }; model.observations.push(added); model.revision++; }

    } else if (action.kind === 'withdraw') { const fact = model.observations.find(o => o.id === action.id)!; if (fact.status !== 'withdrawn') { fact.status = 'withdrawn'; model.revision++; } }
    else if (action.kind === 'conclude') { model.revision++; model.conclusion = { cause: action.cause, accepted: action.accepted, reason: action.reason, revision: model.revision }; }
    if (added !== undefined) { const expected = image(f.investigation, added); sources.set(added.id, { kind: 'status' in added ? 'observation' : 'hypothesis', expected, current: { ...expected } }); }
    assert.deepEqual(native, model);
  };
  /** Mutate sources through the native SDK, including deletion and wrong parent/type. */
  const peer = async (fault: typeof FAULTS[number], step: number) => {
    if (fault === 'owner') { const native = state((await store.get(f.investigation)).hypothesis_state); native.revision++; model.revision++; const edit = { hypothesisState: JSON.stringify(native), message: 'Model peer owner revision' }; await f.client.update(f.investigation, edit); return; }
    const available = [...sources].filter(([, source]) => source.current !== undefined); assert.ok(available.length); const [id, source] = available[random(available.length)]; const current = source.current!;
    if (fault === 'deletion') { await f.client.delete(id); source.current = undefined; }
    else if (fault === 'type') { await f.client.update(id, { type: 'Issue', comment: [`Peer type ${step}`] }); current.type = 'Issue'; }
    else if (fault === 'parent') { await f.client.update(id, { parent: 'hyp-foreign', comment: [`Peer parent ${step}`] }); current.parent = 'hyp-foreign'; }
    else { const data = JSON.parse(source.expected.raw) as Record<string, unknown>; data[source.kind === 'observation' ? 'who' : 'statement'] = `Peer ${step}`; current.raw = fault === 'payload' ? 'not-json' : JSON.stringify(data); const edit = { hypothesisRecord: current.raw, message: 'Model peer source edit', comment: [`Peer payload ${step}`] }; await f.client.update(id, edit); }
  };
  /** Execute one command with an optional scheduled peer action and a byte receipt. */
  const run = async (action: Intent, point?: Boundary, fault?: typeof FAULTS[number], step = 0) => {
    commands++;
    const activeInvalid = invalidBasis(model, sources);
    const selected = action.kind === 'conclude' ? rows(model, sources).find(row => row.id === action.cause) : undefined;
    const staticallyRefused = action.kind === 'conclude' ? activeInvalid || selected === undefined || selected.status === 'eliminated' || selected.status === 'invalid' : action.kind === 'admit' && !valid(sources.get(original)!);
    let rejected = false; let refusal = '';
    let checkpoint = await durable(f.workspace); let committed = false; let injected = false;
    const pre = (boundary: Boundary) => !['owner-written', 'record-written', 'complete'].includes(boundary);
    const options: Options = { ...f.options, boundary: async boundary => {
      if (!pre(boundary) && !committed) { committed = true; await apply(action); }
      if (boundary === point && fault !== undefined) { await peer(fault, step); injected = true; covered.add(`${fault}:${point}`); }
      checkpoint = await durable(f.workspace);
    } };
    const execute = () => {
      if (action.kind === 'observe' || action.kind === 'admit') return observe(f.investigation, action.key, action.value, { ...options, operationId: action.operation, status: action.status, when: WHEN });
      if (action.kind === 'add') return add(f.investigation, action.statement, action.predictions, { ...options, operationId: action.operation });
      if (action.kind === 'withdraw') return observe(f.investigation, '', '', { ...options, withdraw: action.id });
      if (action.kind === 'conclude') return conclude(f.investigation, action.cause, action.reason, { ...options, acceptViable: action.accepted });
      return open('Existing model', { ...options, item: f.investigation });
    };
    try { await execute(); assert.equal(committed, true); }
    catch (error) { if (error instanceof assert.AssertionError) throw error; rejected = true; refusal = error instanceof Error ? `${error.name}: ${error.message}` : String(error); assert.ok(!committed); assert.ok(typeof error === 'object' && error !== null && 'code' in error && ['conflict', 'invalid', 'viable'].includes(String(error.code))); }
    assert.equal(rejected, staticallyRefused || point !== undefined && pre(point) && injected, JSON.stringify({ seed, step, action, point, fault, refusal }));
    assert.deepEqual(await durable(f.workspace), checkpoint, 'no additional durable writes after a refusal or completed commit');
    if (point !== undefined) assert.equal(injected, true, `seed ${seed}: missing fault at ${point}`);
    await check();
  };
  await check();
  for (let step = 0; step < 14; step++) {
    await run(intent(step * 2), undefined, undefined, step);
    const point = POINTS[step % 7]; const fault = FAULTS[seedIndex * 2 + Math.floor(step / 7)];
    // A conclusion can refuse before its post boundary; scheduled post points
    // deliberately use fresh writes or an unchanged open instead.
    await run(intent(step * 2 + 1, point), point, fault, step);
  }
  assert.equal(commands, 28);
});
});
