import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExtensionTestHarness, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import hypothesis, { add, matrix, observe, resumePacket, show } from '../index.ts';
import type { Packet, SourceIssue } from '../index.ts';
import { packet, tokens, wire } from '../src/core.ts';
import { tracker } from './helpers.ts';

/** Independently measure both exact transports, including host newline framing. */
function measured(value: unknown): number {
  return Math.ceil(Math.max(...(['json', 'toon'] as const).map(format => Buffer.byteLength(wire(value, format) + '\n', 'utf8'))) / 4);
}

/** Every packet must describe exactly the public wire representation and omission counts. */
function verified<T>(value: Packet<T>, budget: number): void {
  assert.equal(value.estimatedTokens, measured(value));
  assert.equal(tokens(value), measured(value));
  assert.ok(value.estimatedTokens <= budget);
  assert.equal(value.receipt.returned, value.rows.length);
  assert.equal(Object.hasOwn(value, 'output_fit'), false);
  for (const format of ['json', 'toon'] as const) {
    const output = wire(value, format) + '\n';
    assert.deepEqual(format === 'json' ? JSON.parse(output) : decodeToon(output), value);
  }
}

test('SDK envelope fitting: exact transports, domain prefixes and bounded safe refusals in a gitless tracker', async t => {
  const f = await tracker(t);
  const ext = await createExtensionTestHarness(hypothesis, { capabilities: ['commands', 'schema', 'renderers'] });
  const empty = await matrix(f.investigation, f.options); verified(empty, 1000);
  const exactEmpty = await matrix(f.investigation, { ...f.options, budget: empty.estimatedTokens }); verified(exactEmpty, empty.estimatedTokens);
  await assert.rejects(ext.runCommand({ command: 'hypothesis matrix', args: [f.investigation], pmRoot: f.workspace, options: { budget: empty.estimatedTokens - 1 } }), error => {
    assert.equal((error as { exitCode: number }).exitCode, 2);
    assert.match((error as Error).message, /hypothesis budget:.*Increase --budget/); return true;
  });
  const unicode = '界🧪 é "quoted"\n\u001b\u0085<`>';
  const a = await add(f.investigation, unicode, [{ observation: unicode, value: 'expected' }], f.options);
  await observe(f.investigation, unicode, 'actual', { ...f.options, how: unicode });
  const b = await add(f.investigation, 'x'.repeat(8192), [{ observation: 'b', value: 'c' }], f.options);
  await add(f.investigation, 'small later row', [{ observation: 'd', value: 'e' }], f.options);
  const full = await matrix(f.investigation, { ...f.options, budget: 1000000 }); verified(full, 1000000);
  const witnessRow = full.rows.find(row => row.id === a.hypothesis)!; assert.equal(witnessRow.witnesses[0].observation.how, unicode);
  const atFull = await matrix(f.investigation, { ...f.options, budget: full.estimatedTokens }); assert.deepEqual(atFull, full);
  const limited = await matrix(f.investigation, { ...f.options, budget: full.estimatedTokens - 1 }); verified(limited, full.estimatedTokens - 1);
  assert.ok(limited.rows.length < full.rows.length); assert.deepEqual(limited.rows, full.rows.slice(0, limited.rows.length)); assert.equal(limited.receipt.omitted, full.rows.length - limited.rows.length);
  assert.equal(limited.receipt.sourceComplete, true); assert.equal(limited.receipt.complete, false);
  for (const format of ['json', 'toon'] as const) {
    const result = await ext.runRendererOverride({ command: 'hypothesis matrix', format, result: limited });
    assert.equal(result.rendered, wire(limited, format));
  }
  // Issue detail overflow stops only the issue prefix, retaining room for domain rows.
  const oversized = packet(f.investigation, full.revision, [full.rows.find(row => row.id === b.hypothesis)!, witnessRow], 600, full.receipt.restore); verified(oversized, 600);
  assert.deepEqual(oversized.rows, []); assert.equal(oversized.receipt.omitted, 2);
  const issues: SourceIssue[] = [{ id: 'z'.repeat(8192), kind: 'hypothesis', reason: 'payload' }, { id: 'small', kind: 'hypothesis', reason: 'missing' }];
  const issuePacket = packet(f.investigation, full.revision, [witnessRow], 600, full.receipt.restore, issues); verified(issuePacket, 600);
  assert.equal(issuePacket.rows.length, 1); assert.deepEqual(issuePacket.receipt.sourceIssues, { returned: [], omitted: 2 });
  const tinyRows = Array.from({ length: 12 }, (_, index) => ({ id: String(index), text: unicode }));
  for (const budget of [199, 200, 201, 999, 1000, 1001]) {
    const result = packet('inv', 99, tinyRows, budget, 'read'); verified(result, budget);
    assert.deepEqual(result.rows, tinyRows.slice(0, result.rows.length));
  }
  // Real native edits supply source-issue receipts without fabricated host responses.
  const edits = { hypothesisRecord: 'invalid source', message: 'Synthetic edited source' }; await f.client.update(b.hypothesis, edits);
  const invalid = await matrix(f.investigation, { ...f.options, budget: 1000000 }); verified(invalid, 1000000);
  assert.deepEqual(invalid.receipt.sourceIssues?.returned, [{ id: b.hypothesis, kind: 'hypothesis', reason: 'payload' }]);
  verified(await resumePacket(f.investigation, { ...f.options, budget: 1000 }), 1000);
  const before = await show(f.investigation, f.options);
  // The SDK ceiling must refuse rather than return a partially certified prefix.
  const many = Array.from({ length: 1800 }, () => 'x');
  assert.throws(() => packet(f.investigation, full.revision, many, 1000000, full.receipt.restore), error => {
    assert.equal((error as { code: string }).code, 'output_envelope_work_limit');
    assert.match((error as { remedy: string }).remedy, /hypothesis show/); return true;
  });
  const circular: unknown[] = []; circular.push(circular);
  assert.throws(() => packet(f.investigation, 0, circular, 1000, full.receipt.restore), TypeError);
  assert.deepEqual(await show(f.investigation, f.options), before);
});
