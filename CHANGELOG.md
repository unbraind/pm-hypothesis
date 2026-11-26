# Changelog

## 2026.11.26 - 2026-11-26

### Dependencies

- Bump unbraind/pm-ops/.github/workflows/daily-release.yml ([#59](https://github.com/unbraind/pm-hypothesis/pull/59))
- Bump the codeql-action group with 2 updates ([#58](https://github.com/unbraind/pm-hypothesis/pull/58))

## 2026.11.25 - 2026-11-25

### Other

- Adopt pm-cli 2026.11.24 host-aligned SDK behaviour ([pm-hypothesis-sdk-host-alignment-1122](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/chores/pm-hypothesis-sdk-host-alignment-1122.toon))

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

### Dependencies

- Bump eslint ([#43](https://github.com/unbraind/pm-hypothesis/pull/43))
- Bump @unbrained/pm-cli ([#42](https://github.com/unbraind/pm-hypothesis/pull/42))
- Bump @babel/eslint-parser ([#40](https://github.com/unbraind/pm-hypothesis/pull/40))
- Bump the pm-toolchain group with 2 updates ([#39](https://github.com/unbraind/pm-hypothesis/pull/39))
