/**
 * githeat command line interface.
 *
 *   githeat heat [dir] [options]     find hotspots, render a map
 *   githeat check [dir] [options]    CI gate: fail when the codebase is too hot
 *   githeat install-hook [dir]       add a gentle pre-commit reminder
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { isRepo, repoRoot, readHistory, headSha, mergeBase } from './git.mjs';
import { analyze, parseExtensions, DEFAULT_MIN_COMMITS } from './analyze.mjs';
import { readChangedList, reviewReport, renderReviewMarkdown } from './review.mjs';
import { IGNORE_FILE, makeIgnoreMatcher, parseIgnoreText, IGNORE_TEMPLATE } from './ignore.mjs';
import { explainExclusion, renderExplanation } from './explain.mjs';
import { compareToBase, renderComparison } from './compare.mjs';
import { readLineAges, renderLineReport, isPartialClone, AGE_BUCKETS } from './lines.mjs';
import { renderSvg } from './svg.mjs';
import { renderHtml } from './report.mjs';
import { renderTable, renderTree, shouldUseColor } from './terminal.mjs';
import { paletteNames } from './colors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

const HELP = `
githeat ${pkg.version} — find git hotspots, render them as heatmaps. Zero dependencies.

USAGE
  githeat [heat] [dir] [options]     rank files by hotspot score (default command)
  githeat check  [dir] [options]     print a short risk report, exit 1 if thresholds break
  githeat review [dir] [options]     rank only the files a change touched (for PRs)
  githeat explain <path> [dir]       why a file is (or is not) in the ranking
  githeat lines [path] [dir]         where inside one file the churn sits
  githeat init  [dir]                write a starter .githeatignore
  githeat install-hook [dir]         install a non-blocking pre-commit reminder

ANALYSIS
  --all                      whole history (default)
  --since <when>             e.g. 12.months, 2024-01-01, "6 weeks ago" (UTC, inclusive)
  --until <when>             end of the window, whole day included
  --author <pattern>         only commits whose author matches
  --rev <range>              branch or range, e.g. main, v1.0..HEAD
  --merges                   include merge commits
  --min-commits <n>          ignore files changed fewer than n times (default ${DEFAULT_MIN_COMMITS})
  --ext <list>               score only these extensions, e.g. "js,ts,py" (default: source code)
                             use --ext "" to score every file, config and docs included
  --bands <mode>             absolute | percentile | auto (default auto)
                             auto = absolute for small repos, top-5%/15%/40% for 50+ files
  --ignore <patterns>        comma-separated exclusions, e.g. "src/generated/,*.min.js"
  --no-ignore-file           do not read .githeatignore
  --base <ref>               compare against a revision or branch (uses the merge base)
  --include-noise            keep lockfiles, generated and vendored files

OUTPUT
  --format <fmt>             table | tree | json | svg | html   (default table)
  --top <n>                  rows in table/tree output (default 15)
  --depth <n>                directory depth for --format tree (default 2)
  --out <file>               write svg/html/json to a file (infers --format from extension)
  --palette <name>           ${paletteNames().join(' | ')}   (default ember)
  --tiles <n>                max tiles in the map (default 140)
  --open                     open the written HTML report in the browser
  --no-color                 disable ANSI colour
  --json                     shorthand for --format json

CHECK
  --max-score <n>            fail when the hottest file scores above n
  --max-critical <n>         fail when more than n files are critical (>= 70)
  --quiet                    only print the verdict line

REVIEW
  --changed <file>           newline-separated path list; omit or use - to read stdin
  --format markdown|json     markdown comment body (default) or machine output
  --top <n>                  rows in the generated table (default 10)

LINES
  --map                      print the per-line age column, not just the summary
  --format text|json         report (default) or machine output
  --rev <range>              blame a revision other than HEAD

  -h, --help                 this text
  -v, --version              print the version
`;

export function parseArgs(argv) {
  const args = { _: [], flags: {} };
  const boot = { help: true, version: true, json: true, open: true, quiet: true, color: true, merges: true, force: true, all: true, 'include-noise': true, 'no-color': true, 'no-ignore-file': true, map: true };
  const takesValue = new Set([
    'since', 'until', 'author', 'rev', 'min-commits', 'top', 'depth', 'out', 'format', 'palette', 'tiles',
    'max-score', 'max-critical', 'ext', 'bands', 'changed', 'ignore', 'base',
  ]);
  const known = new Set([...Object.keys(boot), ...takesValue]);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') break;
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      const name = eq === -1 ? body : body.slice(0, eq);
      if (!known.has(name)) throw new Error(`unknown option --${name} (try githeat --help)`);
      if (eq !== -1) {
        args.flags[name] = body.slice(eq + 1);
      } else if (takesValue.has(name)) {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) throw new Error(`--${name} needs a value`);
        args.flags[name] = next;
        i += 1;
      } else {
        args.flags[name] = true;
      }
    } else if (token.startsWith('-') && token.length > 1) {
      const short = { h: 'help', v: 'version', j: 'json', o: 'out' };
      const key = short[token.slice(1)];
      if (!key) throw new Error(`unknown option ${token} (try githeat --help)`);
      if (key === 'out') {
        const next = argv[i + 1];
        if (next === undefined) throw new Error('-o needs a file path');
        args.flags.out = next;
        i += 1;
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

const num = (v, fallback) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`expected a number, got "${v}"`);
  return n;
};

/** --bands accepts absolute | percentile | auto (default auto). */
export function parseBandMode(value) {
  if (value === undefined || value === true) return 'auto';
  const mode = String(value).toLowerCase();
  if (mode === 'absolute' || mode === 'percentile' || mode === 'auto') return mode;
  throw new Error(`--bands expects absolute, percentile or auto — got "${value}"`);
}

