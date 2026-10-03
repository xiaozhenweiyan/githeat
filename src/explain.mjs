/**
 * `githeat explain <path>` — answer "why is this file ranked here", including
 * the far more common and far more useful question: "why is this file *not* in
 * the ranking at all".
 *
 * The README invites ranking complaints as the most useful bug report this tool
 * can get. This module is what makes those reports cheap to write and cheap to
 * answer: every exclusion reason is named, and the arithmetic behind the score
 * is printed instead of asserted.
 */

import { isNoisePath, DEFAULT_EXTENSIONS } from './analyze.mjs';
import { IGNORE_FILE } from './ignore.mjs';

const extOf = (path) => {
  const base = String(path).slice(String(path).lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
};

/**
 * Work out why a path is absent from a ranking.
 * @returns {{included: true} | {included: false, reason: string, detail: string}}
 */
export function explainExclusion(path, { ignoreMatcher, extensions, minCommits, stats, includeNoise = false } = {}) {
  if (isNoisePath(path)) {
    return includeNoise
      ? { included: true }
      : { included: false, reason: 'noise', detail: 'matched a built-in noise pattern (lockfile, build output, binary, minified file)' };
  }
  if (ignoreMatcher && ignoreMatcher(path)) {
    return { included: false, reason: 'ignored', detail: `matched a pattern in ${IGNORE_FILE} or --ignore` };
  }
  const allowed =
    extensions === undefined || extensions === null ? new Set(DEFAULT_EXTENSIONS) : new Set(extensions.map((e) => String(e).replace(/^\./, '').toLowerCase()));
  if (allowed.size > 0 && !allowed.has(extOf(path))) {
    return {
      included: false,
      reason: 'extension',
      detail: `.${extOf(path) || '(none)'} is not in the scored extension list — pass --ext "" to score every file`,
    };
  }
  const seen = stats?.get(path);
  if (!seen) {
    return { included: false, reason: 'untouched', detail: 'this path never appears in the analysed history (check the --since window, --author filter and --rev)' };
  }
  if (seen.commits < minCommits) {
    return {
      included: false,
      reason: 'min-commits',
      detail: `changed ${seen.commits} time${seen.commits === 1 ? '' : 's'}, below --min-commits ${minCommits} — lower it to include this file`,
    };
  }
  return { included: true };
}

/** Human-readable breakdown, suitable for pasting into a bug report. */
export function renderExplanation({ path, report, exclusion, history, title, range }) {
  const lines = [];
  lines.push('');
  lines.push(`${path}`);
  lines.push(`${title} · ${range}`);
  lines.push('');

  if (!exclusion.included) {
    lines.push(`NOT RANKED — ${exclusion.reason}`);
    lines.push(`  ${exclusion.detail}`);
    const commits = history.filter((c) => c.files.includes(path));
    if (commits.length > 0) {
      lines.push('');
      lines.push(`  appears in ${commits.length} analysed commit${commits.length === 1 ? '' : 's'}:`);
      for (const c of commits.slice(0, 5)) {
        lines.push(`    ${c.date.slice(0, 10)}  ${c.sha.slice(0, 7)}  ${c.author}`);
      }
      if (commits.length > 5) lines.push(`    … and ${commits.length - 5} more`);
    } else {
      lines.push('  (no commit in the analysed window touches this path)');
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  const file = report.files.find((f) => f.path === path);
  const n = report.summary.filesRanked;
  const c = file.components;
  lines.push(`RANK ${file.rank} of ${n}   score ${file.score}/100   band ${file.band}`);
  lines.push('');
  lines.push('score = 100 x (0.68 x churn + 0.32 x changes) x recency');
  lines.push(
    `      = 100 x (0.68 x ${c.churnScore.toFixed(3)} + 0.32 x ${c.changeScore.toFixed(3)}) x ${c.recency.toFixed(3)}`,
  );
  lines.push(`      = ${file.score}`);
  lines.push('');
  lines.push(`  churn     ${file.churn}   changes in total (the weighting is not line-based)`);
  lines.push(`  changes   ${file.commits}   separate commits that touched it`);
  lines.push(`  authors   ${file.authors}`);
  lines.push(`  recency   ${c.recency.toFixed(3)}   last change ${file.last.slice(0, 10)} (${file.ageDays} days ago)`);
  lines.push(`  ordinary  base ${c.base.toFixed(3)} before the recency multiplier`);
  lines.push('');
  lines.push(
    `  trend     ${file.trend}   ${file.earlier} change(s) in the first half of the window, ${file.recent} in the second`,
  );
  lines.push('            (rising/cooling use a 60/40 share split, and need 4+ changes to call it)');
  lines.push('');
  lines.push('  normalisation is relative to this repository, not absolute:');
  lines.push(`    churn of the 90th-percentile file maps to 1.000, this file scores ${c.churnScore.toFixed(3)}`);
  lines.push(`    the same for change count: 1.000 there, ${c.changeScore.toFixed(3)} here`);
  if (report.bandCutoffs) {
    lines.push('');
    lines.push(
      `  bands (${report.bands}): critical >= ${report.bandCutoffs.critical}, high >= ${report.bandCutoffs.high}, medium >= ${report.bandCutoffs.medium}`,
    );
    if (report.bands === 'percentile') {
      lines.push('    rank-based: top 5% critical, next 10% high, next 25% medium');
    }
  }
  lines.push('');
  lines.push('  If this ranking is wrong, the most useful report includes this output and the path.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}
