# Contributing

Thanks for looking. `githeat` is deliberately small: no build step, no runtime
dependencies, no test framework beyond `node:test`. A change that keeps it that
way will be merged quickly.

## Setup

```bash
git clone https://github.com/xiaozhenweiyan/githeat
cd githeat
npm test           # node --test, no install needed
node bin/githeat.mjs heat .        # run it on itself
```

Node 18+ and `git` are the only requirements.

## Ground rules

1. **Zero runtime dependencies.** If a feature needs a package, it belongs in a
   fork, not here. `package.json` has no `dependencies` field and should stay
   that way.
2. **Every behaviour change gets a test.** `test/unit.test.mjs` for pure
   functions, `test/cli.test.mjs` for anything the user can see (it builds a real
   throwaway repository, so git behaviour is covered too).
3. **Nothing writes to the user's repository** unless the command says so
   (`--out`, `install-hook`). No network calls, ever.
4. **Keep the output readable in a plain log.** Assume `NO_COLOR=1`, an 100-column
   terminal and a CI log with no TTY.
5. **Windows, macOS and Linux all matter.** Use `node:path`, avoid shelling out
   to anything but `git`.

## What is most useful

- **Ranking complaints.** "It put `foo.bar` at 99 and it should not be there."
  Include the repository (or a minimal shape of it) and the command you ran.
- **Noise patterns.** A generated file class that `isNoisePath` misses.
- **Renderer bugs.** Overlapping tiles, text spilling out of a tile, an SVG that
  a specific viewer refuses to open. Screenshots help.
- **New palettes / terminal widths.** Small, welcome, easy to review.

## Style

- ES modules only, `.mjs` extension, no TypeScript build.
- Two-space indent, single quotes, semicolons.
- Comment the *why*: the code already says what.
- Export new helpers through `src/index.mjs` so they are testable and usable.

## Commits and PRs

Conventional-ish prefixes help the changelog: `feat:`, `fix:`, `docs:`, `test:`,
`perf:`, `chore:`. One idea per commit. In the PR, say what the user-visible
change is and paste the output before/after.

Run `npm test` before pushing. CI runs the suite on Node 18/20/22 across Linux,
macOS and Windows, plus a check that the packed tarball installs and runs.
