/**
 * Dependency graph over a repository's source files, built from imports.
 *
 * The reason this exists: a hotspot list tells you *where* the changes are, not
 * why. If three separate hotspots all import the same module, that module is the
 * shared root, and refactoring it beats refactoring any of the three. That is the
 * "reverse inference" this graph supports, and it is the one thing a per-file
 * ranking structurally cannot see.
 *
 * Everything here is explicitly approximate — see `unresolved` and `external` in
 * the returned stats. Edges that could not be resolved to a real file inside the
 * repository are counted, never invented.
 */
import { posix } from 'node:path';

import { extractImports, RESOLVE_EXTENSIONS, INDEX_FILES } from './imports.mjs';

const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('.');

/**
 * Where a relative specifier would point, whether or not anything is there.
 *
 * Used only to distinguish "this import points at a file that does not exist"
 * (a real gap worth reporting) from "this resolves into the directory" (not a
 * gap — `./` and `..` are legitimate directory specifiers).
 */
function candidateFor(fromPath, specifier) {
  const base = specifier.startsWith('/')
    ? specifier.slice(1)
    : posix.join(posix.dirname(fromPath), specifier);
  return posix.normalize(base);
}

/** `./` and `..` name a directory, so failing to resolve them is not a gap. */
const leadsToDirectory = (candidate) => candidate === '.' || candidate.endsWith('/..') || candidate === '..';

/**
 * Resolve an import specifier to a repository-relative path, or null.
 *
 * Rules, in order:
 *  - relative specifiers are resolved against the importing file's directory
 *  - a specifier that names a real file wins
 *  - otherwise the known source extensions are tried
 *  - otherwise the specifier is treated as a directory and index files are tried
 *  - anything that leaves the repository, or matches no file, returns null
 *
 * @param {string} fromPath repo-relative path of the importing file
 * @param {string} specifier
 * @param {Set<string>} known repo-relative paths that exist
 */
export function resolveSpecifier(fromPath, specifier, known) {
  if (!specifier) return null;
  const direct = (candidate) => (candidate && known.has(candidate) ? candidate : null);

  if (isRelative(specifier) || specifier.startsWith('/')) {
    const base = specifier.startsWith('/')
      ? specifier.slice(1)
      : posix.join(posix.dirname(fromPath), specifier);
    const normalized = posix.normalize(base);
    if (normalized.startsWith('..')) return null; // outside the repository

    const exact = direct(normalized);
    if (exact) return exact;
    for (const ext of RESOLVE_EXTENSIONS) {
      const withExt = direct(`${normalized}${ext}`);
      if (withExt) return withExt;
    }
    for (const index of INDEX_FILES) {
      const asIndex = direct(posix.join(normalized, index));
      if (asIndex) return asIndex;
    }
    return null;
  }

  // A bare specifier could still be a repository path (e.g. "src/util.js") or a
  // package. Only accept it when it names a file that really exists, so npm
  // packages never turn into fake internal edges.
  const exact = direct(specifier);
  if (exact) return exact;
  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = direct(`${specifier}${ext}`);
    if (withExt) return withExt;
  }
  return null;
}

/**
 * Build the graph.
 *
 * @param {object} opts
 * @param {Map<string, string>} opts.sources  repo-relative path -> file text (only what you want graphed)
 * @param {(path: string) => string} [opts.readFile]  used to pull in neighbours not in `sources`
 * @param {string[]} [opts.roots]  files to start from; defaults to every source
 * @param {(path: string) => boolean} [opts.wanted]  restrict which files may enter the graph
 */
