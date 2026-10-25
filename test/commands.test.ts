import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { activateExtensionForTest, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import hypothesis from '../index.ts';
import { runCommand, prediction } from '../src/commands.ts';
import { environment, extension, incident } from './helpers.ts';

/** Invoke the real host with no git executable and fenced ancestor discovery. */
function cli(root: string, workspace: string, args: string[]) { return spawnSync(process.execPath, [join(import.meta.dirname, '../node_modules/.bin/pm'), 'hypothesis', ...args], { cwd: root, encoding: 'utf8', env: environment(root, workspace) }); }

test('native gitless host: seven commands, TOON/JSON, repeated predictions, withdrawal and bounded resumes', async t => {
  const f = await incident(t); await extension(f.workspace);
  const activation = await activateExtensionForTest(hypothesis, { capabilities: ['commands', 'schema'] }); assert.equal(activation.failed.length, 0);
  const help = cli(f.root, f.workspace, ['--help']); assert.equal(help.status, 0, help.stderr);
  for (const command of ['open', 'add', 'observe', 'matrix', 'next', 'resume', 'conclude']) assert.ok(help.stdout.includes(command));
  const opened = cli(f.root, f.workspace, ['open', 'Native incident', '--json']); assert.equal(opened.status, 0, opened.stderr);
  const id = (JSON.parse(opened.stdout) as { investigation: string }).investigation;
  const added = cli(f.root, f.workspace, ['add', id, 'Native cause', '--predict', 'a=b', '--predict', 'c=d', '--json']); assert.equal(added.status, 0, added.stderr);
  const cause = (JSON.parse(added.stdout) as { hypothesis: string }).hypothesis;
  const observed = cli(f.root, f.workspace, ['observe', id, 'a', 'b', '--how', 'public log', '--evidence', 'ev:fixture', '--when', '2026-10-25T00:00:00Z', '--operation', 'host-op', '--json']); assert.equal(observed.status, 0, observed.stderr);
  const observation = (JSON.parse(observed.stdout) as { observation: string }).observation;
  for (const format of [[], ['--json']]) for (const command of ['matrix', 'resume']) {
    const result = cli(f.root, f.workspace, [command, id, '--budget', '1500', ...format]); assert.equal(result.status, 0, result.stderr);
    const value = (format.length === 0 ? decodeToon(result.stdout) : JSON.parse(result.stdout)) as { receipt: { sourceComplete: boolean } };
    assert.equal(value.receipt.sourceComplete, true); assert.ok(Math.ceil(Buffer.byteLength(result.stdout) / 4) <= 1500);
  }
  assert.equal(cli(f.root, f.workspace, ['next', id]).status, 0);
  assert.equal(cli(f.root, f.workspace, ['observe', id, '--withdraw', observation]).status, 0);
  const concluded = cli(f.root, f.workspace, ['conclude', id, '--cause', cause, '--reason', 'Explicit choice']); assert.equal(concluded.status, 0, concluded.stderr);
  assert.equal(cli(f.root, f.workspace, ['observe', id, 'a', 'z', '--disputed']).status, 0);
  const refused = cli(f.root, f.workspace, ['observe', id, 'a', 'z', '--expected-revision', '0']); assert.equal(refused.status, 3); assert.match(refused.stderr, /Remedy:/); assert.ok(!refused.stderr.includes(f.root));
});

test('in-process host dispatch validates flags and gives typed safe remedies', async t => {
  const f = await incident(t);
  const ctx = { command: 'hypothesis matrix', pm_root: f.workspace, args: [f.investigation], options: {}, global: { author: 'fixture' } } as CommandHandlerContext;
  for (const command of ['matrix', 'next', 'resume']) await runCommand(command, ctx);
  await runCommand('open', { ...ctx, args: ['Attached'], options: { item: f.investigation } });
  await runCommand('add', { ...ctx, args: [f.investigation, 'SDK dispatch'], options: { predict: 'new=value', operation: 'test-op' } });
  await runCommand('observe', { ...ctx, args: [f.investigation, 'new', 'value'] });
  await assert.rejects(runCommand('conclude', { ...ctx, options: { cause: f.b, reason: 'needs acknowledgment', acceptViable: f.a } }), { exitCode: 2 });
  await assert.rejects(runCommand('unknown', ctx), { exitCode: 2 });
  await assert.rejects(runCommand('matrix', { ...ctx, args: ['absent'] }), { exitCode: 2 });
  await assert.rejects(runCommand('open', { ...ctx, args: [] }), { exitCode: 2 });
  await assert.rejects(runCommand('matrix', { ...ctx, options: { expectedRevision: -1 } }), { exitCode: 2 });
  assert.deepEqual(prediction('a=b=c'), { observation: 'a', value: 'b=c' });
  for (const value of ['a', '=a', 'a=']) assert.throws(() => prediction(value));
});

test('real active host marks optional evidence availability without a package dependency', async t => {
  const f = await incident(t); await extension(f.workspace);
  const dir = join(f.workspace, 'extensions', 'pm-evidence'); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ name: 'pm-evidence', version: '1.0.0', entry: 'entry.js', capabilities: ['commands'] }));
  await writeFile(join(dir, 'entry.js'), `export default { activate(api) { api.registerCommand({ name: 'evidence show', description: 'Synthetic citation host', run() { return {}; } }); } };\n`);
  const result = cli(f.root, f.workspace, ['observe', f.investigation, 'source', 'checked', '--evidence', 'ev:synthetic', '--json']);
  assert.equal(result.status, 0, result.stderr); assert.equal((JSON.parse(result.stdout) as { evidenceStatus: string }).evidenceStatus, 'host-available');
});
