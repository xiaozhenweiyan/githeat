/**
 * Thin, dependency-free wrapper around the `git` binary.
 * Everything the analyser needs comes out of `git log`.
 */
import { spawnSync } from 'node:child_process';

const SEP = '\u0001'; // field separator inside a commit header
const REC = '\u0002'; // record separator between commits

/** Run a git command, returning stdout as a string. Throws on failure. */
export function git(args, { cwd = process.cwd(), allowFail = false } = {}) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
    // TZ=UTC keeps `--since`/`--until` and the parsed author dates in one frame
    // of reference, so a report is reproducible on any machine.
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (res.error) throw new Error(`failed to run git: ${res.error.message}`);
  if (res.status !== 0) {
    if (allowFail) return null;
    const detail = (res.stderr || '').trim() || `exit code ${res.status}`;
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
  return res.stdout ?? '';
}

export function isRepo(cwd = process.cwd()) {
  const out = git(['rev-parse', '--is-inside-work-tree'], { cwd, allowFail: true });
  return out !== null && out.trim() === 'true';
}

export function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], { cwd, allowFail: true })?.trim() || cwd;
}

export function headSha(cwd = process.cwd()) {
  return git(['rev-parse', '--short', 'HEAD'], { cwd, allowFail: true })?.trim() || null;
}

/**
 * Best common ancestor of `ref` and HEAD, or null when there is none.
 *
 * Comparing against the merge base rather than the branch tip is what makes a
 * baseline mean something: on a branch that is 200 commits behind `main`, the
 * tip of `main` contains work this branch has never seen, and every file those
 * commits touched would look like it had "cooled down" here.
 */
export function mergeBase(ref, cwd = process.cwd()) {
  if (!ref) return null;
  return git(['merge-base', ref, 'HEAD'], { cwd, allowFail: true })?.trim() || null;
}

/**
 * True when `ref` is reachable from HEAD, i.e. this branch contains it.
 *
 * Callers use this to keep their wording honest: comparing against an ancestor
 * can only ever show files getting busier, because the descendant's history
 * contains strictly more of them.
 *
 * `git merge-base --is-ancestor` prints nothing and answers through its exit
 * code, so this one cannot go through the stdout-based `git()` helper.
 */
export function isAncestor(ref, cwd = process.cwd()) {
  if (!ref) return false;
  const res = spawnSync('git', ['merge-base', '--is-ancestor', ref, 'HEAD'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
  });
  return res.status === 0;
}

/**
 * Parse `git log --name-only` output into commit records.
 * Paths are returned as POSIX-style, repo-relative strings.
 */
export function parseLog(raw) {
  const commits = [];
  if (!raw) return commits;
  for (const record of raw.split(REC)) {
    const body = record.replace(/^\s+/, '');
    if (!body) continue;
    // header line: sha<SEP>iso<SEP>author
    const nl = body.indexOf('\n');
    const header = nl === -1 ? body : body.slice(0, nl);
    const rest = nl === -1 ? '' : body.slice(nl + 1);
    const [sha, date, ...authorParts] = header.split(SEP);
    if (!sha) continue;
    const files = [];
    const seen = new Set();
    for (const line of rest.split('\n')) {
      const path = line.trim();
      if (!path || path.startsWith('"')) continue; // skip quoted/odd paths
      if (seen.has(path)) continue; // a path counts once per commit
      seen.add(path);
      files.push(path);
    }
    commits.push({
      sha,
      date,
      author: authorParts.join(SEP).trim(),
      files,
    });
  }
  return commits;
}

/**
 * Normalise a human date so it means the same thing everywhere.
 *
 * Git parses a bare `2024-03-01` in the machine's local time zone, which makes
 * reports machine-dependent. A date gets an explicit UTC time; relative forms
 * ("12.months", "6 weeks ago") are passed through untouched.
 */
export function normalizeWhen(value) {
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) return `${s.replace(' ', 'T')}Z`;
  return s;
}

/**
 * Parse an absolute date for exact filtering. Relative forms ("12.months")
 * return null: those are left to git, because only git can resolve "now".
 *
 * `endOfDay` turns a bare date into 23:59:59.999Z, so `--since 2024-03-01
 * --until 2024-03-31` means "the whole of March" instead of silently dropping
 * everything that happened on the 31st after midnight.
 *
 * @returns {{from:number|null, to:number|null}}
 */
export function parseWhen(value, { endOfDay = false } = {}) {
  const s = normalizeWhen(value);
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?Z$/.test(s)) return null; // relative form
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(s)) return t + 86399999;
  return t;
}

/**
 * Read the commit history of a repository.
 *
 * Time windows are applied on **author dates** in UTC. Only `--since` is handed
 * to git as a cheap pre-filter, because git's own `--until` filters on the
 * *committer* date (rewritten by every rebase) while `--since` uses the author
 * date. The exact cut on both ends happens here instead, so a window means the
 * same thing on every machine.
 *
 * @param {object} opts
 * @param {string} [opts.cwd]        directory inside the work tree
 * @param {string} [opts.since]      e.g. "12.months", "2024-01-01" (UTC)
 * @param {string} [opts.until]      e.g. "2025-01-01" (UTC)
 * @param {string} [opts.author]     git --author pattern
 * @param {string} [opts.rev]        revision range, e.g. "main" or "v1..HEAD"
 * @param {boolean} [opts.merges]    include merge commits (default false)
 */
export function readHistory(opts = {}) {
  const { cwd = process.cwd(), since, until, author, rev, merges = false } = opts;
  const args = [
    'log',
    // %aI (author date) rather than %cI: rebases and squash merges rewrite the
    // committer date, which would make every file look freshly touched.
    `--pretty=format:${REC}%H${SEP}%aI${SEP}%an`,
    '--name-only',
    '--no-renames',
  ];
  if (!merges) args.push('--no-merges');
  if (since) args.push(`--since=${normalizeWhen(since)}`);
  if (author) args.push(`--author=${author}`);
  if (rev) args.push(rev);
  args.push('--');
  // A branch without commits (fresh `git init`) is not an error: it is an
  // empty history, and callers want to say something nicer than git's fatal.
  const raw = git(args, { cwd, allowFail: true });
  let commits = parseLog(raw ?? '');

  const from = since ? parseWhen(since) : null;
  const to = until ? parseWhen(until, { endOfDay: true }) : null;
  if (from !== null || to !== null) {
    commits = commits.filter((c) => {
      const t = Date.parse(c.date);
      if (!Number.isFinite(t)) return true; // unparseable date: keep, never hide history
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      return true;
    });
  }
  return commits;
}