export function describeRange(flags) {
  if (flags.rev && (flags.since || flags.until)) return `${flags.rev} · ${flags.since ?? 'start'}..${flags.until ?? 'now'}`;
  if (flags.rev) return String(flags.rev);
  if (!flags.since && !flags.until) return 'all time';
  return `${flags.since ?? 'start'} → ${flags.until ?? 'now'}`;
}

function inferFormat(flags) {
  if (flags.format) return String(flags.format).toLowerCase();
  if (flags.json) return 'json';
  if (flags.out) {
    const ext = extname(String(flags.out)).toLowerCase();
    if (ext === '.svg') return 'svg';
    if (ext === '.html' || ext === '.htm') return 'html';
    if (ext === '.json') return 'json';
  }
  return 'table';
}

/**
 * User-controlled exclusions, in precedence order:
 *   --ignore "a,b"  >  <repo>/.githeatignore  >  built-in noise patterns
 * Returns a compiled matcher and the pattern list, so a report can explain why a
 * file the user expected to see is missing.
 */
export function loadIgnore(root, flags) {
  const cliPatterns = splitPatterns(flags.ignore);
  const file = join(root, IGNORE_FILE);
  let text = '';
  let source = null;
  if (!flags['no-ignore-file'] && existsSync(file)) {
    text = readFileSync(file, 'utf8');
    source = file;
  }
  const patterns = [...parseIgnoreText(text), ...parseIgnoreText(cliPatterns.join('\n'))];
  return { matcher: makeIgnoreMatcher(patterns), patterns: patterns.map((p) => p.source), source };
}

/** --ignore accepts repeats and comma-separated values; keep the raw strings. */
function splitPatterns(value) {
  if (value === undefined || value === true) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.flatMap((v) => String(v).split(',')).map((s) => s.trim()).filter(Boolean);
}

