# Benchmark

Measured on Windows 11 (PowerShell 5.1), Node 22.23.2, git 2.55.0, warm file
cache, median of three runs. `githeat heat <repo> --json > NUL` so terminal
rendering is excluded.

| repository | commits | ranked files | githeat | raw `git log --name-only` |
| --- | ---: | ---: | ---: | ---: |
| tiny fixture (`test/helpers.mjs`) | 12 | 3 | 0.69 s | 0.01 s |
| slugify | 78 | 9 | 0.69 s | 0.02 s |
| chalk | 359 | 33 | 0.74 s | 0.26 s |

Reading the numbers:

- **Process startup dominates.** `node -e 0` costs ~0.18 s on this machine, and
  the measured floor for *any* `githeat` invocation is ~0.69 s. For repositories
  under a few thousand commits the analysis itself is in the noise.
- **git dominates the rest.** Parsing 359 commits of `chalk` history costs
  ~0.26 s, and `githeat` adds roughly 0.3 s of JavaScript on top of start-up
  plus that git call. There is no per-file subprocess: one `git log`, one parse,
  one layout.
- **Memory** stays proportional to the number of `(commit, path)` pairs; a
  100 000-commit monorepo is a few hundred MB of strings at worst, so prefer
  `--since 12.months` there.

To reproduce:

```bash
git clone --filter=blob:none https://github.com/chalk/chalk /tmp/chalk
time node bin/githeat.mjs heat /tmp/chalk --json > /dev/null
```

No measurements above a 400-commit repository are claimed here: the parser is a
single pass over `git log` output and holds only `(commit, path)` strings, so the
cost is expected to grow linearly with history size, but that expectation has not
been verified on a large monorepo yet. If you run it on one, a PR with the numbers
is very welcome — that is exactly the kind of report this project is built on.
