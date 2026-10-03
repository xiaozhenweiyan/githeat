# Does it actually find anything? An evaluation

A hotspot ranking is easy to believe and hard to check. This page records an
attempt to check it against something external: **the repairs the maintainers
themselves described in their commit messages.**

Reproduce any row with:

```bash
node scripts/eval-fixability.mjs /path/to/repo --pairs 4
```

## Method

Take two revisions of somebody else's project. Between them, the maintainers did
work. Some of it they described as repair — `fix:`, `refactor:`, `simplify`,
`optimize`, `performance`, `rewrite`, `tech debt`, `workaround` — and those files
are the closest available thing to ground truth. Everything else in the window is
ordinary feature and chore work.

Then ask: using **only the history up to the earlier revision**, how did the tool
rank the files in each group?

### The control group is the whole design

A file touched by a repair commit was, by definition, touched recently, and the
score includes a recency bonus. Comparing "files with repair commits" against "every
other file in the repository" would measure *recency*, not diagnosis.

So the comparison group is **files also touched inside the same window, but without
a repair commit**. Both groups are equally recent; only the kind of attention
differs. `separation` below is the gap between their mean percentile ranks, in
percentage points, positive meaning "the files that were later repaired sit higher".

### Four filters, each of which changed the answer

This is worth reading before the numbers, because the numbers moved every time a
filter was added — in both directions.

1. **Interval selection.** Consecutive releases are the obvious unit and often the
   wrong one: a mature package ships patch releases containing a single
   version-bump commit, so there is nothing to predict. The script walks label
   pairs of increasing stride and keeps the first ranges that contain repair work.
2. **Noise scopes are excluded.** `fix(deps):`, `fix(docs):`, `chore(ci):`,
   `test(...)` are not code repairs. Before this filter, express showed 18.9 pp of
   separation built almost entirely out of a dependency bump and a triager-list
   edit — measurement replaced by flattery.
3. **A bare `fix:` is kept.** The first version of filter 2 also dropped every
   `fix(...)` prefix, which threw away the best ground truth available and pushed
   express down to 0.5 pp. Excluding *noise scopes* rather than *the word fix* is
   what produced the result below.
4. **Group-size gates.** A separation computed against one control file is not
   evidence; neither is an answer group covering a third of the repository (express
   had a 62-file "answer group" out of a few hundred ranked files — that is a
   release, not a diagnosis). Ranges failing `≥3 ranked files per group` and
   `answer group ≤ min(20, 15 % of ranked files)` are reported as unusable rather
   than averaged in.

## Results

With all four filters in place, **one repository produced usable evidence.**

### express (6 173 commits) — large project

| range | commits | repair commits | answer group | control | separation | hit (answer) | hit (control) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4.20.0..v5.0.0 | 95 | 9 | 9 | 56 | **+10.0 pp** | 22 % | 7 % |

Mean separation **+22.9 pp**, hit rate **25.4 % vs 16.1 %** across the usable
ranges: the files express later fixed were **1.6× more likely** to be in the top
10 % of the ranking than equally-recent files that were not.

### slugify and chalk — no usable evidence

Both were rejected by the group-size gates, not by producing a zero:

- **slugify** produced an apparent **+60 pp** separation (answer group mean
  percentile 20 %, control 80 %) — on an answer group of **4 files** and a control
  group of **5**, of which only 4 were ranked. That is four files against four
  files. It is the single most impressive number this harness ever produced and it
  is not evidence, which is exactly why the gate exists.
- **chalk** produced a consistent **+16.6 pp** mean across two ranges, and was
  still rejected: its answer groups (11 and 15 files) exceeded the 15 %-of-ranked
  cap, meaning the "causes" it pointed at were a large fraction of everything the
  ranking contained.

Reporting these as "no usable evidence" rather than as wins is the point of the
harness. A tool that grades its own homework will always pass.

## What this does and does not show

**Supported:**

- On express, the top of the ranking is enriched in later-repaired files by
  roughly 1.6× relative to equally-recent control files, with a 22.9 pp mean
  separation in percentile rank.
- The ranking is **not merely a recency detector**, which is the main way a metric
  like this can be useless while looking useful. That is the one thing the control
  group establishes, and it held wherever the sample was big enough to say anything.

**Not supported:**

- **Two of three projects produced no usable evidence at all.** The result rests on
  one repository and a handful of release ranges. No confidence intervals are
  quoted because the sample does not earn them.
- Nothing here says the *ordering* is trustworthy on a large codebase, only that
  the head of the list is enriched.
- Commit messages are a human judgement: terse, inconsistent, sometimes absent. A
  project that never writes `fix` or `refactor` produces no ground truth, and the
  script reports that plainly instead of scoring zero.
- A control file that merely *looks* calm may still be a hotspot nobody got around
  to. Repairs that never happened are invisible to this method.
- The harness cannot distinguish a file repaired *because* it was hot from a file
  that became hot *because* it was being repaired. Both are consistent with the
  numbers.

## What would make this stronger

1. **More repositories, especially medium ones.** One usable repository is a
   starting point, not a result.
2. **A better ground truth than commit subjects.** Issues closed as bugs, or
   `git log -S` on a symbol a fix introduced, would be far less noisy than reading
   prefixes — and would let the answer group be defined by content rather than by
   someone's typing habits.
3. **A per-language split.** Much of what express's windows contain is docs, config
   and examples rather than `lib/` code, which suggests the ground truth still
   needs to be restricted further.

If you have a repository with a clear refactor history, running the script above
and pasting the table into an issue is genuinely useful — it is the one kind of
evidence this project cannot generate for itself.
