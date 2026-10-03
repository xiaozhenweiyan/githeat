# Does it actually find anything? An evaluation

A hotspot ranking is easy to believe and hard to check. This page records an
attempt to check it against something external: **the repairs the maintainers
themselves described in their commit messages.**

**The headline result is unflattering.** On three real projects the full scoring
formula performs exactly as well as sorting files by how many commits touched
them — the same hit count, on all three. Details below, including the numbers that
were rejected along the way and why.

Reproduce any row with:

```bash
node scripts/eval-fixability.mjs /path/to/repo --pairs 4   # relative separation
node scripts/eval-precision.mjs  /path/to/repo --pairs 4   # absolute precision
```

## Headline: absolute precision against a zero-cost baseline

Take the top 10 files the tool recommends at release *N*, and count how many were
actually touched by a repair commit before release *N+1*. Two baselines for scale:
picking the same number of ranked files at random, and the one-line heuristic
`git log --name-only | sort | uniq -c | sort -rn`.

| repository | ranked files | random pick | sort by change count | githeat (full score) | P@5 | recall@10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| express (6 173 commits) | 396 | 0.97 / 10 | **3.33 / 10** | **3.33 / 10** | 53 % | 9 % |
| chalk (380 commits) | 33 | 2.19 / 10 | **2.67 / 10** | **2.67 / 10** | 27 % | 62 % |
| slugify (78 commits) | 6 | 2.33 / 10 | **2.33 / 10** | **2.33 / 10** | 54 % | 100 % |

**Identical hit counts on all three**, and the reason is not subtle: **the ranking
*is* the commit-count sort.** Measured on the same revision with the same filters,
the top 10 by score and the top 10 by commit count are **10/10 identical** on both
express and chalk.

That is what the composite formula is built to do. Churn carries 0.68 of the weight
and `churn` *is* the commit count (one entry per changed path per commit); change
count carries the other 0.32 and is the commit count again; the log-scale
normalisation is a monotone transform, which cannot reorder anything. The recency
multiplier is the only term that could, and on these repositories it does not.

### The default was changed because of this

`--score commits` is now the default, and `--score composite` keeps the old formula
for anyone who wants to test it on their own history. Re-running the absolute
precision harness in both modes confirms the switch costs nothing:

| repository | mode | random | commit-count sort | this tool |
| --- | --- | ---: | ---: | ---: |
| express | `commits` | 0.97 / 10 | 3.33 / 10 | **3.33 / 10** |
| express | `composite` | 0.97 / 10 | 3.33 / 10 | **3.33 / 10** |
| chalk | `commits` | 2.19 / 10 | 2.67 / 10 | **2.67 / 10** |
| chalk | `composite` | 2.19 / 10 | 2.67 / 10 | **2.67 / 10** |
| slugify | `commits` | 2.33 / 10 | 2.33 / 10 | **2.33 / 10** |
| slugify | `composite` | 2.33 / 10 | 2.33 / 10 | **2.33 / 10** |

Two formulas, six measurements, no difference. Shipping the simpler one is the
honest response to that, and the composite stays available rather than deleted
because it is unproven, not disproven — a different history might favour it.

The useful readings that survive are the ones that are true of a commit count too:

- **Far better than random.** 3.33 vs 0.97 per ten files on express is a real
  effect, roughly 3.4×.
- **Precision is highest at the very top and decays fast**: 53 % for the top 5 on
  express, 33 % for the top 10, 27 % by the top 20. Use it as a shortlist of five.
- **Recall is poor.** On express the top 10 covered 9 % of the files that later
  needed repair; the top 20 covered 14 %. It is not a to-do list, it is a hint.
- **It is not merely a recency detector**, which is the main way a metric like this
  can be useless while looking useful. The control group below establishes that,
  and it is the one claim the earlier, more flattering analysis got right.

## Relative separation, and why the absolute numbers matter more

The first version of this evaluation reported only *relative* separation — how much
higher repaired files ranked than equally-recent control files — and produced
"+22.9 pp, 1.6× enrichment". Read on its own that sounds like a working tool. It is
a real effect, and it is also perfectly compatible with the identical-baseline
result above: a ranking can be measurably better than one comparison and no better
than another.

