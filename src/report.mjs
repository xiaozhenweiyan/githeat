/**
 * Single-file HTML report: embedded SVG map + a filterable hotspot table.
 * No CDN, no build step — open it straight from disk or attach it to a CI run.
 */
import { renderSvg } from './svg.mjs';
import { bandOf } from './analyze.mjs';
import { colorForScore, contrastText } from './colors.mjs';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (n) => n.toLocaleString('en-US');

const fmtDate = (iso) => (iso ? iso.slice(0, 10) : 'n/a');

export function renderHtml(report, opts = {}) {
  const { title = 'repository', range = 'all time', rev = 'HEAD', palette = 'ember', maxTiles = 140 } = opts;
  const { files, summary } = report;
  const svg = renderSvg(report, { title, range, rev, palette, maxTiles, width: 1200 });

  const rows = files
    .map((f, i) => {
      const color = colorForScore(f.score, palette);
      const band = bandOf(f.score);
      const barPct = Math.max(2, Math.round(f.score));
      return `<tr data-path="${esc(f.path.toLowerCase())}" data-score="${f.score}" data-churn="${f.churn}" data-commits="${
        f.commits
      }">
  <td class="rank">${i + 1}</td>
  <td class="score"><span class="pill" style="background:${color};color:${contrastText(color)}">${f.score.toFixed(
        1,
      )}</span><span class="meter"><i style="width:${barPct}%;background:${color}"></i></span></td>
  <td class="band band-${band}">${band}</td>
  <td class="num">${f.commits}</td>
  <td class="num">${fmt(f.churn)}</td>
  <td class="num">${f.authors}</td>
  <td class="num">${f.ageDays}d</td>
  <td class="path"><code>${esc(f.path)}</code></td>
</tr>`;
    })
    .join('\n');

  const authorList = summary.topAuthors
    .map((a) => `<li><span>${esc(a.name)}</span><b>${a.count}</b></li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>githeat · ${esc(title)}</title>
<meta name="generator" content="githeat">
<style>
  :root { color-scheme: dark; --bg:#0d1117; --panel:#161b22; --line:#30363d; --fg:#e6edf3; --muted:#8b949e; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:1240px; margin:0 auto; padding:28px 20px 64px; }
  h1 { font-size:24px; margin:0 0 4px; }
  h2 { font-size:16px; margin:32px 0 12px; color:var(--fg); }
  .sub { color:var(--muted); font-size:13px; margin:0 0 20px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .card b { display:block; font-size:22px; }
  .card span { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
  .map { margin-top:22px; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .map svg { display:block; width:100%; height:auto; }
  .toolbar { display:flex; gap:10px; align-items:center; margin:10px 0 12px; flex-wrap:wrap; }
  input[type=search] { flex:1 1 240px; background:var(--panel); border:1px solid var(--line); color:var(--fg); border-radius:8px; padding:8px 12px; font:inherit; }
  .count { color:var(--muted); font-size:13px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  thead th { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); text-align:left; padding:8px 10px; cursor:pointer; user-select:none; white-space:nowrap; }
  thead th.num, td.num { text-align:right; font-variant-numeric:tabular-nums; }
  tbody td { border-bottom:1px solid #21262d; padding:7px 10px; }
  tbody tr:hover { background:#161b22; }
  .rank { color:var(--muted); width:44px; }
  .score { width:190px; display:flex; align-items:center; gap:8px; }
  .pill { border-radius:999px; padding:1px 8px; font-size:12px; font-weight:700; }
  .meter { flex:1; height:5px; background:#21262d; border-radius:999px; overflow:hidden; }
  .meter i { display:block; height:100%; }
  .band { text-transform:capitalize; font-size:12px; }
  .band-critical { color:#ff7b72; } .band-high { color:#ffa657; } .band-medium { color:#d29922; } .band-low { color:#7d8590; }
  .path code { font:12.5px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; word-break:break-all; }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  @media (max-width:760px){ .cols{grid-template-columns:1fr;} }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  ul.authors { list-style:none; margin:0; padding:0; }
  ul.authors li { display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed #21262d; }
  .hint { color:var(--muted); font-size:12.5px; margin-top:8px; }
  footer { color:var(--muted); font-size:12.5px; margin-top:36px; border-top:1px solid var(--line); padding-top:14px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(title)} · hotspot heatmap</h1>
  <p class="sub">${esc(range)} @ ${esc(rev)} · generated by <b>githeat</b> · ${fmt(
    summary.commits,
  )} commits analysed</p>

  <div class="cards">
    <div class="card"><span>ranked files</span><b>${fmt(summary.filesRanked)}</b></div>
    <div class="card"><span>files touched</span><b>${fmt(summary.filesTouched)}</b></div>
    <div class="card"><span>total churn</span><b>${fmt(summary.churn)}</b></div>
    <div class="card"><span>authors</span><b>${fmt(summary.authors)}</b></div>
    <div class="card"><span>critical</span><b style="color:${colorForScore(85, palette)}">${fmt(
      summary.bands.critical,
    )}</b></div>
    <div class="card"><span>top 10 churn share</span><b>${summary.top10Share}%</b></div>
  </div>

  <div class="map">${svg.trim()}</div>

  <h2>Hotspots</h2>
  <div class="toolbar">
    <input type="search" id="q" placeholder="filter by path… (e.g. src/, .mjs, auth)">
    <span class="count" id="count">${files.length} files</span>
  </div>
  <table id="t">
    <thead>
      <tr>
        <th data-sort="rank" class="rank">#</th>
        <th data-sort="score">score</th>
        <th data-sort="band">band</th>
        <th data-sort="commits" class="num">changes</th>
        <th data-sort="churn" class="num">churn</th>
        <th data-sort="authors" class="num">authors</th>
        <th data-sort="age" class="num">last change</th>
        <th>file</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <h2>Where the pain comes from</h2>
  <div class="cols">
    <div class="panel">
      <b>Top authors by commits</b>
      <ul class="authors">${authorList || '<li>none</li>'}</ul>
      <p class="hint">Bus factor check: one name owning most of the hot files is a risk in itself.</p>
    </div>
    <div class="panel">
      <b>How to read this</b>
      <p class="hint">
        Area = churn (how much editing a file absorbs). Colour = hotspot score, blending churn with the
        number of separate commits and a mild recency bonus. Generated files, lockfiles and vendored
        directories are filtered out before scoring.
      </p>
      <p class="hint">
        Next step: pick the top three tiles, cover them with tests, then refactor. Re-run
        <code>githeat</code> after a month — you want the red to move, not grow.
      </p>
    </div>
  </div>

  <footer>
    Range ${esc(fmtDate(summary.firstCommit))} → ${esc(fmtDate(summary.lastCommit))} ·
    report generated offline by <a href="https://github.com/xiaozhenweiyan/githeat" style="color:#58a6ff">githeat</a>
  </footer>
</div>
<script>
(function () {
  var q = document.getElementById('q');
  var table = document.getElementById('t');
  var body = table.tBodies[0];
  var rows = Array.prototype.slice.call(body.rows);
  var count = document.getElementById('count');
  var sortKey = 'score';
  var dir = -1;

  function num(row, key) {
    if (key === 'score') return parseFloat(row.dataset.score);
    if (key === 'churn') return parseInt(row.dataset.churn, 10);
    if (key === 'commits') return parseInt(row.dataset.commits, 10);
    if (key === 'rank') return rows.indexOf(row);
    return 0;
  }

  function apply() {
    var needle = q.value.trim().toLowerCase();
    var shown = 0;
    rows.forEach(function (row) {
      var hit = !needle || row.dataset.path.indexOf(needle) !== -1;
      row.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    count.textContent = shown + ' of ' + rows.length + ' files';
  }

  q.addEventListener('input', apply);

  table.tHead.addEventListener('click', function (e) {
    var th = e.target.closest('th');
    if (!th) return;
    var key = th.dataset.sort;
    if (!key || key === 'band') return;
    if (key === sortKey) dir = -dir; else { sortKey = key; dir = key === 'rank' ? 1 : -1; }
    rows.sort(function (a, b) { return (num(a, sortKey) - num(b, sortKey)) * dir; });
    rows.forEach(function (r) { body.appendChild(r); });
  });
})();
</script>
</body>
</html>
`;
}
