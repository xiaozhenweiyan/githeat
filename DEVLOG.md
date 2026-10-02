# DEVLOG · 开发与决策日志

> 这份日志记录 AI 助手在这个文件夹里做过的每一件事：决定了什么、为什么这么做、踩了哪些坑。
> 你可以随时独自翻阅，不需要问我。倒序更新，最新的在最上面。
> 项目本身叫 **githeat**（git 热点热力图 CLI）。
>
> 日志里不写密钥、不写 token、不写任何账号信息。

---

## 2026-02-14 · 第五轮：仓库上线了

**结果：https://github.com/xiaozhenweiyan/githeat 已经公开，代码全部推上去了。**

### 这一轮踩的坑，按顺序

1. **fine-grained token 建仓库被拒（403）**
   GitHub 的响应头写得很清楚：`x-accepted-github-permissions: administration=write; repository_creation=write`，
   正文是 `Resource not accessible by personal access token`。
   也就是说那个 token 缺"建仓库"权限。我们在设置页里死活找不到权限入口
   （很可能是那个 token 并非从标准的细粒度页面生成，点进去没有权限编辑界面）。
   **结论：这种情况别恋战，直接换 classic token。** classic 只要勾一个 `repo`，
   就同时包含建仓库和推代码，不用在几十个权限项里翻。

2. **`git -c http.extraHeader` 推不上去**
   我原以为可以用一次性 header 传 token，避免凭据落盘。
   实测失败：Git Credential Manager 无视了这个 header，转头去要交互式用户名，
   报 `could not read Username for 'https://github.com'`，退出码 128。
   **这条只在"不需要认证的远端"（比如本地裸仓库）上看起来是成功的** ——
   我之前的验证就是这么骗过自己的，值得记一笔教训：
   *本地裸仓库测不出认证问题，因为它根本不认证。*
   最后的做法：**临时**把 remote URL 换成 `https://user:token@github.com/...`，
   推完立刻 `git remote set-url` 还原成干净地址，并核验 `.git/config` 里没有 token 残留。

3. **README 里写了跑不通的命令**
   `npm i -g githeat` 和 `npx githeat` 在包还没发布时必然 404。
   首页教人做一件会失败的事，比首页丑更伤。已全部改成
   `git clone` + `node bin/githeat.mjs`，并且本地实跑验证过示例命令。
   `docs/launch.md` 里给 HN/X 的文案同样清掉了 `npx`。

### 上线后的核验（都做了，不是"应该没问题"）

| 检查 | 结果 |
| --- | --- |
| 本地 main 与 origin/main 的 sha | 一致 ✅ |
| README 首屏那张图（`docs/demo.svg`） | HTTP 200，`image/svg+xml`，9 KB ✅ |
| Description / Topics | 已设置，10 个 topics ✅ |
| 默认分支 / 可见性 | main / 公开 ✅ |
| `.git/config` 有无 token | 无 ✅ |

### 给自己留的两条待办

- **token 权限过宽**：那个 classic token 实际带了 `admin:enterprise`、`admin:org`、`delete_repo`、
  `delete:packages`、`admin:ssh_signing_key` 等一大堆我用不到的权限。我只需要 `repo`。
  虽然能用，但泄漏面太大，应当重新生成一个只勾 `repo` 的。
- **还没发 npm**：发了之后 README 就能回到 `npx githeat` 那种最顺的用法。

---

## 2026-02-14 · 第四轮：token 全自动建仓库 + 推送

你问"你不能直接帮我建仓库吗"，然后选了让我全做完（B 方案）。这轮就是把这件事变成
**你只需要设置一次环境变量、再跑一条命令**。

### 1. 先说清楚我为什么一开始做不到

建仓库需要一个身份凭据，而这台机器上当时没有任何一个：

| 检查 | 结果 |
| --- | --- |
| `gh` CLI | 未安装 |
| Windows 凭据管理器里的 github 项 | 无 |
| `git config --global credential.helper` | 空 |
| 无头浏览器代你点 | 试过，拉 GitHub 页面拿不到内容（DOM 和截图都空），修不好，不假装能 |

所以不是不愿意，是**手里真的没有钥匙**。现在这把钥匙是你自己给的临时 token。

