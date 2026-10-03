/**
 * End-to-end tests: run the real CLI against a real (throwaway) repository.
 * These are the tests that would have caught a broken git invocation.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeRepo, runCli, gitIn, CLI } from './helpers.mjs';

let repo;
before(() => {
  repo = makeRepo();
});
after(() => repo?.cleanup());

test('heat --format json reports ranked hotspots for a real repository', () => {
  const { code, stdout, stderr } = runCli(['heat', repo.dir, '--format', 'json']);
  assert.equal(code, 0, stderr);
  const payload = JSON.parse(stdout);

  assert.equal(payload.tool.name, 'githeat');
  assert.equal(payload.summary.commits, 12);
  assert.equal(payload.repository.rev.length > 0, true);
  assert.equal(payload.hotspots[0].path, 'src/core.js');
  assert.equal(payload.hotspots[0].commits, 12);
  assert.equal(payload.analysis.range, 'all time');

  const paths = payload.hotspots.map((h) => h.path);
  assert.ok(paths.includes('src/util.js'));
  assert.ok(paths.includes('src/rare.js'));
  assert.ok(!paths.includes('package-lock.json'), 'lockfile must be filtered');
  assert.ok(!paths.includes('README.md'), 'single-commit file must be below the threshold');

  for (let i = 1; i < payload.hotspots.length; i += 1) {
    assert.ok(payload.hotspots[i - 1].score >= payload.hotspots[i].score, 'sorted by score desc');
  }
});

test('--include-noise, --min-commits and --ext change what gets scored', () => {
  const noisy = JSON.parse(
    runCli(['heat', repo.dir, '--json', '--include-noise', '--min-commits', '1', '--ext', '']).stdout,
  );
  const paths = noisy.hotspots.map((h) => h.path);
  assert.ok(paths.includes('package-lock.json'));
  assert.ok(paths.includes('README.md'));

  // by default only source files are ranked, so docs/config stay out
  const defaults = JSON.parse(runCli(['heat', repo.dir, '--json', '--min-commits', '1']).stdout);
  assert.deepEqual(
    defaults.hotspots.map((h) => h.path).sort(),
    ['src/core.js', 'src/rare.js', 'src/util.js'],
  );

  const onlyCore = JSON.parse(runCli(['heat', repo.dir, '--json', '--ext', 'js']).stdout);
  assert.equal(onlyCore.hotspots.length, 3);
});

test('--since/--until narrow the window on author dates (UTC)', () => {
  const all = JSON.parse(runCli(['heat', repo.dir, '--json']).stdout);
  const recent = JSON.parse(runCli(['heat', repo.dir, '--json', '--since', '2024-03-06']).stdout);
  assert.equal(all.summary.commits, 12);
  assert.equal(recent.summary.commits, 7, 'commits from 2024-03-06 onwards');
  assert.ok(recent.analysis.range.includes('2024-03-06'));
  assert.equal(recent.summary.firstCommit, '2024-03-06T12:00:00Z');

  const windowed = JSON.parse(
    runCli(['heat', repo.dir, '--json', '--since', '2024-03-06', '--until', '2024-03-08']).stdout,
  );
  assert.equal(windowed.summary.commits, 3, 'both ends include their whole day');
  assert.equal(windowed.summary.firstCommit, '2024-03-06T12:00:00Z');
  assert.equal(windowed.summary.lastCommit, '2024-03-08T12:00:00Z');

  const none = runCli(['heat', repo.dir, '--json', '--since', '2030-01-01']);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /no commit history/);
});

test('heat --format svg writes a standalone file', () => {
  const out = join(repo.dir, '..', `githeat-${Date.now()}.svg`);
  const { code, stdout, stderr } = runCli(['heat', repo.dir, '--format', 'svg', '--out', out]);
  assert.equal(code, 0, stderr);
  assert.ok(existsSync(out));
  const svg = readFileSync(out, 'utf8');
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.includes('src/core.js'));
  assert.ok(stdout.includes('wrote'));
  rmSync(out, { force: true });
});

test('output format is inferred from the --out extension', () => {
  const out = join(repo.dir, '..', `githeat-${Date.now()}.html`);
  const { code, stderr } = runCli(['heat', repo.dir, '--out', out]);
  assert.equal(code, 0, stderr);
  const html = readFileSync(out, 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('data-path="src/core.js"'));
  rmSync(out, { force: true });
});

test('default terminal output fits in a plain log', () => {
  const { code, stdout } = runCli(['heat', repo.dir]);
  assert.equal(code, 0);
  assert.ok(stdout.includes('src/core.js'));
  assert.ok(stdout.includes('changes'));
  assert.ok(!stdout.includes('\u001b['), 'NO_COLOR output must be escape-free');
  assert.ok(stdout.split('\n').every((line) => line.length < 200), 'lines must not wrap wildly');
});

test('tree format rolls churn up per directory', () => {
  const { code, stdout } = runCli(['heat', repo.dir, '--format', 'tree']);
  assert.equal(code, 0);
  // src/ owns all three ranked files, so it should be the single rollup row
  assert.ok(/\b3 files\b/.test(stdout), `expected the src/ rollup, got:\n${stdout}`);
  assert.ok(stdout.includes('src'));
  assert.ok(stdout.includes('churn'));
});

test('check exits 0 when thresholds hold and 1 when they break', () => {
  // In commits mode the busiest file scores exactly 100 by construction, so a
  // threshold of 100 is the "never fail" setting and 99 is stricter than it looks.
  const ok = runCli(['check', repo.dir, '--max-score', '100', '--max-critical', '50']);
  assert.equal(ok.code, 0, ok.stderr);
  assert.ok(ok.stdout.includes('OK'));

  const bad = runCli(['check', repo.dir, '--max-score', '1']);
  assert.equal(bad.code, 1);
  assert.ok(bad.stdout.includes('FAIL'));

  const quiet = runCli(['check', repo.dir, '--quiet']);
  assert.equal(quiet.code, 0);
  assert.equal(quiet.stdout.trim().split('\n').length, 1);
});

test('the busiest file scores exactly 100, and only ties with it do', () => {
  const payload = JSON.parse(runCli(['heat', repo.dir, '--json']).stdout);
  assert.equal(payload.analysis.scoreMode, 'commits');
  assert.equal(payload.hotspots[0].score, 100, 'the top of a commits-mode ranking is always 100');
  const tied = payload.hotspots.filter((h) => h.score === 100);
  assert.ok(
    tied.every((h) => h.commits === payload.hotspots[0].commits),
    'only files tied for the highest change count may score 100',
  );

  const composite = JSON.parse(runCli(['heat', repo.dir, '--json', '--score', 'composite']).stdout);
  assert.equal(composite.analysis.scoreMode, 'composite');
  assert.notEqual(composite.hotspots[0].score, undefined);
});

test('install-hook writes an executable pre-commit hook', () => {
  const { code, stdout } = runCli(['install-hook', repo.dir]);
  assert.equal(code, 0);
  const hook = join(repo.dir, '.git', 'hooks', 'pre-commit');
  assert.ok(existsSync(hook));
  assert.ok(readFileSync(hook, 'utf8').includes('githeat check'));
  assert.ok(stdout.includes('installed'));

  const again = runCli(['install-hook', repo.dir]);
  assert.equal(again.code, 2, 'must refuse to clobber an existing hook');
  assert.ok(again.stderr.includes('already exists'));

  const forced = runCli(['install-hook', repo.dir, '--force']);
  assert.equal(forced.code, 0);
});

test('a directory that is not a repository is reported, not crashed on', () => {
  const orphan = mkdtempSync(join(tmpdir(), 'githeat-orphan-'));
  try {
    const { code, stdout, stderr } = runCli(['heat', orphan]);
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.ok(/not inside a git work tree/.test(stderr), stderr);
  } finally {
    rmSync(orphan, { recursive: true, force: true });
  }
});

test('an empty repository gets an explanation instead of an empty table', () => {
  const empty = mkdtempSync(join(tmpdir(), 'githeat-empty-'));
  try {
    gitIn(empty, ['init', '-q', '-b', 'main']);
    const { code, stderr } = runCli(['heat', empty]);
    assert.equal(code, 2);
    assert.match(stderr, /no commit history/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('--help and --version work without touching a repository', () => {
  const help = runCli(['--help']);
  assert.equal(help.code, 0);
  assert.ok(help.stdout.includes('USAGE'));
  assert.ok(help.stdout.includes('--max-score'));

  const version = runCli(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('an unknown option fails with a helpful message', () => {
  const { code, stderr } = runCli(['heat', repo.dir, '--nope']);
  assert.equal(code, 2);
  assert.ok(stderr.includes('unknown option'));
});

test('the CLI file is executable through node and exposes the bin entry', () => {
  const { code, stdout } = runCli(['heat', repo.dir, '--top', '1']);
  assert.equal(code, 0);
  assert.ok(stdout.includes('more files'));
  assert.ok(existsSync(CLI));
});
