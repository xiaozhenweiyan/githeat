/**
 * Import extraction and the dependency graph.
 *
 * A regex-based graph is approximate by nature, so these tests pin down what it
 * claims to know. The most important ones are the negative cases: a string
 * constant that merely looks like an import must not become an edge, because a
 * graph with invented edges produces confident nonsense.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractImports } from '../src/imports.mjs';
import { buildGraph, resolveSpecifier, closure, dependentsOf, dependenciesOf, findCycles, couplingReport } from '../src/graph.mjs';
import { analyze } from '../src/analyze.mjs';

const specs = (path, text) => extractImports(path, text).map((i) => i.specifier);

test('extractImports ignores string constants that look like imports', () => {
  // Both of these were real false positives found by graphing this repository:
  // a constant holding a filename, and a path string holding "..".
  assert.deepEqual(specs('src/x.mjs', 'export const IGNORE_FILE = ".githeatignore";'), []);
  assert.deepEqual(specs('src/x.mjs', 'const p = "..";'), []);
  assert.deepEqual(specs('src/x.mjs', '  const s = "import foo from bar";'), []);
  assert.deepEqual(specs('src/x.mjs', '    x.require("./a.js");'), [], 'a method call is not an import');
  assert.deepEqual(specs('src/x.mjs', 'const msg = "#include \\"x.h\\"";'), []);
});

test('extractImports finds the syntax each dialect actually uses', () => {
  assert.deepEqual(specs('src/x.mjs', "import { a } from './b.mjs';"), ['./b.mjs']);
  assert.deepEqual(specs('src/x.mjs', "const m = require('./c.js');"), ['./c.js']);
  assert.deepEqual(specs('src/x.mjs', "export { z } from '../lib/z.js';"), ['../lib/z.js']);
  assert.deepEqual(specs('src/x.mjs', "const l = await import('./lazy.js');"), ['./lazy.js']);
  assert.deepEqual(specs('src/x.mjs', "import './side-effect.css';"), ['./side-effect.css']);

  assert.deepEqual(specs('a.py', 'from . import util'), ['.']);
  assert.deepEqual(specs('a.py', 'import os.path'), ['os.path']);
  assert.deepEqual(specs('a.rs', 'use crate::graph::Node;'), ['crate::graph::Node']);
  assert.deepEqual(specs('a.rb', "require 'json'"), ['json']);
  assert.deepEqual(specs('a.c', '#include "local.h"'), ['local.h']);
  assert.deepEqual(specs('a.java', 'import com.example.Foo;'), ['com.example.Foo']);
});

test('extractImports reports line numbers and skips binaries', () => {
  const found = extractImports('a.mjs', "const x = 1;\nimport './second.js';\n");
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
  assert.equal(found[0].kind, 'import');

  assert.deepEqual(extractImports('a.mjs', 'import "./x.js";\u0000binary'), [], 'a NUL byte means binary');
  assert.deepEqual(extractImports('a.mjs', ''), []);
  assert.deepEqual(extractImports('a.unknown', 'import "./x.js";'), [], 'unknown dialects yield nothing rather than guesses');
});

test('resolveSpecifier resolves real files and refuses to invent any', () => {
  const known = new Set(['src/a.js', 'src/b.ts', 'src/lib/index.ts', 'src/deep/c.mjs', 'root.js']);

  assert.equal(resolveSpecifier('src/a.js', './b.ts', known), 'src/b.ts');
  assert.equal(resolveSpecifier('src/deep/c.mjs', '../a.js', known), 'src/a.js');
  assert.equal(resolveSpecifier('src/a.js', './b', known), 'src/b.ts', 'a missing extension is tried');
  assert.equal(resolveSpecifier('src/a.js', './lib', known), 'src/lib/index.ts', 'a directory resolves to its index');
  assert.equal(resolveSpecifier('src/a.js', '/root.js', known), 'root.js', 'a root-relative specifier works');

  assert.equal(resolveSpecifier('src/a.js', './missing.js', known), null);
  assert.equal(resolveSpecifier('src/a.js', 'express', known), null, 'a package is not an internal edge');
  assert.equal(resolveSpecifier('src/a.js', '../../outside.js', known), null, 'paths outside the repository are refused');
});

test('buildGraph reports what it could not resolve instead of hiding it', () => {
  const sources = new Map([
    ['src/a.js', "import './b.js';\nimport 'express';\nimport './nowhere.js';\n"],
    ['src/b.js', "import './c';\n"],
    ['src/c.js', "export const c = 1;\n"],
  ]);
  const graph = buildGraph({ sources });

  assert.deepEqual(dependenciesOf(graph, 'src/a.js'), ['src/b.js']);
  assert.deepEqual(dependenciesOf(graph, 'src/b.js'), ['src/c.js']);
  assert.deepEqual(dependentsOf(graph, 'src/c.js'), ['src/b.js']);

  assert.equal(graph.stats.unresolved, 1, 'the dangling relative import is counted');
  assert.equal(graph.stats.unresolvedSample[0].specifier, './nowhere.js');
  assert.equal(graph.stats.unresolvedSample[0].line, 3);
  assert.deepEqual(graph.stats.external, [{ name: 'express', count: 1 }], 'packages are reported separately');
});

test('buildGraph follows edges out of the starting set', () => {
  const onDisk = new Map([
    ['a.js', "import './b.js';"],
    ['b.js', "import './c.js';"],
    ['c.js', 'export const c = 1;'],
  ]);
  // only a.js and b.js are "sources"; c.js must be pulled in through readFile
  const graph = buildGraph({
    sources: new Map([['a.js', onDisk.get('a.js')], ['b.js', onDisk.get('b.js')]]),
    readFile: (p) => onDisk.get(p) ?? '',
    roots: ['a.js'],
  });
  assert.deepEqual(dependenciesOf(graph, 'a.js'), ['b.js']);
  assert.deepEqual(dependenciesOf(graph, 'b.js'), ['c.js']);
});

test('closure walks multiple hops and never returns the starting file', () => {
  const sources = new Map([
    ['a.js', "import './b.js';"],
    ['b.js', "import './c.js';"],
    ['c.js', 'export const c = 1;'],
    ['z.js', "import './a.js';"],
  ]);
  const graph = buildGraph({ sources });

  const dependents = closure(graph, 'c.js', { direction: 'dependents' });
  assert.equal(dependents.get('b.js'), 1);
  assert.equal(dependents.get('a.js'), 2);
  assert.equal(dependents.get('z.js'), 3);
  assert.equal(dependents.has('c.js'), false);

  const dependencies = closure(graph, 'a.js', { direction: 'dependencies' });
  assert.deepEqual([...dependencies.keys()].sort(), ['b.js', 'c.js']);

  assert.equal(closure(graph, 'c.js', { direction: 'dependents', maxDepth: 1 }).size, 1, 'maxDepth is honoured');
  assert.equal(closure(graph, 'nothing.js', { direction: 'dependents' }).size, 0);
});

test('cycles are found, including a pair that would be easy to miss', () => {
  const sources = new Map([
    ['a.js', "import './b.js';"],
    ['b.js', "import './a.js';"],
    ['c.js', "import './d.js';"],
    ['d.js', "import './e.js';"],
    ['e.js', "import './c.js';"],
    ['solo.js', "import './c.js';"],
  ]);
  const graph = buildGraph({ sources });
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 2);
  assert.deepEqual(cycles.map((c) => c.length).sort(), [2, 3]);
  assert.deepEqual(cycles.find((c) => c.length === 2), ['a.js', 'b.js']);
});

test('a deep chain does not blow the stack', () => {
  const sources = new Map();
  const depth = 4000;
  for (let i = 0; i < depth; i += 1) sources.set(`f${i}.js`, i + 1 < depth ? `import './f${i + 1}.js';` : 'export const end = 1;');
  const graph = buildGraph({ sources, roots: ['f0.js'] });
  assert.doesNotThrow(() => findCycles(graph));
  assert.equal(closure(graph, 'f3999.js', { direction: 'dependents', maxDepth: depth }).size, depth - 1);
});

test('couplingReport names the shared root behind several hotspots', () => {
  // Two hotspots that both import a third, calm module: that module is the shared
  // cause. It needs history of its own to be ranked at all — an unranked file is
  // invisible to a report built on the hotspot list.
  const commits = [];
  for (let i = 0; i < 6; i += 1) {
    const day = String(i + 1).padStart(2, '0');
    commits.push({ sha: `s${i}`, date: `2024-03-${day}T00:00:00Z`, author: 'A', files: ['src/hot1.js', 'src/hot2.js'] });
  }
  commits.push({ sha: 'calm1', date: '2024-03-07T00:00:00Z', author: 'A', files: ['src/shared.js'] });
  commits.push({ sha: 'calm2', date: '2024-03-08T00:00:00Z', author: 'A', files: ['src/shared.js'] });
  const report = analyze(commits, { minCommits: 1, now: Date.parse('2024-04-01T00:00:00Z') });
  assert.ok(report.files.some((f) => f.path === 'src/shared.js'), 'fixture: the calm module must be ranked');

  const sources = new Map([
    ['src/hot1.js', "import { s } from './shared.js';"],
    ['src/hot2.js', "import { s } from './shared.js';"],
    ['src/shared.js', 'export const s = 1;'],
  ]);
  const graph = buildGraph({ sources });
  const result = couplingReport({ report, graph, limit: 5 });

  const root = result.sharedRoots.find((r) => r.path === 'src/shared.js');
  assert.ok(root, `expected src/shared.js as a shared root, got ${JSON.stringify(result.sharedRoots)}`);
  assert.equal(root.hotspotCount, 2);
  assert.ok(root.hotspotScoreBehind > 0);
  assert.deepEqual(root.consumers.map((c) => c.path).sort(), ['src/hot1.js', 'src/hot2.js']);

  const hot1 = result.hotspots.find((h) => h.path === 'src/hot1.js');
  assert.equal(hot1.imports, 1);
  assert.equal(hot1.importedBy, 0);
  assert.equal(hot1.blastRadius, 0);
  assert.deepEqual(
    hot1.upstreamHotspots.map((u) => u.path),
    ['src/shared.js'],
    'hot1 depends on the calm module, so that is what could be causing hot1',
  );
});

test('couplingReport measures blast radius through other files', () => {
  const commits = [];
  for (let i = 0; i < 5; i += 1) {
    commits.push({ sha: `s${i}`, date: `2024-03-0${i + 1}T00:00:00Z`, author: 'A', files: ['src/core.js'] });
  }
  const report = analyze(commits, { minCommits: 1, now: Date.parse('2024-04-01T00:00:00Z') });
  const sources = new Map([
    ['src/core.js', 'export const core = 1;'],
    ['src/mid.js', "import './core.js';"],
    ['src/leaf.js', "import './mid.js';"],
    ['src/other.js', "import './mid.js';"],
  ]);
  const graph = buildGraph({ sources });
  const result = couplingReport({ report, graph, limit: 3 });
  const core = result.hotspots.find((h) => h.path === 'src/core.js');
  assert.equal(core.importedBy, 1, 'only src/mid.js imports it directly');
  assert.equal(core.blastRadius, 3, 'but three files break through it');
  assert.deepEqual(result.cycles, []);
});
