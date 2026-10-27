import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeToon } from '@unbrained/pm-cli/sdk/testing';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { matrix, resumePacket, conclude, observe } from '../index.ts';
import { operand, wire } from '../src/core.ts';
import { incident, environment, extension } from './helpers.ts';

/** Execute the exact advertised restore shape through the real native host. */
function readRestore<T>(fixture: Awaited<ReturnType<typeof incident>>, command: string): T {
  assert.equal(command, `pm hypothesis show '${fixture.investigation}' --json`);
  const result = spawnSync(process.execPath, [join(import.meta.dirname, '../node_modules/.bin/pm'), 'hypothesis', 'show', fixture.investigation, '--json'], { cwd: fixture.root, env: environment(fixture.root, fixture.workspace), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout) as T;
}

test('every advertised matrix/resume restore command returns the omitted rows and conclusion', async t => {
  const f = await incident(t); await extension(f.workspace); const reason = 'Long conclusion: ' + 'R'.repeat(7980);
  await conclude(f.investigation, f.b, reason, { ...f.options, acceptViable: [f.a, f.c] });
  for (const packet of [await matrix(f.investigation, { ...f.options, budget: 300 }), await resumePacket(f.investigation, { ...f.options, budget: 300 })]) {
    assert.equal(packet.receipt.complete, false);
    assert.equal(packet.receipt.restore, `pm hypothesis show '${f.investigation}' --json`);
    const result = readRestore<{ complete: boolean; rows: { id: string }[]; conclusion: { reason: string } }>(f, packet.receipt.restore);
    assert.equal(result.complete, true); assert.equal(result.rows.length, 3); assert.equal(result.conclusion.reason, reason);
    assert.deepEqual(result.rows.map(row => row.id).sort(), [f.a, f.b, f.c].sort());
  }
  await observe(f.investigation, 'install', 'passed', f.options);
});

test('shell recovery quoting and control-byte transport preserve exact scalar content', () => {
  const value = "<x>'\n\u009b\u001b[0m";
  const output = spawnSync('sh', ['-c', `printf %s ${operand(value)}`], { encoding: 'utf8' });
  assert.equal(output.status, 0, output.stderr); assert.equal(output.stdout, value);
  assert.equal(JSON.parse(wire({ value }, 'json')).value, value);
  // Dynamic keys and ordinary quoted display strings are retained by the codec.
  const record = { ['key\u009b']: 'normal', ['key\u009b\n']: '\u007f\n' };
  const encoded = wire(record, 'toon'); assert.ok(!/[\u007f-\u009f]/.test(encoded));
  assert.deepEqual(decodeToon(encoded), record);
});

test('advertised issue restoration returns invalid support, historical conclusion and current next request', async t => {
  const f = await incident(t); await extension(f.workspace);
  await conclude(f.investigation, f.b, 'Historical decision', { ...f.options, acceptViable: [f.a, f.c] });
  const fact = await observe(f.investigation, 'install', 'passed', f.options); const edit = { hypothesisRecord: 'Invalidated source provenance', message: 'Synthetic source edit' }; await f.client.update(fact.observation, edit);
  const packet = await resumePacket(f.investigation, { ...f.options, budget: 300 }); assert.ok(packet.receipt.omitted > 0); assert.equal(packet.receipt.restore, `pm hypothesis show '${f.investigation}' --json`);
  const restored = readRestore<{ sourceIssues: { id: string }[]; invalidConclusion: { reason: string }; request: { observation: string }; conclusionValid: boolean }>(f, packet.receipt.restore);
  assert.equal(restored.sourceIssues[0].id, fact.observation); assert.equal(restored.invalidConclusion.reason, 'Historical decision'); assert.equal(restored.conclusionValid, false); assert.equal(restored.request.observation, 'install');
});
