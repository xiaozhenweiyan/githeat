# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
