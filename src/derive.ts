import { usedIssues } from './records.ts';
import type { Investigation, MatrixRow, Request, SourceIssue } from './types.ts';

/** Compute the matrix from the complete atomic owner, preserving all contradicting witnesses. */
export function derive(state: Investigation, issues: SourceIssue[] = []): MatrixRow[] {
  const admitted = state.observations.filter(observation => observation.status === 'admitted' && !issues.some(issue => issue.id === observation.id));
  return state.hypotheses.map((hypothesis): MatrixRow => {
    if (issues.some(issue => issue.id === hypothesis.id)) return { ...hypothesis, status: 'invalid', witnesses: [], open: hypothesis.predictions };
    const witnesses = hypothesis.predictions.flatMap(prediction => admitted.filter(observation => observation.observation === prediction.observation && observation.value !== prediction.value).map(observation => ({ prediction, observation })));
    const open = hypothesis.predictions.filter(prediction => !admitted.some(observation => observation.observation === prediction.observation));
    return { ...hypothesis, status: witnesses.length > 0 ? 'eliminated' : open.length > 0 || hypothesis.predictions.length === 0 ? 'unknown' : 'viable', witnesses, open };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}
/** Choose the key splitting most surviving pairs, then the shortest key and lexical order. */
export function choose(rows: MatrixRow[]): Request | null {
  const live = rows.filter(row => row.status !== 'eliminated' && row.status !== 'invalid');
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

/** Validate a recorded decision against current revision, sources, cause and acknowledgments. */
export function decisionValid(value: Investigation, rows: MatrixRow[], issues: SourceIssue[]): boolean {
  const conclusion = value.conclusion;
  if (conclusion === undefined || conclusion.revision !== value.revision || usedIssues(value, issues).length > 0) return false;
  const live = rows.filter(row => row.status === 'viable' || row.status === 'unknown');
  return live.some(row => row.id === conclusion.cause) && JSON.stringify(live.filter(row => row.id !== conclusion.cause).map(row => row.id).sort()) === JSON.stringify([...new Set(conclusion.accepted)].sort());
}