/** Run the analysis pipeline for a directory. */
export function runAnalysis(dir, flags) {
  const cwd = resolve(dir ?? '.');
  if (!isRepo(cwd)) {
    throw new Error(`${cwd} is not inside a git work tree (run githeat from your repository)`);
  }
  const root = repoRoot(cwd);
  const commits = readHistory({
    cwd: root,
    since: flags.since ? String(flags.since) : undefined,
    until: flags.until ? String(flags.until) : undefined,
    author: flags.author ? String(flags.author) : undefined,
    rev: flags.rev ? String(flags.rev) : undefined,
    merges: Boolean(flags.merges),
  });
  const ignore = loadIgnore(root, flags);
  const report = analyze(commits, {
    minCommits: num(flags['min-commits'], DEFAULT_MIN_COMMITS),
    includeNoise: Boolean(flags['include-noise']),
    extensions: parseExtensions(flags.ext),
    ignoreMatcher: ignore.matcher,
    bands: parseBandMode(flags.bands),
  });
  if (commits.length === 0) {
    throw new Error(
      `no commit history found in ${root}${flags.since ? ` since ${flags.since}` : ''} — try a wider --since window or a different --rev`,
    );
  }
  const title = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  const comparison = flags.base
    ? compareToBase({
        cwd: root,
        base: String(flags.base),
        since: flags.since ? String(flags.since) : undefined,
        until: flags.until ? String(flags.until) : undefined,
        author: flags.author ? String(flags.author) : undefined,
        rev: flags.rev ? String(flags.rev) : undefined,
        merges: Boolean(flags.merges),
        minCommits: num(flags['min-commits'], DEFAULT_MIN_COMMITS),
        extensions: parseExtensions(flags.ext),
        ignoreMatcher: ignore.matcher,
        bands: parseBandMode(flags.bands),
      })
    : null;
  return {
    report,
    commits,
    root,
    title,
    rev: flags.rev ? String(flags.rev) : headSha(root) ?? 'HEAD',
    ignore,
    comparison,
  };
}

function payload({ report, title, root, rev, ignore, comparison }, flags) {
  return {
    tool: { name: pkg.name, version: pkg.version },
    generatedAt: new Date().toISOString(),
    repository: { root, name: title, rev },
    analysis: {
      range: describeRange(flags),
      since: flags.since ?? null,
      until: flags.until ?? null,
      author: flags.author ?? null,
      minCommits: num(flags['min-commits'], DEFAULT_MIN_COMMITS),
      includeNoise: Boolean(flags['include-noise']),
      bands: report.bands,
      bandCutoffs: report.bandCutoffs,
      ignoreFile: ignore?.source ?? null,
      ignorePatterns: ignore?.patterns ?? [],
    },
    ...(comparison ? { baseline: comparison } : {}),
    summary: report.summary,
    hotspots: report.files,
  };
}

function writeOut(outPath, content) {
  const target = resolve(String(outPath));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return target;
}

function openInBrowser(target) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target];
  spawnSync(cmd, args, { stdio: 'ignore', windowsHide: true });
}

