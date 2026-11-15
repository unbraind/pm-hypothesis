# Fleet CI v2

Required hosted checks remain `test (22)`, `test (26)` and `codeql`.
PRs and dispatch use quick depth, cancel superseded PR runs and cap each job at
25 minutes. CodeQL is required and remains unfiltered, with its weekly schedule
and a 30-minute timeout. No release caller or release verifier script changes.

| Check | Code PR 22 | Code PR 26 | Docs/tracker PR, both | Deep 22 + 26 |
| --- | --- | --- | --- | --- |
| npm ci, prepare merge drivers | yes | yes | yes | yes |
| Strict pm health with required merge drivers | yes | yes | yes | yes |
| Commit identity and private-path gate | yes | yes | yes | npm + Bun |
| Changelog consistency | — | gate | yes | npm + Bun |
| npm package inventory/dry-run | — | gate | yes | npm + Bun |
| Tooling/identity/docs links and changelog automation tests | suite | suite | yes | npm + Bun |
| Build, test typecheck and unit/model suites | quick | quick coverage | build for package inventory | full npm + Bun |
| Typecheck, lint, zero duplication, docstrings | — | gate | — | npm + Bun |
| Coverage: 100% statements/branches/functions/lines | — | quick | — | full npm + Bun |
| Production audit, publish attestation verifier | — | gate | — | npm + Bun |
| Packed npm/Bun and npx/bunx CLI + SDK acceptance | — | gate | — | npm + Bun |
| Bun package graph smoke | — | yes | — | yes |
| CodeQL | all PRs, separate workflow | separate workflow | yes, required | main pushes and weekly scan |

The cheap path retains the real identity/private-path gate, identity regression
and docs-link tests, generated changelog and packaging inventory. Executable
tracker files select the code path. Packed acceptance already installs via Bun
and activates the extension through bunx, then exercises the CLI and SDK. The
quick gate therefore needs only a Bun graph smoke, without another full gate.

Unset depth stays full. Quick uses 25 of 100 deterministic SDK property samples
and the first 25 transport keys per format. Input alphabets and seed generation
are unchanged. The exhaustive 1,312-case ordered boundary-pair matrix uses a
deterministic prefix per command in quick depth (at least 25 cases per command),
retaining all six commands. Full depth still asserts all 1,312 cases. Generated
and executed counts are compared directly; no seeded counter makes the quick
checks vacuous. The fixed small seed/boundary suites remain intact. All coverage
thresholds and source scope (runtime, scripts and root configuration) are unchanged.
Acceptance/revert child watchdogs alone scale via validated positive finite
`PM_TEST_TIME_SCALE`, rounded up to integer milliseconds. Product token budgets
and assertions remain literal; the finite model suites have no speed deadline.

Deep runs on main pushes, dispatch and daily at 02:29 UTC, away from hourly :41
release reconciliation and Monday 01:47 CodeQL. Distinct `deep (22)`/`deep (26)`
checks run full npm and Bun release gates, with `PM_TEST_DEPTH=full`,
`PM_TEST_TIME_SCALE=3`, per-ref cancellation and a 120-minute limit. Local
`pm-local` runners retain persistent npm caches and use preinstalled Bun (whose
version is logged); `PM_LOCAL_DEEP=off` selects hosted Ubuntu. Behavioral revert
and real-data acceptance scripts were not separate jobs in the original CI and
are not newly promoted to CI gates here; existing per-test regression coverage
remains in both tiers.

Baseline main run 43707230819: Node 22 46m40s queue-inclusive, 9m06s execution;
Node 26 65m42s queue-inclusive, 11m16s execution. Node 26 full coverage test phases
were 308.93s/304.10s. Its exhaustive interleaving matrix took 287.32s and transport
property cases 88.41s. Owner fleet measurement: 39,929 runner-minutes/day and
median PR wall time 45–90m, including about 28m queueing. Full depth is deferred
to deep CI after merge. Local/hosted timings use different hardware and cannot
establish a controlled speedup ratio.

Local proof: typecheck and lint passed. Touched quick suites passed in 318.95s,
including 180 generated interleavings across six commands. The one optional
quick coverage attempt hit its 20-minute host cap while finite recovery cases
were still passing (exit 124); no complete local coverage report exists. This
is not evidence that quick coverage meets the unchanged thresholds. PR CI
retains that certification gate. No full-depth run was attempted locally.
Required PR jobs were still queued at handoff, so completed wall time is unknown.
