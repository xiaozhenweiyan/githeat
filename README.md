# githeat

[![ci](https://github.com/xiaozhenweiyan/githeat/actions/workflows/ci.yml/badge.svg)](https://github.com/xiaozhenweiyan/githeat/actions/workflows/ci.yml)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![node](https://img.shields.io/badge/node-%3E%3D18-informational)

**Find the files that are quietly costing you the most — then watch the heat move.**

`githeat` reads your git history, ranks every source file by how much editing
pressure it absorbs, prints a heat table in your terminal, and renders a
self-contained SVG heatmap you can drop straight into a README or a PR.

Zero dependencies. No config. No account. Nothing leaves your machine.

![githeat hotspot map](docs/demo.svg)

```console
$ node bin/githeat.mjs /path/to/your/repo
```

```console
chalk all time · 359 commits · 33 files · 70 authors · 390 churn
top 10 files hold 64.6% of all churn — concentrated risk

   #  score  heat           changes     churn  auth  last  file
-----------------------------------------------------------------------------
   1   99.7  ████████████        29        29     9    5d  source/index.js
   2   93.5  ███████████░        21        21     8    5d  test/chalk.js
   3   80.0  ██████████░░        60        60    19  7.2y  index.js
   4   80.0  ██████████░░        36        36    13  9.2y  test.js
   5   80.0  ██████████░░        26        26    13  5.2y  index.d.ts
   6   79.1  █████████░░░        14        14     4   2mo  examples/rainbow.js
   7   79.1  █████████░░░        14        14     4   2mo  source/index.d.ts
   8   73.9  █████████░░░        20        20    13  5.2y  index.test-d.ts

bands: critical 9 high 12 medium 12 low 0
```

*(real output — `githeat heat chalk --top 8`)*

---

## Why hot files, not complex files

Two decades of empirical software research keep landing on the same result:
**how often a file changes predicts defects better than how complicated it is.**
Cyclomatic complexity tells you a file *could* be hard. Churn tells you a file
*is* repeatedly reopened, re-reviewed and re-broken by real people under real
deadlines. That is where your next bug is already sitting.

`githeat` turns that signal into a number and a picture, in one command.

## Install

Not on npm yet — clone it or run it straight from the repository:

```bash
git clone https://github.com/xiaozhenweiyan/githeat
cd githeat
node bin/githeat.mjs heat /path/to/your/repo
```

`npm i -g` arrives with the first npm release; the `bin` entry is already wired.
Requires Node 18+ and `git` on your PATH — that is the whole dependency list.

## Use

```bash
githeat                                    # rank the current repo
githeat --since 3.months --top 25          # just this quarter
githeat --format tree                      # which directories own the churn
githeat --format svg --out docs/heat.svg   # save a map for the README
githeat --format html --open               # full interactive report
githeat --json | jq '.hotspots[0]'         # feed a script or a dashboard
githeat check --max-score 90               # CI gate, exit code 1 on breach
githeat install-hook                       # non-blocking pre-commit reminder
```

| flag | what it does |
| --- | --- |
| `--since <when>` / `--until <when>` | time window (`12.months`, `2024-01-01`, `"6 weeks ago"`), UTC, both ends inclusive |
| `--author <pattern>` | only one person's commits — see where *you* keep going back |
| `--rev <range>` | `main`, `v1.0..HEAD`, any revision range |
| `--min-commits <n>` | ignore files touched fewer than n times (default 2) |
| `--ext <list>` | score only these extensions, e.g. `"js,ts,py"`; `--ext ""` scores every file |
| `--include-noise` | keep lockfiles, `dist/`, vendored and generated files |
| `--format <fmt>` | `table`, `tree`, `json`, `svg`, `html` |
| `--palette <name>` | `ember` (default), `viridis` (colour-blind safe), `mono` (print) |
| `--top <n>`, `--tiles <n>` | rows to print, tiles in the map |

## How the score works

Every ranked file gets a **hotspot score from 0 to 100**:

```
score = 100 × (0.68 × churn + 0.32 × changes) × recency
```

- **churn** — how many times the file was changed across commits. Normalised on a
  log scale anchored at the repository's own 90th percentile, so one giant
  generated file cannot flatten everything else to zero.
- **changes** — how many separate commits touched it. Being reopened 30 times in
  30 commits is worse than one sweeping rewrite.
- **recency** — a file nobody has touched in a year is 20% less urgent than one
  edited last week.

Bands: `critical ≥ 70`, `high ≥ 45`, `medium ≥ 20`, `low` below that.

**Direction matters as much as level.** A snapshot cannot tell a file that is
getting worse from one that has always been bad, so every file also carries a
trend comparing the second half of the analysed window with the first:

```
   #  score  heat           changes     churn  trend  auth  last  file
   1   99.2  ████████████        82        82  - flat   29   15d  Suspense.ts
   2   99.1  ████████████       305       305  v down   53   16d  renderer.ts
  12   98.6  ████████████       131       131   ^ up    30   26d  hydration.ts
```

`rising` means 60 % or more of a file's changes happened in the second half of
the window, `cooling` 40 % or less, and a file needs at least five changes before
a direction is claimed at all. `hydration.ts` is the one to worry about: still
scoring high, but on its way up rather than down.

**What is filtered before scoring:** lockfiles, `node_modules/`, `vendor/`,
`dist/`, build output, minified files, images, binaries — and, by default,
non-code files such as `package.json` and `readme.md`. Config and docs are
edited constantly and debugged never; scoring them buries the real signal.
Override with `--ext ""`.

**Excluding your own generated code.** The built-in filter cannot know that
*your* `src/generated/api.ts` is machine-written. When a file keeps topping the
ranking without deserving it, exclude it — permanently, in a file that travels
with the repository:

```bash
githeat init                  # writes a starter .githeatignore (all comments)
```

```gitignore
# .githeatignore — same syntax as .gitignore
src/generated/                # a directory and everything under it
*.min.js                      # a name, at any depth
docs/api/*.md                 # anchored, because the pattern has a slash
!src/generated/handwritten.ts # negation: later patterns win
```

Or for one run, without touching the repository:

```bash
githeat heat . --ignore "src/generated/,*.min.js"
githeat heat . --no-ignore-file      # ignore the ignore file
```

`--ignore` wins over `.githeatignore`, which wins over the built-in noise
patterns, so you can always force a file back into the ranking.

**"Why is this file here — or not here?"** Ask it directly:

```console
$ githeat explain src/core.js
RANK 2 of 8   score 100/100   band critical

score = 100 x (0.68 x churn + 0.32 x changes) x recency
      = 100 x (0.68 x 1.000 + 0.32 x 1.000) x 1.000

  churn     4   changes in total (the weighting is not line-based)
  changes   4   separate commits that touched it
  authors   1
  recency   1.000   last change 2026-10-03 (0 days ago)

  normalisation is relative to this repository, not absolute
```

```console
$ githeat explain README.md
NOT RANKED — extension
  .md is not in the scored extension list — pass --ext "" to score every file

  appears in 54 analysed commits:
    2026-09-17  a1b2c3d  someone
```

Every exclusion reason is named — `noise`, `ignored`, `extension`, `min-commits`,
`untouched` — because "my file is missing" and "my file should not be ranked" are
the two reports this tool gets, and both are answers, not bugs. `--format json`
gives the same thing to a script.

**Author dates, not committer dates.** Rebases and squash merges rewrite the
committer date, which would make every file look freshly touched. Windows are
applied to author dates in UTC so a report means the same thing on every machine.

**Risk bands adapt to repository size.** Absolute cut-offs (`critical ≥ 70`) work
on a small project but stop discriminating on a large one: on `vuejs/core`, 192 of
810 files score ≥ 70. Under the default `--bands auto`, repositories with 50+
ranked files are banded by rank instead — top 5 % `critical`, next 10 % `high`,
next 25 % `medium` — which keeps the label meaningful at any size. Pass
`--bands absolute` or `--bands percentile` to pin it.

## Inside a file

A ranking says *which* file. For a 1 300-line file with 305 changes that is half
an answer — the other half is where inside it:

```console
$ githeat lines parser.js
parser.js
my-service · HEAD · 304 lines tracked by blame

age of each line, by the commit that last touched it:
  last week        60   20%  ███████
  last month        0    0%
  last quarter      0    0%
  last year        80   26%  █████████
  last 2 years     70   23%  ████████
  older            94   31%  ███████████

largest contiguous regions (>= 8 lines):
  lines     1-92      92 lines  older
  lines   163-242     80 lines  last year
  lines    93-162     70 lines  last 2 years
  lines   243-302     60 lines  last week

most untouched: lines 1-242 (242 lines) — nothing here for about 900 days
newest work:    lines 243-302 (60 lines) — last touched 4 days ago
```

`--map` prints a per-line column instead of the summary when you want to see the
shape; `--format json` gives the buckets and regions to a script.

**Read it as staleness, not churn.** `git blame` reports the *last* commit that
touched each line, so this is an age map: a large old region means "nobody has
needed to change this in a long time", which is not the same as "this is correct".
It is the opposite question from the file ranking, and the useful one when you are
about to edit a hotspot: the fresh 60 lines are where the action is, the 242 old
ones are where a change is most likely to surprise you.

**It needs a full clone.** On a `--filter=blob:none` clone — increasingly the
default for big repositories — blame would have to fetch every historical blob
over the network, one file at a time, and then fail anyway. `githeat` detects
that configuration and says so immediately instead of stalling, and tells you the
command that fixes it.

## On every pull request

A repo-wide ranking is a monthly report. The version that earns its keep runs on
every PR and tells the reviewer — and the contributor — when a change lands on a
file that is already known trouble:

```yaml
# .github/workflows/review.yml
name: githeat review
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }      # real history is the whole point
      - uses: xiaozhenweiyan/githeat/action@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          since: 12.months
```

It posts one comment per pull request — edited in place, never a new comment per
push — and skips the comment entirely when a change touches no ranked file, so it
stays quiet on small PRs:

> ### githeat · this PR touches known hotspots
>
> 🔴 **packages/runtime-core/src/renderer.ts** has a hotspot score of **99.1/100**
> (305 changes, 53 authors, last touched 16 days ago).
>
> | score | changes | authors | last change | file |
> | ---: | ---: | ---: | ---: | --- |
> | 99.1 | 305 | 53 | 16d ago | `packages/runtime-core/src/renderer.ts` |
> | 99.1 | 308 | 46 | 16d ago | `packages/compiler-sfc/src/compileScript.ts` |

The same thing locally, on the files you are about to commit:

```bash
git diff --name-only origin/main... | node bin/githeat.mjs review
```

`review` reads the path list from stdin or `--changed <file>`, and `--format json`
gives `{ changed, ranked, average, verdict, hotspots[] }` for scripts.

## Against a baseline

"Where is the pain" is one question. "Did this branch make it worse" is the one
you ask before merging:

```console
$ githeat heat . --base main
vs the baseline revision main @ 2989128  (2 ranked files then, 3 now)
  0 hotter · 1 cooler · 1 new · 0 gone

  v  78.3   -21.7 (was 100)  legacy.js
  +  72.1  new in this revision   fresh.js
```

The baseline is resolved through `git merge-base`, so comparing against a branch
you are 200 commits behind does not credit your work with changes it never made.
Both sides are scored with the same window, filters and exclusions — only the
revision differs, which is what makes the deltas mean anything. Movements below
two points are ignored rather than reported as noise.

**Read `cooler` carefully.** It does not mean a file was refactored: it means the
baseline revision has commits touching it that this revision does not, which on a
branch is "not touched yet" and across forks is "someone else's work". Compared
with an earlier point on the *same* line of history, files can only accumulate,
and `githeat` says so rather than letting `0 cooler` look like a bug.

## In CI

```yaml
- run: node bin/githeat.mjs check --max-score 90 --max-critical 0
```

`check` prints a short verdict and exits `1` when a threshold breaks, `0`
otherwise, `2` on a usage error. `--quiet` reduces it to a single line for logs.

The pre-commit hook installed by `githeat install-hook` uses a deliberately loose
threshold: it reminds, it never blocks a commit for you.

## As a library

```js
import { readHistory, analyze, renderSvg } from 'githeat';
import { writeFileSync } from 'node:fs';

const report = analyze(readHistory({ cwd: '.', since: '6.months' }));
writeFileSync('heat.svg', renderSvg(report, { title: 'my-service' }));
console.log(report.files[0]); // { path, score, commits, churn, authors, last, ... }
```

Nothing in the library touches the network or writes to your repo unless you ask.

## Performance

One `git log` call, one parse, one layout — no per-file subprocess, no index to
keep warm.

| repository | commits | ranked files | githeat |
| --- | ---: | ---: | ---: |
| chalk | 380 | 33 | 0.72 s |
| express | 6 173 | 396 | 1.10 s |
| vuejs/core | 6 532 | 810 | 1.45 s |

Below a few thousand commits the cost is pure Node start-up (~0.7 s floor); at
6 500 commits git itself is ~0.55 s and the whole run is 1.1–1.5 s. Scaling is
close to linear in history size. Method, caveats and the raw comparison against
a bare `git log` are in [`docs/benchmark.md`](docs/benchmark.md) — including
what has **not** been measured.

For very large monorepos, scope the window: `githeat --since 12.months`.

## How it compares

- `git log --stat` / `git-quick-stats` — great at *describing* history, no ranking,
  no map, no threshold to gate on.
- CodeScene and friends — the same idea, commercial, hosted, needs an account.
- `githeat` — one command, local, no dependencies, produces an image and an exit
  code you can put in CI.

## Development

```bash
npm test          # 38 tests, including a real throwaway repository
npm run demo      # regenerate docs/ (synthetic history, stable image)
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md) and the
[benchmark notes](docs/benchmark.md). CI runs the suite on Node 18/20/22 across
Linux, macOS and Windows, plus an install-from-tarball smoke test.

### What this tool is not good at

Worth saying out loud, so you do not have to find out the hard way:

- **It measures edit pressure, not quality.** A file with a high score might be
  the best-tested file in the repo, or it might be a dumping ground. The score
  tells you where to *look*, never what is wrong.
- **Renames are counted as delete + add.** `--no-renames` is deliberate (it keeps
  the parse fast and unambiguous), so a big rename resets a file's history.
- **Generated-but-committed code that is not filtered yet will pollute the
  ranking.** If you see a suspicious winner, add its extension to `--ext` or open
  an issue with the path — noise patterns are the most useful bug reports.
- **Churn is commit count, not lines.** A one-character fix costs as much as a
  full rewrite of the file in this model.

MIT licensed. Issues and pull requests welcome — especially "this ranked my
`foo.bar` at 99 and it does not deserve it" reports, which are the most useful
bug reports this kind of tool can get.

---

**中文说明** → [README.zh-CN.md](README.zh-CN.md)
