# Changelog

## 2026.11.23 - 2026-11-23

### Dependencies

- Bump unbraind/pm-ops/.github/workflows/daily-release.yml ([#52](https://github.com/unbraind/pm-hypothesis/pull/52))
- Bump unbraind/pm-github/.github/workflows/pm-github-sync.yml ([#51](https://github.com/unbraind/pm-hypothesis/pull/51))

## 2026.11.20 - 2026-11-20

No changes.

## 2026.11.19 - 2026-11-19

### Added

- Matrix investigation context ([pm-hypothesis-matrix](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/features/pm-hypothesis-matrix.toon))
- Next investigation context ([pm-hypothesis-next](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/features/pm-hypothesis-next.toon))
- Resume investigation context ([pm-hypothesis-resume](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/features/pm-hypothesis-resume.toon))
- Safety investigation context ([pm-hypothesis-safety](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/features/pm-hypothesis-safety.toon))

### Fixed

- Keep sync changelog regeneration consistent with the release gate ([pm-hypothesis-sync-changelog](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/issues/pm-hypothesis-sync-changelog.toon))
- Interrupted open cannot recover after an unrelated edit changes the initialization precondition ([pm-hypothesis-concurrency](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/issues/pm-hypothesis-concurrency.toon))
- Public SDK output escaping changes exact observation keys and values ([pm-hypothesis-records](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/issues/pm-hypothesis-records.toon))

### Other

- Adopt SDK whole-envelope output fitting ([pm-hypothesis-sdk-envelope-fitter](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/chores/pm-hypothesis-sdk-envelope-fitter.toon))
- Standardize the release gate on owner approval with a daily release schedule ([pm-hypothesis-d9dg](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/tasks/pm-hypothesis-d9dg.toon))
- Apply Fleet CI v2 quick and deep tiers ([pm-hypothesis-ci-v2](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/tasks/pm-hypothesis-ci-v2.toon))
