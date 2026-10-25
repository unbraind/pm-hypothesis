import type { PmClient, CommitItemMutationsOptions } from '@unbrained/pm-cli/sdk';

/** Equality prediction: an exact observation key must have an exact string value. */
export interface Prediction { observation: string; value: string }
/** Competing explanation with a native Question identity. */
export interface Hypothesis { id: string; statement: string; predictions: Prediction[] }
/** Original fact and provenance; the owner alone governs its current admission. */
export interface Observation { id: string; observation: string; value: string; status: 'admitted' | 'disputed' | 'withdrawn'; who: string; when: string; how: string; evidence?: string; evidenceStatus: 'host-available' | 'unavailable' | 'none' }
/** Explicit conclusion; later changes invalidate its revision basis. */
export interface Conclusion { cause: string; reason: string; accepted: string[]; revision: number }
/** Atomic owner envelope; no cached elimination state can drift from the facts. */
export interface Investigation { version: 1; revision: number; hypotheses: Hypothesis[]; observations: Observation[]; conclusion?: Conclusion }
/** Deterministic seam around real SDK operations, used for crash/interleaving acceptance. */
export type Boundary = 'record-read' | 'record-written' | 'owner-read' | 'owner-written' | 'complete';
/** Tracker binding; a host client may be injected for reads and extension discovery. */
export interface Options {
  workspace: string;
  backend?: 'filesystem' | 'remote';
  author?: string;
  client?: PmClient;
  expectedRevision?: number;
  operationId?: string;
  boundary?: (point: Boundary) => Promise<void>;
  onTransition?: CommitItemMutationsOptions['onTransition'];
}
/** Observation input; a withdrawal needs only the existing observation identity. */
export interface ObserveOptions extends Options { evidence?: string; how?: string; when?: string; status?: 'admitted' | 'disputed'; withdraw?: string }
/** A single admitted contradictory observation, preserving prediction and provenance. */
export interface Witness { prediction: Prediction; observation: Observation }
/** Computed hypothesis disposition, with every witness and unobserved prediction. */
export interface MatrixRow extends Hypothesis { status: 'eliminated' | 'viable' | 'unknown'; witnesses: Witness[]; open: Prediction[] }
/** Pair split score and possible value groups; unspecified explanations are preserved. */
export interface Request { observation: string; pairs: number; groups: { value: string; hypotheses: string[] }[]; unspecified: string[] }
/** Bounded output with an exact count of withheld rows from a complete owner read. */
export interface Packet<T> { investigation: string; revision: number; rows: T[]; receipt: { sourceComplete: true; returned: number; omitted: number; complete: boolean; restore: string; estimator: string }; estimatedTokens: number }
/** Resume rows remain discriminated data, never executable instructions. */
export type ResumeRow = { kind: 'next'; request: Request | null } | { kind: 'hypothesis'; hypothesis: Pick<MatrixRow, 'id' | 'statement' | 'status' | 'open'> } | { kind: 'witness'; hypothesis: string; observation: string; key: string; expected: string; actual: string; who: string; when: string; how: string; evidence?: string } | { kind: 'conclusion'; conclusion: Conclusion; stale: boolean };
