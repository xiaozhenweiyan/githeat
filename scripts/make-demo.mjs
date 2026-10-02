/**
 * Generates docs/demo.svg: a real-shaped hotspot map of this project's own
 * history, committed to the repository so the README has a picture without
 * anyone having to run anything.
 *
 *   node scripts/make-demo.mjs
 *
 * It uses a deterministic synthetic history rather than the live git log on
 * purpose: the README image must not change every time someone commits.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze } from '../src/analyze.mjs';
import { renderSvg } from '../src/svg.mjs';
import { renderHtml } from '../src/report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-04-01T00:00:00Z');

/** [path, commits, lastCommitDaysAgo, authors] — tuned to look like a real CLI repo. */
const SHAPE = [
  ['src/analyze.mjs', 34, 3, 4],
  ['src/cli.mjs', 31, 4, 3],
  ['src/svg.mjs', 22, 6, 3],
  ['src/terminal.mjs', 19, 9, 3],
  ['src/git.mjs', 17, 5, 3],
  ['src/treemap.mjs', 14, 12, 2],
  ['src/report.mjs', 12, 11, 2],
  ['src/colors.mjs', 9, 24, 2],
  ['test/cli.test.mjs', 11, 4, 2],
  ['test/unit.test.mjs', 13, 4, 2],
  ['test/helpers.mjs', 6, 18, 2],
  ['bin/githeat.mjs', 4, 40, 1],
  ['scripts/make-demo.mjs', 3, 26, 1],
  ['docs/demo.svg', 3, 26, 1],
  ['.github/workflows/ci.yml', 2, 33, 1],
];

function build() {
  const commits = [];
  let sha = 0;
  const base = Date.parse('2025-10-01T00:00:00Z');
  for (const [path, times, ageDays, authors] of SHAPE) {
    for (let i = 0; i < times; i += 1) {
      const picked = i % authors;
      const daysAgo = ageDays + (times - i) * 2.4;
      const date = new Date(NOW - daysAgo * 86400000);
      const files = [path];
      // a few commits sweep several files, like real refactors do
      if (i % 7 === 0) files.push(SHAPE[(i * 3) % SHAPE.length][0]);
      if (i % 11 === 0) files.push('README.md');
      commits.push({
        sha: `demo${String(sha++).padStart(4, '0')}`,
        date: (date < new Date(base) ? new Date(base) : date).toISOString(),
        author: ['ada', 'grace', 'linus', 'margaret'][picked],
        files,
      });
    }
  }
  return commits;
}

const report = analyze(build(), { now: NOW });
const svg = renderSvg(report, {
  title: 'githeat',
  range: '6 months',
  rev: 'main',
  palette: 'ember',
  width: 1200,
});

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'demo.svg'), svg, 'utf8');

const html = renderHtml(report, { title: 'githeat', range: '6 months', rev: 'main' });
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'report-example.html'), html, 'utf8');

process.stdout.write(
  `generated docs/demo.svg (${svg.length} bytes) and docs/report-example.html (${html.length} bytes)\n` +
    `top hotspot: ${report.files[0].path} (${report.files[0].score})\n`,
);
