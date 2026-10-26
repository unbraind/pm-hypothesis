import type { GetResult } from '@unbrained/pm-cli/sdk';
import type { Hypothesis, Investigation, Observation, Prediction, SourceIssue } from './types.ts';
import { digest, HypothesisError } from './core.ts';

/** Native source snapshot; absence is an explicit read precondition. */
export interface SourceSnapshot { id: string; item: GetResult['item'] | undefined; historyAbsent?: true; invalidStatus?: boolean; invalidType?: boolean; invalidSchema?: boolean }
/** Canonicalize exact keys with a byte tie-break when Unicode collation considers distinct keys equal. */
export function canonicalPredictions(predictions: Prediction[]): Prediction[] { return predictions.map(({ observation, value }) => ({ observation, value })).sort((a, b) => a.observation.localeCompare(b.observation, 'en') || Buffer.compare(Buffer.from(a.observation), Buffer.from(b.observation))); }
/** Bind a declared explanation to its native identity and investigation. */
export function hypothesisPayload(investigation: string, hypothesis: Hypothesis): string { return JSON.stringify({ kind: 'hypothesis', id: hypothesis.id, investigation, statement: hypothesis.statement, predictions: canonicalPredictions(hypothesis.predictions) }); }
/** Idempotence compares canonical declarations, rather than trusting a matching native id. */
export function sameDeclaration(stored: unknown, requested: unknown): void {
  const storedDeclaration = JSON.stringify({ type: typeof stored, value: stored }); const requestedDeclaration = JSON.stringify({ type: typeof requested, value: requested });
  const storedDigest = digest(storedDeclaration); const requestedDigest = digest(requestedDeclaration);
  if (storedDeclaration !== requestedDeclaration) throw new HypothesisError('declaration_mismatch', `Stored declaration ${storedDigest} differs from requested declaration ${requestedDigest}`, 'Inspect the owner and native declaration; restore the intended declaration or choose a new operation identity', { storedDigest, requestedDigest });
}
/** Encode immutable observation provenance, including its effective acquisition time. */
export function observationPayload(investigation: string, fact: Observation, status: 'admitted' | 'disputed'): string {
  return JSON.stringify({ kind: 'observation', id: fact.id, investigation, observation: fact.observation, value: fact.value, status, who: fact.who, how: fact.how, when: fact.when, evidence: fact.evidence });
}
/** Parse a source object without executing text or accepting arrays and scalars. */
export function payload(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string') return undefined;
  try { const value: unknown = JSON.parse(raw); return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
  catch { return undefined; }
}
/** Validate every current native source against the owner's sealed declarations. */
export function sourceIssues(investigation: string, value: Investigation, sources: SourceSnapshot[]): SourceIssue[] {
  return [...value.hypotheses.map(h => ({ kind: 'hypothesis' as const, record: h })), ...value.observations.map(o => ({ kind: 'observation' as const, record: o }))].flatMap(({ kind, record }): SourceIssue[] => {
    const snapshot = sources.find(source => source.id === record.id); const native = snapshot?.item;
    let reason: SourceIssue['reason'] | undefined;
    if (native === undefined) reason = 'missing';
    else if (snapshot?.invalidSchema) reason = 'schema';
    else if (native.id !== record.id) reason = 'payload';
    else if (snapshot?.invalidType || native.type !== (kind === 'hypothesis' ? 'Question' : 'Test')) reason = 'type';
    else if (native.parent !== investigation) reason = 'parent';
    else if (snapshot?.invalidStatus || native.closed_at !== undefined || native.status === 'withdrawn') reason = 'withdrawn';
    else if (kind === 'hypothesis') {
      if (native.hypothesis_record !== hypothesisPayload(investigation, record as Hypothesis)) reason = 'payload';
    } else {
      const fact = record as Observation; const raw = payload(native.hypothesis_record);
      const keys = ['kind', 'id', 'investigation', 'observation', 'value', 'status', 'who', 'how', 'when', 'evidence'];
      if (raw === undefined || Object.keys(raw).some(key => !keys.includes(key)) || raw.kind !== 'observation' || raw.id !== fact.id || raw.investigation !== investigation || typeof raw.observation !== 'string' || typeof raw.value !== 'string' || typeof raw.who !== 'string' || typeof raw.how !== 'string' || !['admitted', 'disputed', 'withdrawn'].includes(String(raw.status)) || raw.when !== undefined && (typeof raw.when !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(raw.when) || !Number.isFinite(Date.parse(raw.when))) || raw.evidence !== undefined && typeof raw.evidence !== 'string') reason = 'payload';
      else if (raw.status === 'withdrawn') reason = 'withdrawn';
      else if (raw.observation !== fact.observation || raw.value !== fact.value || raw.who !== fact.who || raw.how !== fact.how || (raw.when ?? native.created_at) !== fact.when || raw.evidence !== fact.evidence || fact.status !== 'withdrawn' && raw.status !== fact.status) reason = 'provenance';
    }
    return reason === undefined ? [] : [{ id: record.id, kind, reason }];
  });
}
/** Invalid withdrawn facts are historical context, not a basis for a decision. */
export function usedIssues(value: Investigation, issues: SourceIssue[]): SourceIssue[] { return issues.filter(issue => issue.kind === 'hypothesis' || value.observations.find(fact => fact.id === issue.id)?.status !== 'withdrawn'); }