### 2. token 的处理约定（这是这轮最重要的部分）

新增 `scripts/create-and-push.ps1`，它对 token 的处理写死在代码里：

- **只从 `$env:GH_TOKEN` 读**，不接受命令行参数（命令行会留在 PowerShell 历史里）
- **不写进任何文件**，不打印，不回显，不放进 remote URL
- 推送时用 `git -c http.extraHeader=...` **只作用于那一条命令**，推送完即失效
  —— 已实测确认 `.git/config` 里不含 token
- 脚本结束前 `Remove-Item Env:\GH_TOKEN` 清掉会话变量
- 做完会提醒你去 Revoke 那个 token

**已实测的三种状态**（不是"应该能行"）：

| 场景 | 结果 |
| --- | --- |
| 没设 `GH_TOKEN` | 明确提示怎么设，退出码 **2** |
| token 无效 | `[1/5]` 阶段 401 停下，退出码 **1**，不产生半个仓库 |
| 推送链路 | 用本地裸仓库验证：带 header 推送成功、远端收到提交、config 无 token 残留 |

### 3. 这轮又踩的坑（都是 PowerShell 的参数坑）

1. 我给脚本加了个 `-ApiBase` 参数方便测试，结果替换工具把它自己也替换了，
   变成 `[string]$ApiBase = "$ApiBase"`（自己赋给自己）。
   **教训**：批量替换要保护"定义那一行"，我在替换函数里加了负向断言来跳过它。
2. 用完的一次性修复工具 `scripts/fix-ps1.mjs` 已删除 —— 工具类脚本用完就扔，
   不要留在仓库里当噪音。

### 4. 现在你要做的（两条命令，token 只出现在第一条里）

```powershell
# 1) 粘贴你的 token 后回车（注意：这一步 token 会显示在你自己的终端上，这是正常的）
$env:GH_TOKEN = "github_pat_xxxxxxxx"

# 2) 建仓库 + 推代码 + 填 Description/Topics，一次做完
cd "E:\爆火软件"
.\scripts\create-and-push.ps1

# 3) 立刻撤销 token（脚本也会提醒你）
#    https://github.com/settings/personal-access-tokens
```

做完之后：仓库地址是 https://github.com/xiaozhenweiyan/githeat ，
Description 和 10 个 Topics 我都会顺手填好，你直接进 `docs/launch.md` 第 2 节挑文案发帖就行。

---

## 2026-02-14 · 第三轮：发布准备工作（D老师这个称呼从此节开始）

### 1. 一个我判断失误的地方

我先前把 `xiaozhenweiyan` 当成"我随手写的占位用户名"，因为我是从 `git config --global user.name`
（值是 `xiaozhen_weiyan`）推出来的，觉得本地昵称未必等于 GitHub 用户名。

你反问了一句"有没有一种可能我就叫这个"，我去查了 GitHub API：

```
GET https://api.github.com/users/xiaozhenweiyan  ->  200
  login: xiaozhenweiyan
  name:  xiaozhen_weiyan     ← 和你的 git 配置逐字一致
  id:    217602791
  public_repos: 13, followers: 0
GET https://api.github.com/repos/xiaozhenweiyan/githeat -> 404
```

结论：**账号真实存在且就是你本人**；`githeat` 仓库还没建。
我的"占位符"结论错了一半 —— 仓库判断是对的，把真人账号叫占位符是武断的。
已把脚本里的警告改掉，`-User` 默认值直接设成 `xiaozhenweiyan`。

### 2. 环境侦察（决定了最后那一下为什么必须你本人按）

| 检查项 | 结果 | 影响 |
| --- | --- | --- |
| `gh` CLI | 未安装 | 我无法用命令行替你建仓库 |
| Windows 凭据管理器里的 github 项 | 无 | 没有可复用的登录态 |
| `git config --global credential.helper` | 空 | 推送时会弹窗，凭据只有你能输入 |

所以我能做到"推到门口"，最后一步必须你在浏览器点一下 —— 这其实是最好的分工，
你不需要把 token 给我，我也不需要承担它的风险。

### 3. PowerShell 中文脚本的两个坑（都踩了，都修了）

