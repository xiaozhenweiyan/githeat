/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk).
 *
 * We lay out leaf rectangles directly instead of recursing into directory
 * boxes: the readable map is the one where every pixel is one file.
 * Directory grouping still shows up as the path label on each tile.
 */

/**
 * @param {{label:string, value:number, [k:string]:any}[]} items
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @param {{gap?:number}} [opts]
 * @returns {Array<{item:any,x:number,y:number,w:number,h:number,area:number}>}
 */
export function squarify(items, rect, opts = {}) {
  const gap = opts.gap ?? 0;
  const usable = items
    .filter((it) => it.value > 0)
    .map((it) => ({ item: it, value: it.value }))
    .sort((a, b) => b.value - a.value);

  if (usable.length === 0) return [];

  const total = usable.reduce((sum, e) => sum + e.value, 0);
  const box = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  const scale = (box.w * box.h) / total;
  for (const e of usable) e.area = e.value * scale;

  const placed = [];
  layout(usable, box, placed);

  // shrink each tile by the gap so tiles read as separate cards
  return placed.map((t) => {
    const w = Math.max(0, t.w - gap);
    const h = Math.max(0, t.h - gap);
    return { ...t, x: t.x + gap / 2, y: t.y + gap / 2, w, h };
  });
}

function layout(rows, box, placed) {
  if (rows.length === 0 || box.w <= 0 || box.h <= 0) return;
  let row = [];
  let rest = rows;
  while (rest.length > 0) {
    const candidate = rest[0];
    if (row.length > 0 && worst(row, box) < worst([...row, candidate], box)) break;
    row.push(candidate);
    rest = rest.slice(1);
  }
  const layoutBox = placeRow(row, box, placed);
  layout(rest, layoutBox, placed);
}

const sum = (row) => row.reduce((s, e) => s + e.area, 0);
const max = (row) => row.reduce((m, e) => Math.max(m, e.area), 0);
const min = (row) => row.reduce((m, e) => Math.min(m, e.area), 0);

/**
 * Worst aspect ratio produced by the row inside `box`. Lower is better.
 *
 * `s` is the row's total area and `side` the box's shorter edge. A row is laid
 * along that edge, so a tile of area `a` ends up `s/side` by `a*side/s`; the
 * ratio of the two is what we minimise. Getting these two terms the wrong way
 * round silently degrades the map into one full-width bar per file, which is
 * why `test/unit.test.mjs` asserts on real aspect ratios.
 */
function worst(row, box) {
  if (row.length === 0) return Infinity;
  const side = Math.min(box.w, box.h);
  if (side <= 0) return Infinity;
  const s = sum(row);
  if (s <= 0) return Infinity;
  const thickness = s / side; // the row is laid along the box's short edge
  const ratios = row.map((e) => {
    const length = e.area / thickness; // the tile's other dimension
    return Math.max(thickness / length, length / thickness);
  });
  return Math.max(...ratios);
}

/** Lay the row along the shorter side; return the remaining rectangle. */
function placeRow(row, box, placed) {
  const s = sum(row);
  if (s <= 0) return box;
  if (box.w >= box.h) {
    const colW = s / box.h;
    let y = box.y;
    for (const e of row) {
      const h = (e.area / s) * box.h;
      placed.push({ item: e.item, value: e.value, x: box.x, y, w: colW, h, area: e.area });
      y += h;
    }
    return { x: box.x + colW, y: box.y, w: Math.max(0, box.w - colW), h: box.h };
  }
  const rowH = s / box.w;
  let x = box.x;
  for (const e of row) {
    const w = (e.area / s) * box.w;
    placed.push({ item: e.item, value: e.value, x, y: box.y, w, h: rowH, area: e.area });
    x += w;
  }
  return { x: box.x, y: box.y + rowH, w: box.w, h: Math.max(0, box.h - rowH) };
}

/**
 * Aggregate a file list to at most `limit` tiles: the hottest individual
 * files stay, the long tail is folded into directory buckets. Keeps a
 * 5000-file repository legible without pretending every file matters.
 */
export function topTiles(files, limit = 120) {
  if (files.length <= limit) return files.map((f) => ({ ...f, label: f.path, value: f.churn, grouped: false }));
  const head = files.slice(0, Math.floor(limit * 0.75)).map((f) => ({ ...f, label: f.path, value: f.churn, grouped: false }));
  const tail = files.slice(Math.floor(limit * 0.75));
  const buckets = new Map();
  for (const f of tail) {
    const dir = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '.';
    const b = buckets.get(dir) ?? { dir, churn: 0, commits: 0, count: 0, score: 0 };
    b.churn += f.churn;
    b.commits += f.commits;
    b.count += 1;
    b.score = Math.max(b.score, f.score);
    buckets.set(dir, b);
  }
  const grouped = [...buckets.values()]
    .sort((a, b) => b.churn - a.churn)
    .slice(0, limit - head.length)
    .map((b) => ({
      path: `${b.dir}/${b.count > 1 ? `${b.count} files` : ''}`.replace(/\/$/, ''),
      label: `${b.dir} (+${b.count})`,
      value: b.churn,
      churn: b.churn,
      commits: b.commits,
      score: b.score,
      authors: 0,
      grouped: true,
    }));
  return [...head, ...grouped];
}
