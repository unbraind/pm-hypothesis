import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { gitEnvironment, npmEnvironment } from '../scripts/environment.ts';

/** Execute an isolated packed-consumer command and retain its exact exit evidence. */
function execute(cwd: string, executable: string, args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 300000 }); assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout;
}
for (const manager of ['npm', 'bun']) test(`packed ${manager} and ${manager === 'npm' ? 'npx' : 'bunx'} investigation journey`, t => {
  const repository = resolve(import.meta.dirname, '..'); const root = mkdtempSync(join(tmpdir(), 'hypothesis-packed-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...npmEnvironment(gitEnvironment(process.env)), HOME: root, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_CEILING_DIRECTORIES: root, PM_AUTHOR: 'packed-fixture' };
  const pack = JSON.parse(execute(repository, 'npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], env)) as { filename: string; files: { path: string }[] }[];
  assert.ok(pack[0].files.every(file => /^(dist\/|manifest\.json$|package\.json$|README\.md$|ARCHITECTURE\.md$|docs\/real-data\.md$|LICENSE$|CHANGELOG\.md$)/.test(file.path)));
  const tarball = join(root, pack[0].filename); const consumer = join(root, manager); mkdirSync(consumer);
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'hypothesis-packed-fixture', private: true, type: 'module', dependencies: { 'pm-hypothesis': `file:${tarball}`, '@unbrained/pm-cli': manifest.devDependencies['@unbrained/pm-cli'] }, scripts: { hypothesis: 'pm hypothesis' } }));
  execute(consumer, manager, ['install', '--ignore-scripts'], env);
  const hostEnv = { ...env, PM_PATH: join(consumer, '.agents', 'pm') }; const runner = manager === 'npm' ? 'npx' : 'bunx'; const prefix = manager === 'npm' ? ['--no-install', 'pm'] : ['--bun', '--no-install', 'pm'];
  const pm = (args: string[]) => execute(consumer, runner, [...prefix, ...args], hostEnv);
  pm(['init', '--prefix', 'packed', '--defaults', '--agent-guidance', 'skip']); pm(['package', 'install', tarball]);
  const id = (JSON.parse(pm(['hypothesis', 'open', 'Packed CI incident', '--json'])) as { investigation: string }).investigation;
  const a = (JSON.parse(pm(['hypothesis', 'add', id, 'Install failed', '--predict', 'install=failed', '--json'])) as { hypothesis: string }).hypothesis;
  const b = (JSON.parse(pm(['hypothesis', 'add', id, 'Tests failed', '--predict', 'install=passed', '--json'])) as { hypothesis: string }).hypothesis;
  const fact = JSON.parse(pm(['hypothesis', 'observe', id, 'install', 'passed', '--json'])) as { observation: string };
  const checked = JSON.parse(execute(consumer, manager, ['run', '--silent', 'hypothesis', '--', 'matrix', id, '--json'], hostEnv)) as { rows: { id: string; status: string }[] }; assert.equal(checked.rows.find(row => row.id === a)?.status, 'eliminated');
  assert.ok(pm(['hypothesis', 'next', id, '--json']).includes('sourceComplete'));
  const resumed = pm(['hypothesis', 'resume', id, '--budget', '1500', '--json']); assert.ok(Buffer.byteLength(resumed) / 4 <= 1500);
  pm(['hypothesis', 'conclude', id, '--cause', b, '--reason', 'Packed admitted facts']);
  pm(['hypothesis', 'observe', id, '--withdraw', fact.observation]);
  writeFileSync(join(consumer, 'embed.ts'), `import { matrix, nextRequest, resumePacket, observe } from 'pm-hypothesis';\nconst options = { workspace: process.env.PM_PATH };\nconst rows = await matrix(${JSON.stringify(id)}, options);\nif (rows.rows.some(row => row.status === 'eliminated') || [nextRequest,resumePacket,observe].some(fn => typeof fn !== 'function')) throw Error('SDK failed');\nconsole.log('SDK accepted');\n`);
  assert.match(execute(consumer, manager === 'npm' ? process.execPath : 'bun', ['embed.ts'], hostEnv), /SDK accepted/);
});
