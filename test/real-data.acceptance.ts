import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PmClient, certifyCompleteListResult } from '@unbrained/pm-cli/sdk';
import { open, add, observe, matrix, nextRequest, resumePacket } from '../index.ts';

/** Public job-step metadata is the only external input; unavailable logs are never inferred. */
interface Run { headSha: string; url: string; event: string; conclusion: string; jobs: { name: string; completedAt: string; conclusion: string; steps: { name: string; conclusion: string }[] }[] }
const repo = 'unbraind/pm-memory'; const runId = '40161355596';
const raw = execFileSync('gh', ['run', 'view', runId, '-R', repo, '--json', 'headSha,url,event,conclusion,jobs'], { encoding: 'utf8' });
const run = JSON.parse(raw) as Run;
assert.equal(run.conclusion, 'failure'); assert.equal(run.event, 'pull_request');
const scratch = await mkdtemp(join(tmpdir(), 'hypothesis-public-'));
try {
  await assert.rejects(access(join(scratch, '.git')));
  const workspace = join(scratch, '.agents', 'pm'); const options = { workspace, author: 'public-incident-proof' };
  const client = new PmClient({ pmRoot: workspace, author: options.author, noExtensions: true });
  await client.init('incident', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  const investigation = (await open('Public CI failure: Node 22 versus Node 26 release gates', options)).investigation;
  const explanations = [
    ['H1', 'Checkout failed before the package gates', { checkout22: 'failure', install22: 'skipped', health22: 'skipped', identity22: 'skipped', npm22: 'skipped' }],
    ['H2', 'Dependency installation prevented the package gates', { checkout22: 'success', install22: 'failure', health22: 'skipped', identity22: 'skipped', npm22: 'skipped' }],
    ['H3', 'Tracker health blocked release verification', { checkout22: 'success', install22: 'success', health22: 'failure', identity22: 'skipped', npm22: 'skipped' }],
    ['H4', 'Commit identity policy blocked release verification', { checkout22: 'success', install22: 'success', health22: 'success', identity22: 'failure', npm22: 'skipped' }],
    ['H5', 'The failure was in Node 22 npm release gates after prerequisites passed', { checkout22: 'success', node22setup: 'success', bun22setup: 'success', install22: 'success', health22: 'success', identity22: 'success', npm22: 'failure', bun22: 'skipped', npm26: 'success', bun26: 'success' }],
  ] as const;
  const labels = new Map<string, string>();
  for (const [label, statement, predictions] of explanations) labels.set((await add(investigation, statement, Object.entries(predictions).map(([observation, value]) => ({ observation, value })), options)).hypothesis, label);
  const facts = [
    ['checkout22', 'test (22)', 'Checkout'], ['node22setup', 'test (22)', 'Setup Node.js'], ['bun22setup', 'test (22)', 'Setup Bun'],
    ['install22', 'test (22)', 'Install dependencies'], ['health22', 'test (22)', 'Verify tracked pm project health'],
    ['identity22', 'test (22)', 'Verify commit identities and private path policy'], ['npm22', 'test (22)', 'Npm release gates'],
    ['bun22', 'test (22)', 'Bun release gates'], ['npm26', 'test (26)', 'Npm release gates'], ['bun26', 'test (26)', 'Bun release gates'],
  ];
  let apiCalls = 1 + 1 + explanations.length; // init, open, add
  const nextSequence: string[] = []; const reports: string[] = [];
  const previous = new Set<string>();
  nextSequence.push((await nextRequest(investigation, options)).request?.observation ?? 'none'); apiCalls++;
  for (const [key, jobName, stepName] of facts) {
    const job = run.jobs.find(entry => entry.name === jobName); assert.ok(job);
    const step = job.steps.find(entry => entry.name === stepName); assert.ok(step);
    await observe(investigation, key, step.conclusion, { ...options, when: job.completedAt, how: `gh run view ${runId}: ${jobName} / ${stepName}`, evidence: run.url }); apiCalls++;
    const result = await matrix(investigation, { ...options, budget: 1000000 }); apiCalls++;
    const newlyEliminated = result.rows.filter(row => row.status === 'eliminated' && !previous.has(row.id));
    result.rows.filter(row => row.status === 'eliminated').forEach(row => previous.add(row.id));
    reports.push(`| ${key}=${step.conclusion} | ${explanations.map(([label]) => `${label}:${result.rows.find(row => labels.get(row.id) === label)?.status}`).join(', ')} | ${newlyEliminated.length} |`);
    nextSequence.push((await nextRequest(investigation, options)).request?.observation ?? 'none'); apiCalls++;
  }
  const resumed = await resumePacket(investigation, { ...options, budget: 1500 }); apiCalls++;
  assert.ok(resumed.estimatedTokens <= 1500); assert.ok(resumed.rows.some(row => row.kind === 'hypothesis')); assert.ok(resumed.rows.some(row => row.kind === 'witness'));
  assert.equal(new Set(resumed.rows.filter(row => row.kind === 'witness').map(row => row.hypothesis)).size, 4);
  const corpus = certifyCompleteListResult(await client.listAllComplete({ includeBody: true })); apiCalls++;
  const full = [];
  for (const item of corpus.items) { full.push((await client.get(item.id, { full: true })).item); apiCalls++; }
  const transcriptBytes = Buffer.byteLength(JSON.stringify({ publicRun: run, nativeRecords: full }, null, 2));
  const doc = `# Public incident proof\n\nSource: [${repo} CI run ${runId}](${run.url}), head ${run.headSha}. Read with \`gh run view ${runId} -R ${repo} --json headSha,url,event,conclusion,jobs\`. No hosted data was read. A disposable \`mktemp\`-style non-git directory was created through the SDK and removed in finally. Repository test fixtures are synthetic.\n\nFive explicit explanations, ten observations, immutable native fact provenance and an atomic investigation owner. This identifies the failing stage; it does not establish the underlying code cause. The log commands returned no content, so no assertion-level cause is claimed.\n\n${explanations.map(([label, statement]) => `- ${label}: ${statement}`).join('\n')}\n\n| Admitted observation | Complete matrix after observation | Newly eliminated |\n| --- | --- | --- |\n${reports.join('\n')}\n\nNext requests, initially and after each observation: ${nextSequence.join(' → ')}. These are suggestions only; nothing executed them. Pair scores use declared equality predictions and preserve unspecified causes.\n\nResume: **${resumed.estimatedTokens} estimated tokens**, ${resumed.receipt.returned} rows, ${resumed.receipt.omitted} omitted rows, sourceComplete=${resumed.receipt.sourceComplete}. Full investigation transcript: **${transcriptBytes} UTF-8 bytes / ${Math.ceil(transcriptBytes / 4)} estimated tokens**, including the public run metadata and ${full.length} complete native records. The transcript is measured once, without repeated matrix output or SDK transport wrappers. Both estimates use bytes/4; the resume uses the larger JSON/TOON representation including its receipt.\n\nCalls: **1 GitHub read**, **${apiCalls} public SDK/API calls** (init/open/add/observe/matrix/next/resume and transcript reads). These are in-process calls, not model or remote-backend round trips. Internal SDK filesystem/schema operations are not counted.\n\nReproduce with \`npm run test:real-data\`; this refreshes this document from that immutable public run and deletes its scratch tracker.\n`;
  await writeFile(new URL('../docs/real-data.md', import.meta.url), doc);
  console.log(JSON.stringify({ hypotheses: 5, observations: 10, resumeTokens: resumed.estimatedTokens, omitted: resumed.receipt.omitted, transcriptBytes, transcriptTokens: Math.ceil(transcriptBytes / 4), apiCalls, githubReads: 1, nextSequence }));
} finally { await rm(scratch, { recursive: true, force: true }); }
