/**
 * Baseline comparison is the feature people reach for before merging a long
 * branch or cutting a release, so it has to be right about direction — a
 * comparison that cannot tell "we made this worse" from "we have not touched
 * this yet" is worse than no comparison at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { compareToBase, renderComparison, SCORE_EPSILON } from '../src/compare.mjs';
import { mergeBase, isAncestor } from '../src/git.mjs';
import { gitIn, makeRepo } from './helpers.mjs';

/**
 * A repository with two diverging branches, built by hand so the expected
 * movement is known: `feature` keeps editing core.js and adds fresh.js while
 * legacy.js stops changing, so it must come out cooler.
 */
function makeBranchingRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'githeat-compare-'));
  gitIn(dir, ['init', '-q', '-b', 'main']);
  for (let i = 1; i <= 6; i += 1) {
    writeFileSync(join(dir, 'core.js'), `// core ${i}\n`);
    writeFileSync(join(dir, 'legacy.js'), `// legacy ${i}\n`);
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-q', '-m', `main ${i}`]);
  }
  gitIn(dir, ['checkout', '-q', '-b', 'feature']);
  for (let i = 1; i <= 5; i += 1) {
    writeFileSync(join(dir, 'core.js'), `// core feature ${i}\n`);
    writeFileSync(join(dir, 'fresh.js'), `// fresh ${i}\n`);
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-q', '-m', `feature ${i}`]);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) };
}

test('mergeBase finds the fork point, not the branch tip', () => {
  const repo = makeBranchingRepo();
  try {
    const base = mergeBase('main', repo.dir);
    const tip = gitIn(repo.dir, ['rev-parse', 'main']).trim();
    assert.ok(base, 'a fork point exists');
    assert.equal(base, tip, 'main did not move after the branch, so tip == merge base here');
    assert.equal(isAncestor(base, repo.dir), true, 'the fork point is an ancestor of HEAD');
  } finally {
    repo.cleanup();
  }
});

test('isAncestor is false for a revision this branch does not contain', () => {
  const repo = makeRepo('githeat-ancestor-');
  try {
    // HEAD of a fresh repo has no unrelated commit, so ask about a revision
    // that cannot exist: the answer must be false rather than an exception.
    assert.equal(isAncestor('0000000000000000000000000000000000000000', repo.dir), false);
    assert.equal(isAncestor('', repo.dir), false);
    assert.equal(isAncestor(null, repo.dir), false);
  } finally {
    repo.cleanup();
  }
});

test('a branch that stops touching a file reports it as cooler', () => {
  const repo = makeBranchingRepo();
  try {
    const comparison = compareToBase({ cwd: repo.dir, base: 'main' });
    const byPath = new Map(comparison.movers.map((m) => [m.path, m]));

    assert.equal(byPath.get('legacy.js')?.kind, 'cooler', 'untouched since the fork means cooler');
    assert.ok(byPath.get('legacy.js').delta < 0);
    assert.equal(byPath.get('fresh.js')?.kind, 'appeared', 'a file the baseline never had is new');
    assert.equal(comparison.counts.gone, 0, 'nothing disappeared in this fixture');
    assert.ok(comparison.counts.cooler >= 1);
  } finally {
    repo.cleanup();
  }
});

test('the ancestor case explains why nothing cooled down', () => {
  const repo = makeRepo('githeat-compare-ancestor-');
  try {
    const comparison = compareToBase({ cwd: repo.dir, base: 'HEAD' });
    const out = renderComparison(comparison, { top: 3 });
    assert.match(out, /no file moved by 2 points or more/, 'comparing a revision with itself is a no-op');
    assert.ok(!out.includes('nothing cooled down'), 'the note is only for the one-directional case');
  } finally {
    repo.cleanup();
  }
});

test('files that moved less than the threshold are not reported as movers', () => {
  const repo = makeBranchingRepo();
  try {
    const comparison = compareToBase({ cwd: repo.dir, base: 'main' });
    for (const mover of comparison.movers) {
      if (mover.kind === 'hotter' || mover.kind === 'cooler') {
        assert.ok(Math.abs(mover.delta) >= SCORE_EPSILON, `${mover.path} moved only ${mover.delta}`);
        assert.equal(mover.previousScore !== null, true, 'a movement needs a previous score to compare');
        assert.equal(Math.round((mover.score - mover.previousScore) * 10) / 10, mover.delta);
      }
    }
  } finally {
    repo.cleanup();
  }
});

test('movers are ordered by kind, then by size of movement', () => {
  const repo = makeBranchingRepo();
  try {
    const { movers } = compareToBase({ cwd: repo.dir, base: 'main' });
    const rank = { hotter: 0, cooler: 1, appeared: 2, gone: 3 };
    for (let i = 1; i < movers.length; i += 1) {
      const prev = movers[i - 1];
      const cur = movers[i];
      assert.ok(rank[prev.kind] <= rank[cur.kind], 'kinds must be grouped in order');
      if (prev.kind === cur.kind && prev.delta !== null && cur.delta !== null) {
        assert.ok(Math.abs(prev.delta) >= Math.abs(cur.delta), 'bigger movements come first');
      }
    }
  } finally {
    repo.cleanup();
  }
});

test('the rendered block never claims a file was improved', () => {
  const repo = makeBranchingRepo();
  try {
    const out = renderComparison(compareToBase({ cwd: repo.dir, base: 'main' }), { top: 10 });
    // "cooler" means the baseline has commits this revision does not — on a
    // branch that is "not touched yet", and claiming otherwise would be a lie.
    assert.ok(!/\b(refactor|improved|fixed|better)\b/i.test(out), `loaded wording in:\n${out}`);
    assert.match(out, /vs the baseline revision main/);
    assert.match(out, /hotter · \d+ cooler/);
  } finally {
    repo.cleanup();
  }
});

test('comparison works through the CLI, in table and JSON form', () => {
  const repo = makeBranchingRepo();
  try {
    const cli = join(process.cwd(), 'bin', 'githeat.mjs');
    const run = (args) => {
      const res = spawnSync(process.execPath, [cli, ...args], {
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
      });
      return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
    };

    const table = run(['heat', repo.dir, '--base', 'main', '--top', '2']);
    assert.equal(table.code, 0, table.stderr);
    assert.match(table.stdout, /vs the baseline revision main/);
    assert.match(table.stdout, /legacy\.js/);

    const json = run(['heat', repo.dir, '--base', 'main', '--json']);
    assert.equal(json.code, 0, json.stderr);
    const payload = JSON.parse(json.stdout);
    assert.ok(payload.baseline, 'JSON output must carry the comparison');
    assert.ok(payload.baseline.movers.length > 0);
    assert.equal(payload.baseline.base, 'main');
    assert.ok(payload.baseline.summary.baseFiles >= 2);

    // without --base the payload stays exactly as before
    const plain = JSON.parse(run(['heat', repo.dir, '--json']).stdout);
    assert.equal(plain.baseline, undefined, 'no comparison unless asked for');

    // and an unknown base is a clear error, not a comparison against nothing
    const bad = run(['heat', repo.dir, '--base', 'no-such-branch', '--top', '1']);
    assert.equal(bad.code, 2, 'an unknown ref must fail loudly');
    assert.match(bad.stderr, /cannot compare against "no-such-branch"/);
  } finally {
    repo.cleanup();
  }
});
