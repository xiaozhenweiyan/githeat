# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `githeat review` — rank only the files a change touched, from a path list on
  stdin or `--changed <file>`, as markdown (for a PR comment) or JSON.
- A GitHub Action (`action/`) that reviews every pull request: posts one comment
  listing the changed files that are known hotspots, edits it in place instead of
  commenting on every push, and stays silent when nothing ranked was touched.
  "305 changes, 53 authors" is context a reviewer otherwise has no way to see.
  The action runs on this repository's own pull requests.
- `--bands absolute|percentile|auto` — risk bands can be cut by rank instead of
  by absolute score. Absolute cut-offs stop discriminating on large histories
  (`vuejs/core`: 192 of 810 files land in "critical"); under the new default of
  `auto`, repositories with 50+ ranked files are banded by rank, so `critical`
  means "top 5 % of this repository".

## [0.1.0] - 2026-04-01

First release: the whole tool, small enough to read in one sitting.

### Added

- `githeat heat` — rank files by hotspot score, with `table`, `tree`, `json`,
  `svg` and `html` output.
- `githeat check` — CI gate with `--max-score` / `--max-critical` thresholds and
  meaningful exit codes (`0` ok, `1` breached, `2` usage error).
- `githeat install-hook` — non-blocking pre-commit reminder.
- Self-contained SVG heatmap: squarified treemap, area = churn, colour = score,
  tooltips per tile, risk-distribution strip, no scripts and no external fonts.
- Single-file HTML report with a filterable, sortable hotspot table.
- 24-bit colour terminal output with a plain-text fallback (`NO_COLOR`).
- Three palettes: `ember`, `viridis` (colour-blind safe), `mono` (printing).
- Time windows applied to **author dates in UTC**, inclusive on both ends.
- Noise filtering for lockfiles, vendored/generated paths and binaries, plus a
  source-extension filter so config and docs stop outranking code.
- Public API (`readHistory`, `analyze`, `renderSvg`, `renderHtml`, …) for scripts
  and bots.
- Zero runtime dependencies; test suite on `node:test` including an end-to-end
  run against a real throwaway repository.

[Unreleased]: https://github.com/xiaozhenweiyan/githeat/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/xiaozhenweiyan/githeat/releases/tag/v0.1.0
