/**
 * Line-level view of one file: where inside a 1 300-line hotspot the churn
 * actually sits.
 *
 * `githeat heat` answers "which file". For a file with 305 changes that is only
 * half an answer — the reader still has to guess which part of it is the problem.
 * This module answers the other half.
 *
 * Two limits are built into the design rather than hidden:
 *
 * 1. **`git blame` reports the last commit that touched each line, not how many
 *    times it was touched.** So this is a staleness map, not a churn-per-line
 *    map, and it is labelled that way everywhere it appears. A region of very old
 *    lines is "untouched for a long time", which is not the same as "stable
 *    because it is correct".
 * 2. **Blame needs blobs.** On a `--filter=blob:none` clone — increasingly the
 *    default for large repositories — git tries to fetch every historical blob
 *    from the network. That takes tens of seconds per file and then fails. The
 *    cheap preflight below turns that into an immediate, actionable message.
 */
import { spawnSync } from 'node:child_process';

/**
 * Age buckets, in days.
 *
 * Six rather than four because real files are old: with a single "older than a
 * year" bucket, a 400-day line and a 6-year line look identical, and they are
 * not the same kind of problem. The scale roughly doubles so the histogram stays
 * readable on a file that spans a decade.
 */
export const AGE_BUCKETS = [
  { label: 'last week', maxDays: 7 },
  { label: 'last month', maxDays: 30 },
  { label: 'last quarter', maxDays: 90 },
  { label: 'last year', maxDays: 365 },
  { label: 'last 2 years', maxDays: 730 },
  { label: 'older', maxDays: Infinity },
];

/** Longest run of consecutive lines in the same bucket that is worth reporting. */
export const MIN_REGION_LINES = 8;

const DAY = 86400000;

export const bucketOf = (ageDays) => AGE_BUCKETS.findIndex((b) => ageDays <= b.maxDays);

/**
 * True when this clone fetches blobs on demand, which makes blame unusable.
 * One config read, no network.
 */
export function isPartialClone(cwd = process.cwd()) {
  const res = spawnSync('git', ['-C', cwd, 'config', '--get', 'remote.origin.partialclonefilter'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return res.status === 0 && Boolean((res.stdout ?? '').trim());
}

/**
 * Parse `git blame --line-porcelain` output.
 *
 * Each line of the file produces a header (`<sha> <origLine> <finalLine> [<n>]`)
 * followed by metadata, so the header is what carries position and the metadata
 * is what carries the date. Reading dates per line instead of once per commit
 * costs a hash lookup and keeps this function a pure text transform.
 */
export function parseBlame(porcelain) {
  const dates = new Map();
  const lines = [];
  for (const raw of String(porcelain ?? '').split('\n')) {
    const header = raw.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)(?:\s+\d+)?$/);
    if (header) {
      lines.push({ sha: header[1], line: Number(header[2]), date: null });
      continue;
    }
    const time = raw.match(/^author-time\s+(\d+)$/);
    if (time && lines.length > 0) {
      const current = lines[lines.length - 1];
      dates.set(current.sha, Number(time[1]) * 1000);
    }
  }
  for (const line of lines) line.date = dates.get(line.sha) ?? null;
  return lines.filter((l) => l.date !== null);
}

/**
 * Group consecutive lines that share an age bucket.
 * @returns {Array<{from:number,to:number,lines:number,bucket:number,label:string,sha:string,date:number}>}
 */
export function regionsOf(lines) {
  const regions = [];
  let current = null;
  for (const line of lines) {
    const bucket = bucketOf(line.ageDays);
    if (current && current.bucket === bucket && current.to === line.line - 1) {
      current.to = line.line;
      current.lines += 1;
      continue;
    }
    if (current && current.lines >= MIN_REGION_LINES) regions.push(current);
    current = {
      from: line.line,
      to: line.line,
      lines: 1,
      bucket,
      label: AGE_BUCKETS[bucket].label,
      sha: line.sha,
      date: line.date,
      ageDays: line.ageDays,
    };
  }
  if (current && current.lines >= MIN_REGION_LINES) regions.push(current);
  return regions;
}

/**
 * Read one file's line history.
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} opts.path        repo-relative path, or '*' for every tracked file
 * @param {number} [opts.now]
 * @param {string} [opts.rev='HEAD']
 * @returns {{lines:object[], counts:number[], total:number, oldest:object|null, newest:object|null}}
 */
export function readLineAges({ cwd, file, rev = 'HEAD', now = Date.now() }) {
  const res = spawnSync('git', ['-C', cwd, 'blame', '--line-porcelain', rev, '--', file], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    windowsHide: true,
  });
  if (res.status !== 0) {
    const detail = (res.stderr || '').trim().split('\n')[0] || `exit code ${res.status}`;
    throw new Error(`git blame failed for ${file}: ${detail}`);
  }

  const lines = parseBlame(res.stdout).map((line) => ({
    ...line,
    ageDays: Math.max(0, Math.floor((now - line.date) / DAY)),
  }));

  const counts = AGE_BUCKETS.map(() => 0);
  for (const line of lines) counts[bucketOf(line.ageDays)] += 1;

  const sorted = [...lines].sort((a, b) => b.ageDays - a.ageDays);
  return {
    file,
    lines,
    counts,
    total: lines.length,
    oldest: sorted[0] ?? null,
    newest: sorted[sorted.length - 1] ?? null,
    regions: regionsOf(lines),
  };
}

