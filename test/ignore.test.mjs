/**
 * Exclusions are the feature users reach for first when a ranking looks wrong,
 * so the syntax has to behave exactly as documented — silently ignoring a
 * pattern is worse than not supporting it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { compilePattern, parseIgnoreText, makeIgnoreMatcher, makeIgnoreFromText, IGNORE_FILE, IGNORE_TEMPLATE } from '../src/ignore.mjs';
import { analyze } from '../src/analyze.mjs';
import { makeRepo, runCli, gitIn } from './helpers.mjs';

const matcher = (text) => makeIgnoreFromText(text);
const ignored = (text, paths) => paths.map(matcher(text));

test('a bare name matches at any depth', () => {
  const m = matcher('api.ts');
  assert.deepEqual([m('api.ts'), m('src/api.ts'), m('a/b/c/api.ts'), m('api.tsx')], [true, true, true, false]);
});

test('a pattern containing a slash is anchored to the root', () => {
  const m = matcher('src/generated/keep.ts');
  assert.equal(m('src/generated/keep.ts'), true);
  assert.equal(m('other/src/generated/keep.ts'), false);
});

test('a trailing slash covers the directory and everything under it', () => {
  const m = matcher('src/generated/');
  assert.equal(m('src/generated/api.ts'), true);
  assert.equal(m('src/generated/deep/nested/x.ts'), true);
  assert.equal(m('src/generated'), true, 'the directory path itself counts too');
  assert.equal(m('src/other/api.ts'), false);
});

test('star stops at a slash, double star crosses it', () => {
  const star = matcher('*.min.js');
  assert.equal(star('a.min.js'), true);
  assert.equal(star('dist/a.min.js'), true);
  assert.equal(star('a.b.min.js'), true);
  assert.equal(star('a.min.jsx'), false);

  const doubleStar = matcher('packages/**/*.spec.ts');
  assert.equal(doubleStar('packages/core/a.spec.ts'), true);
  assert.equal(doubleStar('packages/a/b/c/d.spec.ts'), true);
  assert.equal(doubleStar('other/packages/a.spec.ts'), false);
});

test('later patterns win, so a negation can re-include a file', () => {
  const m = matcher('src/generated/\n!src/generated/handwritten.ts');
  assert.equal(m('src/generated/api.ts'), true);
  assert.equal(m('src/generated/handwritten.ts'), false, 'the negation must win');
});

test('comments, blank lines and stray whitespace are ignored', () => {
  const patterns = parseIgnoreText('# a comment\n\n   \n  src/legacy/  \n  # indented comment\n');
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].source, 'src/legacy/');
});

test('an empty pattern list matches nothing at all', () => {
  const m = matcher('');
  assert.equal(m('anything.js'), false);
  assert.equal(makeIgnoreMatcher([])('anything.js'), false);
  assert.equal(makeIgnoreMatcher(null)('anything.js'), false);
});

test('compilePattern marks negations and directory rules', () => {
  assert.equal(compilePattern('!src/x.ts').negated, true);
  assert.equal(compilePattern('src/').dirOnly, true);
  assert.equal(compilePattern('/root-only.js').source, '/root-only.js');
  assert.equal(compilePattern('/root-only.js').re.test('root-only.js'), true);
  assert.equal(compilePattern('/root-only.js').re.test('sub/root-only.js'), false);
});

test('dots and other regex characters in patterns are literal', () => {
  const m = matcher('a+b(c).js');
  assert.equal(m('a+b(c).js'), true);
  assert.equal(m('aXbXcXjs'), false, 'the pattern must not be treated as a regex');
});

test('impolite input does not crash the compiler', () => {
  for (const pattern of ['*', '**', '***', '/', '!', '!/', 'a//b/', '[', '\\', '***.js']) {
    assert.doesNotThrow(() => matcher(pattern)(['a.js', 'src/b/c.ts', '', 'x']), `pattern ${pattern} threw`);
  }
});

