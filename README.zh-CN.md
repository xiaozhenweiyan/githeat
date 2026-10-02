# githeat · 中文说明

**找出那些正在悄悄吃掉你时间的文件，然后看着红色退下去。**

`githeat` 读取你的 git 历史，给每个源码文件算一个「热点分」，在终端打印一张热力表，
并生成一张零依赖、可直接嵌入 README 的 SVG 热力图。

零依赖、零配置、无需账号，代码不出本机。

![githeat 热点热力图](docs/demo.svg)

```console
$ npx githeat
```

```console
chalk all time · 359 commits · 33 files · 70 authors · 390 churn
top 10 files hold 64.6% of all churn — concentrated risk

   #  score  heat           changes     churn  auth  last  file
-----------------------------------------------------------------------------
   1   99.7  ████████████        29        29     9    5d  source/index.js
   2   93.5  ███████████░        21        21     8    5d  test/chalk.js
   3   80.0  ██████████░░        60        60    19  7.2y  index.js
   4   80.0  ██████████░░        36        36    13  9.2y  test.js

bands: critical 9 high 12 medium 12 low 0
```

（真实输出，命令：`githeat heat chalk --top 8`）

---

## 为什么看「改得勤」而不是「写得复杂」

软件工程实证研究二十年来反复得出同一个结论：
**一个文件的修改频率，比它的代码复杂度更能预测缺陷。**
圈复杂度只告诉你这个文件「可能」难；churn（改动热度）告诉你这个文件**正在**被人反复打开、
反复评审、反复改坏——在真实的截止日期下。下一个 bug 大概率就坐在那里。

`githeat` 把这件事变成一条命令：一个分数，一张图。

## 安装

还没发 npm —— 先克隆，或者直接用仓库里的入口跑：

```bash
git clone https://github.com/xiaozhenweiyan/githeat
cd githeat
node bin/githeat.mjs heat /path/to/your/repo
```

`npm i -g` 等第一次 npm 发布；`bin` 入口已经配好了。
只需要 Node 18+ 和 PATH 里的 `git`。依赖列表到此为止。

## 用法

```bash
githeat                                    # 分析当前仓库
githeat --since 3.months --top 25          # 只看这个季度
githeat --format tree                      # 哪些目录在贡献 churn
githeat --format svg --out docs/heat.svg   # 存一张图给 README
githeat --format html --open               # 生成可筛选可排序的完整报告
githeat --json | jq '.hotspots[0]'         # 接脚本或看板
githeat check --max-score 90               # CI 卡口，超线退出码 1
githeat install-hook                       # 装一个不阻塞提交的提醒钩子
```

| 参数 | 作用 |
| --- | --- |
| `--since` / `--until` | 时间窗口（`12.months`、`2024-01-01`、`"6 weeks ago"`），UTC，两端含当天 |
| `--author <pattern>` | 只看某人的提交——看看「你自己」反复回去改哪个文件 |
| `--rev <range>` | `main`、`v1.0..HEAD` 等任意版本区间 |
| `--min-commits <n>` | 改动次数少于 n 的文件不计（默认 2） |
| `--ext <list>` | 只算这些扩展名，例如 `"js,ts,py"`；`--ext ""` 表示所有文件 |
| `--include-noise` | 保留 lockfile、`dist/`、第三方与生成文件 |
| `--format <fmt>` | `table`、`tree`、`json`、`svg`、`html` |
| `--palette <name>` | `ember`（默认）、`viridis`（色盲友好）、`mono`（打印） |
| `--top` / `--tiles` | 打印行数 / 图上的方块上限 |

## 分数怎么算

每个进入排名的文件得到 **0–100 的热点分**：

```
score = 100 × (0.68 × churn + 0.32 × changes) × 近期系数
```

- **churn**：该文件在历次提交中被修改的累计次数，用**对数尺度**并且锚定在仓库自身的
  90 分位上——这样一个巨型生成文件不会把其他文件全压成 0。
- **changes**：有多少个不同的提交碰过它。在 30 个提交里被打开 30 次，比一次大重写更糟。
- **近期系数**：一年没动过的文件比上周改过的降 20% 紧急度。

分档：`critical ≥ 70`、`high ≥ 45`、`medium ≥ 20`，其余为 `low`。

**打分前会被过滤掉**：lockfile、`node_modules/`、`vendor/`、`dist/`、构建产物、
压缩文件、图片与二进制；默认还包括 `package.json`、`readme.md` 这类非代码文件——
它们被改得最勤、却从来不需要调试，算进去只会淹没真正的信号。想要全都算：`--ext ""`。

**用作者日期，不用提交者日期**：rebase 和 squash merge 会重写提交者日期，
那会让每个文件看起来都是刚改过的。时间窗口按 UTC 的作者日期计算，换台机器结果一致。

## 在 CI 里

```yaml
- run: npx githeat check --max-score 90 --max-critical 0
```

`check` 打印简短结论：超阈值退出码 `1`，正常 `0`，用法错误 `2`。
加 `--quiet` 只输出一行，方便塞进日志。

`githeat install-hook` 装的 pre-commit 钩子刻意用了很宽松的阈值：它只提醒，绝不拦你提交。

## 当作库用

```js
import { readHistory, analyze, renderSvg } from 'githeat';
import { writeFileSync } from 'node:fs';

const report = analyze(readHistory({ cwd: '.', since: '6.months' }));
writeFileSync('heat.svg', renderSvg(report, { title: 'my-service' }));
console.log(report.files[0]); // { path, score, commits, churn, authors, last, ... }
```

库不会联网，也不会在你没要求时写任何东西进仓库。

## 性能

一次 `git log`、一次解析、一次布局——没有逐文件子进程，也没有需要预热的索引。
热缓存下一次运行约 0.7 秒，其中约 0.18 秒是 Node 启动、约 0.26 秒是 359 个提交的
git 自身开销，JS 分析只占很小一部分。完整测量方法见
[`docs/benchmark.md`](docs/benchmark.md)。

超大单体仓库建议限定窗口：`githeat --since 12.months`。

## 和别的工具比

- `git log --stat` / `git-quick-stats`：擅长**描述**历史，但不排名、不出图、不能当 CI 卡口。
- CodeScene 之类：思路相同，但商业、托管、要账号。
- `githeat`：一条命令、纯本地、零依赖，产出可入库的图和可自动化的退出码。

## 开发

```bash
npm test          # 38 个测试，包含真实临时仓库的端到端测试
npm run demo      # 重新生成 docs/（用合成历史，图不会随提交抖动）
```

见 [CONTRIBUTING.md](CONTRIBUTING.md)、[CHANGELOG.md](CHANGELOG.md)
与[性能测量记录](docs/benchmark.md)。

MIT 协议。欢迎提 issue 和 PR —— 尤其是「它把我的 `foo.bar` 排到了 99 分，
但这文件根本不配」这种报告，对这类工具来说是最有价值的 bug 报告。

---

English → [README.md](README.md)
