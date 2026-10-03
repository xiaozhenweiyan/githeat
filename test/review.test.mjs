/**
 * Tests for the two features that exist for other people's repositories:
 * percentile risk bands and the pull-request review comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { analyze, bandOf, resolveBandMode, percentileCutoffs, ABSOLUTE_BANDS, PERCENTILE_BANDS, AUTO_PERCENTILE_FROM } from '../src/analyze.mjs';
import { readChangedList, reviewReport, renderReviewMarkdown } from '../src/review.mjs';
import { parseBandMode } from '../src/cli.mjs';

/**
 * A history wide enough to exercise percentile bands: 120 files, each touched
 * between 1 and 22 times, spread over 22 monthly commits so scores differ.
 */
function wideHistory(width = 120, depth = 22) {
  const commits = [];
  for (let d = 0; d < depth; d += 1) {
    const month = String((d % 12) + 1).padStart(2, '0');
    const year = d < 12 ? 2023 : 2024;
    const files = [];
    for (let i = 0; i < width; i += 1) {
      if (i % depth <= d) files.push(`src/f${String(i).padStart(3, '0')}.js`);
    }
    commits.push({ sha: `w${d}`, date: `${year}-${month}-01T00:00:00Z`, author: `a${d % 4}`, files });
  }
  return commits;
}

test('resolveBandMode maps auto by repository size', () => {
  assert.equal(resolveBandMode('absolute', 10000), 'absolute');
  assert.equal(resolveBandMode('percentile', 3), 'percentile');
  assert.equal(resolveBandMode('auto', AUTO_PERCENTILE_FROM), 'percentile');
  assert.equal(resolveBandMode('auto', AUTO_PERCENTILE_FROM - 1), 'absolute');
  assert.equal(resolveBandMode(undefined, 10000), 'absolute'); // library default stays predictable
});

test('parseBandMode accepts the documented values and rejects typos', () => {
  assert.equal(parseBandMode(undefined), 'auto');
  assert.equal(parseBandMode(true), 'auto');
  assert.equal(parseBandMode('PERCENTILE'), 'percentile');
  assert.equal(parseBandMode('absolute'), 'absolute');
  assert.throws(() => parseBandMode('nonsense'), /--bands expects/);
});

test('bandOf keeps absolute semantics regardless of repository size', () => {
  // The regression this guards: share thresholds (0.05) being compared against
  // scores, which banded every file identically.
  assert.equal(bandOf(99, 'absolute', 10000), 'critical');
  assert.equal(bandOf(23.7, 'absolute', 10000), 'medium');
  assert.equal(bandOf(5, 'absolute', 10000), 'low');
  assert.deepEqual(ABSOLUTE_BANDS, { critical: 70, high: 45, medium: 20 });
  assert.ok(PERCENTILE_BANDS.critical < 1, 'percentile thresholds are shares, and must stay below 1');
});

test('percentile bands spread a wide repository across all four bands', () => {
  const { files, summary, bands, bandCutoffs } = analyze(wideHistory(), { bands: 'percentile' });
  assert.equal(bands, 'percentile');
  assert.ok(files.length >= AUTO_PERCENTILE_FROM, `expected a wide ranking, got ${files.length}`);

  const total = summary.filesRanked;
  for (const name of ['critical', 'high', 'medium', 'low']) {
    assert.ok(summary.bands[name] > 0, `band ${name} is empty: ${JSON.stringify(summary.bands)}`);
  }
  // top 5% critical, within rounding
  assert.ok(Math.abs(summary.bands.critical / total - 0.05) < 0.02, `critical share is ${summary.bands.critical}/${total}`);
  // the cut-offs must be descending and inside the score range
  assert.ok(bandCutoffs.critical >= bandCutoffs.high && bandCutoffs.high >= bandCutoffs.medium);
  assert.ok(bandCutoffs.critical <= 100 && bandCutoffs.medium >= 0);

  // every file carries a band and a 1-based rank that matches its position
  files.forEach((f, i) => {
    assert.equal(f.rank, i + 1);
    assert.ok(['critical', 'high', 'medium', 'low'].includes(f.band));
  });
  // and the ranking really is sorted by score
  for (let i = 1; i < files.length; i += 1) assert.ok(files[i - 1].score >= files[i].score);
});

test('absolute bands still produce the classic thresholds on a wide repository', () => {
  const { summary } = analyze(wideHistory(), { bands: 'absolute' });
  const total = summary.filesRanked;
  assert.ok(summary.bands.critical / total > 0.1, 'absolute mode is generous by design on dense histories');
});

