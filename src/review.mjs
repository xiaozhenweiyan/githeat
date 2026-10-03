/**
 * `githeat review` — the same hotspot ranking, but for the files a pull request
 * actually touched.
 *
 * This is the piece that makes the tool show up in other people's workflows: a
 * maintainer adds one step, and every contributor sees which of their changed
 * files are already known trouble.
 *
 *   githeat review --changed changed-files.txt --format markdown
 *   git diff --name-only origin/main... | githeat review --format markdown
 */
import { readFileSync } from 'node:fs';

import { bandOf } from './analyze.mjs';

/** Read a newline-separated path list from a file, or from stdin when absent. */
export function readChangedList(source, stdinText = '') {
  const text = source && source !== '-' ? readFileSync(source, 'utf8') : stdinText;
  return [...new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\.\//, ''))
      .filter(Boolean)
      .filter((line) => !line.startsWith('#'))
      // git quotes exotic paths; we cannot match those reliably, so skip them
      .filter((line) => !line.startsWith('"')),
  )];
}

/**
 * Join a hotspot report with the changed-file list.
 *
 * @returns {{matched: object[], unmatched: string[], changed: number, verdict: string, average: number|null}}
 */
export function reviewReport(report, changed, { limit = 10 } = {}) {
  const byPath = new Map(report.files.map((f) => [f.path, f]));
  const matched = [];
  const unmatched = [];
  for (const path of changed) {
    const hit = byPath.get(path);
    if (hit) matched.push(hit);
    else unmatched.push(path);
  }
  matched.sort((a, b) => b.score - a.score);

  const average = matched.length
    ? Math.round((matched.reduce((sum, f) => sum + f.score, 0) / matched.length) * 10) / 10
    : null;
  const top = matched[0];
  const verdict = !top ? 'none' : bandOf(top.score, 'absolute');
  return { matched, unmatched, changed: changed.length, verdict, average, ranked: matched.slice(0, limit) };
}

const bandEmoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };

/**
 * Markdown comment body. Kept deterministic and short: it lands in someone
 * else's pull request, so it has to earn its space.
 */
export function renderReviewMarkdown(result, { repository = 'this repository', rev = 'HEAD', range = 'all time', limit = 10 } = {}) {
  const { matched, unmatched, changed, ranked, average } = result;
  const lines = [];

  if (changed === 0) {
    return '### githeat\n\nNo changed files found to review.\n';
  }

  if (matched.length === 0) {
    lines.push('### githeat · no hotspots touched', '');
    lines.push(
      `None of the ${changed} changed file(s) appear in the ranking for ${range}. ` +
        'Files touched only once are not ranked, which usually means this change is breaking new ground rather than re-opening a known sore spot.',
    );
    return `${lines.join('\n')}\n`;
  }

  const worst = ranked[0];
  lines.push('### githeat · this PR touches known hotspots', '');
  lines.push(
    `${bandEmoji[bandOf(worst.score, 'absolute')] ?? ''} **${worst.path}** has a hotspot score of ` +
      `**${worst.score}/100** (${worst.commits} changes, ${worst.authors} author${worst.authors === 1 ? '' : 's'}, ` +
      `last touched ${worst.ageDays} days ago).`,
  );
  lines.push('');
  lines.push(`Of ${changed} changed file(s), **${matched.length}** are ranked for ${repository} (${range}).`);
  if (average !== null) lines.push(`Average score of the ranked ones: **${average}**.`);
  lines.push('');
  lines.push('| score | changes | authors | last change | file |');
  lines.push('| ---: | ---: | ---: | ---: | --- |');
  for (const f of ranked) {
    lines.push(`| ${f.score} | ${f.commits} | ${f.authors} | ${f.ageDays}d ago | \`${f.path}\` |`);
  }
  if (matched.length > ranked.length) {
    lines.push('');
    lines.push(`_…and ${matched.length - ranked.length} more ranked file(s) in this change._`);
  }
  lines.push('');
  lines.push(
    '<sub>A high score means the file absorbs a lot of editing and has been reopened many times — ' +
      'the place where regressions like to hide. It is a hint about where to look, not a verdict on this change. ' +
      `Ranked by [githeat](https://github.com/xiaozhenweiyan/githeat) at \`${rev}\`; ` +
      'add `githeat check` to your CI to gate on it.</sub>',
  );
  if (unmatched.length > 0 && unmatched.length <= 5) {
    lines.push('');
    lines.push(`<sub>Not ranked (too little history): ${unmatched.map((p) => `\`${p}\``).join(', ')}</sub>`);
  }
  return `${lines.join('\n')}\n`;
}
