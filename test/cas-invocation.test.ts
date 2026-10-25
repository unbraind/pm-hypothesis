import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PmClient, WorkspaceTransactionInterruptedError } from '@unbrained/pm-cli/sdk';
import { add, conclude, open, observe } from '../index.ts';
import type { Boundary, Options } from '../index.ts';
import { Store, state } from '../src/store.ts';
import { incident } from './helpers.ts';

for (const command of ['withdraw', 'conclude']) test(`invocation CAS: ${command} retains source preconditions across owner contention`, async t => {
  const f = await incident(t); const fact = await observe(f.investigation, 'seed', 'yes', f.options); let injected = false; let peerState = '';
  const options = { ...f.options, boundary: async (point: string) => {
    if (point === 'owner-read' && !injected) {
      injected = true;
      await observe(f.investigation, 'peer', 'yes', f.options);
      const edits = { hypothesisRecord: 'Edited source provenance', message: 'Synthetic combined edit' }; await f.client.update(fact.observation, edits);
      peerState = String((await new Store(f.options).get(f.investigation)).hypothesis_state);
    }
  } };
  const action = command === 'withdraw' ? observe(f.investigation, '', '', { ...options, withdraw: fact.observation }) : conclude(f.investigation, f.b, 'Original snapshot', { ...options, acceptViable: [f.a, f.c] });
  await assert.rejects(action, { code: 'conflict' });
  const after = String((await new Store(f.options).get(f.investigation)).hypothesis_state);
  assert.equal(after, peerState); assert.equal(state(after).observations.find(entry => entry.id === fact.observation)?.status, 'admitted');
});

// All pair orderings include identical boundaries: the review's two edits can
// occur in one callback, or either edit can precede the other.
const commands = ['observe', 'admit', 'withdraw', 'conclude', 'add', 'open-existing'] as const;
const faults = ['none', 'owner update', 'source edit', 'both', 'source withdrawal', 'peer conclusion'] as const;

/** Compare all durable tracker bytes, omitting only gitignored SDK caches. */
async function durable(workspace: string, path = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(join(workspace, path), { withFileTypes: true })) {
    if (path === '' && ['locks', 'runtime', 'transactions', 'search', 'checkpoints', 'extensions'].includes(entry.name)) continue;
    const relative = join(path, entry.name);
    if (entry.isDirectory()) Object.assign(files, await durable(workspace, relative));
    else files[relative] = (await readFile(join(workspace, relative))).toString('hex');
  }
  return files;
}

/** Prove a refusal appends nothing after a deliberately injected peer write. */
async function refusesWithoutWrites(f: { workspace: string }, action: (save: () => Promise<void>) => Promise<unknown>) {
  let checkpoint: Record<string, string> | undefined;
  await assert.rejects(action(async () => { checkpoint = await durable(f.workspace); }), { code: 'conflict' });
  assert.ok(checkpoint); assert.deepEqual(await durable(f.workspace), checkpoint);
}

