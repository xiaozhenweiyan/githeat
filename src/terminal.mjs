/**
 * Terminal renderer: an ANSI "heat table" plus a directory-tree rollup.
 * Pure text, 24-bit colour when the terminal supports it, plain otherwise.
 */

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
};

/** Score -> ANSI truecolor. Mirrors the SVG ember palette. */
const RAMP = [
  [18, 50, 79],
  [26, 111, 143],
  [34, 168, 132],
  [168, 201, 58],
  [242, 177, 52],
  [242, 112, 29],
  [215, 38, 61],
];

function rgbFor(score) {
  const t = Math.max(0, Math.min(1, score / 100));
  const pos = t * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(pos));
  const f = pos - i;
  return RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f));
}

export function shouldUseColor(stream = process.stdout) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream.isTTY);
}

const style = (text, code, color) => (color ? `${code}${text}${ANSI.reset}` : text);
export const bold = (text, color) => style(text, ANSI.bold, color);
export const dim = (text, color) => style(text, ANSI.dim, color);

function paint(text, score, color) {
  if (!color) return text;
  const [r, g, b] = rgbFor(score);
  return `\u001b[38;2;${r};${g};${b}m${text}${ANSI.reset}`;
}

function bar(score, width = 12) {
  const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const fmt = (n) => (n >= 1000000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function humanAge(days) {
  if (days <= 0) return 'today';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function truncate(s, max) {
  if (max < 8 || s.length <= max) return s;
  const keep = max - 1;
  const head = s.slice(0, Math.ceil(keep * 0.55));
  const tail = s.slice(s.length - Math.floor(keep * 0.45));
  return `${head}…${tail}`;
}

/**
 * @param {object} report
 * @param {object} [opts]
 * @param {number} [opts.top=15]
 * @param {boolean} [opts.color]
 * @param {boolean} [opts.header=true]
 * @param {boolean} [opts.summaryOnly=false]  header/summary block without rows
 * @param {string} [opts.range]
 * @param {string} [opts.title]
 */
export function renderTable(report, opts = {}) {
  const {
    top = 15,
    color = shouldUseColor(),
    header = true,
    summaryOnly = false,
    range = 'all time',
    title = '',
  } = opts;
  const { files, summary } = report;
  const lines = [];
  const width = Math.min(140, Math.max(96, (process.stdout.columns || 110) - 2));

  if (header) {
    lines.push('');
    lines.push(
      `${bold(title || 'repository', color)} ${dim(
        `${range} · ${summary.commits} commits · ${summary.filesRanked} files · ${summary.authors} authors · ${fmt(
          summary.churn,
        )} churn`,
        color,
      )}`,
    );
    if (summary.top10Share >= 40) {
      lines.push(
        `${dim(`top 10 files hold ${summary.top10Share}% of all churn — `, color)}${paint(
          'concentrated risk',
          summary.top10Share,
          color,
        )}`,
      );
    }
    lines.push('');
  }

  if (files.length === 0) {
    lines.push('No hotspots found. Try --min-commits 1 or a wider --since window.');
    return `${lines.join('\n')}\n`;
  }

  if (summaryOnly) return `${lines.join('\n')}\n`;

  const rankW = 4;
  const scoreW = 5;
  const barW = 12;
  const numW = 8;
  const fixed = rankW + scoreW + barW + numW * 2 + 4 * 2 + 4 * 3;
  const pathW = Math.max(24, width - fixed);

  const head = [
    '#'.padStart(rankW),
    'score'.padStart(scoreW),
    'heat'.padEnd(barW),
    'changes'.padStart(numW),
    'churn'.padStart(numW),
    'auth'.padStart(4),
    'last'.padStart(4),
    'file'.padEnd(pathW),
  ].join('  ');
  lines.push(dim(head, color));
  lines.push(dim('-'.repeat(Math.min(width, head.length)), color));

  for (const [i, f] of files.slice(0, top).entries()) {
    const rank = String(i + 1).padStart(rankW);
    const score = String(f.score.toFixed(1)).padStart(scoreW);
    const heat = paint(bar(f.score, barW), f.score, color);
    lines.push(
      [
        dim(rank, color),
        paint(score, f.score, color),
        heat,
        String(f.commits).padStart(numW),
        fmt(f.churn).padStart(numW),
        String(f.authors).padStart(4),
        humanAge(f.ageDays).padStart(4),
        truncate(f.path, pathW).padEnd(pathW),
      ].join('  '),
    );
  }

  if (files.length > top) {
    lines.push(dim(`… ${files.length - top} more files (--top ${files.length} to see all)`, color));
  }

  const { bands } = summary;
  lines.push('');
  lines.push(
    `${dim('bands:', color)} ${paint(`critical ${bands.critical}`, 85, color)} ${paint(
      `high ${bands.high}`,
      55,
      color,
    )} ${paint(`medium ${bands.medium}`, 30, color)} ${paint(`low ${bands.low}`, 8, color)}`,
  );
  return `${lines.join('\n')}\n`;
}

/** Directory rollup: which folders own the churn. */
export function renderTree(report, opts = {}) {
  const { color = shouldUseColor(), depth = 2, top = 20 } = opts;
  const groups = new Map();
  for (const f of report.files) {
    const parts = f.path.split('/');
    const dir = parts.length === 1 ? '.' : parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
    const g = groups.get(dir) ?? { dir, churn: 0, commits: 0, files: 0, score: 0 };
    g.churn += f.churn;
    g.commits += f.commits;
    g.files += 1;
    g.score = Math.max(g.score, f.score);
    groups.set(dir, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.churn - a.churn).slice(0, top);
  const lines = [''];
  const maxChurn = rows[0]?.churn ?? 1;
  for (const g of rows) {
    const w = Math.max(1, Math.round((g.churn / maxChurn) * 24));
    lines.push(
      `${paint('█'.repeat(w), g.score, color)} ${String(g.files).padStart(4)} files ${fmt(g.churn).padStart(
        7,
      )} churn  ${g.dir}`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