function commandHeat(argv) {
  const { _: positional, flags } = parseArgs(argv);
  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const format = inferFormat(flags);
  const ctx = runAnalysis(positional[0], flags);
  const { report, title } = ctx;
  const palette = String(flags.palette ?? 'ember');
  const range = describeRange(flags);
  /** The baseline block, rendered after whichever table the format produces. */
  const baseline = () =>
    ctx.comparison ? renderComparison(ctx.comparison, { top: num(flags['baseline-top'], 8) }) : '';

  if (format === 'json') {
    const json = `${JSON.stringify(payload(ctx, flags), null, 2)}\n`;
    if (flags.out) {
      const target = writeOut(flags.out, json);
      process.stdout.write(`githeat: wrote ${target}\n`);
    } else {
      process.stdout.write(json);
    }
    return 0;
  }

  if (format === 'svg' || format === 'html') {
    const content =
      format === 'svg'
        ? renderSvg(report, { title, range, rev: ctx.rev, palette, maxTiles: num(flags.tiles, 140) })
        : renderHtml(report, { title, range, rev: ctx.rev, palette, maxTiles: num(flags.tiles, 140) });
    const out = flags.out ? String(flags.out) : `githeat-${title}.${format}`;
    const target = writeOut(out, content);
    process.stdout.write(
      `${renderTable(report, { top: num(flags.top, 10), color: shouldUseColor(), range, title })}` +
        `\ngitheat: wrote ${target}\n`,
    );
    if (flags.open && format === 'html') openInBrowser(target);
    return 0;
  }

  if (format === 'tree') {
    process.stdout.write(
      `${renderTable(report, { summaryOnly: true, color: shouldUseColor(), range, title })}` +
        renderTree(report, { color: shouldUseColor(), depth: num(flags.depth, 2), top: num(flags.top, 20) }) +
        baseline(),
    );
    return 0;
  }

  if (format !== 'table') throw new Error(`unknown --format ${format} (table, tree, json, svg, html)`);

  process.stdout.write(
    renderTable(report, {
      top: num(flags.top, 15),
      color: shouldUseColor(),
      range,
      title,
    }) + baseline(),
  );
  return 0;
}

function commandCheck(argv) {
  const { _: positional, flags } = parseArgs(argv);
  const ctx = runAnalysis(positional[0], flags);
  const { report, title } = ctx;
  const maxScore = flags['max-score'] === undefined ? null : num(flags['max-score'], null);
  const maxCritical = flags['max-critical'] === undefined ? null : num(flags['max-critical'], null);
  const hottest = report.files[0] ?? null;
  const critical = report.summary.bands.critical;

  const failures = [];
  if (maxScore !== null && hottest && hottest.score > maxScore) {
    failures.push(`hottest file scores ${hottest.score} > --max-score ${maxScore} (${hottest.path})`);
  }
  if (maxCritical !== null && critical > maxCritical) {
    failures.push(`${critical} critical files > --max-critical ${maxCritical}`);
  }

  if (flags.quiet) {
    process.stdout.write(
      failures.length === 0
        ? `githeat: ok (${report.summary.filesRanked} files, hottest ${hottest ? hottest.score : 0})\n`
        : `githeat: ${failures.length} threshold breach(es): ${failures.join('; ')}\n`,
    );
    return failures.length === 0 ? 0 : 1;
  }

  const lines = [];
  lines.push('');
  lines.push(`githeat ${pkg.version} · ${title} · ${describeRange(flags)}`);
  lines.push(
    `${report.summary.commits} commits · ${report.summary.filesRanked} ranked files · ${report.summary.churn} churn units`,
  );
  lines.push('');
  if (hottest) {
    lines.push(`hottest   ${hottest.score.toFixed(1)}  ${hottest.path}`);
    lines.push(`          ${hottest.commits} changes · churn ${hottest.churn} · ${hottest.authors} author(s) · last ${hottest.last.slice(0, 10)}`);
  } else {
    lines.push('hottest   none — not enough history yet');
  }
  lines.push(
    `bands     critical ${report.summary.bands.critical} · high ${report.summary.bands.high} · medium ${
      report.summary.bands.medium
    } · low ${report.summary.bands.low}`,
  );
  lines.push(`top 10    ${report.summary.top10Share}% of all churn`);
  lines.push('');
  if (!hottest) {
    lines.push(`WARN  no file reaches --min-commits ${num(flags['min-commits'], DEFAULT_MIN_COMMITS)} yet: not enough history`);
    lines.push('      to rank anything. Widen the window or lower --min-commits in CI.');
    lines.push('');
  }
  if (failures.length > 0) {
    for (const f of failures) lines.push(`FAIL  ${f}`);
    lines.push('');
    lines.push('Tip: refactor the hottest file, or relax the threshold with --max-score.');
  } else {
    lines.push('OK    no threshold breached');
  }
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
  return failures.length === 0 ? 0 : 1;
}

