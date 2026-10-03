/**
 * Static import extraction.
 *
 * Deliberately conservative. A dependency graph built from regexes is wrong in
 * ways that matter — aliases (`@/foo`), `exports` maps in package.json, dynamic
 * `require(variable)`, build-time rewrites — so this module records only the
 * edges it can resolve to a real file in the repository, and reports everything
 * else as `unresolved`. A graph that quietly drops a third of the edges is worse
 * than one that says how much it dropped.
 *
 * Zero runtime dependencies means no per-language parsers here; the patterns cover
 * the import syntax that is stable across the languages this tool supports.
 */

/** Extensions to try, in order, when a specifier has none. */
export const RESOLVE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.php'];
/** Index files to try inside a directory specifier. */
export const INDEX_FILES = ['index.js', 'index.mjs', 'index.ts', 'index.tsx', 'index.jsx', '__init__.py', 'mod.rs'];

/**
 * @typedef {{specifier:string, line:number, kind:string}} RawImport
 */

/**
 * `import x from '...'`, `import '...'`, `export ... from '...'`.
 *
 * The character class excludes `=`, because `export const FILE = "x.json"` is a
 * constant assignment, not an import, and matching it invented edges that the
 * graph then reported as unresolved.
 */
const JS_IMPORT = /^[ \t]*(?:import|export)\b[^'"=\n]*?['"]([^'"\n]+)['"]/gm;
/** `require('...')` and dynamic `import('...')`, but not `foo.require(...)` */
const JS_REQUIRE = /(?<![\w.$])(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
/** `from x import y`, `import x`, `import x.y` — statement position only */
const PY_IMPORT = /^[ \t]*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm;
/** `use crate::x;`, `mod x;` */
const RUST_USE = /^[ \t]*(?:use|mod)\s+([\w:]+)/gm;
/** `#include "x.h"` — the preprocessor directive, not a string containing it */
const C_INCLUDE = /^[ \t]*#[ \t]*include[ \t]+"([^"]+)"/gm;
/** `require 'x'` and `require_relative 'x'` */
const RUBY_REQUIRE = /^[ \t]*require(?:_relative)?[ \t]+['"]([^'"]+)['"]/gm;
/** `using X;`, `import x.y;` */
const JAVA_IMPORT = /^[ \t]*(?:import|using)\s+([\w.]+)\s*;?/gm;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function collect(text, regex, kind, pick = (m) => m[1]) {
  /** @type {RawImport[]} */
  const found = [];
  for (const match of text.matchAll(regex)) {
    const specifier = pick(match);
    if (!specifier) continue;
    found.push({ specifier: specifier.trim(), line: lineOf(text, match.index), kind });
  }
  return found;
}

/**
 * Extract import specifiers from one file's text.
 * @param {string} path  repo-relative path, used only to pick the dialect
 * @param {string} text
 * @returns {RawImport[]}
 */
export function extractImports(path, text) {
  if (!text || text.length === 0) return [];
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();

  // a NUL byte in the first block means "binary", not source
  if (text.slice(0, 8000).includes('\u0000')) return [];

  switch (ext) {
    case 'js': case 'jsx': case 'mjs': case 'cjs': case 'ts': case 'tsx': case 'mts': case 'cts':
    case 'vue': case 'svelte':
      return [...collect(text, JS_IMPORT, 'import'), ...collect(text, JS_REQUIRE, 'require')];
    case 'py':
      return collect(text, PY_IMPORT, 'import', (m) => m[1] ?? m[2]);
    case 'rs':
      return collect(text, RUST_USE, 'use');
    case 'c': case 'h': case 'cc': case 'cpp': case 'cxx': case 'hpp': case 'hh':
      return [...collect(text, C_INCLUDE, 'include'), ...collect(text, JS_REQUIRE, 'require')];
    case 'rb':
      return collect(text, RUBY_REQUIRE, 'require');
    case 'java': case 'kt': case 'kts': case 'scala': case 'groovy': case 'cs':
      return collect(text, JAVA_IMPORT, 'import');
    default:
      return [];
  }
}