test('percentileCutoffs is stable on empty and single-file input', () => {
  assert.deepEqual(percentileCutoffs([]), { ...ABSOLUTE_BANDS });
  const one = percentileCutoffs([{ score: 42 }]);
  assert.equal(one.critical, 42);
});

test('readChangedList normalises, dedupes and skips unusable lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'githeat-changed-'));
  try {
    const file = join(dir, 'changed.txt');
    writeFileSync(
      file,
      ['# a comment', '', './src/a.js', 'src/a.js', '  src/b.ts  ', '"quoted\\path.js"', 'src/c.py'].join('\n'),
    );
    assert.deepEqual(readChangedList(file), ['src/a.js', 'src/b.ts', 'src/c.py']);

    // stdin path: null source means "read the text I was given"
    assert.deepEqual(readChangedList(null, 'src/x.js\nsrc/x.js\n'), ['src/x.js']);
    assert.deepEqual(readChangedList('-', 'src/y.js\n'), ['src/y.js']);
    assert.deepEqual(readChangedList(null, ''), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const sampleReport = () =>
  analyze(
    [
      { sha: '1', date: '2024-01-01T00:00:00Z', author: 'X', files: ['src/hot.js', 'src/cold.js'] },
      { sha: '2', date: '2024-01-02T00:00:00Z', author: 'Y', files: ['src/hot.js'] },
      { sha: '3', date: '2024-01-03T00:00:00Z', author: 'Z', files: ['src/hot.js'] },
      { sha: '4', date: '2024-01-04T00:00:00Z', author: 'X', files: ['src/hot.js'] },
      { sha: '5', date: '2024-01-05T00:00:00Z', author: 'Y', files: ['src/hot.js'] },
      { sha: '6', date: '2024-01-06T00:00:00Z', author: 'Z', files: ['src/cold.js'] },
    ],
    { now: Date.parse('2024-01-10T00:00:00Z') },
  );

test('reviewReport matches changed paths against the ranking', () => {
  const report = sampleReport();
  // the fixture must be unambiguous before it can prove anything about ordering
  assert.ok(report.files[0].score > report.files[1].score, 'fixture: hot.js must outrank cold.js');
  assert.equal(report.files[0].path, 'src/hot.js');

  const result = reviewReport(report, ['src/cold.js', 'src/absent.js', 'src/hot.js']);
  assert.equal(result.changed, 3);
  assert.equal(result.matched.length, 2);
  assert.equal(result.matched[0].path, 'src/hot.js', 'hottest changed file comes first');
  assert.deepEqual(result.unmatched, ['src/absent.js']);
  assert.equal(result.verdict, bandOf(result.matched[0].score, 'absolute'));
  assert.equal(result.average, Math.round(((result.matched[0].score + result.matched[1].score) / 2) * 10) / 10);

  const limited = reviewReport(report, ['src/hot.js', 'src/cold.js'], { limit: 1 });
  assert.equal(limited.ranked.length, 1);
  assert.equal(limited.matched.length, 2, 'limit only trims the table, not the count');
});

test('review markdown names the worst file and stays compact', () => {
  const result = reviewReport(sampleReport(), ['src/hot.js', 'src/absent.js']);
  const md = renderReviewMarkdown(result, { repository: 'demo', rev: 'abc1234', range: '6 months' });
  assert.ok(md.startsWith('### githeat'));
  assert.ok(md.includes('src/hot.js'));
  assert.ok(md.includes('demo'));
  assert.ok(md.includes('abc1234'));
  assert.ok(md.includes('| score | changes | authors | last change | file |'));
  assert.ok(!md.includes('src/absent.js') || md.includes('Not ranked'), 'unranked files must not appear as hotspots');
  assert.ok(md.split('\n').length < 30, 'a PR comment must not be a wall of text');
});

test('review markdown handles the honest edge cases', () => {
  const report = sampleReport();
  assert.match(renderReviewMarkdown(reviewReport(report, []), {}), /No changed files found/);
  const none = renderReviewMarkdown(reviewReport(report, ['src/brand-new.js']), { range: '6 months' });
  assert.match(none, /no hotspots touched/);
  assert.match(none, /6 months/);
  assert.ok(!none.includes('| score |'), 'no table when nothing matched');
});

test('review markdown never invents a hotspot for an unranked file', () => {
  const result = reviewReport(sampleReport(), ['src/brand-new.js', 'docs/readme.md']);
  assert.equal(result.matched.length, 0);
  assert.equal(result.average, null);
  assert.equal(result.verdict, 'none');
  const md = renderReviewMarkdown(result, {});
  assert.ok(!md.includes('score of'), 'must not claim a score it does not have');
});