export function buildGraph({ sources, readFile, roots, wanted = () => true }) {
  /**
   * Paths that count as "exists in this repository".
   *
   * Seeded from `sources`, but `readFile` can materialise a neighbour that the
   * caller did not pre-load — without this, every edge leaving the starting set
   * was dropped and the graph was silently one hop deep.
   */
  const known = new Set(sources.keys());
  const cached = new Map(sources);
  const load = (path) => {
    if (cached.has(path)) return cached.get(path);
    const text = readFile ? readFile(path) : undefined;
    if (text !== undefined && text !== null) {
      cached.set(path, text);
      known.add(path);
    }
    return text;
  };
  /**
   * Does this path exist as a file we can read?
   *
   * Not the same question as `known.has()`, which only holds what has been loaded
   * so far. The edge queue needs this one, otherwise every neighbour that had not
   * been pre-loaded was dropped and the graph stopped one hop out from the seeds.
   */
  const exists = (path) => {
    if (known.has(path)) return true;
    if (!readFile) return false;
    const text = readFile(path);
    if (text === undefined || text === null) return false;
    cached.set(path, text);
    known.add(path);
    return true;
  };

  const importsByFile = new Map();
  const unresolved = [];
  const external = new Map(); // package name -> how many files import it

  const ensure = (path) => {
    if (importsByFile.has(path)) return importsByFile.get(path);
    const text = load(path) ?? '';
    const list = extractImports(path, text);
    importsByFile.set(path, list);
    return list;
  };

  const edges = new Map(); // path -> Set<path>
  const reverse = new Map(); // path -> Set<path>
  const addEdge = (from, to) => {
    if (!edges.has(from)) edges.set(from, new Set());
    if (!reverse.has(to)) reverse.set(to, new Set());
    edges.get(from).add(to);
    reverse.get(to).add(from);
  };

  // Walk from the roots, following resolvable edges, so a deep graph is covered
  // without reading every file in the repository.
  const queue = [...(roots ?? [...sources.keys()])].filter((p) => sources.has(p) || exists(p));
  const seen = new Set();
  while (queue.length > 0) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    for (const imp of ensure(path)) {
      // Probe the literal target before resolving: `resolveSpecifier` answers
      // against what is known to exist, and a neighbour that has not been read
      // yet is not known. Probing first is what lets the graph reach past its
      // seeds; the extension and index fallbacks inside resolveSpecifier still
      // only succeed for files that really exist.
      const candidate = isRelative(imp.specifier) || imp.specifier.startsWith('/')
        ? candidateFor(path, imp.specifier)
        : imp.specifier;
      const candidateExists = exists(candidate);

      const target = resolveSpecifier(path, imp.specifier, known);
      if (target) {
        addEdge(path, target);
        if (!seen.has(target) && wanted(target)) queue.push(target);
      } else if (isRelative(imp.specifier) && !leadsToDirectory(candidate)) {
        // A relative import pointing at nothing is a real gap in the graph;
        // `./` and `..` name directories and are not gaps.
        unresolved.push({ from: path, specifier: imp.specifier, line: imp.line, candidateExists });
      } else if (!isRelative(imp.specifier)) {
        const pkg = imp.specifier.startsWith('@')
          ? imp.specifier.split('/').slice(0, 2).join('/')
          : imp.specifier.split('/')[0];
        external.set(pkg, (external.get(pkg) ?? 0) + 1);
      }
    }
  }

  return {
    edges,
    reverse,
    stats: {
      files: edges.size,
      edges: [...edges.values()].reduce((sum, set) => sum + set.size, 0),
      unresolved: unresolved.length,
      unresolvedSample: unresolved.slice(0, 10),
      external: [...external.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    },
  };
}

/** Direct dependents of a file: who imports it. */
export const dependentsOf = (graph, path) => [...(graph.reverse.get(path) ?? [])].sort();

/** Direct dependencies of a file: what it imports. */
export const dependenciesOf = (graph, path) => [...(graph.edges.get(path) ?? [])].sort();

/**
 * Everything reachable from `start` following one direction, breadth-first.
 * @returns {Map<string, number>} path -> distance in edges (never includes start)
 */
export function closure(graph, start, { direction = 'dependents', maxDepth = 6 } = {}) {
  const map = direction === 'dependents' ? graph.reverse : graph.edges;
  const found = new Map();
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next = [];
    for (const path of frontier) {
      for (const neighbour of map.get(path) ?? []) {
        if (neighbour === start || found.has(neighbour)) continue;
        found.set(neighbour, depth);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return found;
}

/**
 * Cycles, via Tarjan's strongly connected components.
 *
 * Worth surfacing because a cycle between two hotspot files means they are one
 * unit: every change to either one touches the other's boundary, and no amount of
 * refactoring one of them in isolation will cool the pair down.
 */
export function findCycles(graph, { minSize = 2, maxCycles = 12 } = {}) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;

  const strongConnect = (start) => {
    // iterative Tarjan: a deep import chain would otherwise blow the JS stack
    const work = [{ node: start, childIndex: 0, children: [...(graph.edges.get(start) ?? [])] }];
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.childIndex < frame.children.length) {
        const child = frame.children[frame.childIndex];
        frame.childIndex += 1;
        if (!index.has(child)) {
          index.set(child, counter);
          low.set(child, counter);
          counter += 1;
          stack.push(child);
          onStack.add(child);
          work.push({ node: child, childIndex: 0, children: [...(graph.edges.get(child) ?? [])] });
        } else if (onStack.has(child)) {
          low.set(frame.node, Math.min(low.get(frame.node), index.get(child)));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component = [];
        for (;;) {
          const node = stack.pop();
          onStack.delete(node);
          component.push(node);
          if (node === frame.node) break;
        }
        if (component.length >= minSize) components.push(component.sort());
      }
    }
  };

  for (const node of graph.edges.keys()) if (!index.has(node)) strongConnect(node);
  return components.sort((a, b) => b.length - a.length).slice(0, maxCycles);
}

/**
 * The payload of a hotspot report, joined with the graph.
 *
 * @param {object} opts
 * @param {object} opts.report              result of analyze()
 * @param {object} opts.graph               result of buildGraph()
 * @param {number} [opts.limit=10]          how many hotspots to analyse
 * @param {number} [opts.rootsLimit=8]      how many shared roots to report
 */
