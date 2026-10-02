# Benchmark

Measured on Windows 11 (PowerShell 5.1), Node 22.23.2, git 2.55.0, warm file
cache, median of three runs. `githeat heat <repo> --json > NUL` so terminal
rendering is excluded. Reproduce with:

```bash
git clone --filter=blob:none https://github.com/chalk/chalk /tmp/chalk
time node bin/githeat.mjs heat /tmp/chalk --json > /dev/null
```

| repository | commits | ranked files | githeat | raw `git log --name-only` |
| --- | ---: | ---: | ---: | ---: |
| tiny fixture (`test/helpers.mjs`) | 12 | 3 | 0.69 s | 0.01 s |
| slugify | 78 | 9 | 0.69 s | 0.02 s |
| chalk | 359 | 33 | 0.74 s | 0.26 s |
| django | — | — | *not measured, see below* | — |

Reading the numbers:

- **Process start-up dominates.** `node -e 0` costs ~0.18 s on this machine, and
  the measured floor for any `githeat` invocation is ~0.69 s. Below a few thousand
  commits the analysis itself is in the noise.
- **git dominates what is left.** Parsing 359 commits of `chalk` history costs
  ~0.26 s; `githeat` adds roughly 0.3 s of JavaScript on top of start-up plus that
  git call. There is no per-file subprocess: one `git log`, one parse, one layout.
- **Memory** is proportional to the number of `(commit, path)` pairs held during
  the parse — strings only. For a monorepo with 100k+ commits, scope the window
  with `--since 12.months` rather than hoping.

## What has not been measured

**No repository above ~400 commits has been benchmarked yet.** Three attempts to
clone larger targets (express, vue, django, rust) failed on this machine's network
— the partial `django` clone ended up without a usable HEAD and was discarded
rather than guessed at.

So the honest claim is: the parse is a single pass over `git log` and the cost is
expected to grow linearly with history size, but **that expectation is untested**.
If you run `githeat` on a large repository, a PR adding the number here is one of
the most useful contributions this project can receive — and if it is slow, that
is a bug report worth opening.
