import { getActiveExtensionRegistrations, readSettings } from '@unbrained/pm-cli/sdk';
import { data, digest, HypothesisError, operand, packet, requireInput, safe } from './core.ts';
import { choose, derive } from './derive.ts';
import { hypothesisPayload, state, Store } from './store.ts';
import type { Conclusion, Investigation, ObserveOptions, Observation, Options, Prediction, ResumeRow } from './types.ts';

/** Open or attach a revisioned investigation, with deterministic replay identity. */
export async function open(title: string, options: Options & { item?: string }) {
  options = { ...options };
  data(title); const store = new Store(options); await store.register();
  const prefix = (await readSettings(options.workspace)).id_prefix;
  requireInput(typeof prefix === 'string', 'Tracker prefix is missing');
  const id = options.item ?? `${prefix.replace(/-$/, '')}-inv-${digest([title, options.operationId])}`;
  const record = options.item === undefined ? await store.record(id, 'Question', title, JSON.stringify({ kind: 'investigation', id, title })) : undefined;
  const result = await store.mutate(id, () => undefined, undefined, true, record);
  return { investigation: result.id };
}
/** Declare a competing explanation with distinct exact-equality prediction keys. */
export async function add(investigation: string, statement: string, predictions: Prediction[], options: Options) {
  options = { ...options };
  data(statement); requireInput(predictions.length > 0 && predictions.length <= 1000, 'Supply 1 to 1000 predictions');
  predictions = predictions.map(prediction => ({ observation: data(prediction.observation), value: data(prediction.value) })).sort((a, b) => a.observation.localeCompare(b.observation, 'en'));
  requireInput(new Set(predictions.map(entry => entry.observation)).size === predictions.length, 'Each observation key needs one prediction per hypothesis');
  const store = new Store(options); let id = '';
  const result = await store.mutate(investigation, current => {
    if (current.hypotheses.some(entry => entry.id === id)) return undefined;
    current.hypotheses.push({ id, statement, predictions }); return `Added hypothesis ${id}`;
  }, async owner => {
    id = `${owner.id}-h-${digest([statement, predictions, options.operationId])}`;
    return [await store.record(id, 'Question', statement, hypothesisPayload(owner.id, { id, statement, predictions }), owner.id)];
  });
  return { hypothesis: id, revision: result.value.revision };
}
/** Discover citation support in the active host; no sibling dependency or source reads. */
export function evidenceStatus(citation?: string): Observation['evidenceStatus'] {
  if (citation === undefined) return 'none';
  return getActiveExtensionRegistrations()?.commands.some(command => command.name === 'pm-evidence') === true ? 'host-available' : 'unavailable';
}
/** Admit/dispute a fact or withdraw an existing fact; all elimination is derived. */
export async function observe(investigation: string, observation: string, value: string, options: ObserveOptions) {
  options = { ...options };
  const store = new Store(options);
  if (options.withdraw !== undefined) {
    const id = data(options.withdraw);
    const result = await store.mutate(investigation, current => {
      const fact = current.observations.find(entry => entry.id === id);
      if (fact === undefined) throw new HypothesisError('missing', 'Observation does not belong to this investigation', 'Use matrix witnesses or the native investigation record to select an observation');
      if (fact.status === 'withdrawn') return undefined;
      fact.status = 'withdrawn'; return `Withdrew observation ${id}`;
    });
    return { observation: id, revision: result.value.revision };
  }
  data(observation); data(value); const how = data(options.how ?? 'explicit investigator report'); const who = data(await store.author());
  const status = options.status ?? 'admitted'; requireInput(['admitted', 'disputed'].includes(status), 'Status must be admitted or disputed');
  if (options.evidence !== undefined) data(options.evidence);
  if (options.when !== undefined) requireInput(/^\d{4}-\d{2}-\d{2}T/.test(options.when) && Number.isFinite(Date.parse(options.when)), 'Observation time must be an ISO timestamp');
  let id = ''; let fact: Observation; const citationStatus = evidenceStatus(options.evidence);
  const result = await store.mutate(investigation, current => {
    if (current.observations.some(entry => entry.id === id)) return undefined;
    current.observations.push(fact); return `Recorded ${status} observation ${id}`;
  }, async owner => {
    id = `${owner.id}-o-${digest([observation, value, status, who, how, options.when, options.evidence, options.operationId])}`;
    const payload = JSON.stringify({ kind: 'observation', id, investigation: owner.id, observation, value, status, who, how, when: options.when, evidence: options.evidence });
    const record = await store.record(id, 'Test', `Observation: ${observation}`, payload, owner.id); requireInput(typeof record.created_at === 'string', 'Observation record time is missing');
    fact = { id, observation, value, status, who, when: options.when ?? record.created_at, how, evidence: options.evidence, evidenceStatus: citationStatus };
    return [record];
  });
  return { observation: id, revision: result.value.revision, evidenceStatus: citationStatus };
}
/** Read one complete atomic investigation without relying on bounded list projections. */
async function read(investigation: string, options: Options): Promise<{ id: string; value: Investigation }> { const item = await new Store(options).get(investigation); return { id: item.id, value: state(item.hypothesis_state) }; }
/** Compute a bounded matrix, including witnesses and exact omission counts. */
export async function matrix(investigation: string, options: Options & { budget?: number }) {
  const snapshot = await read(investigation, options); investigation = snapshot.id; const value = snapshot.value;
  return packet(investigation, value.revision, safe(derive(value)), options.budget ?? 10000, `pm hypothesis show ${operand(investigation)} --json`);
}
/** Suggest one discriminating key without executing an evidence request. */
export async function nextRequest(investigation: string, options: Options) {
  const snapshot = await read(investigation, options); investigation = snapshot.id; const value = snapshot.value;
  return safe({ investigation, revision: value.revision, request: choose(derive(value)), sourceComplete: true });
}
/** Hand off bounded survivors, witnesses, open predictions and the next request. */
export async function resumePacket(investigation: string, options: Options & { budget?: number }) {
  const snapshot = await read(investigation, options); investigation = snapshot.id; const value = snapshot.value; const rows = derive(value);
  const content: ResumeRow[] = [{ kind: 'next', request: choose(rows) }];
  if (value.conclusion !== undefined) content.push({ kind: 'conclusion', conclusion: value.conclusion, stale: value.conclusion.revision !== value.revision });
  for (const row of rows.filter(entry => entry.status !== 'eliminated')) content.push({ kind: 'hypothesis', hypothesis: { id: row.id, statement: row.statement, status: row.status, open: row.open } });
  const eliminated = rows.filter(entry => entry.status === 'eliminated');
  for (let index = 0; eliminated.some(row => row.witnesses.length > index); index++) for (const row of eliminated) {
    const witness = row.witnesses[index];
    if (witness !== undefined) content.push({ kind: 'witness', hypothesis: row.id, observation: witness.observation.id, key: witness.prediction.observation, expected: witness.prediction.value, actual: witness.observation.value, who: witness.observation.who, when: witness.observation.when, how: witness.observation.how, evidence: witness.observation.evidence });
  }
  return packet(investigation, value.revision, safe(content), options.budget ?? 1500, `pm hypothesis show ${operand(investigation)} --json`);
}
/** Return all records, matrix witnesses and the conclusion without a packet budget. */
export async function show(investigation: string, options: Options) {
  const snapshot = await read(investigation, options); investigation = snapshot.id; const value = snapshot.value;
  return safe({ investigation, revision: value.revision, rows: derive(value), observations: value.observations, conclusion: value.conclusion, sourceComplete: true, complete: true });
}
/** Record an explicit conclusion only after every unresolved alternative is acknowledged. */
export async function conclude(investigation: string, cause: string, reason: string, options: Options & { acceptViable?: string[] }) {
  options = { ...options };
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
  return safe({ investigation: result.id, revision: result.value.revision, conclusion: result.value.conclusion });
}