test('conditional helper combined interleaving matrix: 1104 cases, six commands, every ordered boundary pair', { concurrency: 4 }, async t => {
  const base = await incident(t);
  const seed = await observe(base.investigation, 'seed', 'yes', base.options);
  await observe(base.investigation, 'admitted', 'yes', base.options);
  // Establish interrupted preparation through the actual API. Every case then
  // proves recovery/admission adds zero durable bytes when its CAS refuses.
  const interrupt = async (point: Boundary) => { if (point === 'record-written') throw new WorkspaceTransactionInterruptedError(); };
  await assert.rejects(observe(base.investigation, 'new-key', 'yes', { ...base.options, boundary: interrupt }));
  await assert.rejects(add(base.investigation, 'New explanation', [{ observation: 'new-key', value: 'no' }], { ...base.options, boundary: interrupt }));
  const template = await durable(base.workspace);
  let count = 0; const pending: Promise<void>[] = [];
  for (const command of commands) {
    const points: Boundary[] = ['observe', 'admit', 'add'].includes(command) ? ['record-read', 'record-written', 'owner-read', 'admission-ready'] : ['owner-read', 'admission-ready'];
    if (command !== 'admit' && command !== 'open-existing') points.push('owner-written');
    points.push('complete');
    for (const first of points) for (const second of points) for (const fault of faults) for (const source of (fault === 'source edit' || fault === 'both' ? ['observation', 'hypothesis'] : ['observation'])) {
      pending.push(t.test(`${command}: ${first}/${second}: ${fault}/${source}`, async sub => {
        const root = await mkdtemp(join(tmpdir(), 'hypothesis-pair-')); sub.after(() => rm(root, { recursive: true, force: true }));
        const workspace = join(root, '.agents', 'pm');
        await cp(base.workspace, workspace, { recursive: true, filter: source => !['runtime', 'locks', 'transactions', 'search', 'checkpoints'].includes(source.slice(base.workspace.length + 1).split('/')[0]) });
        assert.deepEqual(await durable(workspace), template);
        const options = { workspace, author: 'fixture' }; const store = new Store(options);
        const client = new PmClient({ pmRoot: workspace, author: 'peer', noExtensions: true });
        const before = state((await store.get(base.investigation)).hypothesis_state); let checkpoint = template; const seen: Boundary[] = []; let verified = false;
        const pre = (point: Boundary) => point !== 'owner-written' && point !== 'complete';
        const conflict = fault === 'none' ? false : fault === 'source edit' ? pre(second) : fault === 'both' ? pre(first) || pre(second) : pre(first);
        /** Inspect the exact local commit before any later peer actions. */
        const intended = async () => {
          const after = state((await store.get(base.investigation)).hypothesis_state);
          if (command === 'admit' || command === 'open-existing') { assert.deepEqual(after, before); assert.deepEqual(await durable(workspace), template); }
          else {
            assert.equal(after.revision, before.revision + 1);
            if (command === 'observe') { const fact = after.observations.pop(); assert.equal(fact?.observation, 'new-key'); assert.equal(fact.value, 'yes'); }
            if (command === 'withdraw') { const fact = after.observations.find(entry => entry.id === seed.observation); assert.ok(fact); assert.equal(fact.status, 'withdrawn'); fact.status = 'admitted'; }
            if (command === 'conclude') { assert.deepEqual(after.conclusion, { cause: base.b, reason: 'Intended decision', accepted: [base.a, base.c].sort(), revision: after.revision }); delete after.conclusion; }
            if (command === 'add') { const hypothesis = after.hypotheses.pop(); assert.equal(hypothesis?.statement, 'New explanation'); assert.deepEqual(hypothesis.predictions, [{ observation: 'new-key', value: 'no' }]); }
            after.revision--; assert.deepEqual(after, before, 'only the exact intended logical change is permitted');
          }
          verified = true;
        };
        const boundary = async (point: Boundary) => {
          seen.push(point);
          if (!pre(point) && !verified) await intended();
          if (point === first) {
            if (fault === 'owner update' || fault === 'both') {
              const current = state((await store.get(base.investigation)).hypothesis_state); current.revision++;
              const edits = { hypothesisState: JSON.stringify(current), message: 'Synthetic paired owner update' }; await client.update(base.investigation, edits);
            }
            if (fault === 'source withdrawal') await observe(base.investigation, '', '', { ...options, withdraw: seed.observation });
            if (fault === 'peer conclusion') { const current = state((await store.get(base.investigation)).hypothesis_state); await conclude(base.investigation, base.b, 'Peer decision', { ...options, acceptViable: current.hypotheses.filter(h => h.id !== base.b).map(h => h.id) }); }
          }
          if (point === second && (fault === 'source edit' || fault === 'both')) {
            const edits = { hypothesisRecord: 'Changed provenance', message: 'Synthetic paired source edit' }; await client.update(source === 'observation' ? seed.observation : base.a, edits);
          }
          if (point === 'admission-ready' || !pre(point)) checkpoint = await durable(workspace);
        };
        const run = (input: Options) => {
          if (command === 'observe' || command === 'admit') return observe(base.investigation, command === 'observe' ? 'new-key' : 'admitted', 'yes', input);
          if (command === 'withdraw') return observe(base.investigation, '', '', { ...input, withdraw: seed.observation });
          if (command === 'conclude') return conclude(base.investigation, base.b, 'Intended decision', { ...input, acceptViable: [base.a, base.c] });
          if (command === 'add') return add(base.investigation, 'New explanation', [{ observation: 'new-key', value: 'no' }], input);
          return open('Existing investigation', { ...input, item: base.investigation });
        };
        if (conflict) {
          await assert.rejects(run({ ...options, boundary }), { code: 'conflict' });
          assert.equal(verified, false);
        } else {
          await run({ ...options, boundary }); assert.equal(verified, true);
        }
        assert.deepEqual(await durable(workspace), checkpoint, 'no extra durable writes after the last peer-only checkpoint');
        // Refusal prevents dependent later boundaries from being reached.
        if (!conflict || pre(first)) assert.ok(seen.includes(first));
        if (!conflict || pre(second)) assert.ok(seen.includes(second)); count++;
      }));
    }
  }
  await Promise.all(pending);
  assert.equal(count, 1104);
});