function commandInstallHook(argv) {
  const { _: positional, flags } = parseArgs(argv);
  const cwd = resolve(positional[0] ?? '.');
  if (!isRepo(cwd)) throw new Error(`${cwd} is not inside a git work tree`);
  const root = repoRoot(cwd);
  const hooksDir = join(root, '.git', 'hooks');
  const target = join(hooksDir, 'pre-commit');
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  if (existsSync(target) && !flags.force) {
    throw new Error(`${target} already exists — rerun with --force to overwrite it`);
  }
  const script = `#!/bin/sh
# Installed by githeat — prints a non-blocking hotspot reminder before each commit.
# Remove with: rm .git/hooks/pre-commit
githeat check --quiet --max-score 95 || true
`;
  writeFileSync(target, script, 'utf8');
  if (process.platform !== 'win32') {
    chmodSync(target, 0o755); // git only runs hooks that are executable
  }
  process.stdout.write(
    `githeat: installed ${target}\n` +
      'It runs `githeat check --quiet --max-score 95` and never blocks a commit unless the threshold breaks.\n',
  );
  return 0;
}

/**
 * `githeat review` — rank only the files a change touched.
 *
 * Designed for CI: reads a path list (file or stdin), prints a markdown comment
 * body. The GitHub Action in action/ is a thin wrapper around this.
 */
