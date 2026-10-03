# Benchmark

Measured on Windows 11 (PowerShell 5.1), Node 22.23.2, git 2.55.0, warm file
cache, median of three runs. Timings come from `scripts/bench.mjs`, which runs
`githeat heat <repo> --json` (terminal rendering excluded) and also times a bare
`git log --name-only` on the same repository for comparison:

```bash
git clone --filter=blob:none https://github.com/chalk/chalk /tmp/chalk
node scripts/bench.mjs /tmp/chalk chalk
# -> | chalk | 380 | 33 | 0.72 s | 0.13 s |
```

| repository | commits | ranked files | githeat (median of 3) | raw `git log --name-only` |
| --- | ---: | ---: | ---: | ---: |
| githeat (this repo) | 15 | 6 | 0.79 s | 0.10 s |
| fixture (`test/helpers.mjs`) | 12 | 3 | 0.69 s | 0.01 s |
| slugify | 78 | 6 | 0.69 s | 0.11 s |
| chalk | 380 | 33 | 0.72 s | 0.13 s |
| express | 6 173 | 396 | 1.10 s | 0.52 s |
| vuejs/core | 6 532 | 810 | 1.45 s | 0.58 s |

Reading the numbers:

- **Process start-up dominates small repositories.** `node -e 0` costs ~0.18 s
  here and the floor for any `githeat` invocation is ~0.69 s, so 15 commits and
  380 commits measure the same. Below a few thousand commits the analysis is
  inside the noise band and you should not think about its cost at all.
- **Above a few thousand commits, git takes over.** On 6 500 commits a bare
  `git log --name-only` costs ~0.55 s and the whole run costs 1.1–1.5 s. The
  JavaScript side therefore contributes roughly 0.5–0.9 s on top of git plus
  start-up — it is a single pass over the log with no per-file subprocess.
- **Scaling is close to linear in history size**, which is what the design
  predicts: one `git log`, one parse, one treemap layout.
- **Memory** is proportional to the number of `(commit, path)` pairs held during
  the parse — strings only. For a monorepo with 100k+ commits, scope the window
  with `--since 12.months` instead of hoping.

## What this measures, and what it does not

Reproduce the two large rows with:

```bash
git clone --filter=blob:none --no-checkout --depth 5000 https://github.com/vuejs/core /tmp/vue
node scripts/bench.mjs /tmp/vue vuejs/core
```

Caveats, stated plainly:

- **`--depth 5000` truncates history.** The clone holds the most recent 5 000
  commits, so "6 532 commits" is what the clone contains, not the project's full
  history. Full-history numbers will be larger; the shape of the curve is what
  matters here.
- **Nothing above ~7 000 commits has been measured.** Cloning the very large
  targets (django, rust) has failed on this machine's network so far; a partial
  `django` clone arrived without a usable `HEAD` and was deleted rather than
  guessed at. That is a gap in the evidence, not a claim about performance.
- **One machine, one OS.** No macOS or Linux timing has been recorded yet.

If you run `githeat` on a larger repository, a pull request adding its row here
is one of the most useful contributions this project can receive — and if it is
slow, that is a bug report worth opening.

## Incidental finding: the risk bands are calibrated for small repositories

On `vuejs/core` the absolute thresholds put **192 of 810 files in `critical`**
(score ≥ 70). Not a bug — a 6 500-commit history really does contain a lot of
heavily-edited files — but it means the bands stop discriminating at that size,
which is why the default is now `--bands auto`: absolute for repositories under
50 ranked files, rank-based above it.

Measured on the same two clones:

| repository | ranked files | `--bands auto` (default) | `--bands absolute` |
| --- | ---: | --- | --- |
| express | 396 | 20 critical (5.1 %), 40 high, 99 medium, 237 low | 66 critical (16.7 %), 167 high, 163 medium, 0 low |
| vuejs/core | 810 | 41 critical (5.1 %), 81 high, 202 medium, 486 low | 192 critical (23.7 %), 217 high, 401 medium, 0 low |

Note the `low` column: under absolute bands nothing in either repository is "low",
because the score floor sits at ~24. Rank-based banding is what makes the label
carry information on a mature codebase.

```bash
githeat heat . --bands absolute     # the old behaviour, comparable across repos
githeat heat . --bands percentile   # same cut-offs regardless of size
```
