/**
 * Turn raw commit history into per-file hotspot metrics.
 *
 * A hotspot is a file that changes often *and* is expensive to change.
 * Churn alone is misleading (a lockfile changes constantly but nobody
 * debugs it), so we filter noise, normalise against the repository's own
 * distribution and blend two signals:
 *
 *   churn       how many lines this file keeps costing the team
 *   changes     how often the file is reopened (the better predictor of defects)
 */

/** Paths that are generated, vendored or otherwise not hand-edited. */
const NOISE_PATTERNS = [
  /(^|\/)(node_modules|vendor|third_party|dist|build|out|target|coverage|\.next|\.nuxt|\.venv|venv|__pycache__)\//i,
  /(^|\/)\.git\//,
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|go\.sum|bun\.lockb?)$/i,
  /\.(min\.js|min\.css|map|snap|lock|svg|png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp4|mov|wasm|so|dll|exe|dylib|bin|class|jar|pyc|ipynb_checkpoints)$/i,
  /(^|\/)(\.eslintcache|\.DS_Store|Thumbs\.db)$/i,
];

export function isNoisePath(path) {
  return NOISE_PATTERNS.some((re) => re.test(path));
}

/** Files whose churn is below this are usually not worth flagging. */
export const DEFAULT_MIN_COMMITS = 2;

/**
 * Extensions worth scoring by default.
 *
 * Without this the ranking is dominated by package.json / readme.md / lockfiles:
 * they are edited constantly but nobody debugs them. Code is what rots quietly,
 * so code is what we score unless the caller says otherwise.
 */
export const DEFAULT_EXTENSIONS = [
  // web / node
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro',
  // systems / jvm / mobile
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'java', 'kt', 'kts', 'swift', 'm', 'mm', 'scala', 'groovy',
  // scripting / data
  'py', 'rb', 'php', 'pl', 'pm', 'lua', 'r', 'jl', 'dart', 'ex', 'exs', 'erl', 'hs', 'ml', 'clj', 'cljs',
  // web-ish and shell
  'go', 'rs', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'proto', 'tf', 'gradle',
];

const extOf = (path) => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
};

/**
 * Build the "should this file be scored" predicate.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeNoise=false]
 * @param {string[]|null} [opts.extensions]  null/undefined = DEFAULT_EXTENSIONS, [] = every file
 */
export function makeFileFilter({ includeNoise = false, extensions } = {}) {
  const extSet =
    extensions === undefined || extensions === null
      ? new Set(DEFAULT_EXTENSIONS)
      : new Set(extensions.map((e) => String(e).replace(/^\./, '').toLowerCase()));
  const anyExt = extSet.size === 0;
  return (path) => {
    if (!includeNoise && isNoisePath(path)) return false;
    if (anyExt) return true;
    return extSet.has(extOf(path));
  };
}

/** Parse a comma-separated --ext value. Empty string means "every file". */
export function parseExtensions(value) {
  if (value === true || value === undefined || value === null) return undefined;
  const parts = String(value)
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
  return parts; // [] -> all files
}

/**
 * Build a "shape" function that maps a raw value to 0..1 using a log scale
 * anchored at the repository's own heavy tail. This keeps one gigantic
 * generated file from flattening everything else to zero.
 */
export function makeScaler(values, { anchorPercentile = 0.9 } = {}) {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return () => 0;
  const idx = Math.min(positive.length - 1, Math.max(0, Math.round(anchorPercentile * (positive.length - 1))));
  const anchor = Math.max(1, positive[idx]);
  const logMax = Math.log1p(anchor);
  return (v) => (v <= 0 ? 0 : Math.min(1, Math.log1p(v) / logMax));
}

const daysBetween = (aIso, bIso) => {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0; // never let a bad date poison the score
  return Math.abs(b - a) / 86400000;
};

/**
 * @param {Array<{sha:string,date:string,author:string,files:string[]}>} commits
 * @param {object} [opts]
 * @param {number} [opts.minCommits=2]  ignore files touched fewer times
 * @param {number} [opts.now=Date.now()] reference time for recency weighting
 * @param {boolean} [opts.includeNoise=false]
 * @param {string[]} [opts.extensions]  undefined = DEFAULT_EXTENSIONS, [] = every file
 * @param {'absolute'|'percentile'|'auto'} [opts.bands='absolute']  how risk bands are cut
 */
