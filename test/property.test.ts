import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matrix } from '../index.ts';
import { Store } from '../src/store.ts';
import type { Investigation } from '../src/types.ts';
import { tracker } from './helpers.ts';

test('100 seeded real-SDK random sets: eliminated iff some admitted fact contradicts some prediction', async t => {
  const f = await tracker(t); const store = new Store(f.options); let seed = 720251025;
  const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let sample = 0; sample < 100; sample++) {
    const current = await store.get(f.investigation);
    const value: Investigation = { version: 1, revision: sample + 1, hypotheses: [], observations: [] };
    for (let index = 0; index < 1 + random(8); index++) {
      const predictions = [];
      for (let key = 0; key < 5; key++) if (random(3) !== 0) predictions.push({ observation: `key${key}`, value: `v${random(3)}` });
      value.hypotheses.push({ id: `h${index}`, statement: `Synthetic cause ${index}`, predictions });
    }
    for (let index = 0; index < random(12); index++) value.observations.push({ id: `o${index}`, observation: `key${random(6)}`, value: `v${random(3)}`, status: (['admitted', 'disputed', 'withdrawn'] as const)[random(3)], who: 'fixture', when: '2026-10-25T00:00:00Z', how: 'seeded synthetic sample', evidenceStatus: 'none' });
    await store.commit(current, value, 'Synthetic property sample');
    const actual = await matrix(f.investigation, { ...f.options, budget: 1000000 });
    assert.equal(actual.receipt.complete, true);
    for (const hypothesis of value.hypotheses) {
      let contradicted = false;
      for (const fact of value.observations) for (const prediction of hypothesis.predictions) if (fact.status === 'admitted' && fact.observation === prediction.observation && fact.value !== prediction.value) contradicted = true;
      assert.equal(actual.rows.find(row => row.id === hypothesis.id)?.status === 'eliminated', contradicted, `sample ${sample}`);
    }
  }
});
