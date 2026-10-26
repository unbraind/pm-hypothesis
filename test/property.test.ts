import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matrix } from '../index.ts';
import { hypothesisPayload, observationPayload } from '../src/records.ts';
import type { Investigation } from '../src/types.ts';
import { tracker } from './helpers.ts';

test('100 seeded real-SDK random sets: eliminated iff some admitted fact contradicts some prediction', async t => {
  const f = await tracker(t); let seed = 720251025;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let sample = 0; sample < 100; sample++) {
    const value: Investigation = { version: 1, revision: sample + 1, hypotheses: [], observations: [] };
    for (let index = 0; index < 1 + random(8); index++) {
      const predictions = [];
      for (let key = 0; key < 5; key++) if (random(3) !== 0) predictions.push({ observation: `key${key}`, value: `v${random(3)}` });
      value.hypotheses.push({ id: `hyp-h${index}`, statement: `Synthetic cause ${index}`, predictions });
    }
    for (let index = 0; index < random(12); index++) value.observations.push({ id: `hyp-o${index}`, observation: `key${random(6)}`, value: `v${random(3)}`, status: (['admitted', 'disputed', 'withdrawn'] as const)[random(3)], who: 'fixture', when: '2026-10-25T00:00:00Z', how: 'seeded synthetic sample', evidenceStatus: 'none' });
    for (const [kind, records] of [['hypothesis', value.hypotheses], ['observation', value.observations]] as const) for (const entry of records) {
      const record = kind === 'hypothesis' ? hypothesisPayload(f.investigation, entry as Investigation['hypotheses'][number]) : observationPayload(f.investigation, entry as Investigation['observations'][number], 'status' in entry && entry.status === 'disputed' ? 'disputed' : 'admitted');
      const options = { hypothesisRecord: record, message: 'Synthetic property source' };
      if ((await f.client.listAllComplete()).items.some(item => item.id === entry.id)) await f.client.update(entry.id, options);
      else { const create = { id: entry.id, type: kind === 'hypothesis' ? 'Question' : 'Test', title: 'Synthetic property source', parent: f.investigation, hypothesisRecord: record, createMode: 'progressive' }; await f.client.create(create); }
    }
    const edits = { hypothesisState: JSON.stringify(value), message: 'Synthetic property sample' };
    await f.client.update(f.investigation, edits);
    const actual = await matrix(f.investigation, { ...f.options, budget: 1000000 });
    assert.equal(actual.receipt.complete, true);
    for (const hypothesis of value.hypotheses) {
      let contradicted = false;
      for (const fact of value.observations) for (const prediction of hypothesis.predictions) if (fact.status === 'admitted' && fact.observation === prediction.observation && fact.value !== prediction.value) contradicted = true;
      assert.equal(actual.rows.find(row => row.id === hypothesis.id)?.status === 'eliminated', contradicted, `sample ${sample}`);
    }
  }
});
