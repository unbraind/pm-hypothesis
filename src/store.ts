import { randomUUID } from 'node:crypto';
import { acquireLockLease, commitItemMutations, EXIT_CODE, getHistoryPath, PmCliError, PmClient, readHistorySnapshot, readSettings, selectImportAuthor } from '@unbrained/pm-cli/sdk';
import type { BulkItemCreateMutation, BulkItemMutation, GetResult, LockLease } from '@unbrained/pm-cli/sdk';
import type { SchemaFieldDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { data, digest, HypothesisError, inert, requireInput } from './core.ts';
import { sameDeclaration, sourceIssues } from './records.ts';
import { admissionSchema, sameSchema, usableSource, usableStatus, validateBatch } from './admission.ts';
import type { AdmissionSchema } from './admission.ts';
import { Attempts } from './attempts.ts';
import type { SourceSnapshot } from './records.ts';
import type { Boundary, Investigation, Options } from './types.ts';

/** Registered scalar envelopes keep domain records on native SDK items. */
export const FIELDS: SchemaFieldDefinition[] = ['hypothesis_state', 'hypothesis_record'].map(name => ({ name, type: 'string', optional: true }));
/** Immutable source plan, carrying its observed version without writing it. */
export interface RecordPlan { snapshot: SourceSnapshot; create?: BulkItemCreateMutation }
/** Canonical explanation encoding retained for SDK integrations. */
export { hypothesisPayload } from './records.ts';
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
/** Conditional SDK batches and current native source snapshots; no domain filesystem writes. */
export class Store {
  /** Tracker-bound public SDK client. */
  readonly client: PmClient;
  /** Immutable acquisition options for this invocation. */
  readonly options: Options;
  /** Stable command intent independent of mutable owner/source revisions. */
  readonly intent?: unknown;
  /** Registry view captured once for this invocation. */
  private policy?: AdmissionSchema;
  /** Bind SDK access without cwd or Git discovery. */
  constructor(options: Options, intent?: unknown) { this.intent = intent; this.options = { ...options }; this.client = this.options.client ?? new PmClient({ pmRoot: this.options.workspace, author: this.options.author, noExtensions: true }); }
  /** Refuse unsupported remote mutations before effects. */
  writable(): void { if (this.options.backend === 'remote') throw new HypothesisError('capability', 'The host lacks a backend-owned conditional item mutation service', 'Use a filesystem tracker for writes; injected host clients can still read investigation context'); }
  /** Attribute effects through SDK settings. */
  async author(): Promise<string> { return selectImportAuthor(this.options.author, (await readSettings(this.options.workspace)).author_default); }
  /** Require the caller's logical owner revision before planning. */
  expected(value: Investigation): void { if (this.options.expectedRevision !== undefined && this.options.expectedRevision !== value.revision) throw new HypothesisError('conflict', 'Expected investigation revision changed', 'Read matrix and retry with its current revision'); }
  /** Expose boundaries before effects and after the complete batch only. */
  async boundary(point: Boundary): Promise<void> { await this.options.boundary?.(point); }
  /** Bootstrap through the SDK; once installed, native registry edits remain authoritative. */
  async register(): Promise<void> {
    this.writable();
    const fields = (await this.client.schemaListFields()).fields;
    for (const definition of FIELDS) {
      const existing = fields.find(entry => entry.key === definition.name);
      if (existing !== undefined && existing.type !== 'string') throw new HypothesisError('schema', 'Registered hypothesis field has an incompatible type', 'Register hypothesis_state and hypothesis_record as string fields');
    }
    if (FIELDS.every(definition => fields.some(field => field.key === definition.name))) return;
    const types = await this.client.schemaList();
    for (const [name, folder] of [['Question', 'questions'], ['Test', 'tests']]) {
      if (![...types.builtin, ...types.custom, ...types.extension].some(type => type.name === name)) await this.client.schemaAddType(name, { folder, description: 'Native investigation context', author: await this.author() });
    }
    for (const definition of FIELDS) if (!fields.some(entry => entry.key === definition.name)) await this.client.schemaAddField(definition.name, { type: 'string', description: 'pm-hypothesis versioned native record', author: await this.author() });
  }
  /** Read projected native fields with complete unbounded SDK output; source strings are never summaries. */
  async get(id: string): Promise<GetResult['item']> {
    const registered = this.policy?.fields ?? (await this.client.schemaListFields()).fields;
    const fields = ['id', 'type', 'parent', 'status', 'closed_at', 'created_at', 'updated_at', 'body', ...FIELDS.filter(field => registered.some(actual => actual.key === field.name)).map(field => field.name)].join(',');
    try {
      // Explicit unbounded cost disables the SDK's budget-exceeded union member.
      return (await this.client.get(id, { outputInclude: fields, outputLimit: 'unbounded', outputBudget: 'unbounded' }) as GetResult).item;
    }
    catch (error) {
      if (error instanceof PmCliError && error.code === 'unknown_field_projection') throw new HypothesisError('conflict', 'Schema changed during the native source read', 'Read the current schema and retry');
      if (error instanceof PmCliError && error.code === 'item_document_invalid') throw new HypothesisError('schema', 'Native SDK rejected an invalid item document', 'Repair the native schema or item through pm before using its data', { item: id });
      throw error;
    }
  }
  /** Absence is an explicit precondition; unrelated SDK failures remain failures. */
  async optional(id: string): Promise<GetResult['item'] | undefined> {
    try { return await this.get(id); }
    catch (error) { if (error instanceof PmCliError && error.exitCode === EXIT_CODE.NOT_FOUND) return undefined; throw error; }
  }
  /** Read one authoritative schema/status snapshot through the SDK. */
  async schema(): Promise<AdmissionSchema> { return admissionSchema(this.client, this.options.workspace, this.options.backend === 'remote'); }
  /** Capture every dependency, including deleted sources, without interpreting saved plans. */
  async sources(value: Investigation, schema: AdmissionSchema): Promise<SourceSnapshot[]> {
    const captured = schema;
    return Promise.all([...value.hypotheses, ...value.observations].map(async record => { const item = await this.optional(record.id); return { id: record.id, item, invalidStatus: item !== undefined && !usableSource(item, captured), invalidType: item !== undefined && !captured.types.some(type => type.name === item.type), invalidSchema: !captured.fields.some(field => field.key === 'hypothesis_record' && field.type === 'string') }; }));
  }
  /** Plan a source using its first native read; never create during preparation. */
  async planRecord(id: string, type: string, title: string, encode: (current: GetResult['item'] | undefined) => string, parent?: string): Promise<RecordPlan> {
    const schema = this.policy ?? await this.schema(); const current = await this.optional(id);
    if (current === undefined && (await readHistorySnapshot(getHistoryPath(this.options.workspace, id), id)).raw !== null) throw new HypothesisError('conflict', 'A native source was removed after it had been recorded', 'Restore it through pm after review, withdraw the fact, or use a new operation identity; retries never undo deletion');
    const record = encode(current);
    await this.boundary('record-read');
    if (current !== undefined && (current.parent !== parent || current.type !== type || !usableSource(current, schema) || !schema.fields.some(field => field.key === 'hypothesis_record' && field.type === 'string'))) throw new HypothesisError('conflict', 'Native source does not match this intent', 'Inspect the native record and repair or choose a new operation identity');
    if (current !== undefined) sameDeclaration(current.hypothesis_record, record);
    if (current === undefined && !usableStatus(schema.statuses.open_status, schema)) throw new HypothesisError('conflict', 'The native default creation status is terminal or withdrawn', 'Select an active default status through the native status registry');
    await this.boundary('plan-ready');
    return { snapshot: { id, item: current, ...(current === undefined ? { historyAbsent: true as const } : {}) }, ...(current === undefined ? { create: { op: 'create' as const, id, unique: { key: 'hypothesis_record', value: record }, options: { type, status: schema.statuses.open_status, title: inert(title), parent, hypothesisRecord: record, createMode: 'progressive' } } } : {}) };
  }
  /** Validate every captured version, including absence, through authoritative SDK reads. */
  async validate(snapshots: SourceSnapshot[]): Promise<void> {
    for (const expected of snapshots) {
      if (JSON.stringify(await this.optional(expected.id)) !== JSON.stringify(expected.item) || expected.historyAbsent === true && (await readHistorySnapshot(getHistoryPath(this.options.workspace, expected.id), expected.id)).raw !== null) throw new HypothesisError('conflict', 'A captured owner or source revision changed', 'Inspect current sources and retry as a fresh invocation; no planned record was written');
    }
  }
  /** Fence a read set; duplicated identities must carry the same captured version. */
  async withSources<T>(sources: (SourceSnapshot | GetResult['item'])[], action: () => Promise<T>): Promise<T> {
    const captured = new Map<string, SourceSnapshot>();
    for (const source of sources) {
      const snapshot: SourceSnapshot = 'item' in source ? source as SourceSnapshot : { id: source.id, item: source as GetResult['item'] };
      const identity = snapshot.item?.id ?? snapshot.id;
      const previous = captured.get(identity);
      if (previous !== undefined && JSON.stringify(previous.item) !== JSON.stringify(snapshot.item)) throw new HypothesisError('conflict', 'A source changed between captured reads', 'Inspect the source and retry from a fresh investigation');
      captured.set(identity, { ...snapshot, ...(previous?.historyAbsent || snapshot.historyAbsent ? { historyAbsent: true as const } : {}) });
    }
    const ordered = [...captured.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
    const leases: LockLease[] = []; let result: T;
    try {
      if (this.options.backend !== 'remote') {
        const settings = await readSettings(this.options.workspace);
        for (const snapshot of ordered) leases.push(await acquireLockLease(this.options.workspace, snapshot.item?.id ?? snapshot.id, settings.locks.ttl_seconds, await this.author(), false, settings.governance.force_required_for_stale_lock, 10000, { maxWaitMs: 10000 }));
      }
      /** Retain every lease generation through validation and the complete SDK batch. */
      const fenced = async (index: number): Promise<T> => {
        if (index < leases.length) return leases[index].fence(() => fenced(index + 1));
        await this.validate(ordered); return action();
      };
      result = await fenced(0);
    } catch (error) {
      if (/lock/i.test(String(error))) throw new HypothesisError('conflict', 'A source lease could not be retained', 'Retry after competing source writes finish');
      throw error;
    } finally { await Promise.all(leases.reverse().map(lease => lease.release())); }
    return result;
  }
  /** Read current validity under one owner/source snapshot before deriving any decision. */
  async view(id: string) {
    const schema = this.policy = await this.schema(); const owner = await this.get(id); requireInput(owner.type === 'Question' || owner.type === 'Issue', 'Investigation owner must be a Question or Issue');
    const value = state(owner.hypothesis_state); const sources = await this.sources(value, schema);
    await this.boundary('owner-read');
    return this.withSources([{ id: owner.id, item: owner }, ...sources], async () => { sameSchema(schema, await this.schema()); return { id: owner.id, value, sources, issues: sourceIssues(owner.id, value, sources) }; });
  }
  /** One prevalidated SDK multi-item commit: the owner CAS is its first write. */
  private async commit(snapshots: SourceSnapshot[], mutations: BulkItemMutation[], schema: AdmissionSchema): Promise<void> {
    const author = await this.author();
    const intent = digest([mutations[0].id, this.intent ?? mutations.map(mutation => ({ ...mutation, ...('match' in mutation ? { match: undefined } : {}) }))]);
    const precondition = digest([snapshots, schema.signature]);
    const transactionId = `hypothesis-owner-batch-${digest([intent, precondition, randomUUID()])}`;
    const input = { pmRoot: this.options.workspace, author, transactionId, mutations };
    await this.validate(snapshots); sameSchema(schema, await this.schema());
    const preview = await validateBatch(input);
    const attempts = new Attempts(this.options.workspace, mutations[0].id);
    await attempts.plan(author, { id: transactionId, intent, precondition, status: 'planned', constraints: [...preview.unresolved_commit_constraints] });
    // Created ids are guarded by the SDK's create/unique preconditions. Existing
    // sources stay leased; the owner must remain free for its native SDK CAS.
    const owner = mutations[0].id; const created = new Set(mutations.filter(mutation => mutation.op === 'create').map(mutation => mutation.id));
    let release = (): void => undefined; let retained: Promise<unknown> = Promise.resolve();
    try {
      await this.validate(snapshots); sameSchema(schema, await this.schema());
      await commitItemMutations({ ...input, onTransition: async event => {
        if (event.transition === 'prepared') {
          // Acquire source leases after the SDK workspace writer. Every package
          // batch uses this order, including recovery of a missing native source.
          const done = new Promise<void>(resolve => { release = resolve; });
          await new Promise<void>((ready, reject) => {
            retained = this.withSources(snapshots.filter(snapshot => { const id = snapshot.item?.id ?? snapshot.id; return id !== owner && !created.has(id); }), async () => { ready(); await done; });
            void retained.catch(reject);
          });
        }
        await this.options.onTransition?.(event);
        if (event.transition === 'prepared') { await this.validate(snapshots); sameSchema(schema, await this.schema()); }
      }, lockWaitMs: 10000 });
    } finally { release(); await retained; }
    await attempts.committed(author, transactionId);
  }
  /** Fix all preconditions once; fresh creates stay in memory until the one batch. */
  async mutate(id: string, change: (value: Investigation, sources: SourceSnapshot[]) => string | undefined, prepare?: (owner: GetResult['item'], value: Investigation) => Promise<RecordPlan[]>, initialize = false, capturedOwner?: GetResult['item']): Promise<{ id: string; value: Investigation }> {
    try {
      this.writable(); const schema = this.policy = await this.schema(); const item = capturedOwner ?? await this.get(id); id = item.id;
      requireInput(item.type === 'Question' || item.type === 'Issue', 'Investigation owner must be a Question or Issue');
      const initial = initialize && item.hypothesis_state === undefined;
      const value: Investigation = initial ? { version: 1, revision: 0, hypotheses: [], observations: [] } : state(item.hypothesis_state);
      this.expected(value); const dependencies = await this.sources(value, schema);
      const plans = await prepare?.(item, value) ?? [];
      const snapshots = [{ id: item.id, item }, ...dependencies, ...plans.map(plan => plan.snapshot)];
      await this.boundary('owner-read');
      await this.validate(snapshots); sameSchema(schema, await this.schema());
      const comment = initial ? 'Opened differential investigation' : change(value, dependencies);
      const creates = plans.flatMap(plan => plan.create === undefined ? [] : [plan.create]);
      await this.boundary('admission-ready');
      try {
        if (comment !== undefined || creates.length > 0) {
          if (!initial && comment !== undefined) value.revision++;
          const mutation: BulkItemMutation = { op: 'update', id: item.id, match: { key: 'updated_at', value: item.updated_at }, options: { hypothesisState: JSON.stringify(value), comment: [comment ?? 'Restored missing native investigation sources'] } };
          await this.commit(snapshots, [mutation, ...creates], schema);
          await this.boundary('owner-written'); if (plans.length > 0) await this.boundary('record-written');
        } else await this.withSources(snapshots, async () => { sameSchema(schema, await this.schema()); if (this.intent !== undefined) await new Attempts(this.options.workspace, item.id).satisfied(await this.author(), digest([item.id, this.intent])); });
      } catch (error) {
        if (error instanceof PmCliError && error.exitCode === EXIT_CODE.CONFLICT || /upsert_match_changed|no longer carries upsert key|already exists|upsert_key_conflict/.test(String(error))) throw new HypothesisError('conflict', 'A conditional batch precondition changed', 'Read the current investigation and retry with the same intent');
        throw error;
      }
      await this.boundary('complete'); return { id: item.id, value };
    } catch (error) {
      if (error instanceof HypothesisError && ['missing', 'invalid', 'schema'].includes(error.code) && this.intent !== undefined) {
        const intent = digest([id, this.intent]); const pending = (await new Attempts(this.options.workspace, id).read()).some(attempt => attempt.intent === intent && attempt.status === 'planned');
        if (pending) throw new HypothesisError('conflict', 'The current target no longer supports the interrupted intent', 'Inspect the current owner and sources; repair the conflicting edit or choose a different intent');
      }
      throw error;
    }
  }
  /** Create the investigation and its initial envelope in one native SDK creation. */
  async initialize(id: string, title: string, create: boolean): Promise<{ id: string }> {
    this.writable(); const schema = this.policy = await this.schema(); const item = await this.optional(id);
    if (item !== undefined) {
      if (create && item.hypothesis_record !== JSON.stringify({ kind: 'investigation', id, title })) throw new HypothesisError('conflict', 'Investigation source does not match this intent', 'Inspect the native investigation or use a new operation identity');
      return this.mutate(item.id, () => undefined, undefined, true, item);
    }
    requireInput(create, 'The selected native investigation does not exist');
    if ((await readHistorySnapshot(getHistoryPath(this.options.workspace, id), id)).raw !== null) throw new HypothesisError('conflict', 'The investigation identity was deleted', 'Restore the native investigation through pm or use a new operation identity');
    this.expected({ version: 1, revision: 0, hypotheses: [], observations: [] });
    await this.boundary('record-read'); await this.boundary('plan-ready'); await this.boundary('owner-read'); await this.boundary('admission-ready');
    if (!usableStatus(schema.statuses.open_status, schema)) throw new HypothesisError('conflict', 'The native default creation status is not admissible', 'Select an active default status through the native registry');
    const record = JSON.stringify({ kind: 'investigation', id, title });
    await this.commit([{ id, item, historyAbsent: true }], [{ op: 'create', id, unique: { key: 'hypothesis_record', value: record }, options: { type: 'Question', status: schema.statuses.open_status, title: inert(title), hypothesisRecord: record, hypothesisState: JSON.stringify({ version: 1, revision: 0, hypotheses: [], observations: [] }), comment: ['Opened differential investigation'], createMode: 'progressive' } }], schema);
    await this.boundary('owner-written'); await this.boundary('record-written'); await this.boundary('complete'); return { id };
  }
}
