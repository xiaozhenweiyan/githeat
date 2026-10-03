/**
 * 绝对精度：如果用户只看排名前 N 个文件，其中几个真的在下一个版本里被修了？
 *
 * 之前只算了相对提升（1.6x），那个数字好看但不能拿来做决定。
 * 这里算的是可以直接指导行动的数字：
 *   precision@N   = 前 N 名里后来被修的比例（也就是「白看几个」）
 *   recall@N      = 后来被修的文件里，前 N 名覆盖了几个（也就是「漏了几个」）
 *   baseline@N    = 随机抽 N 个上榜文件能碰到的比例（对照组）
 *
 * 最后再算一个「不靠工具、按提交次数排序」的基线，
 * 用来回答真正的核心问题：这个分数比「文件改动次数」这个零成本启发式强多少？
 */

import { spawnSync } from 'node:child_process';

import { readWindow, partitionFiles, REPAIR_PATTERN, NON_REPAIR_PATTERN } from '../src/eval.mjs';
import { readHistory, repoRoot, git } from '../src/git.mjs';
import { analyze, DEFAULT_MIN_COMMITS, DEFAULT_SCORE_MODE, SCORE_MODES } from '../src/analyze.mjs';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
if (!target) {
  process.stderr.write('用法: node scripts/eval-precision.mjs <仓库路径> [--pairs 4] [--min-commits 2]\n');
  process.exit(2);
}

const root = repoRoot(target);
const pairCount = Number(flag('pairs', '4'));
const minCommits = Number(flag('min-commits', '2'));
const scoreMode = String(flag('score', DEFAULT_SCORE_MODE)).toLowerCase();
if (!SCORE_MODES.includes(scoreMode)) {
  process.stderr.write(`--score 只能是 ${SCORE_MODES.join(' / ')}\n`);
  process.exit(2);
}
const tags = (spawnSync('git', ['-C', root, 'tag', '--sort=creatordate'], { encoding: 'utf8' }).stdout ?? '')
  .split('\n')
  .map((t) => t.trim())
  .filter(Boolean);

if (tags.length < 2) {
  process.stderr.write(`${root}: 少于两个版本标签\n`);
  process.exit(1);
}

// 复用区间挑选：找到含足够修复工作的区间
const ranges = [];
for (const stride of [1, 2, 4, 8]) {
  for (let i = tags.length - 1; i - stride >= 0 && ranges.length < pairCount; i -= 1) {
    const from = tags[i - stride];
    const to = tags[i];
    if (ranges.some((r) => r.from === from && r.to === to)) continue;
    const commits = readWindow({ cwd: root, from, to });
    const { repair } = partitionFiles(commits, { pattern: REPAIR_PATTERN, exclude: NON_REPAIR_PATTERN });
    if (repair.size >= 3) ranges.push({ from, to, repairFiles: repair.size });
    if (ranges.length >= pairCount) break;
  }
  if (ranges.length >= pairCount) break;
}

if (ranges.length === 0) {
  process.stdout.write(`${root}\n没有找到含足够修复工作的版本区间，无法评估绝对精度。\n`);
  process.exit(0);
}

const CUTS = [5, 10, 20];
process.stdout.write(`\n${root}\n绝对精度：只看前 N 名，几个是真的（后来被修过的）文件   [score=${scoreMode}]\n\n`);
process.stdout.write('区间              上榜数  ' + CUTS.map((n) => `P@${n}`.padStart(7)).join('') + '   ' + CUTS.map((n) => `R@${n}`.padStart(7)).join('') + '   随机基线@10  改动次数基线@10\n');
process.stdout.write('-'.repeat(112) + '\n');

const totals = {
  hits: Object.fromEntries(CUTS.map((n) => [n, 0])),
  picked: Object.fromEntries(CUTS.map((n) => [n, 0])),
  intervals: 0,
  repairTotal: 0,
  randomHits10: 0,
  churnHits10: 0,
  overlap10: 0,
  overlapIntervals: 0,
};

