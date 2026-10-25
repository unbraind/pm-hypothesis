import type { GetResult } from '@unbrained/pm-cli/sdk';
import type { Hypothesis, Investigation, Observation, SourceIssue } from './types.ts';

/** Native source snapshot; absence is an explicit read precondition. */
export interface SourceSnapshot { id: string; item: GetResult['item'] | undefined; historyAbsent?: true }
/** Bind a declared explanation to its native identity and investigation. */
export function hypothesisPayload(investigation: string, hypothesis: Hypothesis): string { return JSON.stringify({ kind: 'hypothesis', id: hypothesis.id, investigation, statement: hypothesis.statement, predictions: hypothesis.predictions }); }
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
    const native = sources.find(source => source.id === record.id)?.item;
    let reason: SourceIssue['reason'] | undefined;
    if (native === undefined) reason = 'missing';
    else if (native.id !== record.id) reason = 'payload';
    else if (native.type !== (kind === 'hypothesis' ? 'Question' : 'Test')) reason = 'type';
    else if (native.parent !== investigation) reason = 'parent';
    else if (native.closed_at !== undefined || native.status === 'withdrawn') reason = 'withdrawn';
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