/** One character per bucket, for the per-line column and the histogram bar. */
export const BUCKET_GLYPH = ['#', '+', '-', '.', ' '];

const bar = (count, total, width = 34) => {
  if (total === 0) return '';
  const filled = Math.max(count > 0 ? 1 : 0, Math.round((count / total) * width));
  return '█'.repeat(filled);
};

/**
 * Merge neighbouring regions that share a coarse property (both old, or both
 * fresh). "Lines 1-180 have not been touched in a year" is the sentence a reader
 * wants; "lines 1-120 are 500 days old, lines 121-180 are 200 days old" makes
 * them do the addition themselves.
 */
function mergeAdjacent(regions) {
  const sorted = [...regions].sort((a, b) => a.from - b.from);
  const merged = [];
  for (const region of sorted) {
    const last = merged[merged.length - 1];
    if (last && region.from === last.to + 1) {
      last.to = region.to;
      last.lines += region.lines;
      continue;
    }
    merged.push({ ...region });
  }
  return merged;
}

/**
 * Bounded, readable report.
 *
 * A 1 340-line file printed in full is not a report, it is a wall — so the
 * default output is a histogram plus the largest untouched and largest fresh
 * regions, which is what the question "where is the churn in this file"
 * actually needs. `--map` asks for the per-line column when someone really
 * wants to see the shape.
 */
export function renderLineReport(result, { title = '', range = 'all time', showMap = false, maxRegions = 6 } = {}) {
  const { file, counts, total, oldest, newest, regions } = result;
  const lines = [''];
  lines.push(`${file}`);
  lines.push(`${title ? `${title} · ` : ''}${range} · ${total} lines tracked by blame`);
  lines.push('');

  if (total === 0) {
    lines.push('  no lines attributed — is this file tracked at HEAD?');
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  lines.push('age of each line, by the commit that last touched it:');
  counts.forEach((count, i) => {
    const pct = ((count / total) * 100).toFixed(0).padStart(3);
    lines.push(`  ${AGE_BUCKETS[i].label.padEnd(13)} ${String(count).padStart(5)}  ${pct}%  ${bar(count, total)}`);
  });
  lines.push('');

  const oldRegions = mergeAdjacent(regions.filter((r) => r.bucket >= 3)).sort((a, b) => b.lines - a.lines);
  const newRegions = mergeAdjacent(regions.filter((r) => r.bucket <= 1)).sort((a, b) => b.lines - a.lines);
  const all = [...regions].sort((a, b) => b.lines - a.lines).slice(0, maxRegions);

  if (regions.length > 0) {
    lines.push(`largest contiguous regions (>= ${MIN_REGION_LINES} lines):`);
    for (const region of all) {
      lines.push(
        `  lines ${String(region.from).padStart(5)}-${String(region.to).padEnd(5)} ${String(region.lines).padStart(4)} lines  ${region.label}`,
      );
    }
    lines.push('');
  }

  if (oldRegions.length > 0) {
    const r = oldRegions[0];
    lines.push(`most untouched: lines ${r.from}-${r.to} (${r.lines} lines) — nothing here for about ${r.ageDays} days`);
  }
  if (newRegions.length > 0) {
    const r = newRegions[0];
    lines.push(`newest work:    lines ${r.from}-${r.to} (${r.lines} lines) — last touched ${r.ageDays} days ago`);
  }
  if (oldest && newest) {
    lines.push(`oldest line ${oldest.line} (${oldest.ageDays}d), newest line ${newest.line} (${newest.ageDays}d)`);
  }
  lines.push('');

  if (showMap) {
    lines.push('per-line map (each character is one line, in file order):');
    const width = 100;
    const legend = AGE_BUCKETS.map((b, i) => `${BUCKET_GLYPH[i]} ${b.label}`).join('   ');
    lines.push(`  ${legend}`);
    lines.push('');
    for (let i = 0; i < result.lines.length; i += width) {
      const chunk = result.lines.slice(i, i + width);
      const glyphs = chunk.map((l) => BUCKET_GLYPH[bucketOf(l.ageDays)]).join('');
      lines.push(`  ${String(i + 1).padStart(5)}  ${glyphs}`);
    }
    lines.push('');
  }

  lines.push('  blame reports the last commit per line, so this is a staleness map:');
  lines.push('  "untouched for a long time" is not the same as "stable because it is correct".');
  lines.push('');
  return `${lines.join('\n')}\n`;
}