写 `push-to-github.ps1` 时连续翻车两次，记下来免得以后再犯：

1. **PS 5.1 按 GBK 读没有 BOM 的 `.ps1`** —— 我的中文注释被读成乱码，
   连里面的中文引号都变了，直接报 `The string is missing the terminator`。
   修法：给文件加 UTF-8 BOM（用 Node 加，别用 PowerShell 自己加，否则循环套娃）。
2. **`$ErrorActionPreference = "Stop"` + 原生命令写 stderr = 脚本中断** ——
   `git remote get-url origin` 在没有 origin 时会往 stderr 输出 `error: No such remote`，
   PS 5.1 会把它当终止性错误直接掐断脚本（即使 `2>$null` 也拦不住）。
   修法：先 `git remote` 列名字，再决定要不要取值，绕开 stderr。

### 4. 这一轮新增

- `push-to-github.ps1`：现在可以**干跑**（`-DryRun`）。它会先用公开 API 探测仓库是否存在，
  404 就明确告诉你"先去建仓库"并退出码 3，建好了再跑一次才真正推送。
  已用本地裸仓库端到端验证过推送链路。
- `docs/launch.md`：发布与推广手册。包含仓库 Description/Topics 的填法、
  V2EX/掘金/HN/Reddit/X 五套可直接复制的文案、一周动作清单，
  以及一份"会毁掉项目"的反例清单。
  里面明确要求：**文案必须主动写明 AI 参与、以及还没在超大仓库上实测** ——
  这两件事被人指出来的伤害远大于自己先说。
- `origin` 已经配好指向 `https://github.com/xiaozhenweiyan/githeat.git`，
  所以推送只剩"建仓库 + 跑脚本"。

### 5. 现在只剩你要做的两步

```
1) 打开  https://github.com/new?name=githeat&visibility=public
   仓库名填 githeat，公开，不要勾 Add README / .gitignore / license

2) 回到本文件夹执行：
   .\push-to-github.ps1
   （会弹 GitHub 登录窗口，登录一下就行，凭据不用给我）
```

推完之后按 `docs/launch.md` 第 0 节把 Description 和 Topics 填上，然后按第 4 节的时间表发出去。

---

## 2026-02-14 · 第二轮：把首屏图渲染出来看，抓到一个真算法 bug

### 最重要的发现：treemap 的宽高比公式写反了

我原本以为图已经没问题了，为了确认，用 Edge 无头模式把 `docs/demo.svg` 渲染成 PNG 看了
一眼 —— 结果整张图是 **15 条全宽的横条**，完全不像热力图。

排查过程（值得记）：

1. 先怀疑数据太偏斜（前几个文件占 90% churn）→ 调平数据，还是横条。
2. 直接量化布局结果：15 个方块的宽高比是 **20~60**，也就是每条都是极窄长条。
3. 对比手算：n 个文件放进 2:1 的画布，方块本该接近正方形（比例 ≈1.3）。
4. 定位到 `worst()` —— squarify 用来选择"把哪些方块排成一行"的代价函数。
   我把公式写成了

   ```js
   max(side² · max / s²,  s² / (side² · min))
   ```

   即两个象限的**分子分母都写反了**，第一项在"方块越方"时反而越大，
   于是算法一路认为"再加一块会更糟"，每行只放一块 → 全宽横条。

   正确写法是直接算每个方块的真实宽高比：

   ```js
   thickness = rowArea / min(box.w, box.h)
   length    = tileArea / thickness
   ratio     = max(thickness / length, length / thickness)
   return Math.max(...ratios)
   ```

   修好后：15 个偏斜数据的最大宽高比从 60.4 降到 **1.59**，
   4 个等值方块完美排成 2×2 正方形网格。

5. **关键反思**：我原来那个"面积铺满 + 不重叠"的测试**完全测不出这个 bug** ——
   横条布局同样铺满、同样不重叠。测试只验证了不变量，没验证"好不好看"。
   于是补了一个断言真实宽高比的回归测试（`< 2.5`）。

**教训**：布局/视觉代码必须**渲染出来看**，不变量测试在这种地方是假安全感。

### 其他补充

