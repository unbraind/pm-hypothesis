import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Behavioral reversions replace only the named implementation branch, never test assertions. */
const proofs = [
  { file: 'src/derive.ts', label: 'derive: disable contradiction elimination', before: "witnesses.length > 0 ? 'eliminated'", after: "false ? 'eliminated'", test: 'test/hypothesis.test.ts', pattern: '^acceptance:' },
  { file: 'src/hypothesis.ts', label: 'observe: retain withdrawn admission', before: "fact.status = 'withdrawn';", after: "fact.status = fact.status;", test: 'test/hypothesis.test.ts', pattern: '^acceptance:' },
  { file: 'src/hypothesis.ts', label: 'conclude: permit unacknowledged survivors', before: 'if (JSON.stringify(others) !== JSON.stringify(accepted))', after: 'if (false)', test: 'test/hypothesis.test.ts', pattern: '^conclusions refuse' },
  { file: 'src/derive.ts', label: 'choose: prefer lower discrimination', before: 'b.pairs - a.pairs', after: 'a.pairs - b.pairs', test: 'test/edges.test.ts', pattern: '^next-request pair' },
  { file: 'src/core.ts', label: 'packet: ignore output budget', before: 'if (next.estimatedTokens > budget) break;', after: 'if (false) break;', test: 'test/hypothesis.test.ts', pattern: '^admission, repeated' },
  { file: 'src/store.ts', label: 'expected: ignore explicit expected revision', before: 'if (this.options.expectedRevision !== undefined && this.options.expectedRevision !== value.revision)', after: 'if (false)', test: 'test/hypothesis.test.ts', pattern: '^conclusions refuse' },
];
for (const proof of proofs) {
  const path = resolve(import.meta.dirname, '..', proof.file); const original = readFileSync(path, 'utf8'); assert.ok(original.includes(proof.before));
  try {
    writeFileSync(path, original.replace(proof.before, proof.after));
    const result = spawnSync(process.execPath, ['--test', `--test-name-pattern=${proof.pattern}`, proof.test], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 180000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 1, `${proof.label} must fail behaviorally`); assert.match(result.stdout + result.stderr, /AssertionError|Missing expected rejection/);
    console.log(`REVERT PROVED: ${proof.label}`);
  } finally { writeFileSync(path, original); assert.equal(readFileSync(path, 'utf8'), original); }
}