for (const { from, to } of ranges) {
  const commits = readWindow({ cwd: root, from, to });
  const { repair } = partitionFiles(commits, { pattern: REPAIR_PATTERN, exclude: NON_REPAIR_PATTERN });

  // 工具在 from 这个时点能看到的东西
  const report = analyze(readHistory({ cwd: root, rev: from }), { minCommits, score: scoreMode });
  const ranked = report.files;
  const totalRepair = [...repair].filter((p) => ranked.some((f) => f.path === p)).length;

  // 零成本基线一：随机取 N 个上榜文件，期望命中比例 = 上榜修复文件 / 上榜总数
  const randomRate = ranked.length === 0 ? 0 : totalRepair / ranked.length;

  // 零成本基线二：直接按提交次数排序（不看分数、不看作者数、不看近期）
  const byCommits = [...ranked].sort((a, b) => b.commits - a.commits || b.churn - a.churn);
  const churnHitAt10 = byCommits.slice(0, 10).filter((f) => repair.has(f.path)).length;

  const line = [];
  for (const n of CUTS) {
    const top = ranked.slice(0, n);
    const hits = top.filter((f) => repair.has(f.path)).length;
    totals.hits[n] += hits;
    totals.picked[n] += top.length;
    line.push(`${hits}/${top.length}`.padStart(7));
  }

  /**
   * How much of the ordering the scoring actually changes.
   *
   * Equal hit counts with a different order is the worst version of this result:
   * it means the formula is reshuffling the list without improving which files it
   * names. If this number is low while the hit counts match, the extra terms are
   * decoration.
   */
  const top10ByScore = ranked.slice(0, 10).map((f) => f.path);
  const top10ByCommits = byCommits.slice(0, 10).map((f) => f.path);
  const overlap = top10ByScore.filter((p) => top10ByCommits.includes(p)).length;
  totals.overlap10 += overlap;
  totals.overlapIntervals += 1;
  const recall = [];
  for (const n of CUTS) {
    const top = ranked.slice(0, n);
    const hits = top.filter((f) => repair.has(f.path)).length;
    recall.push(totalRepair === 0 ? ' n/a ' : `${Math.round((hits / totalRepair) * 100)}%`.padStart(7));
  }
  totals.repairTotal += totalRepair;
  totals.intervals += 1;
  totals.randomHits10 += randomRate * Math.min(10, ranked.length);
  totals.churnHits10 += churnHitAt10;

  process.stdout.write(
    `${(from + '..' + to).slice(0, 16).padEnd(18)}${String(ranked.length).padStart(5)}  ` +
      line.join('') + '   ' + recall.join('') + '   ' +
      `${(randomRate * 100).toFixed(1)}%`.padStart(11) + '  ' + `${churnHitAt10}/10`.padStart(12) + '\n',
  );
}

if (totals.picked[10] === 0) {
  process.stdout.write('\n没有可用数据。\n');
  process.exit(0);
}

process.stdout.write('\n汇总（每个区间取前 10 名比较三个基线）\n');
for (const n of CUTS) {
  const p = totals.hits[n] / totals.picked[n];
  const r = totals.repairTotal === 0 ? null : totals.hits[n] / totals.repairTotal;
  process.stdout.write(
    `  前 ${String(n).padStart(2)} 名：精确率 ${(p * 100).toFixed(1)}%` + (r === null ? '' : `，召回率 ${(r * 100).toFixed(1)}%`) + '\n',
  );
}

const perInterval = Math.max(1, totals.intervals);
const overlap = totals.overlapIntervals === 0 ? null : totals.overlap10 / totals.overlapIntervals;
process.stdout.write(
  `\n  前 10 名的三个基线（${totals.intervals} 个区间平均）：\n` +
    `    随机抽样（同比例）        ${(totals.randomHits10 / perInterval).toFixed(2)}/10\n` +
    `    按提交次数排序（零成本）  ${(totals.churnHits10 / perInterval).toFixed(2)}/10\n` +
    `    本工具（完整评分）        ${(totals.hits[10] / perInterval).toFixed(2)}/10\n`,
);
if (overlap !== null) {
  process.stdout.write(
    `\n  两种排序前 10 名的重合度：${overlap.toFixed(1)}/10 —— ` +
      (Math.abs(overlap - 10) < 0.5
        ? '评分几乎不改变排序。\n'
        : '评分明显改变了排序顺序；若此时命中数仍与零成本基线相同，说明它只是在重新洗牌，\n' +
          '  而没有选中更好的文件 —— 这是比「结果一样」更糟的情况。\n'),
  );
}
process.stdout.write(
  `\n读法：精确率 = 你点开前 N 个文件，几个真是下一个版本要修的；召回率 = 下一个版本要修的文件，前 N 个覆盖了几个。\n` +
    `若「按提交次数排序」这一行与「本工具」接近，则复杂评分没有带来可测量的额外价值，\n` +
    `也就是说这个工具相对「按改动次数排序」这个零成本启发式没有优势。\n\n`,
);
