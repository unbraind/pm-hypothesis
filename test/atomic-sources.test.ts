import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conclude, matrix, observe } from '../index.ts';
import { Store, state } from '../src/store.ts';
import { incident, durable } from './helpers.ts';

test('atomic command: combined record-read edits leave no fresh Test or history behind', async t => {
  const f = await incident(t); const seed = await observe(f.investigation, 'seed', 'yes', f.options); let checkpoint: Record<string, string> | undefined;
  await assert.rejects(observe(f.investigation, 'brand-new', 'yes', { ...f.options, boundary: async point => {
    if (point === 'record-read') {
      const owner = state((await new Store(f.options).get(f.investigation)).hypothesis_state); owner.revision++;
      const edits = { hypothesisState: JSON.stringify(owner), message: 'Peer owner revision' }; await f.client.update(f.investigation, edits);
      const source = { hypothesisRecord: 'Changed source provenance', message: 'Peer source edit' }; await f.client.update(seed.observation, source);
      checkpoint = await durable(f.workspace);
    }
  } }), { code: 'conflict' });
  assert.ok(checkpoint); assert.deepEqual(await durable(f.workspace), checkpoint);
});

test('current source invariants: changed admitted provenance cannot eliminate or conclude', async t => {
  const f = await incident(t); const source = await observe(f.investigation, 'install', 'passed', f.options);
  assert.equal((await matrix(f.investigation, f.options)).rows.find(row => row.id === f.a)?.status, 'eliminated');
  const native = await new Store(f.options).get(source.observation);
  const payload = JSON.parse(String(native.hypothesis_record)) as Record<string, unknown>; payload.who = 'changed-reporter';
  const edits = { hypothesisRecord: JSON.stringify(payload), message: 'Peer changed provenance' }; await f.client.update(source.observation, edits);
  const checkpoint = await durable(f.workspace);
  await assert.rejects(conclude(f.investigation, f.b, 'Invalid fact must not justify this', { ...f.options, acceptViable: [f.c] }), { code: 'conflict' });
  assert.deepEqual(await durable(f.workspace), checkpoint);
  const result = await matrix(f.investigation, f.options);
  assert.equal(result.rows.find(row => row.id === f.a)?.status, 'unknown');
});
