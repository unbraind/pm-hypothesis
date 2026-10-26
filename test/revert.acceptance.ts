import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/** Behavioral reversions replace only the named implementation branch, never test assertions. */
const proofs = [
  { file: 'src/store.ts', label: 'native creation policy: apply an unused default to existing-source replays', before: 'if (current === undefined && !usableStatus(schema.statuses.open_status, schema))', after: 'if (!usableStatus(schema.statuses.open_status, schema))', test: 'test/admission-internals.test.ts', pattern: '^native registry workflow:' },
  { file: 'src/records.ts', label: 'missing declaration: hash absent SDK data without canonical framing', before: 'JSON.stringify({ type: typeof stored, value: stored })', after: 'JSON.stringify(stored)', test: 'test/admission.test.ts', pattern: '^replay declaration: a missing native' },
  { file: 'src/store.ts', label: 'native registry authority: silently recreate removed types on replay', before: 'if (FIELDS.every(definition => fields.some(field => field.key === definition.name))) return;', after: 'void fields;', test: 'test/admission-internals.test.ts', pattern: '^native bootstrap: installed fields' },
  { file: 'src/records.ts', label: 'canonical replay: collapse distinct Unicode collation ties', before: " || Buffer.compare(Buffer.from(a.observation), Buffer.from(b.observation))", after: '', test: 'test/admission.test.ts', pattern: '^replay declaration: canonical Unicode' },
  { file: 'src/admission.ts', label: 'native validation: bypass lifecycle preview', before: 'const receipt = await previewItemMutations(input);', after: 'const receipt = { validated: true, unresolved_commit_constraints: [] };', test: 'test/admission.test.ts', pattern: '^native admission: removed Test' },
  { file: 'src/admission.ts', label: 'status registry: accept withdrawn sources', before: 'return definition !== undefined && status !==', after: 'return true || definition !== undefined && status !==', test: 'test/admission.test.ts', pattern: '^native admission: a withdrawn' },
  { file: 'src/hypothesis.ts', label: 'same intent: accept edited owner declarations', before: 'sameDeclaration(hypothesisPayload(investigation, original), hypothesisPayload(investigation, { id, statement, predictions }));', after: 'void original;', test: 'test/admission.test.ts', pattern: '^replay declaration:' },
  { file: 'src/core.ts', label: 'data boundary: escape public data strings', before: 'return JSON.parse(JSON.stringify(value)) as T;', after: "return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === 'string' ? inert(entry) : entry)) as T;", test: 'test/admission.test.ts', pattern: '^issue 5:' },
  { file: 'src/store.ts', label: 'recovery: reuse an intent-only transaction id', before: 'digest([intent, precondition, randomUUID()])', after: 'digest([intent])', test: 'test/admission.test.ts', pattern: '^issue 6:' },
  { file: 'src/attempts.ts', label: 'recovery lineage: forget superseded attempts', before: "for (const row of rows) if (row.status === 'planned' && row.intent === attempt.intent) { row.status = 'superseded'; row.supersededBy = attempt.id; }", after: 'void attempt;', test: 'test/admission.test.ts', pattern: '^issue 6:' },
  { file: 'src/store.ts', label: 'complete reads: restore default SDK compaction', before: "outputInclude: fields, outputLimit: 'unbounded', outputBudget: 'unbounded'", after: 'outputInclude: fields', test: 'test/admission.test.ts', pattern: '^authoritative reads' },
  { file: 'src/store.ts', label: 'atomic command: recreate the create-before-validate sequence', before: "const snapshots = [{ id: item.id, item }, ...dependencies, ...plans.map(plan => plan.snapshot)];", after: "const snapshots = [{ id: item.id, item }, ...dependencies, ...plans.map(plan => plan.snapshot)];\n    for (const plan of plans) if (plan.create !== undefined) { await commitItemMutations({ pmRoot: this.options.workspace, author: await this.author(), transactionId: `revert-precreate-${digest([plan.create])}`, mutations: [plan.create] }); plan.snapshot.item = await this.get(plan.snapshot.id); delete plan.snapshot.historyAbsent; delete plan.create; }", test: 'test/atomic-sources.test.ts', pattern: '^atomic command:' },
  { file: 'src/records.ts', label: 'source validity: trust edited native payloads', before: "export function sourceIssues(investigation: string, value: Investigation, sources: SourceSnapshot[]): SourceIssue[] {", after: "export function sourceIssues(investigation: string, value: Investigation, sources: SourceSnapshot[]): SourceIssue[] { return [];", test: 'test/atomic-sources.test.ts', pattern: '^current source invariants:' },
  { file: 'src/store.ts', label: 'invocation CAS: restore owner retry that refreshes source preconditions', before: "await this.boundary('owner-read');\n      await this.validate(snapshots);", after: "await this.boundary('owner-read');\n      if (JSON.stringify(await this.get(id)) !== JSON.stringify(item)) return this.mutate(id, change, prepare, initialize);\n      await this.validate(snapshots);", test: 'test/cas-invocation.test.ts', pattern: '^invocation CAS:' },
  { file: 'src/derive.ts', label: 'derive: disable contradiction elimination', before: "witnesses.length > 0 ? 'eliminated'", after: "false ? 'eliminated'", test: 'test/hypothesis.test.ts', pattern: '^acceptance:' },
  { file: 'src/hypothesis.ts', label: 'observe: retain withdrawn admission', before: "fact.status = 'withdrawn';", after: "fact.status = fact.status;", test: 'test/hypothesis.test.ts', pattern: '^acceptance:' },
  { file: 'src/hypothesis.ts', label: 'conclude: permit unacknowledged survivors', before: 'if (JSON.stringify(others) !== JSON.stringify(accepted))', after: 'if (false)', test: 'test/hypothesis.test.ts', pattern: '^conclusions refuse' },
  { file: 'src/derive.ts', label: 'choose: prefer lower discrimination', before: 'b.pairs - a.pairs', after: 'a.pairs - b.pairs', test: 'test/edges.test.ts', pattern: '^next-request pair' },
  { file: 'src/core.ts', label: 'packet: ignore output budget', before: 'if (next.estimatedTokens > budget) break;', after: 'if (false) break;', test: 'test/hypothesis.test.ts', pattern: '^admission, repeated' },
  { file: 'src/store.ts', label: 'expected: ignore explicit expected revision', before: 'if (this.options.expectedRevision !== undefined && this.options.expectedRevision !== value.revision)', after: 'if (false)', test: 'test/hypothesis.test.ts', pattern: '^conclusions refuse' },
  { file: 'src/store.ts', label: 'source CAS: skip authoritative revision validation', before: 'if (JSON.stringify(await this.optional(expected.id)) !== JSON.stringify(expected.item) || expected.historyAbsent === true', after: 'if (false && JSON.stringify(await this.optional(expected.id)) !== JSON.stringify(expected.item) || false && expected.historyAbsent === true', test: 'test/review-classes.test.ts', pattern: '^admission refuses' },
  { file: 'src/hypothesis.ts', label: 'restore: advertise a matrix that omits conclusions', before: "safe(content), options.budget ?? 1500, `pm hypothesis show ${operand(investigation)} --json`", after: "safe(content), options.budget ?? 1500, 'pm hypothesis matrix <investigation> --budget 1000000'", test: 'test/review-classes.test.ts', pattern: '^bounded conclusion restoration' },
];
const originalRoot = resolve(import.meta.dirname, '..'); const scratch = mkdtempSync(resolve(tmpdir(), 'hypothesis-revert-'));
try {
for (const path of ['src', 'test', 'index.ts', 'package.json']) cpSync(resolve(originalRoot, path), resolve(scratch, path), { recursive: true });
symlinkSync(resolve(originalRoot, 'node_modules'), resolve(scratch, 'node_modules'), 'dir');
// Every selected test imports TypeScript source, so these reversions need no dist rebuild.
const selected = proofs.filter(proof => process.argv[2] === undefined || proof.label.includes(process.argv[2])); assert.ok(selected.length > 0, 'Select at least one behavioral reversion');
for (const proof of selected) {
  const path = resolve(scratch, proof.file); const original = readFileSync(path, 'utf8'); assert.ok(original.includes(proof.before));
  try {
    const edited = original.replace(proof.before, proof.after);
    writeFileSync(path, edited);
    const result = spawnSync(process.execPath, ['--test', `--test-name-pattern=${proof.pattern}`, proof.test], { cwd: scratch, encoding: 'utf8', timeout: 300000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 1, `${proof.label} must fail behaviorally`); assert.match(result.stdout + result.stderr, /AssertionError|Missing expected rejection/);
    console.log(`REVERT PROVED: ${proof.label}`);
  } finally { writeFileSync(path, original); assert.equal(readFileSync(path, 'utf8'), original); }
}
} finally { rmSync(scratch, { recursive: true, force: true }); }