- 生成图脚本加了"热点文件被顺带卷入其他提交"的模拟，让 churn 分布更接近真实仓库。
- `check` 在"没有任何文件达到 min-commits"时不再只报 OK，而是先给一行 WARN，
  避免在刚起步的仓库里给出虚假的安心感。
- 临时文件 `scripts/inspect-report.mjs`（用来核对 HTML 报告里的数字）用完已删除。

---

## 2026-02-14 · 第一轮：从选型到 37 个测试全绿

### 1. 起意与选型

**你的需求**：在无干预的情况下，独立造出一个「有希望在 GitHub 拿到 10 star」的项目。

**我的判断**：拿 star 的公式不是"功能多"，而是 `真实痛点 × 立刻看懂 × 零门槛试用 × 可截图传播`。
所以定下四条硬标准：

1. **真实痛点**：开发者会反复用，不是玩具。
2. **零依赖**：`npx githeat` 直接跑，不装依赖 —— 装机门槛越低，star 越多。
3. **有画面**：产出自带话题的图（热力图），天生适合 README 首屏和社交媒体。
4. **能自动化**：能进 CI、能当 git hook，才有"长期留在工具箱里"的理由。

**最终选型**：`githeat` —— 分析 git 历史，找出**热点文件**（改得最多、最容易出 bug 的文件），
终端用彩色热力柱排序，并能导出**零依赖、可嵌入 README 的 SVG 热力图**。

**为什么是热点分析**：

- 有 20 年实证研究背书（hotspot / churn analysis）：**修改频率比代码复杂度更能预测缺陷**。
- 商业工具（CodeScene）在做，开源侧只有零散 shell 脚本，缺一个"开箱即用 + 出图"的 CLI。
- 门槛极低：一条命令，不用配置、不上传代码、纯本地离线。

**被否掉的方案**（记录一下，免得以后反复摇摆）：

| 方案 | 否掉原因 |
| --- | --- |
| AI 会话 token 统计器 | 依赖特定工具的数据格式，受众窄 |
| 文本 diff / 正则批量替换 | 同类的 comby、sd、ast-grep 已占满，红海 |
| 目录空间分析 TUI | 同类多（dust、duf），纯文本也不好截图传播 |

### 2. 交付物

```
bin/githeat.mjs      可执行入口（薄壳）
src/cli.mjs          参数解析 + heat / check / install-hook
src/git.mjs          唯一碰 git 的地方：spawnSync 包装 + git log 解析
src/analyze.mjs      核心算法：过滤 → 归一化 → 打分 → 分档
src/treemap.mjs      squarified treemap 布局
src/colors.mjs       三套色阶 + 对比色
src/svg.mjs          零依赖 SVG 热力图
src/report.mjs       单文件 HTML 报告
src/terminal.mjs     终端彩色热力表 + 目录汇总
src/index.mjs        对外 API
test/                37 个测试（unit + 真实临时仓库的端到端）
docs/demo.svg        README 首屏图（脚本生成，合成历史，不随提交抖动）
```

### 3. 测试抓出来的真 bug（值得一读）

写完第一版我以为能跑了，结果 `node --test` 抓出一串问题，其中 4 处是真缺陷：

1. **用了提交者日期而不是作者日期**（最严重）
   `git log --pretty=%cI` 拿的是 committer date。rebase / squash merge 会重写它，
   结果每个文件看起来都"刚刚改过"，近期加权完全失真。改成 `%aI`。
2. **`--since` 和 `--until` 的语义在 git 里根本不一样**
   实测结论：`--since` 按**作者日期**过滤，`--until` 按**提交者日期**过滤。
   原来的写法会让 `--until 2024-03-08` 在 rebase 过的仓库上返回空结果。
   现在 `--until` 不交给 git，两端统一在 JS 里按作者日期精确过滤（UTC，含当天）。
3. **裸日期按本地时区解释**
   `git log --since=2024-03-01` 在不同机器上结果不同。现在裸日期补成 `T00:00:00Z`，
   并且 git 子进程固定 `TZ=UTC`，报告可复现。
4. **拼错的参数被静默忽略**
   `--nope` 以前会被吃掉然后给你一份默认报告 —— 现在直接报错退出 2。
