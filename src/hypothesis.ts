import { getActiveExtensionRegistrations, readSettings } from '@unbrained/pm-cli/sdk';
import { data, digest, HypothesisError, packet, requireInput, safe } from './core.ts';
import { choose, derive } from './derive.ts';
import { state, Store } from './store.ts';
import type { Conclusion, Investigation, ObserveOptions, Observation, Options, Prediction, ResumeRow } from './types.ts';

/** Require a native Question or Issue as the investigation owner. */
function ownerType(type: unknown): void { requireInput(type === 'Question' || type === 'Issue', 'Investigation owner must be a Question or Issue'); }
/** Open or attach a revisioned investigation, with deterministic replay identity. */
export async function open(title: string, options: Options & { item?: string }) {
  data(title); const store = new Store(options); await store.register();
  const prefix = (await readSettings(options.workspace)).id_prefix;
  requireInput(typeof prefix === 'string', 'Tracker prefix is missing');
  const id = options.item ?? `${prefix.replace(/-$/, '')}-inv-${digest([title, options.operationId])}`;
  if (options.item === undefined) await store.record(id, 'Question', title, JSON.stringify({ kind: 'investigation', title }));
  const item = await store.get(id); ownerType(item.type);
  if (item.hypothesis_state === undefined) await store.commit(item, { version: 1, revision: 0, hypotheses: [], observations: [] }, 'Opened differential investigation');
  else state(item.hypothesis_state);
  return { investigation: id };
}
/** Declare a competing explanation with distinct exact-equality prediction keys. */
export async function add(investigation: string, statement: string, predictions: Prediction[], options: Options) {
  data(statement); requireInput(predictions.length > 0 && predictions.length <= 1000, 'Supply 1 to 1000 predictions');
  predictions = predictions.map(prediction => ({ observation: data(prediction.observation), value: data(prediction.value) })).sort((a, b) => a.observation.localeCompare(b.observation, 'en'));
  requireInput(new Set(predictions.map(entry => entry.observation)).size === predictions.length, 'Each observation key needs one prediction per hypothesis');
  const store = new Store(options); const owner = await store.get(investigation); ownerType(owner.type); store.expected(state(owner.hypothesis_state));
  const id = `${investigation}-h-${digest([statement, predictions, options.operationId])}`;
  await store.record(id, 'Question', statement, JSON.stringify({ kind: 'hypothesis', statement, predictions }), investigation);
  const value = await store.mutate(investigation, current => {
    if (current.hypotheses.some(entry => entry.id === id)) return undefined;
    current.hypotheses.push({ id, statement, predictions }); return `Added hypothesis ${id}`;
  });
  return { hypothesis: id, revision: value.revision };
}
/** Discover citation support in the active host; no sibling dependency or source reads. */
export function evidenceStatus(citation?: string): Observation['evidenceStatus'] {
  if (citation === undefined) return 'none';
  return getActiveExtensionRegistrations()?.commands.some(command => command.name === 'pm-evidence') === true ? 'host-available' : 'unavailable';
}
/** Admit/dispute a fact or withdraw an existing fact; all elimination is derived. */
export async function observe(investigation: string, observation: string, value: string, options: ObserveOptions) {
  const store = new Store(options);
  if (options.withdraw !== undefined) {
    const id = data(options.withdraw);
    const result = await store.mutate(investigation, current => {
      const fact = current.observations.find(entry => entry.id === id);
      if (fact === undefined) throw new HypothesisError('missing', 'Observation does not belong to this investigation', 'Use matrix witnesses or the native investigation record to select an observation');
      if (fact.status === 'withdrawn') return undefined;
      fact.status = 'withdrawn'; return `Withdrew observation ${id}`;
    });
    return { observation: id, revision: result.revision };
  }
  data(observation); data(value); const how = data(options.how ?? 'explicit investigator report'); const who = data(await store.author());
  const status = options.status ?? 'admitted'; requireInput(['admitted', 'disputed'].includes(status), 'Status must be admitted or disputed');
  if (options.evidence !== undefined) data(options.evidence);
  if (options.when !== undefined) requireInput(/^\d{4}-\d{2}-\d{2}T/.test(options.when) && Number.isFinite(Date.parse(options.when)), 'Observation time must be an ISO timestamp');
  const owner = await store.get(investigation); store.expected(state(owner.hypothesis_state));
  const id = `${investigation}-o-${digest([observation, value, status, who, how, options.when, options.evidence, options.operationId])}`;
  const payload = JSON.stringify({ kind: 'observation', observation, value, status, who, how, when: options.when, evidence: options.evidence });
  await store.record(id, 'Test', `Observation: ${observation}`, payload, investigation);
  const record = await store.get(id); requireInput(typeof record.created_at === 'string', 'Observation record time is missing');
  const fact: Observation = { id, observation, value, status, who, when: options.when ?? record.created_at, how, evidence: options.evidence, evidenceStatus: evidenceStatus(options.evidence) };
  const result = await store.mutate(investigation, current => {
    if (current.observations.some(entry => entry.id === id)) return undefined;
    current.observations.push(fact); return `Recorded ${status} observation ${id}`;
  });
  return { observation: id, revision: result.revision, evidenceStatus: fact.evidenceStatus };
}
/** Read one complete atomic investigation without relying on bounded list projections. */
async function read(investigation: string, options: Options): Promise<Investigation> { return state((await new Store(options).get(investigation)).hypothesis_state); }
/** Compute a bounded matrix, including witnesses and exact omission counts. */
export async function matrix(investigation: string, options: Options & { budget?: number }) {
  const value = await read(investigation, options);
  return packet(investigation, value.revision, safe(derive(value)), options.budget ?? 10000, 'pm hypothesis matrix <investigation> --budget 1000000');
}
/** Suggest one discriminating key without executing an evidence request. */
export async function nextRequest(investigation: string, options: Options) {
  const value = await read(investigation, options);
  return safe({ investigation, revision: value.revision, request: choose(derive(value)), sourceComplete: true });
}
/** Hand off bounded survivors, witnesses, open predictions and the next request. */
export async function resumePacket(investigation: string, options: Options & { budget?: number }) {
  const value = await read(investigation, options); const rows = derive(value);
  const content: ResumeRow[] = [{ kind: 'next', request: choose(rows) }];
  if (value.conclusion !== undefined) content.push({ kind: 'conclusion', conclusion: value.conclusion, stale: value.conclusion.revision !== value.revision });
  for (const row of rows.filter(entry => entry.status !== 'eliminated')) content.push({ kind: 'hypothesis', hypothesis: { id: row.id, statement: row.statement, status: row.status, open: row.open } });
  const eliminated = rows.filter(entry => entry.status === 'eliminated');
  for (let index = 0; eliminated.some(row => row.witnesses.length > index); index++) for (const row of eliminated) {
    const witness = row.witnesses[index];
    if (witness !== undefined) content.push({ kind: 'witness', hypothesis: row.id, observation: witness.observation.id, key: witness.prediction.observation, expected: witness.prediction.value, actual: witness.observation.value, who: witness.observation.who, when: witness.observation.when, how: witness.observation.how, evidence: witness.observation.evidence });
  }
  return packet(investigation, value.revision, safe(content), options.budget ?? 1500, 'pm hypothesis matrix <investigation> --budget 1000000');
}
/** Record an explicit conclusion only after every unresolved alternative is acknowledged. */
export async function conclude(investigation: string, cause: string, reason: string, options: Options & { acceptViable?: string[] }) {
  data(cause); data(reason); const accepted = [...new Set(options.acceptViable ?? [])].sort(); const store = new Store(options);
  const result = await store.mutate(investigation, current => {
    const rows = derive(current); const selected = rows.find(entry => entry.id === cause);
    requireInput(selected !== undefined && selected.status !== 'eliminated', 'Choose a hypothesis without an eliminating witness');
    const others = rows.filter(entry => entry.id !== cause && entry.status !== 'eliminated').map(entry => entry.id).sort();
    if (JSON.stringify(others) !== JSON.stringify(accepted)) throw new HypothesisError('viable', 'Unresolved alternatives require explicit acknowledgment', 'Pass --accept-viable once for every other viable or unknown hypothesis; use matrix to obtain their ids');
    const conclusion: Conclusion = { cause, reason, accepted, revision: current.revision + 1 };
    if (current.conclusion?.cause === cause && current.conclusion.reason === reason && current.conclusion.revision === current.revision && JSON.stringify(current.conclusion.accepted) === JSON.stringify(accepted)) return undefined;
    current.conclusion = conclusion; return `Concluded investigation with cause ${cause}; reason: ${JSON.stringify(reason)}`;
  });
  return safe({ investigation, revision: result.revision, conclusion: result.conclusion });
}
