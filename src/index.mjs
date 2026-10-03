/**
 * Public API — the same functions the CLI uses, for build scripts and bots.
 *
 *   import { readHistory, analyze, renderSvg } from 'githeat';
 *
 *   const report = analyze(readHistory({ cwd: '/repo', since: '6.months' }));
 *   console.log(report.files[0]);            // hottest file
 *   writeFileSync('heat.svg', renderSvg(report, { title: 'my-repo' }));
 *
 * Exclusions, reviewed changes and rendering are all reachable from here, so a
 * bot can do anything the CLI does without shelling out.
 */
export { readHistory, parseLog, normalizeWhen, parseWhen, isRepo, repoRoot, headSha, mergeBase, isAncestor, git } from './git.mjs';
export {
  analyze,
  bandOf,
  trendOf,
  resolveBandMode,
  percentileCutoffs,
  bandFromThresholds,
  isNoisePath,
  buildTree,
  makeScaler,
  makeFileFilter,
  parseExtensions,
  DEFAULT_MIN_COMMITS,
  DEFAULT_EXTENSIONS,
  ABSOLUTE_BANDS,
  PERCENTILE_BANDS,
  AUTO_PERCENTILE_FROM,
  MIN_CHANGES_FOR_TREND,
} from './analyze.mjs';
export {
  IGNORE_FILE,
  IGNORE_TEMPLATE,
  compilePattern,
  parseIgnoreText,
  makeIgnoreMatcher,
  makeIgnoreFromText,
} from './ignore.mjs';
export { squarify, topTiles } from './treemap.mjs';
export { renderSvg } from './svg.mjs';
export { renderHtml } from './report.mjs';
export { renderTable, renderTree, shouldUseColor } from './terminal.mjs';
export { readChangedList, reviewReport, renderReviewMarkdown } from './review.mjs';
export { explainExclusion, renderExplanation } from './explain.mjs';
export { compareToBase, renderComparison, SCORE_EPSILON } from './compare.mjs';
export { colorForScore, paletteNames, legendStops } from './colors.mjs';

export const version = '0.1.0';
