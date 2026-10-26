import assert from 'node:assert/strict';
import { matrix } from '../index.ts';
import { Store, state } from '../src/store.ts';
import type { Investigation, MatrixRow, Request, Options } from '../index.ts';

/** Independent oracle indexes facts by observation before checking declared predictions. */
export function referenceRows(model: Investigation, invalid: Set<string>): MatrixRow[] {
  const facts = new Map<string, Investigation['observations']>();
  for (const fact of model.observations) if (fact.status === 'admitted' && !invalid.has(fact.id)) facts.set(fact.observation, [...facts.get(fact.observation) ?? [], fact]);
  return model.hypotheses.map(hypothesis => {
    if (invalid.has(hypothesis.id)) return { ...hypothesis, status: 'invalid' as const, witnesses: [], open: hypothesis.predictions };
    const witnesses = hypothesis.predictions.flatMap(prediction => (facts.get(prediction.observation) ?? []).filter(fact => fact.value !== prediction.value).map(observation => ({ prediction, observation })));
    const open = hypothesis.predictions.filter(prediction => !facts.has(prediction.observation));
    return { ...hypothesis, witnesses, open, status: witnesses.length ? 'eliminated' as const : open.length || !hypothesis.predictions.length ? 'unknown' as const : 'viable' as const };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

/** Count discriminating pairs directly, rather than reusing the production group scorer. */
export function referenceRequest(matrix: MatrixRow[]): Request | null {
  const live = matrix.filter(row => row.status === 'unknown' || row.status === 'viable'); const candidates: Request[] = [];
  for (const key of new Set(live.flatMap(row => row.open.map(prediction => prediction.observation)))) {
    const values = live.map(row => row.predictions.find(prediction => prediction.observation === key)?.value); let pairs = 0;
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) if (values[a] !== undefined && values[b] !== undefined && values[a] !== values[b]) pairs++;
    if (pairs) candidates.push({ observation: key, pairs, groups: [...new Set(values.filter(value => value !== undefined))].sort((a, b) => a.localeCompare(b, 'en')).map(value => ({ value, hypotheses: live.filter((_, index) => values[index] === value).map(row => row.id) })), unspecified: live.filter((_, index) => values[index] === undefined).map(row => row.id) });
  }
  const bestScore = Math.max(0, ...candidates.map(candidate => candidate.pairs));
  const best = candidates.filter(candidate => candidate.pairs === bestScore);
  best.sort((left, right) => Buffer.byteLength(left.observation) === Buffer.byteLength(right.observation) ? left.observation.localeCompare(right.observation, 'en') : Buffer.byteLength(left.observation) - Buffer.byteLength(right.observation));
  return best.length === 0 ? null : best[0];
}

/** Assert the complete native owner and its matrix against independently computed expectations. */
export async function checkedMatrix(investigation: string, options: Options, expected: Investigation, rows: MatrixRow[], invalid: Set<string>) {
  const owner = await new Store(options).get(investigation); assert.deepEqual(state(owner.hypothesis_state), expected);
  const packet = await matrix(investigation, { ...options, budget: 1000000 }); assert.deepEqual(packet.rows, rows);
  assert.deepEqual((packet.receipt.sourceIssues?.returned ?? []).map(issue => issue.id).sort(), [...invalid].sort());
  assert.equal(packet.receipt.sourceIssues?.omitted ?? 0, 0); return packet;
}
