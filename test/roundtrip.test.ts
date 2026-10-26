import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { decodeToon } from '@unbrained/pm-cli/sdk/testing';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { add, open, matrix, nextRequest, observe } from '../index.ts';
import { wire } from '../src/core.ts';
import { runCommand } from '../src/commands.ts';
import { Store, state } from '../src/store.ts';
import { environment, extension, tracker } from './helpers.ts';

/** Decode the actual package transport through the official host codecs. */
function decoded<T>(value: T, format: 'json' | 'toon'): T {
  const output = wire(value, format); assert.ok(!/[\u001b\u007f-\u009f]/.test(output));
  return (format === 'json' ? JSON.parse(output) : decodeToon(output)) as T;
}

test('seeded next-to-observe property preserves random keys and values in both output formats', async t => {
  let seed = 991025;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const alphabet = ['<', '>', '"', "'", '\n', '\r', '\t', '\u001b[31m', '\u009b31m', '\u007f', 'é', '雪', '🧪', '\\', 'a', '=', ',', '`', '\\u003c', ':', '[', ']', '#', '|' ];
  const keys = ['probe-' + 'x'.repeat(4000), 'probe-' + '雪'.repeat(1500), ...alphabet.map(character => 'probe-' + character), ...Array.from({ length: 15 }, () => 'probe-' + Array.from({ length: 5 }, () => alphabet[random(alphabet.length)]).join(''))];
  for (const format of ['toon', 'json'] as const) for (const key of keys) {
    const f = await tracker(t); const id = f.investigation;
    const left = 'left-' + key; const right = 'right-' + key;
    const a = await add(id, 'Left explanation', [{ observation: key, value: left }], f.options);
    await add(id, 'Right explanation', [{ observation: key, value: right }], f.options);
    const request = decoded(await nextRequest(id, f.options), format).request; assert.ok(request);
    assert.equal(request.observation, key);
    const value = request.groups.find(group => group.hypotheses.includes(a.hypothesis))?.value; assert.equal(value, left);
    const ctx = { command: 'hypothesis observe', pm_root: f.workspace, args: [id, request.observation, value], options: {}, global: { author: 'fixture' } } as CommandHandlerContext;
    const result = decoded(await runCommand('observe', ctx), format) as { observation: string };
    const stored = state((await new Store(f.options).get(id)).hypothesis_state);
    assert.equal(stored.observations[0].id, result.observation); assert.equal(stored.observations[0].observation, key); assert.equal(stored.observations[0].value, left);
    assert.equal((await nextRequest(id, f.options)).request, null);
    const rows = (await matrix(id, { ...f.options, budget: 1000000 })).rows;
    for (const row of rows) assert.equal(row.status, row.id === a.hypothesis ? 'viable' : 'eliminated');
  }
});

test('native TOON/JSON next output can be passed back to observe with inert control-byte transport', async t => {
  const f = await tracker(t); await extension(f.workspace);
  for (const format of ['toon', 'json'] as const) {
    const id = (await open('Native control ' + format, f.options)).investigation; const key = '<probe>\n"🧪\u001b[31m\u009b0m';
    await add(id, 'Control left', [{ observation: key, value: 'yes\u007f' }], f.options);
    await add(id, 'Control right', [{ observation: key, value: 'no\u001b[0m' }], f.options);
    const cli = (args: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, '../node_modules/.bin/pm'), 'hypothesis', ...args, ...(format === 'json' ? ['--json'] : [])], { cwd: f.root, env: environment(f.root, f.workspace), encoding: 'utf8' });
    const result = cli(['next', id]); assert.equal(result.status, 0, result.stderr); assert.ok(!/[\u001b\u007f-\u009f]/.test(result.stdout));
    const request = (format === 'json' ? JSON.parse(result.stdout) : decodeToon(result.stdout)) as Awaited<ReturnType<typeof nextRequest>>;
    assert.equal(request.request?.observation, key); assert.ok(request.request);
    const observed = cli(['observe', id, request.request.observation, request.request.groups[0].value]); assert.equal(observed.status, 0, observed.stderr);
    assert.equal(state((await new Store(f.options).get(id)).hypothesis_state).observations[0].observation, key);
  }
});