test('repeated source reads cannot overwrite an earlier revision precondition', async t => {
  const f = await incident(t); const before = await durable(f.workspace); let checkpoint = before;
  await assert.rejects(add(f.investigation, 'Dependency install failed', [{ observation: 'install', value: 'failed' }, { observation: 'tests', value: 'absent' }], {
    ...f.options, boundary: async point => {
      if (point === 'record-read') { await f.client.update(f.a, { comment: ['Peer changed the source revision'] }); checkpoint = await durable(f.workspace); }
    },
  }), { code: 'conflict' });
  assert.deepEqual(await durable(f.workspace), checkpoint);
});

test('owner native revision is conditional even when its domain envelope is unchanged', async t => {
  const f = await incident(t);
  await refusesWithoutWrites(f, save => observe(f.investigation, 'new-key', 'yes', { ...f.options, onTransition: async event => {
    if (event.transition === 'prepared' && event.transactionId.includes('-owner-')) {
      await f.client.update(f.investigation, { comment: ['Peer native metadata update'] }); await save();
    }
  } }));
});

test('reopening by title carries the source owner revision captured during preparation', async t => {
  const f = await incident(t);
  await refusesWithoutWrites(f, save => open('Synthetic CI failure', { ...f.options, boundary: async point => {
    if (point === 'record-written') {
      const edits = { hypothesisRecord: 'Peer edited investigation provenance', message: 'Synthetic reopen source edit' }; await f.client.update(f.investigation, edits); await save();
    }
  } }));
});

test('prepared source rereads retain the first native revision before admission', async t => {
  const f = await incident(t);
  await assert.rejects(observe(f.investigation, 'prepared', 'yes', { ...f.options, boundary: async point => { if (point === 'record-written') throw new WorkspaceTransactionInterruptedError(); } }));
  const source = (await f.client.listAllComplete()).items.find(item => item.type === 'Test'); assert.ok(source);
  await refusesWithoutWrites(f, save => observe(f.investigation, 'prepared', 'yes', { ...f.options, boundary: async point => {
    if (point === 'record-read') { await f.client.update(source.id, { comment: ['Peer changed prepared source revision'] }); await save(); }
  } }));
});

test('captured readsets refuse two revisions of one source without replacing either precondition', async t => {
  const f = await incident(t); const store = new Store(f.options); const first = await store.source(f.a);
  await f.client.update(f.a, { comment: ['Peer changed a captured source'] });
  const second = await store.source(f.a); const checkpoint = await durable(f.workspace); let called = false;
  await assert.rejects(store.withSources([first, second], async () => { called = true; }), { code: 'conflict' });
  assert.equal(called, false); assert.deepEqual(await durable(f.workspace), checkpoint);
});
