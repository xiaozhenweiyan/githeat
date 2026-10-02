// 可复用的计时工具：node scripts/bench.mjs <仓库路径> [标签]
// 输出一行 markdown 表格行，方便直接贴进 docs/benchmark.md。
// 只做三件事：测 githeat 全量耗时、测 git log 自身耗时、数提交数与上榜文件数。
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const label = process.argv[3] ?? (target ? resolve(target).split(/[\\/]/).pop() : null);
if (!target) {
  process.stderr.write('用法: node scripts/bench.mjs <仓库路径> [标签]\n');
  process.exit(2);
}

const time = (fn) => {
  const t0 = process.hrtime.bigint();
  const out = fn();
  return { seconds: Number(process.hrtime.bigint() - t0) / 1e9, out };
};

const run = (args) => spawnSync(process.execPath, [join(root, 'bin', 'githeat.mjs'), ...args], { encoding: 'utf8' });
const git = (args) => spawnSync('git', ['-C', target, ...args], { encoding: 'utf8' });

const commits = Number((git(['rev-list', '--count', 'HEAD']).stdout || '0').trim());
if (!commits) {
  process.stderr.write(`无法读取 ${target} 的提交历史（克隆是否完整？）\n`);
  process.exit(1);
}

const runs = [];
for (let i = 0; i < 3; i += 1) runs.push(time(() => run(['heat', target, '--json'])).seconds);
const gitRuns = [];
for (let i = 0; i < 3; i += 1) gitRuns.push(time(() => git(['log', '--name-only', '--no-merges'])).seconds);

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const payload = JSON.parse(runs.length ? run(['heat', target, '--json']).stdout : '{}');
const ranked = payload.summary?.filesRanked ?? 0;

process.stdout.write(
  `| ${label} | ${commits} | ${ranked} | ${median(runs).toFixed(2)} s | ${median(gitRuns).toFixed(2)} s |\n`,
);
