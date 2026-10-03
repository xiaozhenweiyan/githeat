/**
 * Baseline comparison: "what did this branch do to the heat map?"
 *
 * The single-repository ranking answers "where is the pain". This answers the
 * question a reviewer actually has before merging a long-lived branch or cutting
 * a release: did we make anything worse, and did the refactor we claimed to do
 * actually cool a file down.
 *
 * Only scores and counts are compared, never absolute file contents, so the
 * baseline can be any revision the local clone already has.
 */
import { readHistory, mergeBase, headSha, isAncestor } from './git.mjs';
import { analyze, DEFAULT_MIN_COMMITS } from './analyze.mjs';

/** A score change smaller than this is noise, not a movement. */
export const SCORE_EPSILON = 2;

/**
 * @param {object} opts
 * @param {string} opts.cwd         repository root
 * @param {string} opts.base        revision to compare against (branch, tag, sha)
 * @param {object} [opts.analysis]  the same options the head analysis used
 * @returns {{base:string, baseSha:string|null, baseRange:string, movers:object[], counts:object, summary:object}}
 */
export function compareToBase({ cwd, base, since, until, author, rev, merges, minCommits = DEFAULT_MIN_COMMITS, extensions, ignoreMatcher, bands = 'absolute' }) {
  if (!base) throw new Error('--base needs a revision or branch name');
  const baseSha = mergeBase(base, cwd);
  if (!baseSha) {
    // Without this check an unknown ref silently produces a comparison against
    // an empty history, where every file looks brand new — a wrong answer that
    // looks like a real one.
    throw new Error(`cannot compare against "${base}": not a revision this clone knows (try git fetch, or check the branch name)`);
  }
  const analysisOpts = { minCommits, extensions, ignoreMatcher, bands };

  const headReport = analyze(readHistory({ cwd, since, until, author, rev, merges }), analysisOpts);
  const baseReport = analyze(readHistory({ cwd, since, until, author, rev: baseSha, merges }), analysisOpts);

  const headByPath = new Map(headReport.files.map((f) => [f.path, f]));
  const baseByPath = new Map(baseReport.files.map((f) => [f.path, f]));

  const movers = [];
  for (const [path, head] of headByPath) {
    const before = baseByPath.get(path);
    if (!before) {
      movers.push({ path, kind: 'appeared', score: head.score, previousScore: null, delta: null, head, base: null });
      continue;
    }
    const delta = Math.round((head.score - before.score) * 10) / 10;
    if (Math.abs(delta) < SCORE_EPSILON) continue;
    movers.push({
      path,
      kind: delta > 0 ? 'hotter' : 'cooler',
      score: head.score,
      previousScore: before.score,
      delta,
      head,
      base: before,
    });
  }
  for (const [path, before] of baseByPath) {
    if (!headByPath.has(path)) {
      movers.push({ path, kind: 'gone', score: null, previousScore: before.score, delta: null, head: null, base: before });
    }
  }

  const rank = { hotter: 0, cooler: 1, appeared: 2, gone: 3 };
  movers.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || a.path.localeCompare(b.path),
  );

  const counts = {
    hotter: movers.filter((m) => m.kind === 'hotter').length,
    cooler: movers.filter((m) => m.kind === 'cooler').length,
    appeared: movers.filter((m) => m.kind === 'appeared').length,
    gone: movers.filter((m) => m.kind === 'gone').length,
  };

  return {
    base,
    baseSha,
    // both sides deliberately share the same time window and filters, so the
    // only thing that differs is the revision being scored
    summary: {
      headFiles: headReport.summary.filesRanked,
      baseFiles: baseReport.summary.filesRanked,
      headChurn: headReport.summary.churn,
      baseChurn: baseReport.summary.churn,
      headRev: headSha(cwd) ?? 'HEAD',
      baseRev: baseSha,
    },
    counts,
    movers,
  };
}

const arrow = { hotter: '^', cooler: 'v', appeared: '+', gone: '-' };

/** Compact terminal block. Silence is the correct output for an uneventful branch. */
export function renderComparison(comparison, { top = 8 } = {}) {
  const { counts, movers, base, baseSha, summary } = comparison;
  const lines = [''];
  const label = baseSha && baseSha !== base ? `${base} @ ${String(baseSha).slice(0, 7)}` : base;
  lines.push(`vs the baseline revision ${label}  (${summary.baseFiles} ranked files then, ${summary.headFiles} now)`);

  if (movers.length === 0) {
    lines.push('  no file moved by 2 points or more — this revision did not change the heat map');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    `  ${counts.hotter} hotter · ${counts.cooler} cooler · ${counts.appeared} new · ${counts.gone} gone`,
  );
  if (counts.hotter > 0 && counts.cooler === 0) {
    // Otherwise "0 cooler" reads like a bug instead of a property of comparing
    // an earlier point on the same line of history.
    lines.push('  (nothing cooled down: against an earlier point on the same line of history,');
    lines.push('   files can only accumulate. Compare two branches or forks to see the other direction.)');
  }
  lines.push('');
  for (const m of movers.slice(0, top)) {
    const path = m.path.length > 52 ? `…${m.path.slice(-51)}` : m.path;
    if (m.kind === 'appeared') {
      lines.push(`  ${arrow.appeared} ${String(m.score).padStart(5)}  new in this revision   ${path}`);
    } else if (m.kind === 'gone') {
      lines.push(`  ${arrow.gone}   was ${String(m.previousScore).padStart(5)}  no longer ranked       ${path}`);
    } else {
      const delta = `${m.delta > 0 ? '+' : ''}${m.delta}`;
      lines.push(
        `  ${arrow[m.kind]} ${String(m.score).padStart(5)}  ${delta.padStart(6)} (was ${m.previousScore})  ${path}`,
      );
    }
  }
  if (movers.length > top) lines.push(`  … ${movers.length - top} more (--top ${movers.length})`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}
