/**
 * Self-contained SVG heatmap: one tile per file, colour = hotspot score,
 * area = churn. No <script>, no external fonts, embeds in any README.
 */
import { colorForScore, contrastText, shade, legendStops } from './colors.mjs';
import { squarify, topTiles } from './treemap.mjs';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const fmtDate = (iso) => (iso ? iso.slice(0, 10) : 'n/a');

const truncate = (s, max) => (s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`);

/**
 * @param {object} report  result of analyze()
 * @param {object} [opts]
 * @param {string} [opts.title]     project name for the header
 * @param {string} [opts.palette]   ember | viridis | mono
 * @param {number} [opts.width]
 * @param {number} [opts.maxTiles]
 * @param {string} [opts.range]     human readable time range
 * @param {string} [opts.rev]
 */
export function renderSvg(report, opts = {}) {
  const {
    width = 1200,
    palette = 'ember',
    title = 'repository',
    range = 'all time',
    rev = 'HEAD',
    maxTiles = 140,
    showLegend = true,
  } = opts;

  const { files, summary } = report;
  const headerH = 78;
  const legendH = showLegend ? 74 : 0;
  const pad = 16;
  const mapH = Math.max(240, Math.round(width * 0.5));
  const height = headerH + mapH + legendH + pad;

  const tiles = squarify(
    topTiles(files, maxTiles).map((f) => ({ ...f, value: f.churn, label: f.label ?? f.path })),
    { x: pad, y: headerH, w: width - pad * 2, h: mapH - pad },
    { gap: 2 },
  );

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(
      `${title} hotspot heatmap`,
    )}" font-family="ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#0d1117"/>`);

  // ---- header -------------------------------------------------------------
  parts.push(
    `<text x="${pad}" y="34" fill="#f0f6fc" font-size="24" font-weight="700" letter-spacing="-0.2">${esc(title)}</text>`,
  );
  parts.push(
    `<text x="${pad}" y="58" fill="#8b949e" font-size="13">${esc(
      `${summary.commits} commits · ${summary.filesRanked} files ranked · ${fmt(summary.churn)} churn · ${summary.authors} authors · ${range} @ ${rev}`,
    )}</text>`,
  );
  parts.push(
    `<text x="${width - pad}" y="34" fill="#f0f6fc" font-size="13" font-weight="600" text-anchor="end">githeat hotspot map</text>`,
  );
  parts.push(
    `<text x="${width - pad}" y="58" fill="#8b949e" font-size="12" text-anchor="end">top 10 files = ${summary.top10Share}% of all churn</text>`,
  );

  // ---- tiles --------------------------------------------------------------
  for (const t of tiles) {
    const score = t.item.score ?? 0;
    const color = colorForScore(score, palette);
    const text = contrastText(color);
    const x = round(t.x);
    const y = round(t.y);
    const w = round(t.w);
    const h = round(t.h);
    if (w < 1 || h < 1) continue;
    const tip = `${t.item.path}\nscore ${score} · ${t.item.commits} changes · churn ${t.item.churn}${
      t.item.authors ? ` · ${t.item.authors} author${t.item.authors > 1 ? 's' : ''}` : ''
    }\nlast change ${fmtDate(t.item.last)}`;
    parts.push(`<g><title>${esc(tip)}</title>`);
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${color}" stroke="${shade(color, -0.45)}" stroke-width="1"/>`,
    );
    if (w > 46 && h > 22) {
      const fs = w > 150 && h > 60 ? 13 : 11;
      const maxChars = Math.floor((w - 10) / (fs * 0.56));
      const name = t.item.path.split('/').pop();
      const dir = t.item.path.split('/').slice(0, -1).join('/');
      const lines = [];
      if (h > 44 && dir) lines.push({ text: truncate(dir, maxChars), size: fs - 1, opacity: 0.72 });
      lines.push({ text: truncate(name, maxChars), size: fs, weight: 600, opacity: 1 });
      lines.push({ text: `${score}`, size: fs - 1, weight: 700, opacity: 0.9 });
      let ly = y + (h - lines.length * (fs + 3)) / 2 + fs;
      for (const line of lines) {
        if (ly > y + h - 2) break;
        parts.push(
          `<text x="${x + 6}" y="${round(ly)}" fill="${text}" font-size="${line.size}" font-weight="${line.weight ?? 400}" opacity="${line.opacity}">${esc(
            line.text,
          )}</text>`,
        );
        ly += fs + 3;
      }
    }
    parts.push('</g>');
  }

  // ---- band strip + legend ------------------------------------------------
  if (showLegend) {
    const y = headerH + mapH + 6;
    const bandColors = {
      critical: colorForScore(85, palette),
      high: colorForScore(55, palette),
      medium: colorForScore(30, palette),
      low: colorForScore(8, palette),
    };
    const order = ['critical', 'high', 'medium', 'low'];
    const ranked = summary.filesRanked || 1;
    let x = pad;
    const barW = Math.min(width * 0.42, 480);
    const barH = 10;
    for (const band of order) {
      const share = summary.bands[band] / ranked;
      const w = Math.max(0, share * barW);
      if (w < 0.8) continue;
      parts.push(
        `<rect x="${round(x)}" y="${y + 20}" width="${round(w)}" height="${barH}" fill="${bandColors[band]}"><title>${band}: ${
          summary.bands[band]
        } files (${Math.round(share * 100)}%)</title></rect>`,
      );
      if (w > 54) {
        parts.push(
          `<text x="${round(x + w / 2)}" y="${y + 45}" fill="#8b949e" font-size="10" text-anchor="middle">${band} ${Math.round(
            share * 100,
          )}%</text>`,
        );
      }
      x += w;
    }
    parts.push(
      `<text x="${pad}" y="${y + 12}" fill="#c9d1d9" font-size="11" font-weight="600">risk distribution across ${summary.filesRanked} ranked files</text>`,
    );

    // colour scale
    const stops = legendStops(palette, 7);
    const sw = Math.min(300, width * 0.22);
    const sx = width - pad - sw;
    for (let i = 0; i < stops.length; i += 1) {
      const w = sw / stops.length;
      parts.push(
        `<rect x="${round(sx + i * w)}" y="${y + 20}" width="${round(w + 0.6)}" height="${barH}" fill="${stops[i].color}"/>`,
      );
    }
    parts.push(
      `<text x="${round(sx)}" y="${y + 45}" fill="#8b949e" font-size="10">0 low risk</text>` +
        `<text x="${round(sx + sw)}" y="${y + 45}" fill="#8b949e" font-size="10" text-anchor="end">100 critical</text>`,
    );
    parts.push(
      `<text x="${round(sx)}" y="${y + 12}" fill="#c9d1d9" font-size="11" font-weight="600">hotspot score</text>` +
        `<text x="${round(sx + sw)}" y="${y + 12}" fill="#6e7681" font-size="10" text-anchor="end">area = churn</text>`,
    );
  }

  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}

const round = (n) => Math.round(n * 100) / 100;

export { esc as escapeXml, fmt as formatNumber };
