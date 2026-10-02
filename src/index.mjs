/**
 * Public API — the same functions the CLI uses, for build scripts and bots.
 *
 *   import { readHistory, analyze, renderSvg } from 'githeat';
 *
 *   const report = analyze(readHistory({ cwd: '/repo', since: '6.months' }));
 *   console.log(report.files[0]);            // hottest file
 *   writeFileSync('heat.svg', renderSvg(report, { title: 'my-repo' }));
 */
export { readHistory, parseLog, normalizeWhen, parseWhen, isRepo, repoRoot, headSha, git } from './git.mjs';
export {
  analyze,
  bandOf,
  isNoisePath,
  buildTree,
  makeScaler,
  makeFileFilter,
  parseExtensions,
  DEFAULT_MIN_COMMITS,
  DEFAULT_EXTENSIONS,
} from './analyze.mjs';
export { squarify, topTiles } from './treemap.mjs';
export { renderSvg } from './svg.mjs';
export { renderHtml } from './report.mjs';
export { renderTable, renderTree, shouldUseColor } from './terminal.mjs';
export { colorForScore, paletteNames, legendStops } from './colors.mjs';

export const version = '0.1.0';
