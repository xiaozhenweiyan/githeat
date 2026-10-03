/**
 * The evaluation harness itself.
 *
 * This measures the tool, so it has to be at least as carefully tested as the
 * tool. The cases that matter are the ones where a naive implementation would
 * report a flattering number: a "repair" commit that is really a dependency bump,
 * a range with one control file, a project that never says "fix".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { partitionFiles, percentileOf, pickEvaluableRanges, REPAIR_PATTERN, NON_REPAIR_PATTERN, evaluateRange } from '../src/eval.mjs';
import { analyze } from '../src/analyze.mjs';

const commit = (subject, files, sha = subject) => ({ sha, date: '2024-01-01T00:00:00Z', subject, files });

test('repair subjects are recognised across the phrasings projects actually use', () => {
  for (const subject of [
    'refactor: simplify normalizeTypes',
    'Refactor the parser',
    'rewrite the scheduler',
    'Fix support for nested styles',
    'fixes a typo in the docs',
    'Optimize 2-argument calls (#670)',
    'Improve performance greatly (#337)',
    'cleanup: remove dead code',
    'workaround for old browsers',
    'technical debt in the tokenizer',
  ]) {
    assert.ok(REPAIR_PATTERN.test(subject), `should count as repair: ${subject}`);
  }
});

test('routine work is not mistaken for a repair', () => {
  for (const subject of ['Add FAQ to readme', 'Update CIRCLECI environments', 'Bump version to 6.0.1', 'Meta tweaks', 'Tweak example (#623)']) {
    assert.ok(!REPAIR_PATTERN.test(subject), `should not count as repair: ${subject}`);
  }
});

test('scoped non-repairs are excluded, because they are not code repairs', () => {
  // Regression guard: without this, express scored 18.9pp of "separation" that was
  // almost entirely dependency bumps and a triager-list edit.
  for (const subject of [
    'fix(deps): serve-static@^2.2.0 (#6418)',
    'fix(docs): remove @mertcanaltin from Triagers (#6408)',
    'chore(ci): bump action versions',
    'test: fix flaky assertion',
    'build: update rollup',
    'perf(tests): speed up the suite',
  ]) {
    assert.ok(NON_REPAIR_PATTERN.test(subject), `should be excluded: ${subject}`);
  }
  // A bare `fix:` is real repair work and must survive: filtering every `fix:`
  // prefix would throw away the best ground truth available.
  for (const subject of [
    'fix: treat a numeric FORCE_COLOR as an exact level',
    'refactor: simplify normalizeTypes',
    'fix: added a missing semicolon in css styles',
  ]) {
    assert.ok(!NON_REPAIR_PATTERN.test(subject), `should not be excluded: ${subject}`);
  }

  const { repair, repairCommits, skipped } = partitionFiles([
    commit('fix(deps): serve-static@^2.2.0', ['package.json']),
    commit('fix: real bug', ['lib/router/index.js']),
  ]);
  assert.deepEqual([...repair], ['lib/router/index.js']);
  assert.equal(repairCommits.length, 1);
  assert.equal(skipped.length, 1);
  assert.deepEqual([...repair].includes('package.json'), false, 'a skipped commit must not enter the answer group');
});

test('a file in both groups counts as a repair file, not a control file', () => {
  const { repair, ordinary } = partitionFiles([
    commit('feat: something', ['src/a.js', 'src/b.js']),
    commit('refactor: rewrite src/a.js', ['src/a.js']),
  ]);
  assert.deepEqual([...repair], ['src/a.js']);
  assert.deepEqual([...ordinary], ['src/b.js'], 'the control group must not contain a repaired file');
});

test('percentileOf returns the position and null for files outside the ranking', () => {
  const report = analyze(
    [
      { sha: '1', date: '2024-01-01T00:00:00Z', author: 'A', files: ['a.js', 'b.js'] },
      { sha: '2', date: '2024-01-02T00:00:00Z', author: 'A', files: ['a.js'] },
    ],
    { minCommits: 1, now: Date.parse('2024-02-01T00:00:00Z') },
  );
  assert.equal(percentileOf(report, 'a.js'), 0, 'the hottest file is the 0th percentile');
  assert.equal(percentileOf(report, 'b.js'), 1);
  assert.equal(percentileOf(report, 'nope.js'), null, 'unranked files must be reported as unranked, not as last');
});

test('ranges without enough repair work are skipped rather than scored as zero', () => {
  const windows = new Map([
    ['v1..v2', [commit('Bump version', ['package.json'])]],
    ['v2..v3', [commit('refactor: rewrite the core', ['src/core.js', 'src/a.js', 'src/b.js']), commit('fix: another', ['src/c.js'])]],
  ]);
  const { chosen, scanned } = pickEvaluableRanges({
    cwd: '/unused',
    labels: ['v1', 'v2', 'v3'],
    count: 4,
    minRepairCommits: 2,
    minRepairFiles: 3,
    probe: (from, to) => windows.get(`${from}..${to}`) ?? [],
  });
  assert.deepEqual(chosen.map((c) => `${c.from}..${c.to}`), ['v2..v3']);
  assert.ok(scanned.includes('v1..v2'), 'skipped ranges are recorded so the user can see what was passed over');
  assert.equal(chosen[0].repairCommits, 2);
  assert.equal(chosen[0].repairFiles, 4);
});

test('pickEvaluableRanges widens the stride when adjacent releases are empty', () => {
  // mirrors chalk: consecutive patch releases contain nothing to predict
  const windows = new Map([
    ['v1..v2', [commit('version 2', ['package.json'])]],
    ['v2..v3', [commit('version 3', ['package.json'])]],
    ['v3..v4', [commit('version 4', ['package.json'])]],
    ['v2..v4', [commit('refactor: the middle', ['src/x.js', 'src/y.js', 'src/z.js']), commit('fix: it', ['src/w.js'])]],
  ]);
  const { chosen } = pickEvaluableRanges({
    cwd: '/unused',
    labels: ['v1', 'v2', 'v3', 'v4'],
    count: 1,
    probe: (from, to) => windows.get(`${from}..${to}`) ?? [],
  });
  assert.equal(chosen.length, 1);
  assert.equal(`${chosen[0].from}..${chosen[0].to}`, 'v2..v4');
});

test('a range with a tiny control group is marked unreliable instead of averaged in', () => {
  // one control file is not a comparison
  const dir = process.cwd();
  const result = evaluateRange({
    cwd: dir,
    from: 'HEAD~3',
    to: 'HEAD',
    minCommits: 1,
  });
  // whatever the numbers, usability must be decided by the group sizes
  assert.equal(
    result.reliable,
    result.repair.ranked >= 3 && result.ordinary.ranked >= 3,
    'reliable must be derived from both group sizes',
  );
  assert.ok(result.repair.count >= 0 && result.ordinary.count >= 0);
});
