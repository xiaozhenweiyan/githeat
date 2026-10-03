/**
 * Tests for the line-level report and its command wiring.
 *
 * The age fixtures here build commit dates explicitly (both author and
 * committer), because blame reports the committer date and a fixture that only
 * sets the author date would silently test nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readLineAges, renderLineReport, AGE_BUCKETS } from '../src/lines.mjs';
import { gitIn, runCli, makeRepo } from './helpers.mjs';

const DAY = 86400000;
const iso = (daysAgo, now) => new Date(now - daysAgo * DAY).toISOString();

/** A 300-line file committed in four blocks of different ages. */
function makeLayeredRepo(now = Date.now()) {
  const dir = mkdtempSync(join(tmpdir(), 'githeat-lines2-'));
  gitIn(dir, ['init', '-q', '-b', 'main']);
  const block = (name, n) => Array.from({ length: n }, (_, i) => `// ${name} ${i + 1}`).join('\n');

  const a = block('ancient', 120);
  const b = block('old', 60);
  const c = block('mid', 60);
  const d = block('new', 60);

  const steps = [
    [a, 500, 'ancient block'],
    [`${a}\n${b}`, 200, 'old block'],
    [`${a}\n${b}\n${c}`, 45, 'mid block'],
    [`${a}\n${b}\n${c}\n${d}`, 3, 'new block'],
  ];
  for (const [content, daysAgo, message] of steps) {
    writeFileSync(join(dir, 'layered.js'), `${content}\n`);
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-q', '-m', message], { date: iso(daysAgo, now) });
  }
  return { dir, now, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) };
}

test('the report buckets a layered file correctly', () => {
  const repo = makeLayeredRepo();
  try {
    const result = readLineAges({ cwd: repo.dir, file: 'layered.js', now: repo.now });
    assert.equal(result.total, 300);
    const byLabel = Object.fromEntries(AGE_BUCKETS.map((b, i) => [b.label, result.counts[i]]));
    assert.equal(byLabel['last 2 years'], 120, 'the ancient block is 500 days old');
    assert.equal(byLabel['last year'], 60, 'the old block is 200 days old');
    assert.equal(byLabel['last quarter'], 60);
    assert.equal(byLabel['last week'], 60);
  } finally {
    repo.cleanup();
  }
});

test('the rendered report stays bounded and names the extremes', () => {
  const repo = makeLayeredRepo();
  try {
    const result = readLineAges({ cwd: repo.dir, file: 'layered.js', now: repo.now });
    const out = renderLineReport(result, { title: 'demo', range: 'HEAD' });

    assert.match(out, /layered\.js/);
    assert.match(out, /300 lines tracked by blame/);
    assert.match(out, /age of each line/);
    assert.match(out, /largest contiguous regions/);
    assert.match(out, /most untouched: lines 1-180/);
    assert.match(out, /newest work:\s+lines 241-300/);
    assert.match(out, /blame reports the last commit per line, so this is a staleness map/);

    // 300 lines of per-line output would be a wall; the default report is not
    assert.ok(out.split('\n').length < 40, `report is too long: ${out.split('\n').length} lines`);
    assert.ok(!out.includes('per-line map'), 'the map is opt-in');
  } finally {
    repo.cleanup();
  }
});

test('the per-line map is available but opt-in', () => {
  const repo = makeLayeredRepo();
  try {
    const result = readLineAges({ cwd: repo.dir, file: 'layered.js', now: repo.now });
    const out = renderLineReport(result, { showMap: true });
    assert.match(out, /per-line map/);
    assert.match(out, /each character is one line/);
    // the four blocks should show as four runs of different glyphs
    const mapLines = out.split('\n').filter((l) => /^\s+\d+\s+[#+\-. ]+$/.test(l));
    assert.ok(mapLines.length >= 3, `expected map rows, got ${mapLines.length}`);
    assert.ok(mapLines[0].includes(' '), 'the oldest bucket renders as a space');
  } finally {
    repo.cleanup();
  }
});

test('an empty or untracked file explains itself instead of printing a blank table', () => {
  const out = renderLineReport({ file: 'empty.js', counts: AGE_BUCKETS.map(() => 0), total: 0, oldest: null, newest: null, regions: [] });
  assert.match(out, /no lines attributed/);
  assert.ok(!out.includes('age of each line'));
});

test('lines works through the CLI in text and JSON form', () => {
  const repo = makeLayeredRepo();
  try {
    const text = runCli(['lines', 'layered.js', repo.dir]);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /age of each line/);
    assert.match(text.stdout, /most untouched/);

    const json = runCli(['lines', 'layered.js', repo.dir, '--format', 'json']);
    assert.equal(json.code, 0, json.stderr);
    const payload = JSON.parse(json.stdout);
    assert.equal(payload.file, 'layered.js');
    assert.equal(payload.total, 300);
    assert.equal(payload.buckets.length, AGE_BUCKETS.length);
    assert.ok(payload.regions.length >= 3);
    assert.ok(payload.oldest.ageDays > payload.newest.ageDays);

    const noArgs = runCli(['lines'], repo.dir);
    assert.equal(noArgs.code, 2);
    assert.match(noArgs.stderr, /needs a file path/);

    const missing = runCli(['lines', 'nope.js', repo.dir]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /git blame failed/);
  } finally {
    repo.cleanup();
  }
});

test('a partial clone is refused immediately with an actionable message', () => {
  const repo = makeRepo('githeat-lines-partial2-');
  try {
    gitIn(repo.dir, ['config', 'remote.origin.partialclonefilter', 'blob:none']);
    const started = Date.now();
    const out = runCli(['lines', 'src/core.js', repo.dir]);
    const elapsed = Date.now() - started;

    assert.equal(out.code, 2);
    assert.match(out.stderr, /partial clone/);
    assert.match(out.stderr, /blob:limit=1m/, 'the message must say how to fix it');
    assert.ok(elapsed < 5000, `refusing took ${elapsed}ms — it must not reach the network`);
  } finally {
    repo.cleanup();
  }
});