test('exclusions remove files from the analysis entirely', () => {
  const history = [
    { sha: '1', date: '2024-01-01T00:00:00Z', author: 'A', files: ['src/a.js', 'src/gen/api.ts', 'vendor-copy/lib.js'] },
    { sha: '2', date: '2024-01-02T00:00:00Z', author: 'A', files: ['src/a.js', 'src/gen/api.ts', 'vendor-copy/lib.js'] },
    { sha: '3', date: '2024-01-03T00:00:00Z', author: 'A', files: ['src/gen/api.ts', 'vendor-copy/lib.js'] },
  ];
  const now = Date.parse('2024-02-01T00:00:00Z');
  const base = analyze(history, { now });
  assert.deepEqual(base.files.map((f) => f.path).sort(), ['src/a.js', 'src/gen/api.ts', 'vendor-copy/lib.js']);

  const filtered = analyze(history, { now, ignore: ['src/gen/', 'vendor-copy/'] });
  assert.deepEqual(filtered.files.map((f) => f.path), ['src/a.js']);
  // excluded paths are accounted for rather than silently dropped:
  // noiseEntries counts (commit, path) pairs that were filtered out
  assert.equal(filtered.summary.noiseEntries, 6);

  // a negation only makes sense alongside the rule it undoes, in the same list
  const kept = analyze(history, { now, ignore: ['src/gen/', 'vendor-copy/', '!src/gen/api.ts'] });
  assert.deepEqual(kept.files.map((f) => f.path).sort(), ['src/a.js', 'src/gen/api.ts']);
});

test('--ignore and .githeatignore both reach the ranking', () => {
  const repo = makeRepo('githeat-ignore-');
  try {
    // baseline: three ranked source files
    const before = JSON.parse(runCli(['heat', repo.dir, '--json']).stdout);
    assert.ok(before.hotspots.some((h) => h.path === 'src/util.js'));
    assert.equal(before.analysis.ignoreFile, null);
    assert.deepEqual(before.analysis.ignorePatterns, []);

    // --ignore on the command line
    const flagged = JSON.parse(runCli(['heat', repo.dir, '--json', '--ignore', 'src/util.js,src/rare.js']).stdout);
    const paths = flagged.hotspots.map((h) => h.path);
    assert.deepEqual(paths, ['src/core.js'], `expected only src/core.js, got ${paths.join(', ')}`);
    assert.deepEqual(flagged.analysis.ignorePatterns, ['src/util.js', 'src/rare.js']);

    // the same via a file, with .githeatignore discovered from the repo root
    writeFileSync(join(repo.dir, IGNORE_FILE), '# fixture\nsrc/util.js\n');
    const viaFile = JSON.parse(runCli(['heat', repo.dir, '--json']).stdout);
    assert.ok(!viaFile.hotspots.some((h) => h.path === 'src/util.js'), '.githeatignore must be honoured');
    assert.match(viaFile.analysis.ignoreFile, /\.githeatignore$/);

    // and it can be turned off again
    const off = JSON.parse(runCli(['heat', repo.dir, '--json', '--no-ignore-file']).stdout);
    assert.ok(off.hotspots.some((h) => h.path === 'src/util.js'), '--no-ignore-file must disable the file');
    assert.equal(off.analysis.ignoreFile, null);
  } finally {
    repo.cleanup();
  }
});

test('githeat init writes a template that changes nothing until edited', () => {
  const repo = makeRepo('githeat-init-');
  try {
    const first = runCli(['init', repo.dir]);
    assert.equal(first.code, 0, first.stderr);
    const target = join(repo.dir, IGNORE_FILE);
    assert.ok(existsSync(target));
    assert.equal(parseIgnoreText(readFileSync(target, 'utf8')).length, 0, 'the template must contain no active rules');
    assert.ok(IGNORE_TEMPLATE.includes('src/generated/'));

    const second = runCli(['init', repo.dir]);
    assert.equal(second.code, 0);
    assert.match(second.stdout, /already exists/);

    const forced = runCli(['init', repo.dir, '--force']);
    assert.equal(forced.code, 0);
    assert.match(forced.stdout, /Replaced/);
  } finally {
    repo.cleanup();
  }
});

test('excluded files stay out of the review path too', () => {
  const repo = makeRepo('githeat-ignore-review-');
  try {
    writeFileSync(join(repo.dir, IGNORE_FILE), 'src/rare.js\n');
    const changed = join(repo.dir, '..', `changed-${Date.now()}.txt`);
    writeFileSync(changed, 'src/core.js\nsrc/rare.js\n');
    const out = runCli(['review', repo.dir, '--changed', changed, '--format', 'json']);
    assert.equal(out.code, 0, out.stderr);
    const payload = JSON.parse(out.stdout);
    assert.deepEqual(payload.hotspots.map((h) => h.path), ['src/core.js']);
    assert.deepEqual(payload.notRanked, ['src/rare.js'], 'an excluded file is reported as not ranked');
    rmSync(changed, { force: true });
  } finally {
    repo.cleanup();
  }
});
