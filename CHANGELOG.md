# Changelog

## 2026.10.25 - 2026-10-25

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

- Close delivered items and return idle in-progress items to open (2026-11-14 sweep) ([pm-hypothesis-sweep-1114](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/chores/pm-hypothesis-sweep-1114.toon))
- Adopt SDK whole-envelope output fitting ([pm-hypothesis-sdk-envelope-fitter](https://github.com/unbraind/pm-hypothesis/blob/main/.agents/pm/chores/pm-hypothesis-sdk-envelope-fitter.toon))
