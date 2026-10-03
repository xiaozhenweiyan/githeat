/**
 * Line-level analysis: where inside a hotspot file the churn sits.
 *
 * The interesting assertions are about honesty, not arithmetic: blame reports the
 * last commit per line, so the feature must present itself as a staleness map,
 * and it must refuse quickly on a clone where blame cannot work at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseBlame, bucketOf, regionsOf, readLineAges, isPartialClone, AGE_BUCKETS, MIN_REGION_LINES } from '../src/lines.mjs';
import { gitIn, makeRepo } from './helpers.mjs';

const DAY = 86400000;
const iso = (daysAgo, now) => new Date(now - daysAgo * DAY).toISOString();

/**
 * A file whose middle section is ancient and whose tail is fresh, with commit
 * dates set on both author and committer so blame agrees.
 */
function makeAgedRepo(now = Date.now()) {
  const dir = mkdtempSync(join(tmpdir(), 'githeat-lines-'));
  gitIn(dir, ['init', '-q', '-b', 'main']);

  const oldBlock = Array.from({ length: 20 }, (_, i) => `// ancient line ${i + 1}`).join('\n');
  const midBlock = Array.from({ length: 20 }, (_, i) => `// middling line ${i + 1}`).join('\n');
  const newBlock = Array.from({ length: 20 }, (_, i) => `// fresh line ${i + 1}`).join('\n');

  writeFileSync(join(dir, 'aged.js'), `${oldBlock}\n`);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'old block'], { date: iso(400, now) });

  writeFileSync(join(dir, 'aged.js'), `${oldBlock}\n${midBlock}\n`);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'middle block'], { date: iso(60, now) });

  writeFileSync(join(dir, 'aged.js'), `${oldBlock}\n${midBlock}\n${newBlock}\n`);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'fresh block'], { date: iso(2, now) });

  return { dir, now, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) };
}

test('age buckets have descending boundaries and a catch-all', () => {
  const bounds = AGE_BUCKETS.map((b) => b.maxDays);
  for (let i = 1; i < bounds.length; i += 1) assert.ok(bounds[i] > bounds[i - 1], 'buckets must be ordered');
  assert.equal(bounds[bounds.length - 1], Infinity, 'the last bucket must catch everything');
  assert.equal(AGE_BUCKETS.length, 6, 'the scale spans a decade, so a single "older" bucket is too coarse');
  assert.equal(bucketOf(0), 0);
  assert.equal(bucketOf(7), 0);
  assert.equal(bucketOf(8), 1);
  assert.equal(bucketOf(400), 4);
  assert.equal(bucketOf(4000), AGE_BUCKETS.length - 1);
});

test('parseBlame reads position and date from the porcelain stream', () => {
  const porcelain = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 2',
    'author-time 1000000000',
    'filename x.js',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2 2',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 3 3 1',
    'author-time 1700000000',
    'filename x.js',
  ].join('\n');
  const lines = parseBlame(porcelain);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.line), [1, 2, 3]);
  assert.equal(lines[0].date, 1000000000 * 1000);
  assert.equal(lines[1].date, 1000000000 * 1000, 'the second line shares its commit, not its own timestamp line');
  assert.equal(lines[2].date, 1700000000 * 1000);
});

test('parseBlame survives empty, malformed and date-less input', () => {
  assert.deepEqual(parseBlame(''), []);
  assert.deepEqual(parseBlame(null), []);
  assert.deepEqual(parseBlame('not a blame at all\n'), []);
  // a header with no author-time is dropped rather than reported with a null age
  assert.deepEqual(parseBlame('cccccccccccccccccccccccccccccccccccccccc 1 1 1\nfilename x.js'), []);
});

test('regionsOf groups consecutive lines and ignores short runs', () => {
  const lines = [
    ...Array.from({ length: 12 }, (_, i) => ({ line: i + 1, sha: 'a', date: 0, ageDays: 400 })),
    { line: 13, sha: 'b', date: 0, ageDays: 2 }, // a run of one, below the threshold
    ...Array.from({ length: 9 }, (_, i) => ({ line: 14 + i, sha: 'c', date: 0, ageDays: 60 })),
  ];
  const regions = regionsOf(lines);
  assert.equal(regions.length, 2, 'the single fresh line is not a region');
  assert.deepEqual(
    regions.map((r) => [r.from, r.to, r.lines, r.label]),
    [
      [1, 12, 12, 'last 2 years'],
      [14, 22, 9, 'last quarter'],
    ],
  );
  assert.ok(regions.every((r) => r.lines >= MIN_REGION_LINES));
});

test('readLineAges reports a staleness map for a real file', () => {
  const repo = makeAgedRepo();
  try {
    const result = readLineAges({ cwd: repo.dir, file: 'aged.js', now: repo.now });
    assert.equal(result.total, 60, 'three blocks of twenty lines');

    const byBucket = Object.fromEntries(result.counts.map((count, i) => [AGE_BUCKETS[i].label, count]));
    assert.equal(byBucket['last 2 years'], 20, 'the first block is over a year old');
    assert.equal(byBucket['last quarter'], 20, 'the middle block is two months old');
    assert.equal(byBucket['last week'], 20, 'the last block is two days old');

    assert.ok(result.oldest.ageDays >= 399);
    assert.ok(result.newest.ageDays <= 2);

    const regions = result.regions;
    assert.equal(regions.length, 3, 'three contiguous blocks');
    assert.deepEqual(regions.map((r) => [r.from, r.to]), [
      [1, 20],
      [21, 40],
      [41, 60],
    ]);
    assert.equal(regions[0].label, 'last 2 years');
    assert.equal(regions[2].label, 'last week');
  } finally {
    repo.cleanup();
  }
});

test('readLineAges fails with a useful message on an unknown path', () => {
  const repo = makeRepo('githeat-lines-missing-');
  try {
    assert.throws(() => readLineAges({ cwd: repo.dir, file: 'no/such/file.js' }), /git blame failed for no\/such\/file\.js/);
  } finally {
    repo.cleanup();
  }
});

test('a partial clone is detected before blame wastes time on the network', () => {
  const repo = makeRepo('githeat-lines-partial-');
  try {
    assert.equal(isPartialClone(repo.dir), false, 'a normal clone is not partial');
    // this is the configuration a --filter=blob:none clone carries
    gitIn(repo.dir, ['config', 'remote.origin.partialclonefilter', 'blob:none']);
    assert.equal(isPartialClone(repo.dir), true, 'the preflight must see it');
  } finally {
    repo.cleanup();
  }
});
