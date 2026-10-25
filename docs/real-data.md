# Public incident proof

Source: [unbraind/pm-memory CI run 40161355596](https://github.com/unbraind/pm-memory/actions/runs/40161355596), head 06f15eb9fb109acf15192a3d6d6a1fd2ca85398e. Read with `gh run view 40161355596 -R unbraind/pm-memory --json headSha,url,event,conclusion,jobs`. No hosted data was read. A disposable `mktemp`-style non-git directory was created through the SDK and removed in finally. Repository test fixtures are synthetic.

Five explicit explanations, ten observations, immutable native fact provenance and an atomic investigation owner. This identifies the failing stage; it does not establish the underlying code cause. The log commands returned no content, so no assertion-level cause is claimed.

- H1: Checkout failed before the package gates
- H2: Dependency installation prevented the package gates
- H3: Tracker health blocked release verification
- H4: Commit identity policy blocked release verification
- H5: The failure was in Node 22 npm release gates after prerequisites passed

| Admitted observation | Complete matrix after observation | Newly eliminated |
| --- | --- | --- |
| checkout22=success | H1:eliminated, H2:unknown, H3:unknown, H4:unknown, H5:unknown | 1 |
| node22setup=success | H1:eliminated, H2:unknown, H3:unknown, H4:unknown, H5:unknown | 0 |
| bun22setup=success | H1:eliminated, H2:unknown, H3:unknown, H4:unknown, H5:unknown | 0 |
| install22=success | H1:eliminated, H2:eliminated, H3:unknown, H4:unknown, H5:unknown | 1 |
| health22=success | H1:eliminated, H2:eliminated, H3:eliminated, H4:unknown, H5:unknown | 1 |
| identity22=success | H1:eliminated, H2:eliminated, H3:eliminated, H4:eliminated, H5:unknown | 1 |
| npm22=failure | H1:eliminated, H2:eliminated, H3:eliminated, H4:eliminated, H5:unknown | 0 |
| bun22=skipped | H1:eliminated, H2:eliminated, H3:eliminated, H4:eliminated, H5:unknown | 0 |
| npm26=success | H1:eliminated, H2:eliminated, H3:eliminated, H4:eliminated, H5:unknown | 0 |
| bun26=success | H1:eliminated, H2:eliminated, H3:eliminated, H4:eliminated, H5:viable | 0 |

Next requests, initially and after each observation: health22 → health22 → health22 → health22 → identity22 → npm22 → none → none → none → none → none. These are suggestions only; nothing executed them. Pair scores use declared equality predictions and preserve unspecified causes.

Resume: **1397 estimated tokens**, 11 rows, 5 omitted rows, sourceComplete=true. Full investigation transcript: **37913 UTF-8 bytes / 9479 estimated tokens**, including the public run metadata and 16 complete native records. The transcript is measured once, without repeated matrix output or SDK transport wrappers. Both estimates use bytes/4; the resume uses the larger JSON/TOON representation including its receipt.

Calls: **1 GitHub read**, **56 public SDK/API calls** (init/open/add/observe/matrix/next/resume and transcript reads). These are in-process calls, not model or remote-backend round trips. Internal SDK filesystem/schema operations are not counted.

Reproduce with `npm run test:real-data`; this refreshes this document from that immutable public run and deletes its scratch tracker.
