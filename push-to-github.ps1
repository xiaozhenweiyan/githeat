# 一键推到 GitHub
#
# 用法（在 PowerShell 里，于本文件夹执行）：
#   .\push-to-github.ps1 -User 你的GitHub用户名
#
# 会做四件事：把 package.json 里的占位用户名改成你的、提交、加 remote、推送。
# 前提：你已经先在 GitHub 网页上建好了一个**空仓库**，名字建议就叫 githeat
#      （不要勾选 Add README / .gitignore / license，否则首次 push 会冲突）。

param(
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Repo = 'githeat',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ($User -eq 'xiaozhenweiyan') {
  Write-Warning 'xiaozhenweiyan 只是我写的占位用户名，请填你自己的 GitHub 用户名。'
}

# 1) 把 package.json / README 里的占位地址替换成真实地址
$placeholder = 'xiaozhenweiyan'
$files = @('package.json', 'README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'CHANGELOG.md')
$touched = @()
foreach ($f in $files) {
  if (-not (Test-Path $f)) { continue }
  $text = Get-Content $f -Raw
  if ($text -like "*$placeholder*") {
    Set-Content $f -Value ($text -replace $placeholder, $User) -NoNewline
    $touched += $f
  }
}
if ($touched.Count -gt 0) { "已替换占位用户名：$($touched -join ', ')" }

# 2) 提交（有改动才提交）
git add -A
if ((git status --porcelain).Length -gt 0) {
  git commit -q -m "chore: point repository metadata at $User/$Repo"
  "已提交元数据改动"
} else {
  "元数据无需改动"
}

# 3) 配置 remote
$url = "https://github.com/$User/$Repo.git"
$existing = git remote get-url origin 2>$null
if ($existing) {
  git remote set-url origin $url
  "已更新 origin -> $url"
} else {
  git remote add origin $url
  "已添加 origin -> $url"
}

# 4) 推送
git branch -M $Branch 2>$null
git push -u origin $Branch

"`n完成。仓库地址：https://github.com/$User/$Repo"
"提醒两件事："
"  1. 去仓库 Settings 填 Description 和 Topics（cli, git, hotspots, code-health, treemap, churn），"
"     这直接影响能不能被别人搜到。"
"  2. 想发 npm 的话：npm publish（需要你自己的 npm 账号，我没有也不该有）。"
