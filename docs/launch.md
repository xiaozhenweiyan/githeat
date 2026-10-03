# 发布与推广手册（launch kit）

> **⚠️ 网络实测结果（重要）**
>
> 从这台机器上实测：
>
> | 可用 | 不可用（12 秒超时） |
> | --- | --- |
> | GitHub、掘金、CSDN、开源中国、博客园、知乎、B站 | **V2EX、Hacker News、Reddit、Gitee** |
>
> 也就是说本文件里的 V2EX / HN / Reddit 文案**在当前网络下用不了**。
> 中文渠道请用 [`launch-cn.md`](launch-cn.md)（掘金 / CSDN 稿），那份是按中文社区口吻重写的，
> 不是英文稿的翻译。

这份文件只服务于一个目标：**让项目被对被搜到、被点开、被 star。**
代码已经写完了，接下来的成败全在"有没有人看见"。

---

## 0. 先把仓库门面填满（5 分钟，收益最大）

打开 https://github.com/xiaozhenweiyan/githeat ，点右侧 **About 的齿轮**：

**Description（直接复制）**

```
Find the git files that quietly cost you the most — hotspot ranking + SVG heatmap. Zero dependencies.
```

**Topics（逐个填）**

```
cli  git  hotspots  churn  code-health  treemap  heatmap  developer-tools  refactoring  nodejs
```

**Website** 留空即可（暂时没有主页，别填假的）。

再确认一件事：仓库首页应当自动显示 `docs/demo.svg` 那张热力图（README 第一屏引用了它）。
如果没显示，说明图片路径不对，把 README 第 5 行的 `docs/demo.svg` 检查一遍。

---

## 1. 关于"要不要说这是 AI 写的"

**建议：说，而且要主动说。**

理由不是道德，是效果：

- 这个社区对"假装纯手工"极敏感，被扒出来会直接毁掉项目口碑；
- 反过来，"我用 AI 在一个晚上造了这个工具，它现在能分析你们仓库"本身就是一个**有传播力的话题**；
- gittrends、HN 上关于 AI 造工具是否算"自己的项目"的讨论，永远有人愿意点开。

**但有一个硬要求**：所有推广文案里，**必须写清楚它现在还没在超大仓库上实测过**。
被人指出"你连 react 都没跑过就敢发"，比你自己先说出来，伤害大十倍。

---

## 2. 中文渠道（先发这里，反馈最快、最宽容）

### V2EX · 分享创造节点

标题：

```
[分享] 写了个小工具 githeat，给 git 历史画热力图，一眼看出哪些文件在拖后腿
```

正文：

```
受"修改频率比代码复杂度更能预测缺陷"这个老结论启发，做了个零依赖的 CLI：

  git clone https://github.com/xiaozhenweiyan/githeat
  node bin/githeat.mjs heat /path/to/repo

（还没发 npm，所以先 clone；包已经准备好，随时能发）

它会读你的 git 历史，给每个源码文件算一个热点分（churn + 修改次数 + 近期加权），
终端直接出彩色热力表，还能导出可嵌 README 的 SVG 热力图和单文件 HTML 报告。

设计上比较在意的几点：
- 零依赖，纯本地，代码不出机器
- 默认过滤 lockfile / 生成物 / 非源码文件（不然 package.json 永远排第一）
- 时间窗口按作者日期算（rebase 会重写提交者日期，会让所有文件看起来都刚改过）
- 能当 CI 卡口：githeat check --max-score 90，超了退出码 1

在 chalk（359 提交）和 slugify 上验证过，chalk 全量分析 0.74s。
超过 400 提交的仓库我还没实测，欢迎拿你们的大仓库打我脸。

https://github.com/xiaozhenweiyan/githeat

顺便说一句：这项目是我和 AI 一起写的，测试反而是我改动最多的地方——
第一版把 treemap 的宽高比公式写反了，图渲染出来是 15 条横杠，
测试全绿但一眼就看出不对。
```

### 掘金 / 思否（可以更技术一些）

标题：

```
我用 600 行零依赖 JS 做了个 git 热点分析器，顺便踩了 3 个 git 日期的坑
```

重点写**踩坑**部分（`%aI` vs `%cI`、`--since` 与 `--until` 语义不一致、裸日期的时区问题），
这类文章比"我做了个工具"有阅读量得多。工具本身放文章结尾。

---

## 3. 英文渠道（star 主要来源）

### Hacker News · Show HN（周二至周四，太平洋时间早上 7-9 点发）

标题（**不要**用 "Show HN: githeat – ..." 以外的花活）：

```
Show HN: githeat – Rank the files your git history keeps breaking (zero deps)
```

首条自评（发完立刻自己回复，这是 HN 的惯例，也决定讨论方向）：

```
Author here. This started from the old empirical result that change frequency
predicts defects better than complexity does — a file you reopen 30 times is
where the next bug already lives.

What it does: one git log call, then it scores every source file on churn,
change count and recency, prints a heat table, and renders an SVG treemap
(area = churn, colour = score) you can drop in a README.

Three deliberate choices worth arguing about:
1. churn = number of commits touching the file, not lines added/removed.
   --numstat is slower and gets noisy on renames and binaries.
2. Non-code files are filtered out by default. Without that, package.json and
   readme.md top every ranking — edited constantly, debugged never.
3. Time windows use author dates, not committer dates. Rebases rewrite the
   committer date, which made every file look freshly touched.

It is ~600 lines of dependency-free Node. Measured: 0.74s end to end on
chalk (359 commits), of which 0.26s is git itself. I have NOT verified it on a
monorepo with 100k+ commits — if you run it on one, I would like the number.

Written with AI assistance; the tests and the date-semantics debugging are
where most of the human time went.
```

### Reddit · r/programming（别用 r/github，那里只欢迎"我的项目"式互赞）

标题：

```
githeat: ranking source files by how often they change, because that predicts bugs better than complexity
```

正文用上面 HN 那段，去掉 "Author here"，改成第一人称。

### Reddit · r/node、r/devops

侧重不同：r/node 讲零依赖 + API 用法；r/devops 讲 `githeat check --max-score` 进 CI。

### X / Twitter

```
Your git history already knows which files are rotting.

githeat scores every source file by churn + change count + recency, prints a
heat table, and renders a treemap you can drop in a README.

Zero deps. Nothing leaves your machine.
```

配图就用 `docs/demo.svg`（转成 PNG，或者直接截屏那个热力图）。

---

## 4. 一周内的动作清单

| 时间 | 动作 |
| --- | --- |
| 第 1 天 | ✅ 已完成：建仓库 + 填 Description/Topics + 推代码 |
| 第 1 天 | V2EX 分享创造发一帖（中文渠道反馈最快） |
| 第 2 天 | ✅ 已完成：vuejs/core（6 532 提交 / 1.45 s）与 express（6 173 提交 / 1.10 s）实测已进 `docs/benchmark.md` |
| 第 3 天 | Show HN + r/programming 同时发（时差上覆盖两波人） |
| 第 4-7 天 | 回复每一条评论。**不要**争辩评分公式，把"你说得对，我把这个做成 issue 了"当标准回复 |
| 持续 | 有人提 bug 就当天修并回帖；star 数不用盯，issue 数才是指标 |

## 4.5 手里已经有的"真实数据"弹药

发帖时把下面这几条直接甩出去，比任何形容词都管用：

**性能**（本机实测，中位数三次）

```
chalk        380 提交   0.72 秒
express      6 173 提交 1.10 秒
vuejs/core   6 532 提交 1.45 秒   （其中裸 git log 自身 0.55 秒）
```

**在真实仓库上找出来的热点**（这才是有说服力的部分）

- `vuejs/core` 榜首：`packages/compiler-sfc/src/compileScript.ts`（308 次改动 / 46 位作者）、
  `packages/runtime-core/src/renderer.ts`（305 次 / 53 位作者）、
  `Suspense.ts`（82 次 / 29 位作者）—— 任何写过 Vue 的人都知道这几个文件什么脾气。
- `express` 榜单同样落在 `lib/router/index.js` 这类核心调度文件上。

**一个诚实的副产品**：vue 这种规模下，默认阈值会把 810 个文件里的 192 个判为
`critical`。这不是 bug（6500 次提交的仓库确实有一堆高频改动文件），但说明**分档阈值是给
中小仓库校准的**。我在 README 里写明了这点，并给了 `--since 12.months` 的用法。
**主动说出自己工具的局限，比等人来骂你强得多。**

---

## 5. 反例：这些做法会毁掉项目

- ❌ 去各个仓库的 issue 区发"我用 githeat 分析了你们仓库"——会被当垃圾广告举报
- ❌ 让朋友刷 star —— GitHub 有异常检测，得不偿失
- ❌ 标题写"重磅""神器""颠覆"——技术社区条件反射式反感
- ❌ 隐瞒 AI 参与、隐瞒没做大仓库实测 —— 一旦被指出，比缺点本身更致命
- ❌ 一次发五个渠道然后不回复 —— 冷启动阶段，**回复评论比再写代码重要十倍**
