import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseLog, normalizeWhen, parseWhen } from '../src/git.mjs';
import { analyze, bandOf, isNoisePath, makeScaler, parseExtensions, DEFAULT_MIN_COMMITS } from '../src/analyze.mjs';
import { squarify, topTiles } from '../src/treemap.mjs';
import { colorForScore, contrastText, paletteNames, legendStops } from '../src/colors.mjs';
import { renderSvg, escapeXml } from '../src/svg.mjs';
import { renderHtml } from '../src/report.mjs';
import { renderTable, renderTree } from '../src/terminal.mjs';

const SEP = '\u0001';
const REC = '\u0002';

const commit = (sha, date, author, files) =>
  `${REC}${sha}${SEP}${date}${SEP}${author}\n\n${files.join('\n')}\n`;

test('parseLog reads sha, date, author and file list', () => {
  const raw = commit('aaa111', '2024-01-01T10:00:00+00:00', 'Ada', ['src/a.js', 'src/b.js']) +
    commit('bbb222', '2024-02-01T10:00:00+00:00', 'Bob', ['src/a.js']);
  const commits = parseLog(raw);
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0], {
    sha: 'aaa111',
    date: '2024-01-01T10:00:00+00:00',
    author: 'Ada',
    files: ['src/a.js', 'src/b.js'],
  });
  assert.deepEqual(commits[1].files, ['src/a.js']);
});

test('parseLog deduplicates repeated paths and skips quoted paths', () => {
  const raw = `${REC}ccc${SEP}2024-01-01T00:00:00Z${SEP}Ada\n\nsrc/a.js\nsrc/a.js\n"weird\\path.js"\n`;
  const [c] = parseLog(raw);
  assert.deepEqual(c.files, ['src/a.js']);
});

test('parseLog tolerates empty and malformed input', () => {
  assert.deepEqual(parseLog(''), []);
  assert.deepEqual(parseLog(null), []);
  assert.deepEqual(parseLog('\n\n'), []);
});

test('normalizeWhen pins bare dates to UTC but leaves relative forms alone', () => {
  assert.equal(normalizeWhen('2024-03-01'), '2024-03-01T00:00:00Z');
  assert.equal(normalizeWhen('2024-03-01 08:30'), '2024-03-01T08:30Z');
  assert.equal(normalizeWhen('2024-03-01T08:30:15'), '2024-03-01T08:30:15Z');
  assert.equal(normalizeWhen('2024-03-01T08:30:15+02:00'), '2024-03-01T08:30:15+02:00');
  assert.equal(normalizeWhen('12.months'), '12.months');
  assert.equal(normalizeWhen('6 weeks ago'), '6 weeks ago');
});

test('parseWhen resolves absolute dates, end-of-day and relative forms', () => {
  assert.equal(parseWhen('2024-03-01'), Date.parse('2024-03-01T00:00:00Z'));
  assert.equal(parseWhen('2024-03-31', { endOfDay: true }), Date.parse('2024-03-31T23:59:59.999Z'));
  assert.equal(parseWhen('2024-03-31T10:00:00Z', { endOfDay: true }), Date.parse('2024-03-31T10:00:00Z'));
  assert.equal(parseWhen('12.months'), null);
  assert.equal(parseWhen('not a date'), null);
});

test('isNoisePath filters generated and vendored files but keeps real code', () => {
  for (const p of [
    'package-lock.json',
    'pnpm-lock.yaml',
    'node_modules/react/index.js',
    'dist/bundle.js',
    'assets/logo.svg',
    'src/__pycache__/x.pyc',
    'Cargo.lock',
  ]) {
    assert.equal(isNoisePath(p), true, `${p} should be noise`);
  }
  for (const p of ['src/app.js', 'src/components/Button.tsx', 'main.go', 'docs/heat.md']) {
    assert.equal(isNoisePath(p), false, `${p} should not be noise`);
  }
});

test('analyze aggregates per-file churn, then filters and ranks', () => {
  const history = [
    { sha: '1', date: '2024-01-01T00:00:00Z', author: 'A', files: ['src/hot.js', 'README.md'] },
    { sha: '2', date: '2024-01-02T00:00:00Z', author: 'A', files: ['src/hot.js'] },
    { sha: '3', date: '2024-01-03T00:00:00Z', author: 'B', files: ['src/hot.js', 'src/cold.js'] },
    { sha: '4', date: '2024-01-04T00:00:00Z', author: 'B', files: ['package-lock.json'] },
    { sha: '5', date: '2024-01-05T00:00:00Z', author: 'B', files: ['src/cold.js'] },
  ];
  const { files, summary } = analyze(history, { now: Date.parse('2024-01-10T00:00:00Z') });

  // README.md has a single change -> below the default threshold, lockfile -> noise
  assert.deepEqual(
    files.map((f) => f.path),
    ['src/hot.js', 'src/cold.js'],
  );
  assert.equal(files[0].commits, 3);
  assert.equal(files[0].churn, 3);
  assert.equal(files[0].authors, 2);
  assert.ok(files[0].score > files[1].score, 'the most churned file must rank first');
  assert.equal(summary.commits, 5);
  assert.equal(summary.filesTouched, 2); // only the two .js files are scored
  assert.equal(summary.authors, 2);
  assert.equal(summary.noiseEntries, 2); // README.md (commit 1) + lockfile (commit 4)
  assert.equal(summary.topAuthors[0].name, 'B');
  assert.equal(DEFAULT_MIN_COMMITS, 2);
});

