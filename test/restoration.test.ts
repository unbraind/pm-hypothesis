import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeToon } from '@unbrained/pm-cli/sdk/testing';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { matrix, resumePacket, conclude, observe } from '../index.ts';
import { operand, wire } from '../src/core.ts';
import { incident, environment, extension } from './helpers.ts';

test('every advertised matrix/resume restore command returns the omitted rows and conclusion', async t => {
  const f = await incident(t); await extension(f.workspace); const reason = 'Long conclusion: ' + 'R'.repeat(7980);
  await conclude(f.investigation, f.b, reason, { ...f.options, acceptViable: [f.a, f.c] });
  for (const packet of [await matrix(f.investigation, { ...f.options, budget: 300 }), await resumePacket(f.investigation, { ...f.options, budget: 300 })]) {
    assert.equal(packet.receipt.complete, false);
    assert.equal(packet.receipt.restore, `pm hypothesis show '${f.investigation}' --json`);
    const actual = spawnSync(process.execPath, [join(import.meta.dirname, '../node_modules/.bin/pm'), 'hypothesis', 'show', f.investigation, '--json'], { cwd: f.root, env: environment(f.root, f.workspace), encoding: 'utf8' });
    assert.equal(actual.status, 0, actual.stderr);
    const result = JSON.parse(actual.stdout) as { complete: boolean; rows: { id: string }[]; conclusion: { reason: string } };
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
