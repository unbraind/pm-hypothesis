import { certifyCompleteListResult, commitItemMutations, PmClient, readSettings, selectImportAuthor } from '@unbrained/pm-cli/sdk';
import type { GetResult, PmClientFullMutationOptions } from '@unbrained/pm-cli/sdk';
import type { SchemaFieldDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { data, digest, HypothesisError, inert, requireInput } from './core.ts';
import type { Boundary, Investigation, Options } from './types.ts';

/** Registered scalar envelopes keep domain records on native SDK items. */
export const FIELDS: SchemaFieldDefinition[] = ['hypothesis_state', 'hypothesis_record'].map(name => ({ name, type: 'string', optional: true }));
/** Parse a complete owner envelope, failing closed on malformed or future records. */
export function state(raw: unknown): Investigation {
  try {
    requireInput(typeof raw === 'string', 'Missing investigation');
    const value = JSON.parse(raw) as Investigation;
    requireInput(value.version === 1 && Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.hypotheses) && Array.isArray(value.observations), 'Invalid investigation');
    for (const hypothesis of value.hypotheses) {
      data(hypothesis.id); data(hypothesis.statement); requireInput(Array.isArray(hypothesis.predictions), 'Invalid predictions');
      for (const prediction of hypothesis.predictions) { data(prediction.observation); data(prediction.value); }
      requireInput(new Set(hypothesis.predictions.map(entry => entry.observation)).size === hypothesis.predictions.length, 'Duplicate prediction keys');
    }
    for (const observation of value.observations) {
      for (const key of ['id', 'observation', 'value', 'who', 'when', 'how'] as const) data(observation[key]);
      requireInput(['admitted', 'disputed', 'withdrawn'].includes(observation.status) && ['host-available', 'unavailable', 'none'].includes(observation.evidenceStatus), 'Invalid observation');
      if (observation.evidence !== undefined) data(observation.evidence);
    }
    requireInput(new Set(value.hypotheses.map(entry => entry.id)).size === value.hypotheses.length && new Set(value.observations.map(entry => entry.id)).size === value.observations.length, 'Duplicate domain identities');
    if (value.conclusion !== undefined) { data(value.conclusion.cause); data(value.conclusion.reason); requireInput(Array.isArray(value.conclusion.accepted) && value.conclusion.accepted.every(entry => typeof entry === 'string') && Number.isSafeInteger(value.conclusion.revision), 'Invalid conclusion'); }
    return value;
  } catch { throw new HypothesisError('schema', 'Investigation field is absent or malformed', 'Open a Question or Issue with hypothesis open; restore valid hypothesis_state through pm if damaged'); }
}
/** Native records and owner compare-and-swap; each plan contains exactly one target. */
export class Store {
  /** Tracker-bound public SDK client. */
  readonly client: PmClient;
  /** Caller-selected tracker and mutation seams. */
  readonly options: Options;
  /** Bind SDK access without relying on cwd or Git discovery. */
  constructor(options: Options) { this.options = options; this.client = options.client ?? new PmClient({ pmRoot: options.workspace, author: options.author, noExtensions: true }); }
  /** Refuse explicitly remote effects until the host provides conditional item capabilities. */
  writable(): void { if (this.options.backend === 'remote') throw new HypothesisError('capability', 'The host lacks a backend-owned conditional item mutation service', 'Use a filesystem tracker for writes; injected host clients can still read matrix, next and resume'); }
  /** Resolve canonical attribution through SDK settings, never raw settings files. */
  async author(): Promise<string> { return selectImportAuthor(this.options.author, (await readSettings(this.options.workspace)).author_default); }
  /** Refuse a caller's stale owner revision before creating dependent native records. */
  expected(value: Investigation): void { if (this.options.expectedRevision !== undefined && this.options.expectedRevision !== value.revision) throw new HypothesisError('conflict', 'Expected investigation revision changed', 'Read matrix and retry with its current revision'); }
  /** Expose deterministic boundaries around actual SDK reads and mutations. */
  async boundary(point: Boundary): Promise<void> { await this.options.boundary?.(point); }
  /** Install missing package fields through the SDK; incompatible types refuse. */
  async register(): Promise<void> {
    this.writable();
    const types = await this.client.schemaList();
    for (const [name, folder] of [['Question', 'questions'], ['Test', 'tests']]) {
      if (![...types.builtin, ...types.custom, ...types.extension].some(type => type.name === name)) await this.client.schemaAddType(name, { folder, description: 'Native investigation context', author: await this.author() });
    }
    const fields = (await this.client.schemaListFields()).fields;
    for (const definition of FIELDS) {
      const existing = fields.find(entry => entry.key === definition.name);
      if (existing === undefined) await this.client.schemaAddField(definition.name, { type: 'string', description: 'pm-hypothesis versioned native record', author: await this.author() });
      else if (existing.type !== 'string') throw new HypothesisError('schema', 'Registered hypothesis field has an incompatible type', 'Register hypothesis_state and hypothesis_record as string fields');
    }
  }
  /** Exact complete item reads supply current CAS values, never a saved plan. */
  async get(id: string): Promise<GetResult['item']> { return (await this.client.get(id, { full: true })).item; }
  /** Certify discovery before deciding whether a deterministic native record exists. */
  async exists(id: string): Promise<boolean> { return certifyCompleteListResult(await this.client.listAllComplete({ includeBody: false })).items.some(item => item.id === id); }
  /** Materialize an immutable record, validating existing content on every retry. */
  async record(id: string, type: string, title: string, payload: string, parent?: string): Promise<void> {
    this.writable();
    const exists = await this.exists(id);
    const current = exists ? await this.get(id) : undefined;
    await this.boundary('record-read');
    if (current !== undefined) {
      if (current.hypothesis_record !== payload || current.parent !== parent || current.type !== type) throw new HypothesisError('conflict', 'Native record changed since its intent was planned', 'Inspect the linked record and retry with a new operation identity');
    } else {
      await commitItemMutations({ pmRoot: this.options.workspace, author: await this.author(), transactionId: `hypothesis-record-${digest([id, payload])}`, mutations: [{ op: 'create', id, unique: { key: 'hypothesis_record', value: payload }, options: { type, title: inert(title), parent, hypothesisRecord: payload, createMode: 'progressive' } }], onTransition: this.options.onTransition, lockWaitMs: 10000 });
    }
    // Revalidate the dependency even when the SDK adopted an interrupted creation.
    const actual = await this.get(id);
    if (actual.hypothesis_record !== payload || actual.parent !== parent || actual.type !== type) throw new HypothesisError('conflict', 'Native record no longer matches this operation', 'Inspect the linked record and retry with a new operation identity');
    await this.boundary('record-written');
  }
  /** Compare the exact current owner field under the SDK writer lock. */
  async commit(item: GetResult['item'], value: Investigation, comment: string): Promise<void> {
    this.writable();
    const encoded = JSON.stringify(value);
    const options: PmClientFullMutationOptions = { hypothesisState: encoded, comment: [comment] };
    await commitItemMutations({ pmRoot: this.options.workspace, author: await this.author(), transactionId: `hypothesis-owner-${digest([item.id, item.hypothesis_state, encoded])}`, mutations: [{ op: 'update', id: item.id, match: item.hypothesis_state === undefined ? { key: 'updated_at', value: item.updated_at } : { key: 'hypothesis_state', value: item.hypothesis_state }, options }], onTransition: this.options.onTransition, lockWaitMs: 10000 });
  }
  /** Recompute every retry from current state; unchanged also requires a fresh current read. */
  async mutate(id: string, change: (value: Investigation) => string | undefined): Promise<Investigation> {
    this.writable();
    for (let attempt = 0; attempt < 12; attempt++) {
      const item = await this.get(id); const value = state(item.hypothesis_state);
      this.expected(value);
      await this.boundary('owner-read');
      const latest = await this.get(id);
      if (latest.hypothesis_state !== item.hypothesis_state) continue;
      const comment = change(value);
      if (comment === undefined) { await this.boundary('complete'); return value; }
      value.revision++;
      try { await this.commit(item, value, comment); }
      catch (error) { if (/upsert_match_changed|no longer carries upsert key/.test(String(error))) continue; throw error; }
      await this.boundary('owner-written'); await this.boundary('complete'); return value;
    }
    throw new HypothesisError('conflict', 'Concurrent investigation writers exhausted retries', 'Retry after competing writes finish');
  }
}