| repository | usable ranges | mean separation | hit@10 (answer) | hit@10 (control) |
| --- | ---: | ---: | ---: | ---: |
| express | 2 | +22.9 pp | 25.4 % | 16.1 % |
| chalk | 0 (rejected) | — | — | — |
| slugify | 0 (rejected) | — | — | — |

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
differs.

### Filters, each of which changed the answer

This is worth reading before the numbers, because they moved every time a filter was
added — in both directions.

1. **Interval selection.** Consecutive releases are the obvious unit and often the
   wrong one: a mature package ships patch releases containing a single
   version-bump commit, so there is nothing to predict. The script walks label pairs
   of increasing stride and keeps the first ranges that contain repair work.
2. **Noise scopes are excluded.** `fix(deps):`, `fix(docs):`, `chore(ci):`,
   `test(...)` are not code repairs. Before this filter, express showed 18.9 pp of
   separation built almost entirely out of a dependency bump and a triager-list
   edit — measurement replaced by flattery.
3. **A bare `fix:` is kept.** The first version of filter 2 also dropped every
   `fix(...)` prefix, which threw away the best ground truth available and pushed
   express down to 0.5 pp.
4. **Group-size gates.** A separation computed against one control file is not
   evidence; neither is an answer group covering a third of the repository (express
   had a 62-file "answer group" out of a few hundred ranked files — that is a
   release, not a diagnosis). Ranges failing `≥3 ranked files per group` and
   `answer group ≤ min(20, 15 % of ranked files)` are reported as unusable rather
   than averaged in.

### Rejected results

Reporting these is the point of the harness; a tool that grades its own homework
always passes.

- **slugify showed +60 pp** — answer group mean percentile 20 %, control 80 % — on
  an answer group of **4 files** and a control group of **5**, of which only 4 were
  ranked. Four files against four files. It is the most impressive number this
  harness ever produced and it is not evidence.
- **chalk showed a consistent +16.6 pp** across two ranges, and was still rejected:
  its answer groups (11 and 15 files) exceeded the 15 %-of-ranked cap, meaning the
  "causes" it pointed at were a large fraction of everything the ranking contained.

## What this does and does not show

**Supported:**

- The ranking is **substantially better than random** at pointing at files that
  later needed repair (roughly 3.4× on express).
- **It is not a recency detector**; the control group rules that out.
- Precision is concentrated at the top of the list — the top 5 is the usable part.

**Not supported:**

- **There is no evidence that the full score beats sorting by commit count.** On
  all three projects they returned the same hits. Until a project shows otherwise,
  treat the extra terms as unproven rather than valuable.
- **Recall is low.** Missing ~90 % of later-repaired files means this cannot be used
  as a checklist, only as a place to start looking.
- One large repository carries the precision result; two of three produced no
  usable relative evidence at all. No confidence intervals are quoted because the
  sample does not earn them.
- Commit messages are a human judgement: terse, inconsistent, sometimes absent. A
  project that never writes `fix` or `refactor` produces no ground truth, and the
  scripts report that plainly instead of scoring zero.
- The harness cannot distinguish a file repaired *because* it was hot from a file
  that became hot *because* it was being repaired.
- A control file that merely *looks* calm may still be a hotspot nobody got around
  to; repairs that never happened are invisible here.

## What would make this stronger, in priority order

1. **Make the score beat the commit count, or delete the extra terms.** This is now
   the top of the list. A concrete first experiment: the weighting is dominated by
   churn (0.68) which is itself close to commit count, so the 0.32 "changes" term
   and the log-scale normalisation mostly re-derive the same ordering. Either a
   signal that is not derived from commit counts earns its place — author spread,
   file size, coupling from `githeat roots` — or the honest move is to report commit
   count and stop pretending.
2. **More repositories, especially medium ones.** Three projects, one of which
   produced usable relative evidence.
3. **A better ground truth than commit subjects.** Issues closed as bugs, or
   `git log -S` on a symbol a fix introduced, would be far less noisy than reading
   prefixes.
4. **A per-language split.** Much of what express's windows contain is docs, config
   and examples rather than `lib/` code.

If you have a repository with a clear refactor history, running either script and
pasting the table into an issue is genuinely useful — it is the one kind of evidence
this project cannot generate for itself.
