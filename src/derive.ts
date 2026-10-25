import type { Investigation, MatrixRow, Request } from './types.ts';

/** Compute the matrix from the complete atomic owner, preserving all contradicting witnesses. */
export function derive(state: Investigation): MatrixRow[] {
  const admitted = state.observations.filter(observation => observation.status === 'admitted');
  return state.hypotheses.map((hypothesis): MatrixRow => {
    const witnesses = hypothesis.predictions.flatMap(prediction => admitted.filter(observation => observation.observation === prediction.observation && observation.value !== prediction.value).map(observation => ({ prediction, observation })));
    const open = hypothesis.predictions.filter(prediction => !admitted.some(observation => observation.observation === prediction.observation));
    return { ...hypothesis, status: witnesses.length > 0 ? 'eliminated' : open.length > 0 || hypothesis.predictions.length === 0 ? 'unknown' : 'viable', witnesses, open };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}
/** Choose the key splitting most surviving pairs, then the shortest key and lexical order. */
export function choose(rows: MatrixRow[]): Request | null {
  const live = rows.filter(row => row.status !== 'eliminated');
  const keys = [...new Set(live.flatMap(row => row.open.map(prediction => prediction.observation)))];
  const requests = keys.map(observation => {
    const groups = new Map<string, string[]>(); const unspecified: string[] = [];
    for (const row of live) {
      const prediction = row.predictions.find(entry => entry.observation === observation);
      if (prediction === undefined) unspecified.push(row.id);
      else groups.set(prediction.value, [...(groups.get(prediction.value) ?? []), row.id]);
    }
    const entries = [...groups].sort(([a], [b]) => a.localeCompare(b, 'en'));
    let pairs = 0;
    for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) pairs += entries[i][1].length * entries[j][1].length;
    return { observation, pairs, groups: entries.map(([value, hypotheses]) => ({ value, hypotheses })), unspecified };
  }).filter(request => request.pairs > 0);
  requests.sort((a, b) => b.pairs - a.pairs || Buffer.byteLength(a.observation) - Buffer.byteLength(b.observation) || a.observation.localeCompare(b.observation, 'en'));
  return requests[0] ?? null;
}
