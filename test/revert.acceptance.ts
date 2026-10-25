import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Behavioral reversions replace only the named implementation branch, never test assertions. */
const proofs = [
  { file: 'src/store.ts', label: 'managed installation: restore whole-tracker preview', before: '    const schema = await resolveTransactionSchema(this.options.workspace, await readSettings(this.options.workspace));', after: '    await previewItemMutations({ pmRoot: this.options.workspace, author, transactionId, mutations });\n    const schema = await resolveTransactionSchema(this.options.workspace, await readSettings(this.options.workspace));', preview: true, test: 'test/source-validity.test.ts', pattern: '^managed extension executable' },
  { file: 'src/store.ts', label: 'atomic command: recreate the create-before-validate sequence', before: "const snapshots = [{ id: item.id, item }, ...dependencies, ...plans.map(plan => plan.snapshot)];", after: "const snapshots = [{ id: item.id, item }, ...dependencies, ...plans.map(plan => plan.snapshot)];\n    for (const plan of plans) if (plan.create !== undefined) { await commitItemMutations({ pmRoot: this.options.workspace, author: await this.author(), transactionId: `revert-precreate-${digest([plan.create])}`, mutations: [plan.create] }); plan.snapshot.item = await this.get(plan.snapshot.id); delete plan.snapshot.historyAbsent; delete plan.create; }", test: 'test/atomic-sources.test.ts', pattern: '^atomic command:' },
  { file: 'src/records.ts', label: 'source validity: trust edited native payloads', before: "export function sourceIssues(investigation: string, value: Investigation, sources: SourceSnapshot[]): SourceIssue[] {", after: "export function sourceIssues(investigation: string, value: Investigation, sources: SourceSnapshot[]): SourceIssue[] { return [];", test: 'test/atomic-sources.test.ts', pattern: '^current source invariants:' },
  { file: 'src/store.ts', label: 'invocation CAS: restore owner retry that refreshes source preconditions', before: "await this.boundary('owner-read');\n    await this.validate(snapshots);", after: "await this.boundary('owner-read');\n    if (JSON.stringify(await this.get(id)) !== JSON.stringify(item)) return this.mutate(id, change, prepare, initialize);\n    await this.validate(snapshots);", test: 'test/cas-invocation.test.ts', pattern: '^invocation CAS:' },
  { file: 'src/derive.ts', label: 'derive: disable contradiction elimination', before: "witnesses.length > 0 ? 'eliminated'", after: "false ? 'eliminated'", test: 'test/hypothesis.test.ts', pattern: '^acceptance:' },
  { file: 'src/hypothesis.ts', label: 'observe: retain withdrawn admission', before: "fact.status = 'withdrawn';", after: "fact.status = fact.status;", test: 'test/hypothesis.test.ts', pattern: '^acceptance:' },
  { file: 'src/hypothesis.ts', label: 'conclude: permit unacknowledged survivors', before: 'if (JSON.stringify(others) !== JSON.stringify(accepted))', after: 'if (false)', test: 'test/hypothesis.test.ts', pattern: '^conclusions refuse' },
  { file: 'src/derive.ts', label: 'choose: prefer lower discrimination', before: 'b.pairs - a.pairs', after: 'a.pairs - b.pairs', test: 'test/edges.test.ts', pattern: '^next-request pair' },
  { file: 'src/core.ts', label: 'packet: ignore output budget', before: 'if (next.estimatedTokens > budget) break;', after: 'if (false) break;', test: 'test/hypothesis.test.ts', pattern: '^admission, repeated' },
  { file: 'src/store.ts', label: 'expected: ignore explicit expected revision', before: 'if (this.options.expectedRevision !== undefined && this.options.expectedRevision !== value.revision)', after: 'if (false)', test: 'test/hypothesis.test.ts', pattern: '^conclusions refuse' },
  { file: 'src/store.ts', label: 'source CAS: skip authoritative revision validation', before: 'if (JSON.stringify(await this.optional(expected.id)) !== JSON.stringify(expected.item) || expected.historyAbsent === true', after: 'if (false && JSON.stringify(await this.optional(expected.id)) !== JSON.stringify(expected.item) || false && expected.historyAbsent === true', test: 'test/review-classes.test.ts', pattern: '^admission refuses' },
  { file: 'src/core.ts', label: 'identity: escape reusable keys and values', before: "typeof entry === 'string' && ['statement', 'reason', 'how'].includes(key)", after: "typeof entry === 'string'", test: 'test/review-classes.test.ts', pattern: '^next-request identities' },
  { file: 'src/hypothesis.ts', label: 'restore: advertise a matrix that omits conclusions', before: "safe(content), options.budget ?? 1500, `pm hypothesis show ${operand(investigation)} --json`", after: "safe(content), options.budget ?? 1500, 'pm hypothesis matrix <investigation> --budget 1000000'", test: 'test/review-classes.test.ts', pattern: '^bounded conclusion restoration' },
];
for (const proof of proofs) {
  const path = resolve(import.meta.dirname, '..', proof.file); const original = readFileSync(path, 'utf8'); assert.ok(original.includes(proof.before));
  try {
    const edited = original.replace(proof.before, proof.after);
    writeFileSync(path, 'preview' in proof ? edited.replace('parseItemMutationBatch,', 'previewItemMutations, parseItemMutationBatch,') : edited);
    const result = spawnSync(process.execPath, ['--test', `--test-name-pattern=${proof.pattern}`, proof.test], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 180000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 1, `${proof.label} must fail behaviorally`); assert.match(result.stdout + result.stderr, /AssertionError|Missing expected rejection/);
    console.log(`REVERT PROVED: ${proof.label}`);
  } finally { writeFileSync(path, original); assert.equal(readFileSync(path, 'utf8'), original); }
}
