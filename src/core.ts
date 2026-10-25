import { createHash } from 'node:crypto';
import { WorkspaceTransactionInterruptedError } from '@unbrained/pm-cli/sdk';
import { encode } from '@toon-format/toon';
import type { Packet, SourceIssue } from './types.ts';

/** Typed refusal shared by SDK and CLI, with safe diagnostics and a concrete remedy. */
export class HypothesisError extends Error {
  /** Classify the refusal for embedded callers. */
  readonly code: string;
  /** Describe the next permitted action. */
  readonly remedy: string;
  /** Retain no private SDK diagnostics. */
  constructor(code: string, message: string, remedy: string) { super(message); this.name = 'HypothesisError'; this.code = code; this.remedy = remedy; }
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
export function data(value: string): string { requireInput(typeof value === 'string' && value.trim().length > 0 && value.length <= 8192, 'Text must contain 1 to 8192 characters'); return value; }
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
export function tokens(value: unknown): number { return Math.ceil(Math.max(Buffer.byteLength(wire(value, 'json') + '\n'), Buffer.byteLength(wire(value, 'toon') + '\n')) / 4); }
/** Stabilize the self-inclusive byte estimate before enforcing the bound. */
function account<T>(value: Packet<T>): Packet<T> { let count = tokens(value); while (value.estimatedTokens !== count) { value.estimatedTokens = count; count = tokens(value); } return value; }
/** Include a deterministic prefix of rows and an omission receipt in the requested budget. */
export function packet<T>(investigation: string, revision: number, rows: T[], budget: number, restore: string, issues: SourceIssue[] = []): Packet<T> {
  requireInput(Number.isSafeInteger(budget) && budget > 0 && budget <= 1_000_000, 'Budget must be an integer from 1 to 1000000');
  let selectedIssues: SourceIssue[] = [];
  const make = (selected: T[]): Packet<T> => account({ investigation, revision, rows: selected, receipt: { sourceComplete: true, returned: selected.length, omitted: rows.length - selected.length, complete: selected.length === rows.length && selectedIssues.length === issues.length, restore, ...(issues.length > 0 ? { sourceIssues: { returned: selectedIssues, omitted: issues.length - selectedIssues.length } } : {}), estimator: 'ceil(max(json,toon)_utf8_bytes/4)' }, estimatedTokens: 0 });
  let result = make([]);
  if (result.estimatedTokens > budget) throw new HypothesisError('budget', 'Budget cannot hold the omission receipt', 'Increase --budget');
  for (const issue of issues) { selectedIssues = [...selectedIssues, issue]; const next = make([]); if (next.estimatedTokens > budget) { selectedIssues = selectedIssues.slice(0, -1); break; } result = next; }
  for (const row of rows) { const next = make([...result.rows, row]); if (next.estimatedTokens > budget) break; result = next; }
  return result;
}

/** Escape human display fields only; reusable identities and values stay byte-exact. */
export function safe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, entry: unknown) => typeof entry === 'string' && ['statement', 'reason', 'how'].includes(key) ? inert(entry) : entry)) as T;
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
