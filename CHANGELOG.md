# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`githeat lines <path>`** — where inside one file the churn sits. A ranking
  answers "which file"; for a 1 300-line file with 305 changes that is half an
  answer. Shows the age distribution per line, the largest contiguous regions,
  and the widest untouched and freshest spans ("lines 1-242, nothing here for
  about 900 days"). `--map` prints a per-line column, `--format json` the data.
  Presented as a **staleness** map everywhere, because blame reports the last
  commit per line, not how often a line changed — a large old region means nobody
  has needed to touch it, which is not the same as it being correct.
  Refuses immediately, with the fix, on a `--filter=blob:none` clone, where blame
  would otherwise spend tens of seconds per file fetching blobs and then fail.
- **`--base <ref>`** — compare the current ranking against a baseline revision and
  list what moved: hotter, cooler, new, gone. Resolved through `git merge-base` so
  a branch that is behind does not get credited with work it never did, and scored
  with identical window/filters/exclusions on both sides so the deltas mean
  something. Movements under two points are ignored. The output is deliberately
  careful about direction: `cooler` means the baseline has commits this revision
  does not, which is not the same as "improved", and against an earlier point on
  the same line of history the tool says that only accumulation is possible
  instead of letting `0 cooler` look like a bug. An unknown ref is an error
  rather than a silent comparison against nothing (which would report every file
  as brand new).
- **Trend per file** (`rising` / `cooling` / `steady`) — the second half of the
  analysed window compared with the first, shown as a `trend` column and in
  `explain`. A snapshot cannot distinguish a file that is getting worse from one
  that has always been bad, and that distinction decides whether you refactor now
  or keep an eye on it. Rising means 60 %+ of a file's changes landed in the
  second half, cooling 40 % or less, and a direction needs five changes before
  it is claimed at all. Thresholds are shares rather than ratios because "three
  of its five changes happened late" is checkable and "the ratio is 1.5" is not.
- `githeat explain <path>` — why a file is, or is not, in the ranking. Prints the
  score arithmetic (the two normalised signals, the recency multiplier and the
  band cut-offs) or names the exact exclusion reason (`noise`, `ignored`,
  `extension`, `min-commits`, `untouched`) together with the commits that touched
  the path. `--format json` for scripts. This exists because "why is my file
  missing" and "why is this file ranked" are the two reports a hotspot tool
  receives, and both deserve an answer rather than a bug hunt.
- `.githeatignore` plus `--ignore "a,b"` and `--no-ignore-file` — gitignore-style
  exclusions for generated code the built-in filter cannot recognise. Supports
  directory rules, `*`/`**`, root anchoring and `!` negation, with later patterns
  winning. `githeat init` writes a starter file that contains only comments, so
  committing it cannot silently change somebody else's ranking.
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
