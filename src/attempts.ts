import { join } from 'node:path';
import { acquireLockLease, readFileIfExists, readSettings, writeFileAtomic } from '@unbrained/pm-cli/sdk';
import { digest, HypothesisError } from './core.ts';

/** Package-owned recovery lineage; SDK journals remain untouched. */
export interface Attempt { id: string; intent: string; precondition: string; status: 'planned' | 'committed' | 'superseded' | 'satisfied'; constraints: string[]; supersededBy?: string }

/** Runtime attempt state is advisory and contains identities/digests only. */
export class Attempts {
  /** Filesystem tracker owning the SDK runtime cache. */
  readonly workspace: string;
  /** Canonical native owner identity, never a filesystem operand. */
  readonly owner: string;
  /** Keep attempt files outside authoritative native records and SDK journals. */
  constructor(workspace: string, owner: string) { this.workspace = workspace; this.owner = owner; }
  /** Derive a package-owned, traversal-free runtime location. */
  private path(): string { return join(this.workspace, 'runtime', 'pm-hypothesis', `${digest(this.owner)}.json`); }
  /** Read validated lineage through the public SDK file primitive. */
  async read(): Promise<Attempt[]> {
    const raw = await readFileIfExists(this.path()); if (raw === null) return [];
    try {
      const value = JSON.parse(raw) as Attempt[];
      if (!Array.isArray(value) || !value.every(row => typeof row.id === 'string' && typeof row.intent === 'string' && typeof row.precondition === 'string' && Array.isArray(row.constraints) && row.constraints.every(value => typeof value === 'string') && ['planned', 'committed', 'superseded', 'satisfied'].includes(row.status) && (row.supersededBy === undefined || typeof row.supersededBy === 'string'))) throw Error('Invalid attempts');
      return value;
    } catch { throw new HypothesisError('schema', 'Package recovery lineage is malformed', 'Inspect the package runtime attempt cache; preserve SDK journals and native item history'); }
  }
  /** Serialize advisory updates with an SDK lease and atomic runtime publication. */
  async update(author: string, edit: (rows: Attempt[]) => void): Promise<void> {
    const settings = await readSettings(this.workspace);
    const lease = await acquireLockLease(this.workspace, `hypothesis-attempts-${digest(this.owner)}`, settings.locks.ttl_seconds, author, false, settings.governance.force_required_for_stale_lock, 10000, { maxWaitMs: 10000 });
    try { await lease.fence(async () => { const rows = await this.read(); const before = JSON.stringify(rows); edit(rows); const after = JSON.stringify(rows); if (before !== after) await writeFileAtomic(this.path(), after); }); }
    finally { await lease.release(); }
  }
  /** Record a validated plan and explicitly supersede earlier attempts at different preconditions. */
  async plan(author: string, attempt: Attempt): Promise<void> {
    await this.update(author, rows => {
      for (const row of rows) if (row.status === 'planned' && row.intent === attempt.intent) { row.status = 'superseded'; row.supersededBy = attempt.id; }
      rows.push(attempt);
    });
  }
  /** Reconcile a successful no-op from current native records without replaying a saved plan. */
  async satisfied(author: string, intent: string): Promise<void> {
    await this.update(author, rows => { for (const row of rows) if (row.status === 'planned' && row.intent === intent) row.status = 'satisfied'; });
  }
  /** Mark only an invocation whose SDK commit actually returned success. */
  async committed(author: string, id: string): Promise<void> {
    await this.update(author, rows => { const row = rows.find(entry => entry.id === id); if (row !== undefined) { row.status = 'committed'; delete row.supersededBy; } });
  }
}
