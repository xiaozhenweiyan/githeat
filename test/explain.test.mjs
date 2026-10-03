/**
 * `explain` exists to make ranking complaints cheap to file and unambiguous to
 * answer. Its most valuable output is the "not ranked, because…" case, so that
 * is what most of these tests cover.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { explainExclusion, renderExplanation } from '../src/explain.mjs';
import { analyze, DEFAULT_EXTENSIONS } from '../src/analyze.mjs';
import { makeRepo, runCli } from './helpers.mjs';

const NOW = Date.parse('2024-02-01T00:00:00Z');
const history = [
  { sha: 'a1', date: '2024-01-01T00:00:00Z', author: 'Ada', files: ['src/hot.js', 'readme.md', 'once.js'] },
  { sha: 'a2', date: '2024-01-02T00:00:00Z', author: 'Ada', files: ['src/hot.js', 'readme.md', 'generated/api.ts'] },
  { sha: 'a3', date: '2024-01-03T00:00:00Z', author: 'Bob', files: ['src/hot.js', 'generated/api.ts'] },
];

const statsOf = (report) => report.touched;

test('a ranked file reports no exclusion', () => {
  const report = analyze(history, { now: NOW });
  const result = explainExclusion('src/hot.js', { stats: statsOf(report), minCommits: 2 });
  assert.equal(result.included, true);
});

test('each exclusion reason is named, and in the order that explains the most', () => {
  const report = analyze(history, { now: NOW, ignore: ['generated/'] });
  const opts = { stats: statsOf(report), minCommits: 2, extensions: undefined, ignoreMatcher: (p) => p.startsWith('generated/') };

  assert.equal(explainExclusion('readme.md', opts).reason, 'extension');
  assert.match(explainExclusion('readme.md', opts).detail, /--ext ""/);

  assert.equal(explainExclusion('generated/api.ts', opts).reason, 'ignored');
  assert.equal(explainExclusion('once.js', opts).reason, 'min-commits');
  assert.match(explainExclusion('once.js', opts).detail, /changed 1 time/);

  assert.equal(explainExclusion('src/never-seen.js', opts).reason, 'untouched');
  assert.match(explainExclusion('src/never-seen.js', opts).detail, /--since window/);

  const noise = explainExclusion('package-lock.json', { ...opts, stats: new Map([['package-lock.json', { commits: 5 }]]) });
  assert.equal(noise.reason, 'noise');
});

test('an explicitly allowed extension is no longer an exclusion', () => {
  const report = analyze(history, { now: NOW });
  const opts = { stats: statsOf(report), minCommits: 1, extensions: ['md'] };
  assert.equal(explainExclusion('readme.md', opts).included, true);
  assert.ok(DEFAULT_EXTENSIONS.includes('js'));
});

test('include-noise turns a noise exclusion into an inclusion', () => {
  const stats = new Map([['package-lock.json', { commits: 9 }]]);
  assert.equal(explainExclusion('package-lock.json', { stats, minCommits: 1, includeNoise: true }).included, true);
});

test('the rendered breakdown shows the arithmetic, not just the number', () => {
  const report = analyze(history, { now: NOW });
  const out = renderExplanation({
    path: 'src/hot.js',
    report,
    exclusion: { included: true },
    history,
    title: 'demo',
    range: 'all time',
  });
  assert.match(out, /RANK 1 of \d+/);
  // the default mode prints a division, not a weighted sum
  assert.match(out, /score = 100 x \(this file's changes \/ the busiest file's changes\)/);
  assert.match(out, /churn\s+3/);
  assert.match(out, /changes\s+3/);
  assert.match(out, /bands \(absolute\)/);
  assert.ok(!/\bNaN\b|\bundefined\b/.test(out), 'the breakdown must not leak placeholder values');
});

test('the composite mode explains itself and warns that it is unproven', () => {
  const report = analyze(history, { now: NOW, score: 'composite' });
  const out = renderExplanation({
    path: 'src/hot.js',
    report,
    exclusion: { included: true },
    history,
    title: 'demo',
    range: 'all time',
  });
  assert.match(out, /score = 100 x \(0\.68 x churn \+ 0\.32 x changes\) x recency/);
  assert.match(out, /normalisation is relative to this repository/);
  assert.match(out, /docs\/evaluation\.md/, 'the arithmetic must carry its own caveat');
  assert.ok(!/\bNaN\b|\bundefined\b/.test(out));
});

test('the rendered breakdown explains an excluded file and cites its commits', () => {
  const report = analyze(history, { now: NOW });
  const out = renderExplanation({
    path: 'readme.md',
    report,
    exclusion: explainExclusion('readme.md', { stats: statsOf(report), minCommits: 2 }),
    history,
    title: 'demo',
    range: 'all time',
  });
  assert.match(out, /NOT RANKED — extension/);
  assert.match(out, /appears in 2 analysed commits/);
  assert.match(out, /Ada/);
});

test('explain works end to end through the CLI, including JSON', () => {
  const repo = makeRepo('githeat-explain-');
  try {
    const text = runCli(['explain', 'src/core.js', repo.dir]);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /RANK 1 of/);
    assert.match(text.stdout, /score = 100 x/);

    const missing = runCli(['explain', 'src/nope.js', repo.dir]);
    assert.equal(missing.code, 0);
    assert.match(missing.stdout, /NOT RANKED — untouched/);

    const asJson = runCli(['explain', 'src/core.js', repo.dir, '--format', 'json']);
    assert.equal(asJson.code, 0);
    const payload = JSON.parse(asJson.stdout);
    assert.equal(payload.path, 'src/core.js');
    assert.equal(payload.exclusion.included, true);
    assert.equal(payload.file.rank, 1);
    assert.ok(payload.file.components.churnScore > 0);

    // a file excluded by .githeatignore says so
    writeFileSync(join(repo.dir, '.githeatignore'), 'src/core.js\n');
    const ignored = runCli(['explain', 'src/core.js', repo.dir]);
    assert.match(ignored.stdout, /NOT RANKED — ignored/);
    assert.match(ignored.stdout, /\.githeatignore/);

    const noArgs = runCli(['explain'], repo.dir);
    assert.equal(noArgs.code, 2);
    assert.match(noArgs.stderr, /needs a file path/);
  } finally {
    repo.cleanup();
  }
});
