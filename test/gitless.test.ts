import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { emptyTracker, environment, extension } from './helpers.ts';

test('fresh non-git tracker registers Question/Test and fields with no git on PATH', async t => {
  const { root, workspace, client } = await emptyTracker(t); await extension(workspace);
  await assert.rejects(access(join(root, '.git')));
  const result = spawnSync(process.execPath, [join(import.meta.dirname, '../node_modules/.bin/pm'), 'hypothesis', 'open', 'Fresh native investigation', '--json'], { cwd: root, encoding: 'utf8', env: environment(root, workspace) });
  assert.equal(result.status, 0, result.stderr);
  const investigation = (JSON.parse(result.stdout) as { investigation: string }).investigation;
  assert.equal((await client.get(investigation, { full: true })).item.type, 'Question');
  assert.ok((await client.schemaList()).custom.some(type => type.name === 'Test'));
});
