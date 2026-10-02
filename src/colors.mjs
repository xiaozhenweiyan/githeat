/**
 * Heat colour scales: score -> hex. Tuned so a printed/screenshotted
 * heatmap stays readable and colour-blind friends still see the gradient.
 */

const PALETTES = {
  // cool -> hot, the classic "this file is on fire" ramp
  ember: ['#12324f', '#1a6f8f', '#22a884', '#a8c93a', '#f2b134', '#f2701d', '#d7263d'],
  // perceptually even, colour-blind safe
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  // single hue, good for grayscale printing
  mono: ['#e8eef5', '#b9c9da', '#8ba2ba', '#5d7b99', '#365473', '#17324d'],
};

export const PALETTE_NAMES = Object.keys(PALETTES);

export function paletteNames() {
  return [...PALETTE_NAMES];
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

export function mix(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

/**
 * Map a hotspot score (0..100) to a colour.
 * @param {number} score
 * @param {string} [palette='ember']
 */
export function colorForScore(score, palette = 'ember') {
  const stops = PALETTES[palette] ?? PALETTES.ember;
  const t = Math.max(0, Math.min(1, score / 100));
  const pos = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  return mix(stops[i], stops[i + 1], pos - i);
}

export function contrastText(hex) {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? '#0d1b26' : '#f4f8fb';
}

export function shade(hex, factor) {
  const [r, g, b] = hexToRgb(hex);
  if (factor >= 0) return rgbToHex([r + (255 - r) * factor, g + (255 - g) * factor, b + (255 - b) * factor]);
  return rgbToHex([r * (1 + factor), g * (1 + factor), b * (1 + factor)]);
}

/** Build the legend strip data: evenly spaced score -> colour samples. */
export function legendStops(palette, count = 6) {
  return Array.from({ length: count }, (_, i) => {
    const score = Math.round((i / (count - 1)) * 100);
    return { score, color: colorForScore(score, palette) };
  });
}