5. 空仓库（刚 `git init`）会喷 git 的 fatal 原文 —— 现在给一句人能看懂的解释。
6. 剩下 2 处是我自己把测试期望写错了（例如 fixture 里 "2 files" 实际是 3 files）——
   测试的错，不是代码的错，但同样值得记下来。

**教训**：日期语义这种东西必须写测试，靠"看起来对"是过不去的。

### 4. 在真实仓库上验证（这是最有价值的一步）

克隆了两个真仓库跑：`chalk`（359 提交）和 `slugify`（78 提交）。

第一次跑出来第一名是 `package.json`，第二名 `readme.md` —— **信号的灾难**：
它们被改得最勤，但从来不需要调试。于是加了 **源码扩展名白名单**（默认只算代码），
可用 `--ext ""` 关掉。改完后 `chalk` 的榜首变成 `source/index.js`，这才像话。

性能实测（热缓存，本机）：`node -e 0` 启动就要 0.18s，
`chalk` 全量分析 0.74s，其中 git 自身 0.26s —— JS 侧其实是便宜的那部分。
数字都写进了 `docs/benchmark.md`，没有夸大；超过 400 提交的仓库我**没有**实测，
文档里也照实说了没测。

### 5. 关键技术决策（备查）

1. **churn 的定义**：文件在每次提交中被修改的累计次数，而不是精确行数增删。
   取舍原因：`--name-only` 极快且稳，行级 `--numstat` 在大仓库上又慢又容易失真。已写进 README。
2. **打分公式**：`score = 100 × (0.68 × churn归一 + 0.32 × 次数归一) × 近期系数`。
   归一化用 **log 尺度 + 90 分位锚点**，避免一个巨型生成文件把其他文件压成 0；
   近期系数最低 0.8（一年没动降 20% 紧急度）。
3. **噪声过滤**：lockfile、`node_modules/`、`dist/`、二进制、图片、min.js、以及非源码文件。
4. **零依赖**：不引任何 npm 包，测试用 Node 内置 `node:test`。
5. **三套色阶**：ember（默认）、viridis（色盲友好）、mono（黑白打印）。
6. **README 首屏图用合成历史生成**（`npm run demo`），这样图不会因为你每次提交而变。

### 6. 当前状态

- [x] 37 个测试全绿（含真实临时仓库端到端）
- [x] 在 chalk / slugify 上验证过正确性与性能
- [x] README（英文 + 中文）、CONTRIBUTING、CHANGELOG、CI（三系统 × 三 Node 版本）
- [x] 本地已 `git init` + 首次提交（26 个文件）
- [ ] 等你 `git push` 到 GitHub（我没有你的凭据，也不该有）

**关于 GitHub 账号 / token**：不需要给我，也不要发给我。
项目已经提交到本地仓库，你自己三条命令就能推上去（见下）。
把 token 贴进对话等于把它写进聊天记录和这份日志，风险远大于省下的那点力气。

### 7. 下一步该你做的（复制即用）

```powershell
cd "E:\爆火软件"
# 1) 先在 GitHub 网页上新建一个空仓库，名字建议就叫 githeat（不要勾 README / .gitignore）
git remote add origin https://github.com/<你的用户名>/githeat.git
git push -u origin main
```

推上去之后想拿 star，最有效的三件事（按性价比排序）：

1. **把 README 首屏那张图当门面** —— `docs/demo.svg` 已经在仓库里，首页直接显示。
2. **去 Reddit r/programming、Hacker News (Show HN)、V2EX / 掘金发一贴**，
   标题写具体的收益（"我给 git 历史做了张热力图，一眼看出哪些文件在拖后腿"），
   别写"重磅神器"这种词，技术社区反感到条件反射。
3. **拿 3~5 个真实仓库跑一遍，把输出贴进讨论区** —— 有真实数据的工具才有人愿意信。

### 8. 还没做、但值得做的（留给下一轮）

- `react`（约 1.5 万提交）级别仓库的实测数据 —— 这次网络太慢，clone 超时被我掐了。
- 行级 churn（`--numstat`）做可选模式，给愿意等的人更精确的分数。
- `--format html` 里加"热点趋势"折线（需要按时间分桶，代码已经有一半基础）。
- 发布到 npm（`npm publish` 需要你的账号，我不碰）。