test('analyze min-commits, include-noise and extension switches behave', () => {
  const history = [
    { sha: '1', date: '2024-01-01T00:00:00Z', author: 'A', files: ['a.js', 'package-lock.json'] },
    { sha: '2', date: '2024-01-02T00:00:00Z', author: 'A', files: ['package-lock.json'] },
  ];
  const now = Date.parse('2024-01-03T00:00:00Z');
  const loose = analyze(history, { minCommits: 1, includeNoise: true, extensions: [], now });
  assert.deepEqual(loose.files.map((f) => f.path).sort(), ['a.js', 'package-lock.json']);

  // docs and config are skipped by default, and [] means "score everything"
  const docs = [
    { sha: '1', date: '2024-01-01T00:00:00Z', author: 'A', files: ['readme.md', 'src/a.js'] },
    { sha: '2', date: '2024-01-02T00:00:00Z', author: 'A', files: ['readme.md', 'src/a.js'] },
  ];
  assert.deepEqual(analyze(docs, { now }).files.map((f) => f.path), ['src/a.js']);
  assert.deepEqual(
    analyze(docs, { now, extensions: [] }).files.map((f) => f.path).sort(),
    ['readme.md', 'src/a.js'],
  );
  assert.deepEqual(analyze(docs, { now, extensions: ['md'] }).files.map((f) => f.path), ['readme.md']);

  assert.deepEqual(parseExtensions('.JS, ts ,py'), ['js', 'ts', 'py']);
  assert.deepEqual(parseExtensions(''), []);
  assert.equal(parseExtensions(undefined), undefined);
});

test('analyze survives an empty history', () => {
  const { files, summary } = analyze([]);
  assert.deepEqual(files, []);
  assert.equal(summary.top10Share, 0);
  assert.equal(summary.firstCommit, null);
});

test('scores stay inside 0..100 and the top file reaches a meaningful band', () => {
  const history = [];
  for (let i = 0; i < 40; i += 1) {
    const files = ['src/core.js', 'src/core.js'];
    if (i % 2 === 0) files.push('src/util.js');
    if (i % 5 === 0) files.push('src/rare.js');
    history.push({ sha: `s${i}`, date: `2024-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`, author: 'A', files });
  }
  const { files } = analyze(history, { now: Date.parse('2024-03-01T00:00:00Z') });
  for (const f of files) {
    assert.ok(f.score >= 0 && f.score <= 100, `${f.path} score out of range: ${f.score}`);
  }
  assert.equal(files[0].path, 'src/core.js');
  assert.ok(files[0].score >= 45, `hottest file should at least be "high", got ${files[0].score}`);
  assert.ok(files[files.length - 1].score < files[0].score);
});

test('bandOf boundaries are inclusive on the lower edge', () => {
  assert.equal(bandOf(70), 'critical');
  assert.equal(bandOf(69.9), 'high');
  assert.equal(bandOf(45), 'high');
  assert.equal(bandOf(44.9), 'medium');
  assert.equal(bandOf(20), 'medium');
  assert.equal(bandOf(19.9), 'low');
});

test('makeScaler anchors on the heavy tail instead of the maximum', () => {
  const scale = makeScaler([1, 1, 1, 1, 1, 1, 1, 1, 1, 100]);
  assert.equal(scale(0), 0);
  assert.equal(scale(1), 1); // the 90th percentile is 1 here, so 1 already saturates
  assert.equal(scale(100), 1);
  assert.equal(makeScaler([])(5), 0);
});

test('squarify produces tiles that fill the rectangle without overlap', () => {
  const items = [10, 8, 6, 4, 3, 2, 1].map((v, i) => ({ label: `f${i}`, value: v }));
  const rect = { x: 0, y: 0, w: 200, h: 100 };
  const tiles = squarify(items, rect, { gap: 0 });
  assert.equal(tiles.length, items.length);

  const area = tiles.reduce((s, t) => s + t.w * t.h, 0);
  assert.ok(Math.abs(area - 200 * 100) < 1, `area mismatch: ${area}`);

  for (const t of tiles) {
    assert.ok(t.x >= -0.001 && t.y >= -0.001, 'tile escapes the top-left corner');
    assert.ok(t.x + t.w <= 200.001 && t.y + t.h <= 100.001, 'tile escapes the rectangle');
    assert.ok(t.w > 0 && t.h > 0, 'degenerate tile');
  }

  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) {
      const a = tiles[i];
      const b = tiles[j];
      const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(overlapW <= 0.001 || overlapH <= 0.001, `tiles ${i} and ${j} overlap`);
    }
  }
});

