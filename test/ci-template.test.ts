/** Guard one full gate per deep job and executable-file routing in PR CI. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { parseDocument } from 'yaml';

interface Step {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  concurrency: { group: string; 'cancel-in-progress': boolean | string };
  on: Record<string, { paths?: string[]; 'paths-ignore'?: string[] } | null>;
  jobs: Record<string, {
    name?: string;
    'runs-on': string;
    'timeout-minutes': number;
    env: Record<string, unknown>;
    strategy: { matrix: Record<string, (string | number)[]> };
    steps: Step[];
  }>;
}

function workflow(name: string): Workflow {
  const document = parseDocument(readFileSync(`.github/workflows/${name}`, 'utf8'), { uniqueKeys: true, strict: true });
  assert.deepEqual(document.errors, [], name);
  return document.toJS() as Workflow;
}

test('all workflows parse strictly with unique mapping keys', () => {
  for (const name of readdirSync('.github/workflows').filter(name => /\.ya?ml$/u.test(name))) workflow(name);
});

test('deep matrix executes exactly one complete gate per job without cancelling active runs', () => {
  const deep = workflow('ci-deep.yml');
  assert.equal(deep.concurrency['cancel-in-progress'], false);
  assert.equal(deep.concurrency.group, 'ci-deep-${{ github.ref }}');
  const job = deep.jobs.deep;
  const matrix = job.strategy.matrix;
  const nodeKey = 'node' in matrix ? 'node' : 'node-version';
  assert.deepEqual(matrix[nodeKey], [22, 26]);
  assert.deepEqual(matrix['package-manager'], ['npm', 'bun']);
  assert.equal(job.name, 'deep (${{ matrix.' + nodeKey + ' }}, ${{ matrix.package-manager }})');
  assert.match(job['runs-on'], /vars\.PM_LOCAL_DEEP != 'off'.*self-hosted.*pm-local.*ubuntu-latest/u);
  assert.equal(job['timeout-minutes'], 120);
  assert.equal(job.env.PM_TEST_DEPTH, 'full');
  assert.equal(job.env.PM_TEST_TIME_SCALE, 3);
  const gates = job.steps.filter(step => step.run?.includes('run release:check'));
  assert.equal(gates.length, 2);
  for (const manager of matrix['package-manager']) {
    const active = gates.filter(step => step.if === `matrix.package-manager == '${manager}'`);
    assert.equal(active.length, 1);
    assert.equal(active[0].run, `${manager} run release:check`);
  }
  const node = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(node?.with?.cache, "${{ runner.environment == 'github-hosted' && 'npm' || '' }}");
  assert.equal(job.steps.find(step => step.uses?.startsWith('oven-sh/setup-bun@'))?.if, "runner.environment == 'github-hosted'");
  assert.ok(job.steps.some(step => step.run === 'bun --version'));
});

test('PR detector routes nested executable docs and tracker extensions to code', () => {
  const jobs = Object.values(workflow('ci.yml').jobs);
  const detector = jobs.flatMap(job => job.steps).find(step => step.name === 'Detect code changes')?.run ?? '';
  const cases = detector.match(/case "\$path" in[\s\S]*?esac/u)?.[0];
  assert.ok(cases);
  const executable = ['mjs', 'cjs', 'js', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'sh'];
  const codePaths = executable.flatMap(ext => [`.agents/pm/tool.${ext}`, `.agents/pm/nested/tool.${ext}`, `docs/tool.${ext}`, `docs/nested/tool.${ext}`]);
  codePaths.push('.agents/pm/extensions/contract.json', '.agents/pm/extensions/nested/README.md', 'src/code.ts', 'docs/space and\nnewline.sh');
  const cheapPaths = ['.agents/pm/item.toon', '.agents/pm/history/item.jsonl', 'README.md', 'docs/guide.md', 'docs/nested/guide.txt', 'LICENSE', 'CHANGELOG.md'];
  for (const [expected, paths] of [['true', codePaths], ['false', cheapPaths]] as const) {
    const result: SpawnSyncReturns<string> = spawnSync('bash', ['-c', `for path do\ncode=false\n${cases}\nprintf '%s\\n' "$code"\ndone`, 'detector', ...paths], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), paths.map(() => expected));
  }
});

test('required CodeQL check remains unfiltered on pushes and pull requests', () => {
  const codeql = workflow('codeql.yml');
  for (const event of ['push', 'pull_request']) {
    assert.equal(codeql.on[event]?.paths, undefined);
    assert.equal(codeql.on[event]?.['paths-ignore'], undefined);
  }
});