export function couplingReport({ report, graph, limit = 10, rootsLimit = 8 }) {
  const hotspotPaths = report.files.slice(0, limit).map((f) => f.path);
  const scoreOf = new Map(report.files.map((f) => [f.path, f.score]));

  const perHotspot = hotspotPaths.map((path) => ({
    path,
    score: scoreOf.get(path) ?? 0,
    imports: dependenciesOf(graph, path).length,
    importedBy: dependentsOf(graph, path).length,
    /**
     * Distance 2+ dependents: files that break *through* this one. A hotspot with
     * a large blast radius is a different kind of risk from a leaf hotspot.
     */
    blastRadius: closure(graph, path, { direction: 'dependents' }).size,
    /** Hotspots this file depends on indirectly: candidates for "the real cause". */
    upstreamHotspots: [...closure(graph, path, { direction: 'dependencies', maxDepth: 4 })]
      .filter(([p]) => p !== path && hotspotPaths.includes(p))
      .map(([p, depth]) => ({ path: p, depth })),
  }));

  // shared roots: modules that more than one hotspot depends on.
  //
  // Hotspots are NOT excluded here, and that is the point: the most useful answer
  // is usually a file that looks calm in the ranking while five louder files all
  // depend on it. `isHotspot` lets the report say which kind it found.
  const consumers = new Map();
  for (const path of hotspotPaths) {
    for (const [target, depth] of closure(graph, path, { direction: 'dependencies', maxDepth: 4 })) {
      if (target === path) continue;
      if (!consumers.has(target)) consumers.set(target, []);
      consumers.get(target).push({ path, depth, score: scoreOf.get(path) ?? 0 });
    }
  }
  const sharedRoots = [...consumers.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([path, list]) => ({
      path,
      hotspotCount: list.length,
      score: scoreOf.get(path) ?? 0,
      isHotspot: hotspotPaths.includes(path),
      // the point of the report: how much hotspot score hangs off this one module
      hotspotScoreBehind: Math.round(list.reduce((sum, c) => sum + c.score, 0)),
      consumers: list.sort((a, b) => b.score - a.score).slice(0, 6),
    }))
    .sort(
      (a, b) =>
        b.hotspotCount - a.hotspotCount ||
        b.hotspotScoreBehind - a.hotspotScoreBehind ||
        a.path.localeCompare(b.path),
    )
    .slice(0, rootsLimit);

  const cycles = findCycles(graph).filter((component) => component.some((p) => hotspotPaths.includes(p))).slice(0, 6);

  return { hotspots: perHotspot, sharedRoots, cycles, stats: graph.stats };
}

/**
 * Terminal report.
 *
 * The framing matters: a shared root is a *candidate* cause, and a cycle is a
 * coupling fact, not a defect. Saying "if you fix this, the others may calm down"
 * would be a claim the data cannot support — this is a graph of imports, not of
 * causality.
 */
export function renderCoupling(result, { title = '', range = 'all time', top = 8 } = {}) {
  const lines = [''];
  const { stats } = result;
  lines.push(`${title}${title ? ' · ' : ''}${range}`);
  lines.push(
    `dependency graph: ${stats.files} files, ${stats.edges} internal edges` +
      (stats.unresolved > 0 ? `, ${stats.unresolved} unresolved import${stats.unresolved === 1 ? '' : 's'}` : ''),
  );
  lines.push('');

  if (result.hotspots.length === 0) {
    lines.push('  no hotspots to analyse');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  lines.push('hotspots and how much breaks through them:');
  lines.push('     score  imports  imported-by  blast-radius  file');
  for (const h of result.hotspots) {
    lines.push(
      `  ${String(h.score).padStart(7)}  ${String(h.imports).padStart(7)}  ${String(h.importedBy).padStart(11)}  ` +
        `${String(h.blastRadius).padStart(12)}  ${h.path}`,
    );
  }
  lines.push('');

  if (result.sharedRoots.length > 0) {
    lines.push('shared roots — files that several hotspots depend on (start here):');
    for (const root of result.sharedRoots.slice(0, top)) {
      const mark = root.isHotspot ? 'hot' : 'calm';
      lines.push(
        `  ${String(root.hotspotCount).padStart(2)} hotspot(s) / ${String(root.hotspotScoreBehind).padStart(4)} score behind  ` +
          `[${mark}] ${root.path}`,
      );
      lines.push(
        `      used by ${root.consumers
          .slice(0, 4)
          .map((c) => `${c.path}${c.depth > 1 ? ` (via ${c.depth} hops)` : ''}`)
          .join(', ')}${root.consumers.length > 4 ? `, +${root.consumers.length - 4} more` : ''}`,
      );
      if (!root.isHotspot) {
        lines.push('      ^ not a hotspot itself, which is exactly why it is easy to miss');
      }
    }
    lines.push('');
  } else {
    lines.push('no shared roots: the hotspots do not converge on one module');
    lines.push('');
  }

  if (result.cycles.length > 0) {
    lines.push('cycles among hotspots (coupled — editing one means touching the boundary of the other):');
    for (const cycle of result.cycles) lines.push(`  ${cycle.join(' → ')} →`);
    lines.push('');
  }

  lines.push('  Approximate by construction: aliases, package "exports" maps and dynamic');
  lines.push('  requires are not resolved, so treat missing edges as unknown, not absent.');
  if (stats.external.length > 0) {
    lines.push(`  External imports seen: ${stats.external.slice(0, 5).map((e) => `${e.name} (${e.count})`).join(', ')}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