function commandReview(argv) {
  const { _: positional, flags } = parseArgs(argv);
  const ctx = runAnalysis(positional[0], flags);
  const source = flags.changed === undefined || flags.changed === true ? null : String(flags.changed);

  let stdinText = '';
  if (!source || source === '-') {
    try {
      stdinText = readFileSync(0, 'utf8'); // fd 0: works when piped, empty when interactive
    } catch {
      stdinText = '';
    }
  }
  const changed = readChangedList(source, stdinText);

  const result = reviewReport(ctx.report, changed, { limit: num(flags.top, 10) });
  const range = describeRange(flags);

  if (String(flags.format ?? 'markdown').toLowerCase() === 'json') {
    process.stdout.write(
      `${JSON.stringify(
        {
          repository: ctx.title,
          rev: ctx.rev,
          range,
          changed: changed.length,
          ranked: result.matched.length,
          average: result.average,
          verdict: result.verdict,
          hotspots: result.matched,
          notRanked: result.unmatched,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  process.stdout.write(
    `${renderReviewMarkdown(result, {
      repository: ctx.title,
      rev: ctx.rev,
      range,
      limit: num(flags.top, 10),
    })}\n`,
  );
  return 0;
}

/**
 * `githeat explain <path>` — why this file is (or is not) in the ranking.
 *
 * Its real job is the second case: making "it should not have ranked my file"
 * and "why is my file missing" reports cheap for the user and unambiguous to
 * answer.
 */
function commandExplain(argv) {
  const { _: positional, flags } = parseArgs(argv);
  if (positional.length === 0) {
    throw new Error('explain needs a file path, e.g. githeat explain src/index.js');
  }
  const target = positional[0].replace(/\\/g, '/').replace(/^\.\//, '');
  const ctx = runAnalysis(positional[1], flags);
  const exclusion = explainExclusion(target, {
    ignoreMatcher: ctx.ignore.matcher,
    extensions: parseExtensions(flags.ext),
    minCommits: num(flags['min-commits'], DEFAULT_MIN_COMMITS),
    stats: ctx.report.touched,
    includeNoise: Boolean(flags['include-noise']),
  });

  if (String(flags.format ?? 'text').toLowerCase() === 'json') {
    const file = ctx.report.files.find((f) => f.path === target) ?? null;
    process.stdout.write(
      `${JSON.stringify({ path: target, repository: ctx.title, rev: ctx.rev, range: describeRange(flags), exclusion, file }, null, 2)}\n`,
    );
    return 0;
  }

  process.stdout.write(
    renderExplanation({
      path: target,
      report: ctx.report,
      exclusion,
      history: ctx.commits,
      title: ctx.title,
      range: describeRange(flags),
    }),
  );
  return 0;
}

/**
 * `githeat init` — write a starter .githeatignore.
 *
 * Deliberately all comments: a template with active rules would silently change
 * everyone's ranking the moment it is committed.
 */
function commandInit(argv) {
  const { _: positional, flags } = parseArgs(argv);
  const cwd = resolve(positional[0] ?? '.');
  if (!isRepo(cwd)) throw new Error(`${cwd} is not inside a git work tree`);
  const root = repoRoot(cwd);
  const target = join(root, IGNORE_FILE);

  if (existsSync(target) && !flags.force) {
    const existing = readFileSync(target, 'utf8');
    const rules = parseIgnoreText(existing).length;
    process.stdout.write(
      `${target} already exists (${rules} active pattern${rules === 1 ? '' : 's'}).\n` +
        'Edit it, or rerun with --force to replace it with the starter file.\n',
    );
    return 0;
  }

  writeFileSync(target, IGNORE_TEMPLATE, 'utf8');
  process.stdout.write(
    `${flags.force && existsSync(target) ? 'Replaced' : 'Created'} ${target}\n` +
      'It is all comments, so your ranking will not change until you add a pattern.\n' +
      'Ranking a file you never want to see again? Add its path, then:\n' +
      `  node bin/githeat.mjs heat ${root === cwd ? '.' : root} --top 5\n`,
  );
  return 0;
}

/**
 * `githeat lines <path>` — where inside one file the churn sits.
 *
 * Fails fast on a partial clone: blame would fetch every historical blob from the
 * network, one file at a time, and then fail anyway.
 */
function commandLines(argv) {
  const { _: positional, flags } = parseArgs(argv);
  if (positional.length === 0) {
    throw new Error('lines needs a file path, e.g. githeat lines src/index.js');
  }
  const file = positional[0].replace(/\\/g, '/').replace(/^\.\//, '');
  const cwd = resolve(positional[1] ?? '.');
  if (!isRepo(cwd)) throw new Error(`${cwd} is not inside a git work tree`);
  const root = repoRoot(cwd);

  if (isPartialClone(root)) {
    throw new Error(
      'this is a partial clone (blob:none), so line history would have to be fetched from the network file by file. ' +
        'Run `git fetch --refetch --filter=blob:limit=1m` or use a full clone, then try again.',
    );
  }

  const result = readLineAges({ cwd: root, file, rev: flags.rev ? String(flags.rev) : 'HEAD' });

  if (String(flags.format ?? 'text').toLowerCase() === 'json') {
    process.stdout.write(
      `${JSON.stringify(
        {
          file,
          total: result.total,
          buckets: AGE_BUCKETS.map((bucket, i) => ({ bucket: bucket.label, lines: result.counts[i] })),
          oldest: result.oldest,
          newest: result.newest,
          regions: result.regions,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  process.stdout.write(
    renderLineReport(result, {
      title: root.split(/[\\/]/).filter(Boolean).pop() ?? root,
      range: flags.rev ? String(flags.rev) : 'HEAD',
      showMap: Boolean(flags.map),
    }),
  );
  return 0;
}

export function main(argv) {
  const [first, ...rest] = argv;
  if (first === '--version' || first === '-v') {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (first === '--help' || first === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    if (first === 'check') return commandCheck(rest);
    if (first === 'review') return commandReview(rest);
    if (first === 'explain') return commandExplain(rest);
    if (first === 'lines') return commandLines(rest);
    if (first === 'init') return commandInit(rest);
    if (first === 'install-hook') return commandInstallHook(rest);
    if (first === 'help') {
      process.stdout.write(HELP);
      return 0;
    }
    if (first === 'heat') return commandHeat(rest);
    return commandHeat(argv);
  } catch (err) {
    process.stderr.write(`githeat: ${err.message}\n`);
    return 2;
  }
}
