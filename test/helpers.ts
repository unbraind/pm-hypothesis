import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { open, add } from '../index.ts';

/** Initialize a real empty SDK tracker before any extension-owned schema or item writes. */
export async function emptyTracker(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'hypothesis-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, '.agents', 'pm');
  const client = new PmClient({ pmRoot: workspace, author: 'fixture', noExtensions: true });
  await client.init('hyp', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  return { root, workspace, client, options: { workspace, author: 'fixture' } };
}
/** Build real isolated SDK trackers without invoking git or touching the package tracker. */
export async function tracker(t: TestContext) {
  const fixture = await emptyTracker(t);
  const { investigation } = await open('Synthetic CI failure', fixture.options);
  return { ...fixture, investigation };
}
/** Three competing explanations with one discriminating key and one independent key. */
export async function incident(t: TestContext) {
  const f = await tracker(t);
  const a = await add(f.investigation, 'Dependency install failed', [{ observation: 'install', value: 'failed' }, { observation: 'tests', value: 'absent' }], f.options);
  const b = await add(f.investigation, 'Test assertion changed', [{ observation: 'install', value: 'passed' }, { observation: 'tests', value: 'failed' }], f.options);
  const c = await add(f.investigation, 'Lint failure', [{ observation: 'install', value: 'passed' }, { observation: 'lint', value: 'failed' }], f.options);
  return { ...f, a: a.hypothesis, b: b.hypothesis, c: c.hypothesis };
}
/** Native discovery fixture uses this package's real extension implementation. */
export async function extension(workspace: string) {
  const dir = join(workspace, 'extensions', 'pm-hypothesis'); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ name: 'pm-hypothesis', version: '2026.10.25', entry: 'entry.js', capabilities: ['commands', 'schema', 'renderers'] }));
  await writeFile(join(dir, 'entry.js'), `export { default } from ${JSON.stringify(new URL('../index.ts', import.meta.url).href)};\n`);
}
/** Fence ancestor discovery and remove git from the native command path. */
export function environment(root: string, workspace: string) { return { ...process.env, PM_PATH: workspace, PM_AUTHOR: 'fixture', GIT_CEILING_DIRECTORIES: dirname(root), PATH: root }; }

/** Compare all durable tracker bytes; retain explicit search evaluation fixtures. */
export async function durable(workspace: string, path = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(join(workspace, path), { withFileTypes: true })) {
    if (!path && ['runtime', 'locks', 'transactions', 'checkpoints', 'extensions'].includes(entry.name)) continue;
    const relative = join(path, entry.name);
    if (path === 'search' && entry.name !== 'eval-queries.json') continue;
    if (entry.isDirectory()) Object.assign(files, await durable(workspace, relative));
    else files[relative] = (await readFile(join(workspace, relative))).toString('hex');
  }
  return files;
}
