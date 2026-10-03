/**
 * Evidence, not vibes: does the ranking actually point at the files that later
 * needed fixing?
 *
 * Method
 * ------
 * Take two versions of somebody else's project (any two revisions). Between them,
 * the maintainers did work. Some of that work they *described* as repair —
 * "refactor", "rewrite", "simplify", "tech debt" — and those files are the closest
 * thing to a ground truth we can get without reading anyone's mind. The rest of
 * the work is ordinary feature and chore work.
 *
 * Then ask: using the history **only up to the earlier revision**, how did githeat
 * rank the files in each group?
 *
 * Why the control group is not optional
 * -------------------------------------
 * A file touched by a repair commit was, by definition, touched recently, and
 * githeat gives recently-touched files a recency bonus. Comparing "files with
 * repair commits" against "all other files in the repository" would therefore
 * measure recency, not diagnosis. So the comparison group is **files also touched
 * in the same window, but without a repair commit**. Both groups are equally
 * recent; only the kind of attention differs. That is the whole design.
 *
 * What it cannot tell you: commit messages are a human judgement, often terse and
 * sometimes absent. A project that never says "refactor" produces no ground truth
 * at all, and this script will say so rather than scoring zero.
 */
import { analyze, DEFAULT_MIN_COMMITS } from './analyze.mjs';
import { readHistory, git } from './git.mjs';

/**
 * Words maintainers use when they are fixing something structural.
 *
 * Chosen by reading real histories, not by taste. chalk, for instance, says
 * "Fix:", "Optimize 2-argument calls" and "Improve performance" rather than
 * "refactor", so a structural-only list finds nothing there and the evaluation
 * silently reports "no ground truth" for a project that has plenty.
 *
 * Still conservative in the other direction: "update", "add" and "tweak" are
 * absent, because routine work is the control group, not the answer.
 */
export const REPAIR_PATTERN =
  /\b(refactor|rework|rewrite|restructure|simplif\w*|clean[- ]?up|overhaul|tech debt|technical debt|hack|hotfix|workaround|dead code|decouple|untangle|fix(?:e[sd])?|optimi[sz]\w*|performance|perf)\b/i;

/**
 * Commit subjects that match `REPAIR_PATTERN` but are not code repairs.
 *
 * Found by reading express's output: `fix(deps): serve-static@^2.2.0` and
 * `fix(docs): remove ... from Triagers` were being counted as ground truth, which
 * would have credited the tool for predicting a dependency bump. Excluding them is
 * not cosmetic — it is the difference between measuring diagnosis and measuring
 * noise. (Before this filter express scored 18.9 pp of "separation" that was
 * almost entirely dependency bumps.)
 *
 * Two separate rules, because they catch different things:
 *
 *  - **noise scope**: any type scoped to deps/docs/tests/CI is not a code repair,
 *    whatever verb it uses.
 *  - **noise type**: `chore:`, `docs:`, `build:` … are housekeeping even unscoped.
 *
 * `fix:` *without* a scope is deliberately kept: "fix: treat a numeric FORCE_COLOR
 * as an exact level" is exactly the kind of repair this evaluation wants as an
 * answer. Filtering all `fix:` prefixes would throw away the best ground truth
 * available.
 */
export const NON_REPAIR_SCOPE = /^\s*\w+\s*\(\s*(?:deps?|dependencies|docs?|test|tests|ci|build|release|chore|meta|style)\s*\)\s*:/i;
export const NON_REPAIR_TYPE = /^\s*(?:chore|docs?|build|ci|test|release|style|meta)\s*:/i;
/** @deprecated kept as one name for callers that just want "is this noise" */
export const NON_REPAIR_PATTERN = { test: (subject) => NON_REPAIR_SCOPE.test(subject) || NON_REPAIR_TYPE.test(subject) };

/** Accepts either a RegExp or an object with a `test` method, so callers can pass both shapes. */
const matches = (matcher, subject) => (typeof matcher === 'function' ? matcher(subject) : matcher.test(subject));

