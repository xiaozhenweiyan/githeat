/**
 * User-controlled exclusions: `.githeatignore` plus `--ignore`.
 *
 * The built-in noise filter covers lockfiles and build output, but it cannot
 * know that *your* `generated/api.ts` is machine-written. Every user of a
 * hotspot tool eventually hits one file that should not be in the ranking, and
 * the honest answer cannot be "fork it" or "score only .js files".
 *
 * Supports the subset of gitignore syntax people actually use:
 *
 *   ```githeatignore
 *   # generated code
 *   src/generated/
 *   *.min.js
 *   !src/generated/keep.ts     # negation wins, evaluated last
 *   ```
 *
 * Semantics chosen deliberately, and documented in the README:
 *  - a bare name matches at any depth (`api.ts` == `**\/api.ts`)
 *  - a pattern with a slash is anchored to the repository root
 *  - a trailing slash means "directory and everything under it"
 *  - `*` does not cross `/`, `**` does
 *  - later patterns win, so a negation can re-include something
 */

export const IGNORE_FILE = '.githeatignore';

/**
 * Starter file written by `githeat init`. Every line is a comment on purpose:
 * a template full of active rules would silently change other people's rankings
 * the moment they commit it.
 */
export const IGNORE_TEMPLATE = `# .githeatignore — files that must never appear in a hotspot ranking.
# Same syntax as .gitignore. Patterns match paths relative to the repository root.
#
#   src/generated/        a directory and everything under it
#   *.min.js              a name, at any depth
#   docs/api/*.md         anchored, because the pattern contains a slash
#   !src/generated/x.ts   negation: later patterns win, so this re-includes it
#
# The built-in filter already skips lockfiles, node_modules, dist/, binaries and
# non-source extensions. Add entries here for generated code that is committed,
# vendored drops, fixtures with huge histories, or anything else that keeps
# topping the ranking without deserving it.
#
# Exclusions can also be passed per run, without touching this file:
#   githeat heat . --ignore "src/generated/,*.min.js"
#   githeat heat . --no-ignore-file
`;

const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/**
 * Compile one gitignore-style pattern.
 * @returns {{re: RegExp, negated: boolean, dirOnly: boolean, source: string}}
 */
export function compilePattern(line) {
  let source = String(line).trim();
  const negated = source.startsWith('!');
  if (negated) source = source.slice(1).trim();
  const dirOnly = source.endsWith('/');
  if (dirOnly) source = source.slice(0, -1);

  // A pattern without a slash matches at any depth; with a slash it is anchored.
  const anchored = source.includes('/');
  if (source.startsWith('/')) source = source.slice(1);

  const body = source
    .split('**')
    .map((part) => part.split('*').map(escapeRe).join('[^/]*'))
    .join('.*');

  const prefix = anchored ? '^' : '(?:^|/)';
  const suffix = dirOnly ? '(?:/.*)?$' : '$';
  return { re: new RegExp(`${prefix}${body}${suffix}`), negated, dirOnly, source: String(line).trim() };
}

/** Split raw ignore-file text into usable patterns, dropping comments/blanks. */
export function parseIgnoreText(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(compilePattern);
}

/**
 * Build a predicate from patterns.
 *
 * Directory patterns must also match the files *inside* them, and a negation
 * has to be able to bring one of those files back, so the decision is: walk all
 * patterns in order, remember the last one that matched, and use its polarity.
 */
export function makeIgnoreMatcher(patterns) {
  const list = (patterns ?? []).filter(Boolean);
  if (list.length === 0) return () => false;
  return (path) => {
    const normalized = String(path).replace(/\\/g, '/');
    let ignored = false;
    for (const p of list) {
      if (p.re.test(normalized)) ignored = !p.negated;
    }
    return ignored;
  };
}

/** Convenience: parse text and return a matcher in one step. */
export function makeIgnoreFromText(text) {
  return makeIgnoreMatcher(parseIgnoreText(text));
}
