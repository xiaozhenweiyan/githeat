/**
 * 评测：githeat 能不能指对「病因」。
 *
 *   node scripts/eval-fixability.mjs <仓库路径> [--pairs 4] [--min-commits 2]
 *
 * 做法（细节见 src/eval.mjs 顶部注释）：
 *   取项目两个版本之间的提交，把「作者自己描述为修复类」的提交
 *   （refactor / rewrite / simplify / hotfix / tech debt …）碰过的文件作为答案组，
 *   把同一区间内被普通提交碰过的文件作为对照组，
 *   然后只用较早版本的git历史排名，看两组文件的排名是否有系统性差异。
 *
 * 关键点：对照组让这个评测不会被「近期活跃度」蒙混过关。
 */
import { spawnSync } from 'node:child_process';

import { evaluateRange, pickEvaluableRanges } from '../src/eval.mjs';
import { repoRoot } from '../src/git.mjs';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

if (!target) {
  process.stderr.write('用法: node scripts/eval-fixability.mjs <仓库路径> [--pairs 4] [--min-commits 2]\n');
  process.exit(2);
}

const root = repoRoot(target);
const pairCount = Number(flag('pairs', '4'));
const minCommits = Number(flag('min-commits', '2'));

// 用版本标签当锚点：有 tag 的项目天然提供「发布周期」这个评价单位
const tags = (spawnSync('git', ['-C', root, 'tag', '--sort=creatordate'], { encoding: 'utf8' }).stdout ?? '')
  .split('\n')
  .map((t) => t.trim())
  .filter(Boolean);

if (tags.length < 2) {
  process.stderr.write(`${root}: 少于两个版本标签，无法按发布周期评测\n`);
  process.exit(1);
}

process.stdout.write(`\n${root}\n`);
process.stdout.write(`标签 ${tags.length} 个，min-commits=${minCommits}\n`);

// 挑「真的有修复工作」的区间，而不是简单取相邻标签：
// 成熟小包的相邻发布之间常常只有一次版本号提交，那样什么也测不出来
const { chosen, scanned } = pickEvaluableRanges({ cwd: root, labels: tags, count: pairCount, minCommits });
if (chosen.length === 0) {
  process.stdout.write(
    `扫描了 ${scanned.length} 个区间，没有一个含足够的「修复类」提交 —— 这个项目不这么描述自己的工作，因此没有标准答案。\n` +
      '（本脚本如实报告「没有标准答案」，而不是给一个 0 分。）\n',
  );
  process.exit(0);
}

process.stdout.write(`选中 ${chosen.length} 个有价值的区间（跳过相邻发布之间的空区间）\n\n`);
process.stdout.write('区间                    提交  修复提交  答案组  对照组  平均百分位(答案)  平均百分位(对照)  分离度  命中率 倍数  可用\n');
process.stdout.write('-'.repeat(126) + '\n');

const rows = [];
for (const { from, to } of chosen) {
  let result;
  try {
    result = evaluateRange({ cwd: root, from, to, minCommits });
  } catch (error) {
    process.stdout.write(`${from}..${to}  评测失败: ${error.message}\n`);
    continue;
  }
  rows.push(result);
  const pct = (v) => (v === null ? '  n/a ' : (v * 100).toFixed(1).padStart(5) + '%');
  process.stdout.write(
    `${(from + '..' + to).slice(0, 22).padEnd(24)}` +
      `${String(result.commits).padStart(4)}  ${String(result.repairCommits).padStart(6)}  ` +
      `${String(result.repair.count).padStart(5)}  ${String(result.ordinary.count).padStart(6)}  ` +
      `${pct(result.repair.meanPercentile).padStart(15)}  ${pct(result.ordinary.meanPercentile).padStart(16)}  ` +
      `${(result.separation === null ? 'n/a' : (result.separation * 100).toFixed(1) + 'pp').padStart(7)}  ` +
      `${pct(result.repair.topShare).padStart(6)} ${(result.lift === null ? 'n/a' : result.lift.toFixed(2) + 'x').padStart(6)}  ` +
      `${result.reliable ? ' 是 ' : ' 否 '}\n`,
  );
}

const usable = rows.filter((r) => r.reliable && r.separation !== null);
if (usable.length === 0) {
  process.stdout.write('\n没有可用区间：要么这些版本之间没有「修复类」提交，要么答案组/对照组太小（不足 3 个上榜文件），无法得出结论。\n');
  process.exit(0);
}

const avg = (pick) => usable.reduce((s, r) => s + pick(r), 0) / usable.length;
process.stdout.write(
  `\n汇总（${usable.length} 个可用区间，已排除答案组或对照组不足 3 个文件的区间）：` +
    `平均分离度 ${(avg((r) => r.separation) * 100).toFixed(1)}pp，` +
    `答案组平均命中率 ${(avg((r) => r.repair.topShare) * 100).toFixed(1)}%，` +
    `对照组 ${(avg((r) => r.ordinary.topShare) * 100).toFixed(1)}%\n`,
);

process.stdout.write('\n修复类提交示例（答案的来源，人工可核对）：\n');
for (const row of usable.slice(-2)) {
  process.stdout.write(`  ${row.from}..${row.to}\n`);
  for (const message of row.repairMessages.slice(0, 4)) process.stdout.write(`    - ${message}\n`);
}
process.stdout.write(
  '\n注意：提交信息是人的判断，有的项目从不说 refactor，那就没有标准答案（本脚本会说没有，而不是给 0 分）。\n' +
    '分离度 = 对照组平均百分位 − 答案组平均百分位，正值表示「后来被修的文件」在排名里更靠前。\n\n',
);