const pathFromNameOnly = (raw) =>
  String(raw ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Commits between two revisions, with their subjects.
 * @returns {{sha:string,date:string,subject:string,files:string[]}[]}
 */
export function readWindow({ cwd, from, to, merges = false }) {
  const args = ['log', '--pretty=format:\u0002%H\u0001%aI\u0001%s', '--name-only', '--no-renames'];
  if (!merges) args.push('--no-merges');
  args.push(from ? `${from}..${to}` : to, '--');

  const out = git(args, { cwd, allowFail: true }) ?? '';
  const commits = [];
  for (const record of out.split('\u0002')) {
    const body = record.replace(/^\s+/, '');
    if (!body) continue;
    const [header, ...rest] = body.split('\n');
    const [sha, date, ...subject] = header.split('\u0001');
    if (!sha) continue;
    commits.push({ sha, date, subject: subject.join('\u0001').trim(), files: pathFromNameOnly(rest.join('\n')) });
  }
  return commits;
}

/** Split the files of a window into "repair" and "ordinary". */
export function partitionFiles(commits, { pattern = REPAIR_PATTERN, exclude = NON_REPAIR_PATTERN } = {}) {
  const repair = new Set();
  const ordinary = new Set();
  const repairCommits = [];
  const skipped = [];
  for (const commit of commits) {
    const looksLikeRepair = matches(pattern, commit.subject);
    const isScopedNoise = matches(exclude, commit.subject);
    if (looksLikeRepair && isScopedNoise) {
      skipped.push({ sha: commit.sha, subject: commit.subject });
      continue;
    }
    const isRepair = looksLikeRepair;
    if (isRepair) repairCommits.push({ sha: commit.sha, subject: commit.subject, files: commit.files });
    for (const file of commit.files) (isRepair ? repair : ordinary).add(file);
  }
  // a file with both kinds of attention belongs to the repair group: it is still
  // a file that needed repairing
  for (const file of repair) ordinary.delete(file);
  return { repair, ordinary, repairCommits, skipped };
}

/**
 * Percentile of one file in a ranking (0 = top). Returns null when unranked.
 */
export function percentileOf(report, path) {
  const index = report.files.findIndex((f) => f.path === path);
  if (index === -1) return null;
  return index / Math.max(1, report.files.length - 1);
}

const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/**
 * Evaluate one version pair.
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} opts.from    baseline revision (the snapshot the tool sees)
 * @param {string} opts.to      later revision (whose commits provide the answers)
 * @param {number} [opts.topShare=0.1]  "top N%" cut-off for the hit rate
 */
export function evaluateRange({ cwd, from, to, topShare = 0.1, minCommits = DEFAULT_MIN_COMMITS, pattern = REPAIR_PATTERN, exclude = NON_REPAIR_PATTERN }) {
  const commits = readWindow({ cwd, from, to });
  const { repair, ordinary, repairCommits, skipped } = partitionFiles(commits, { pattern, exclude });

  // the tool only ever sees history up to `from`
  const history = readHistory({ cwd, rev: from });
  const report = analyze(history, { minCommits });

  const rank = (paths) => {
    const percentiles = [];
    let unranked = 0;
    for (const path of paths) {
      const p = percentileOf(report, path);
      if (p === null) unranked += 1;
      else percentiles.push(p);
    }
    const cut = Math.max(1, Math.ceil(report.files.length * topShare));
    const inTop = [...paths].filter((path) => {
      const index = report.files.findIndex((f) => f.path === path);
      return index !== -1 && index < cut;
    }).length;
    return {
      count: paths.size,
      ranked: percentiles.length,
      unranked,
      meanPercentile: mean(percentiles),
      topShare: paths.size === 0 ? null : inTop / paths.size,
      inTop,
      cut,
    };
  };

  const repairStats = rank(repair);
  const ordinaryStats = rank(ordinary);

  return {
    from,
    to,
    commits: commits.length,
    repairCommits: repairCommits.length,
    repairMessages: repairCommits.slice(0, 8).map((c) => c.subject),
    /**
     * Whether the comparison is worth reading.
     *
     * Three ways a range can look like evidence without being evidence:
     *  - one control file is not a comparison;
     *  - an answer group of one or two files is a coin flip;
     *  - an answer group covering a third of the repository is not a set of
     *    causes, it is a sweeping change (express had a 62-file "answer group"
     *    out of a few hundred ranked files, which is a release, not a diagnosis).
     */
    reliable:
      repairStats.ranked >= 3 &&
      ordinaryStats.ranked >= 3 &&
      repairStats.ranked <= Math.min(20, report.files.length * 0.15),
    skippedScopedCommits: skipped.length,
    rankedFiles: report.files.length,
    repair: repairStats,
    ordinary: ordinaryStats,
    /**
     * The one number to look at. Positive means the files that were later
     * repaired sit higher in the ranking than equally-recent files that were not.
     */
    separation: repairStats.meanPercentile === null || ordinaryStats.meanPercentile === null
      ? null
      : ordinaryStats.meanPercentile - repairStats.meanPercentile,
    lift: ordinaryStats.topShare && repairStats.topShare !== null ? repairStats.topShare / ordinaryStats.topShare : null,
  };
}

/**
 * Pick version pairs that are worth evaluating.
 *
 * Consecutive releases are the obvious unit and usually the wrong one: a mature
 * package often ships a patch release containing one version-bump commit, so
 * there is nothing to predict. This walks every label pair and keeps the ones
 * with at least `minRepairCommits` repair commits and `minRepairFiles` files in
 * the answer group, preferring the most recent such pairs.
 *
 * @param {string[]} labels  revisions in chronological order
 */
export function pickEvaluableRanges({
  cwd,
  labels,
  count = 4,
  minRepairCommits = 2,
  minRepairFiles = 3,
  minCommits = DEFAULT_MIN_COMMITS,
  pattern = REPAIR_PATTERN,
  lookback = 24,
  probe = (from, to) => readWindow({ cwd, from, to }),
}) {
  const chosen = [];
  const scanned = [];
  // walk backwards from the newest so the most recent work is preferred, and
  // compare each label with the one `stride` releases earlier so the window has
  // enough commits in it to say anything
  for (const stride of [1, 2, 4, 8]) {
    for (let i = labels.length - 1; i - stride >= 0 && chosen.length < count; i -= 1) {
      const from = labels[i - stride];
      const to = labels[i];
      if (chosen.some((c) => c.from === from && c.to === to)) continue;
      if (scanned.length > lookback) break;
      scanned.push(`${from}..${to}`);

      const commits = probe(from, to);
      const { repair, repairCommits } = partitionFiles(commits, { pattern });
      if (repairCommits.length < minRepairCommits || repair.size < minRepairFiles) continue;
      chosen.push({ from, to, repairCommits: repairCommits.length, repairFiles: repair.size, commits: commits.length });
    }
    if (chosen.length >= count) break;
  }
  return { chosen, scanned };
}
