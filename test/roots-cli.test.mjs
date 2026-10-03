/**
 * `githeat roots` end to end.
 *
 * The value of this command is that it can point at a file the ranking does not
 * consider interesting, so the tests check both that it finds the shared root and
 * that it keeps saying how approximate the graph is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { gitIn, runCli } from './helpers.mjs';

/**
 * Two churning files that both import a calm module, plus a churning file with a
 * wide blast radius. History is shaped so all three are ranked hotspots.
 */
function makeCoupledRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'githeat-roots-'));
  gitIn(dir, ['init', '-q', '-b', 'main']);
  mkdirSync(join(dir, 'src'));

  const files = {
    'src/shared.js': 'export const shared = 1;\n',
    'src/hot1.js': "import { shared } from './shared.js';\nexport const a = shared;\n",
    'src/hot2.js': "import { shared } from './shared.js';\nexport const b = shared;\n",
    'src/core.js': 'export const core = 1;\n',
    'src/mid.js': "import './core.js';\nexport const mid = 1;\n",
    'src/leaf.js': "import './mid.js';\nexport const leaf = 1;\n",
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'initial']);

  for (let i = 0; i < 5; i += 1) {
    writeFileSync(join(dir, 'src/hot1.js'), `import { shared } from './shared.js';\nexport const a = shared + ${i};\n`);
    writeFileSync(join(dir, 'src/hot2.js'), `import { shared } from './shared.js';\nexport const b = shared + ${i};\n`);
    writeFileSync(join(dir, 'src/core.js'), `export const core = ${i};\n`);
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-q', '-m', `churn ${i}`]);
  }
  // src/shared.js is deliberately left at one change: it must stay *below* the
  // ranking threshold, because "a file the ranking ignores is behind several
  // hotspots" is the case this command exists to surface.
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) };
}

test('roots names the calm module that several hotspots depend on', () => {
  const repo = makeCoupledRepo();
  try {
    const out = runCli(['roots', repo.dir, '--top', '6']);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /dependency graph:/);
    assert.match(out.stdout, /shared roots/);
    assert.match(out.stdout, /src\/shared\.js/);
    assert.match(out.stdout, /\[calm\]/, 'the point is that the shared root is not itself a hotspot');
    assert.match(out.stdout, /not a hotspot itself, which is exactly why it is easy to miss/);
    assert.match(out.stdout, /hotspots and how much breaks through them/);
  } finally {
    repo.cleanup();
  }
});

test('roots measures blast radius through intermediate files', () => {
  const repo = makeCoupledRepo();
  try {
    const out = runCli(['roots', repo.dir, '--format', 'json', '--top', '6']);
    assert.equal(out.code, 0, out.stderr);
    const payload = JSON.parse(out.stdout);

    assert.ok(payload.stats.edges > 0);
    const core = payload.hotspots.find((h) => h.path === 'src/core.js');
    assert.ok(core, `expected src/core.js among hotspots: ${payload.hotspots.map((h) => h.path).join(', ')}`);
    assert.equal(core.importedBy, 1, 'only src/mid.js imports it directly');
    assert.equal(core.blastRadius, 2, 'but two more files break through it');

    const shared = payload.sharedRoots.find((r) => r.path === 'src/shared.js');
    assert.ok(shared, 'the shared root must be reported');
    assert.equal(shared.isHotspot, false, 'it is not in the ranking, which is the whole point');
    assert.equal(shared.hotspotCount, 2);
    assert.deepEqual(shared.consumers.map((c) => c.path).sort(), ['src/hot1.js', 'src/hot2.js']);
  } finally {
    repo.cleanup();
  }
});

test('roots says how approximate the graph is', () => {
  const repo = makeCoupledRepo();
  try {
    const out = runCli(['roots', repo.dir]);
    assert.match(out.stdout, /Approximate by construction/);
    assert.match(out.stdout, /treat missing edges as unknown, not absent/);
  } finally {
    repo.cleanup();
  }
});

test('roots reports imports it could not resolve rather than hiding them', () => {
  const repo = makeCoupledRepo();
  try {
    writeFileSync(join(repo.dir, 'src/broken.js'), "import './does-not-exist.js';\n");
    gitIn(repo.dir, ['add', '-A']);
    gitIn(repo.dir, ['commit', '-q', '-m', 'broken import']);

    const out = runCli(['roots', repo.dir, '--format', 'json']);
    const payload = JSON.parse(out.stdout);
    assert.ok(payload.stats.unresolved >= 1, 'the dangling relative import must be counted');
    assert.ok(
      payload.stats.unresolvedSample.some((u) => u.specifier === './does-not-exist.js'),
      `expected the dangling import in the sample: ${JSON.stringify(payload.stats.unresolvedSample)}`,
    );
  } finally {
    repo.cleanup();
  }
});

test('roots works on a repository with no imports at all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'githeat-roots-empty-'));
  try {
    gitIn(dir, ['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'solo.js'), 'export const solo = 1;\n');
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-q', '-m', 'one file']);
    writeFileSync(join(dir, 'solo.js'), 'export const solo = 2;\n');
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-q', '-m', 'again']);

    const out = runCli(['roots', dir]);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /0 internal edges/);
    assert.match(out.stdout, /no shared roots/);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('roots is listed in the help output', () => {
  const out = runCli(['--help']);
  assert.match(out.stdout, /githeat roots \[dir\]/);
  assert.match(out.stdout, /which files the hotspots have in common/);
  assert.match(out.stdout, /--roots-top <n>/);
});
