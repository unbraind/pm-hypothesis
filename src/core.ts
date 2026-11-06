import { createHash } from 'node:crypto';
import { estimatePmOutputTokens, fitOutputEnvelope, OutputEnvelopeFitError, WorkspaceTransactionInterruptedError } from '@unbrained/pm-cli/sdk';
import { encode } from '@toon-format/toon';
import type { Packet, SourceIssue } from './types.ts';

/** Typed refusal shared by SDK and CLI, with safe diagnostics and a concrete remedy. */
export class HypothesisError extends Error {
  /** Classify the refusal for embedded callers. */
  readonly code: string;
  /** Describe the next permitted action. */
  readonly remedy: string;
  /** Safe structured comparison evidence, containing digests rather than untrusted declarations. */
  readonly details?: Record<string, string>;
  /** Retain no private SDK diagnostics. */
  constructor(code: string, message: string, remedy: string, details?: Record<string, string>) { super(message); this.name = 'HypothesisError'; this.code = code; this.remedy = remedy; this.details = details; }
}
/** Enforce a safe package contract without echoing untrusted values. */
export function requireInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw new HypothesisError('invalid', message, 'Use documented operands and bounds; read pm hypothesis --help');
}
/** Escape terminal controls, markup and line breaks while retaining their exact data identity. */
export function inert(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f<>`]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
/** Validate and render a bounded data string; command-like text is always quoted data. */
export function data(value: string): string { requireInput(typeof value === 'string' && value.trim().length > 0 && value.length <= 8192 && value.isWellFormed(), 'Text must contain 1 to 8192 well-formed Unicode code units'); return value; }
/** Stable intent identities support interrupted retry without relying on a wall clock. */
export function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24); }
/** Render control characters reversibly at the wire boundary, preserving decoded identities. */
export function wire(value: unknown, format: 'json' | 'toon'): string {
  const controls = /[\u007f-\u009f]/;
  /** JSON quoting preserves control bytes after decoding without terminal interpretation. */
  const json = (entry: unknown): string => JSON.stringify(entry, null, 2).replace(/[\u007f-\u009f]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  if (format === 'json') return json(value);
  const encoded = encode(value, { replacer: (_key, entry) => {
    if (typeof entry === 'string' && controls.test(entry)) return entry + '\n';
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) return Object.fromEntries(Object.entries(entry).map(([key, content]) => [controls.test(key) ? key + '\n' : key, content]));
    return entry;
  } });
  return encoded.replace(/"(?:\\.|[^"\\])*"/g, quoted => {
    const text = JSON.parse(quoted) as string;
    return controls.test(text) ? json(text.slice(0, -1)) : quoted;
  });
}
/** Estimate the larger actual lossless JSON and TOON transport, including newline. */
export function tokens(value: unknown): number { return estimatePmOutputTokens(Math.max(Buffer.byteLength(wire(value, 'json') + '\n'), Buffer.byteLength(wire(value, 'toon') + '\n'))); }
/** Include source-issue and row prefixes using SDK-owned bounded envelope fitting. */
export function packet<T>(investigation: string, revision: number, rows: T[], budget: number, restore: string, issues: SourceIssue[] = []): Packet<T> {
  requireInput(Number.isSafeInteger(budget) && budget > 0 && budget <= 1_000_000, 'Budget must be an integer from 1 to 1000000');
  /** Preserve the public receipt while the SDK owns its self-inclusive estimate. */
  const make = (selected: readonly T[], selectedIssues: readonly SourceIssue[], estimatedTokens: number): Packet<T> => ({ investigation, revision, rows: [...selected], receipt: { sourceComplete: true, returned: selected.length, omitted: rows.length - selected.length, complete: selected.length === rows.length && selectedIssues.length === issues.length, restore, ...(issues.length > 0 ? { sourceIssues: { returned: [...selectedIssues], omitted: issues.length - selectedIssues.length } } : {}), estimator: 'ceil(max(json,toon)_utf8_bytes/4)' }, estimatedTokens });
  /** Project SDK accounting into the existing packet schema in both measured renderers. */
  const fit = <Candidate,>(candidates: readonly Candidate[], build: (selected: readonly Candidate[], estimate: number) => Packet<T>): Packet<T> => {
    const fitted = fitOutputEnvelope(candidates, {
      tokenBudget: budget, policy: 'prefix',
      buildEnvelope: (selected, receipt) => ({ packet: build(selected, receipt.estimated_tokens) }),
      renderers: { json: envelope => wire(envelope.packet, 'json') + '\n', toon: envelope => wire(envelope.packet, 'toon') + '\n' },
    });
    return fitted.envelope.packet;
  };
  try {
    // Issue details have priority, but an oversized issue must not block smaller rows.
    const selectedIssues = issues.length > 0 ? fit(issues, (selected, estimate) => make([], selected, estimate)).receipt.sourceIssues!.returned : [];
    return fit(rows, (selected, estimate) => make(selected, selectedIssues, estimate));
  } catch (error) {
    if (!(error instanceof OutputEnvelopeFitError)) throw error;
    if (error.code === 'output_envelope_infeasible') throw new HypothesisError('budget', 'Budget cannot hold the omission receipt', 'Increase --budget');
    throw new HypothesisError(error.code, 'Output fitting could not certify a bounded packet', 'Use pm hypothesis show to restore the complete investigation');
  }
}

/** Normalize JSON-compatible envelopes without changing any data string. */
export function safe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Adapt public SDK functions to typed refusals while preserving explicit crash-test faults. */
export function guarded<Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    try { return await operation(...args); }
    catch (error) {
      if (error instanceof HypothesisError || error instanceof WorkspaceTransactionInterruptedError) throw error;
      throw new HypothesisError('sdk', 'Investigation SDK operation failed', 'Check pm health, tracker access and schema; retry the same operation');
    }
  };
}

/** Quote one canonical item identity as a reusable shell operand in recovery receipts. */
export function operand(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }
