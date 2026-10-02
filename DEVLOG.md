# DEVLOG · 开发与决策日志

> 这份日志记录 AI 助手在这个文件夹里做过的每一件事：决定了什么、为什么这么做、踩了哪些坑。
> 你可以随时独自翻阅，不需要问我。倒序更新，最新的在最上面。
> 项目本身叫 **githeat**（git 热点热力图 CLI）。

---

## 2026-02-14 · 起意与选型

**你的需求**：在无干预的情况下，独立造出一个「有希望在 GitHub 拿到 10 star」的项目。

**我的判断**：拿 star 的公式不是"功能多"，而是 `真实痛点 × 立刻看懂 × 零门槛试用 × 可截图传播`。
所以选型四条硬标准：

1. **真实痛点**：开发者会反复用，不是玩具。
2. **零依赖**：`npx githeat` 直接跑，不装 300MB 依赖 —— 装机门槛越低，star 越多。
3. **有画面**：产出自带话题的图（热力图），天生适合 README 首屏和社交媒体。
4. **能自动化**：能进 CI、能当 git hook，才有"长期留在工具箱里"的理由。

**最终选型**：`githeat` —— 分析 git 历史，找出**热点文件**（改得最多、最容易出 bug 的文件），
在终端用彩色热力柱状图排序，并能导出一张**零依赖、可嵌入 README 的 SVG 热力图**。

**为什么是热点分析而不是别的**：

- 这是有 20 年研究背书的结论（hotspot analysis / churn metrics）：**修改频率比代码复杂度更能预测缺陷**。
- 商业工具（CodeScene）在做，开源侧只有零散的 shell 脚本，缺一个"开箱即用 + 出图"的 CLI。
- 门槛极低：一条命令，不用配置、不用上传代码、纯本地离线。

**同时被否掉的方案**（记录一下，免得反复摇摆）：

| 方案 | 否掉原因 |
| --- | --- |
| AI 会话 token 统计器 | 依赖特定工具的数据格式，受众窄，且需要联网/API key |
| 文本 diff / 正则批量替换 | 同类工具太多（comby、sd、ast-grep），红海 |
| 目录空间分析 TUI | 同类多（dust、duf），纯文本不好截图传播 |

---

## 目录结构（随开发更新）

```
bin/githeat.mjs      可执行入口（薄壳，只调用 main）
src/cli.mjs          参数解析 + heat / check / install-hook 三个子命令
src/git.mjs          唯一碰 git 的地方：spawnSync 包装 + git log 解析
src/analyze.mjs      核心算法：过滤噪声 → 归一化 → 打分 → 分档
src/treemap.mjs      squarified treemap 布局（Bruls/Huizing/van Wijk 算法）
src/colors.mjs       三套色阶（ember / viridis / mono）+ 对比色计算
src/svg.mjs          零依赖 SVG 热力图（可嵌 README）
src/report.mjs       单文件 HTML 报告（内嵌 SVG + 可筛选可排序表格）
src/terminal.mjs     终端 ANSI 彩色热力表 + 目录汇总
src/index.mjs        对外 API（给脚本和 bot 用）
test/                node:test 测试，含真实临时仓库的集成测试
```

---

## 关键技术决策（备查）

1. **churn 的定义**：本项目把 churn 定义为"文件在每次提交中被修改的累计次数"，
   而不是精确的行数增删。原因：`--name-only` 解析极快且稳，而行级 `--numstat`
   在二进制/重命名/超大仓库上又慢又容易失真。这是一个刻意的工程取舍，已写进 README。
2. **打分公式**：`score = 100 × (0.68 × churn_norm + 0.32 × changes_norm) × 近期系数`，
   其中归一化用 **log 尺度 + 90 分位锚点**，避免一个巨型生成文件把所有文件压成 0。
   近期系数最低 0.8（一年未改动打折 20%），让"正在烂的文件"排前面。
3. **噪声过滤**：lockfile、`node_modules/`、`dist/`、二进制、图片、min.js 等直接排除，
   否则噪音会淹没信号。
4. **零依赖**：不引任何 npm 包，测试用 Node 内置 `node:test`。发布体积 = 源码体积。
5. **三种色彩模式**：ember（默认，冷→热）、viridis（色盲友好）、mono（黑白打印）。

---

## 待办 / 进行中

- [x] 项目骨架（package.json / LICENSE / .gitignore）
- [x] 核心链路：git 解析 → 打分 → treemap → SVG/HTML/终端
- [x] CLI 三个子命令
- [ ] 测试套件（含真实临时仓库集成测试）
- [ ] README（英文主文档 + 中文说明）+ 演示图
- [ ] 在真实开源仓库上跑一遍验证
- [ ] git 初始化并提交