test('squarify handles empty, zero-value and single-item input', () => {
  assert.deepEqual(squarify([], { x: 0, y: 0, w: 10, h: 10 }), []);
  assert.deepEqual(squarify([{ label: 'a', value: 0 }], { x: 0, y: 0, w: 10, h: 10 }), []);
  const one = squarify([{ label: 'a', value: 5 }], { x: 1, y: 2, w: 10, h: 4 });
  assert.equal(one.length, 1);
  assert.ok(Math.abs(one[0].w * one[0].h - 40) < 0.001);
});

test('topTiles folds the long tail into directory buckets', () => {
  const files = Array.from({ length: 30 }, (_, i) => ({
    path: `src/${i < 5 ? 'hot' : 'tail'}/file${i}.js`,
    churn: 30 - i,
    commits: 30 - i,
    score: 100 - i,
    authors: 1,
  }));
  const tiles = topTiles(files, 10);
  assert.ok(tiles.length <= 10, `expected <= 10 tiles, got ${tiles.length}`);
  assert.ok(tiles.some((t) => t.grouped), 'tail should be grouped');
  assert.equal(tiles[0].path, 'src/hot/file0.js');
  assert.ok(tiles.every((t) => t.value > 0));
});

test('colour helpers produce stable hex and readable contrast', () => {
  assert.ok(paletteNames().includes('ember'));
  assert.match(colorForScore(0, 'ember'), /^#[0-9a-f]{6}$/);
  assert.match(colorForScore(100, 'ember'), /^#[0-9a-f]{6}$/);
  assert.equal(colorForScore(-5, 'ember'), colorForScore(0, 'ember'));
  assert.equal(colorForScore(500, 'ember'), colorForScore(100, 'ember'));
  assert.equal(colorForScore(50, 'nope'), colorForScore(50, 'ember'));
  assert.equal(contrastText('#ffffff'), '#0d1b26');
  assert.equal(contrastText('#000000'), '#f4f8fb');
  assert.equal(legendStops('ember', 5).length, 5);
});

test('escapeXml neutralises markup in paths', () => {
  assert.equal(escapeXml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

const sampleReport = () =>
  analyze(
    [
      { sha: '1', date: '2024-01-01T00:00:00Z', author: 'A', files: ['src/hot.js', 'src/cold.js'] },
      { sha: '2', date: '2024-01-02T00:00:00Z', author: 'B', files: ['src/hot.js'] },
      { sha: '3', date: '2024-01-03T00:00:00Z', author: 'B', files: ['src/hot.js'] },
    ],
    { now: Date.parse('2024-01-05T00:00:00Z') },
  );

test('renderSvg emits well-formed standalone SVG', () => {
  const svg = renderSvg(sampleReport(), { title: 'demo', width: 800, maxTiles: 20 });
  assert.ok(svg.startsWith('<svg '), 'should start with the svg tag');
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(svg.includes('viewBox="0 0 800'));
  assert.ok(!svg.includes('<script'), 'SVG must stay script-free');
  assert.ok(svg.includes('src/hot.js'), 'labels the hottest file');
  assert.equal((svg.match(/<svg /g) || []).length, 1);
});

test('renderSvg escapes hostile file names', () => {
  const report = analyze(
    [
      { sha: '1', date: '2024-01-01T00:00:00Z', author: 'A', files: ['src/<script>.js'] },
      { sha: '2', date: '2024-01-02T00:00:00Z', author: 'A', files: ['src/<script>.js'] },
    ],
    { now: Date.parse('2024-01-03T00:00:00Z') },
  );
  const svg = renderSvg(report, { width: 600 });
  assert.ok(!svg.includes('<script>'), 'raw tag must be escaped');
  assert.ok(svg.includes('&lt;script&gt;'));
});

test('renderSvg copes with an empty repository', () => {
  const svg = renderSvg(analyze([]), { width: 600 });
  assert.ok(svg.includes('</svg>'));
});

test('renderHtml is a self-contained document with the data inlined', () => {
  const html = renderHtml(sampleReport(), { title: 'demo', range: 'all time' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<svg '), 'embeds the map');
  assert.ok(html.includes('data-path="src/hot.js"'));
  assert.ok(!/src="https?:/.test(html), 'no remote assets');
  assert.ok(html.includes('</html>'));
});

test('renderTable and renderTree stay readable without colour', () => {
  const report = sampleReport();
  const table = renderTable(report, { color: false, title: 'demo', top: 5 });
  assert.ok(table.includes('src/hot.js'));
  assert.ok(!table.includes('\u001b['), 'no ANSI escapes when colour is off');
  assert.equal((table.match(/src\/hot\.js/g) || []).length, 1);

  const tree = renderTree(report, { color: false, depth: 2 });
  assert.ok(tree.includes('src'));
  assert.ok(tree.includes('█'));
});

test('renderTable handles an empty ranking with advice instead of a crash', () => {
  const out = renderTable(analyze([]), { color: false });
  assert.ok(out.includes('nothing to rank yet'));
  assert.ok(out.includes('--min-commits 1'));
});