export function analyze(commits, opts = {}) {
  const { minCommits = DEFAULT_MIN_COMMITS, now = Date.now(), includeNoise = false, extensions, bands = 'absolute' } = opts;
  const keep = makeFileFilter({ includeNoise, extensions });

  /** @type {Map<string, {path:string,commits:number,churn:number,authors:Set<string>,first:string,last:string}>} */
  const stats = new Map();
  let noiseCommits = 0;

  for (const commit of commits) {
    for (const path of commit.files) {
      if (!keep(path)) {
        noiseCommits += 1;
        continue;
      }
      let entry = stats.get(path);
      if (!entry) {
        entry = { path, commits: 0, churn: 0, authors: new Set(), first: commit.date, last: commit.date };
        stats.set(path, entry);
      }
      entry.commits += 1;
      // `--name-only` gives us one line per changed path: churn == files changed
      // per commit, summed. It is an honest, cheap proxy for edit pressure.
      entry.churn += 1;
      entry.authors.add(commit.author);
      if (commit.date < entry.first) entry.first = commit.date;
      if (commit.date > entry.last) entry.last = commit.date;
    }
  }

  const all = [...stats.values()];
  const ranked = all.filter((f) => f.commits >= minCommits);
  const bandMode = resolveBandMode(bands, ranked.length);
  const churnScaler = makeScaler(all.map((f) => f.churn));
  const changeScaler = makeScaler(all.map((f) => f.commits));

  const files = ranked
    .map((f) => {
      const churnScore = churnScaler(f.churn);
      const changeScore = changeScaler(f.commits);
      const base = 0.68 * churnScore + 0.32 * changeScore;

      // A file untouched for a long time is less urgent than a fresh one.
      const ageDays = daysBetween(f.last, new Date(now).toISOString());
      const recency = 1 - 0.2 * Math.min(1, ageDays / 365);

      const score = Math.round(100 * base * recency * 10) / 10;
      return {
        path: f.path,
        commits: f.commits,
        churn: f.churn,
        authors: f.authors.size,
        first: f.first,
        last: f.last,
        ageDays: Math.round(ageDays),
        score,
      };
    })
    .sort((a, b) => b.score - a.score || b.churn - a.churn || a.path.localeCompare(b.path));

  const bandCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  const thresholds = bandMode === 'percentile' ? PERCENTILE_BANDS : ABSOLUTE_BANDS;
  files.forEach((f, rank) => {
    f.band = bandFromThresholds(f.score, thresholds, rank, files.length);
    f.rank = rank + 1;
    bandCounts[f.band] += 1;
  });

  const authors = new Map();
  for (const c of commits) authors.set(c.author, (authors.get(c.author) ?? 0) + 1);

  const dates = commits.map((c) => c.date).sort();
  const totalChurn = files.reduce((sum, f) => sum + f.churn, 0);

  return {
    files,
    bands: bandMode,
    bandCutoffs: bandMode === 'percentile' ? percentileCutoffs(files) : { ...ABSOLUTE_BANDS },
    summary: {
      commits: commits.length,
      filesTouched: stats.size,
      filesRanked: files.length,
      authors: authors.size,
      topAuthors: [...authors.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count })),
      churn: totalChurn,
      noiseEntries: noiseCommits,
      firstCommit: dates[0] ?? null,
      lastCommit: dates[dates.length - 1] ?? null,
      bands: bandCounts,
      // How concentrated is the pain? Share of churn in the top 10 files.
      top10Share: totalChurn === 0 ? 0 : Math.round((files.slice(0, 10).reduce((s, f) => s + f.churn, 0) / totalChurn) * 1000) / 10,
    },
  };
}

/**
 * Absolute bands. Fine for small repositories, but on a 6 500-commit project
 * almost the whole distribution sits above 20, so nearly everything lands in
 * `medium` or worse and the bands stop discriminating. See `percentileBand`.
 */
export const ABSOLUTE_BANDS = { critical: 70, high: 45, medium: 20 };
export const PERCENTILE_BANDS = { critical: 0.05, high: 0.15, medium: 0.4 };

/** Repositories with at least this many ranked files get percentile bands under `auto`. */
export const AUTO_PERCENTILE_FROM = 50;

export function bandOf(score, mode = 'absolute', rankedCount = Infinity) {
  if (resolveBandMode(mode, rankedCount) === 'percentile') return bandFromThresholds(score, PERCENTILE_BANDS);
  return bandFromThresholds(score, ABSOLUTE_BANDS);
}

export function resolveBandMode(mode = 'absolute', rankedCount = Infinity) {
  if (mode === 'auto') return rankedCount >= AUTO_PERCENTILE_FROM ? 'percentile' : 'absolute';
  return mode === 'percentile' ? 'percentile' : 'absolute';
}

/**
 * Band a score by its rank rather than its value: the top 5 % of ranked files
 * are `critical`, the next 10 % `high`, the next 25 % `medium`, the rest `low`.
 *
 * `thresholds` must be of the same kind as the comparison: share thresholds
 * (all < 1, e.g. PERCENTILE_BANDS) are only ever used against rank shares, and
 * score thresholds (e.g. ABSOLUTE_BANDS) only against scores. Mixing the two
 * silently bands every file the same way — the bug that made the first version
 * of this function report 100 % `critical`.
 */
export function bandFromThresholds(score, thresholds, rank = null, total = null) {
  const isShareScale = thresholds.critical < 1;
  if (rank !== null && total && isShareScale) {
    const share = rank / total;
    if (share < thresholds.critical) return 'critical';
    if (share < thresholds.high) return 'high';
    if (share < thresholds.medium) return 'medium';
    return 'low';
  }
  if (score >= thresholds.critical) return 'critical';
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  return 'low';
}

/** Percentile thresholds expressed as absolute score cut-offs, for display. */
export function percentileCutoffs(files) {
  const n = files.length;
  if (n === 0) return { ...ABSOLUTE_BANDS };
  const at = (q) => files[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))].score;
  return { critical: at(PERCENTILE_BANDS.critical), high: at(PERCENTILE_BANDS.high), medium: at(PERCENTILE_BANDS.medium) };
}

/** Compact a flat file list into a nested tree for treemap layout / tree output. */
export function buildTree(files) {
  const root = { name: '', path: '', children: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i];
      let child = node.children.get(name);
      if (!child) {
        child = { name, path: parts.slice(0, i + 1).join('/'), children: new Map(), files: [] };
        node.children.set(name, child);
      }
      node = child;
    }
    node.files.push({ ...file, name: parts[parts.length - 1] });
  }
  return root;
}

/** A node's weight is the churn of everything beneath it. */
export function treeWeight(node) {
  if (node.weight !== undefined) return node.weight;
  let weight = node.files.reduce((sum, f) => sum + f.churn, 0);
  for (const child of node.children.values()) weight += treeWeight(child);
  node.weight = weight;
  return weight;
}
