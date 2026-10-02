<#
一键推到 GitHub

用法（在 PowerShell 里，于本文件夹执行）：
  .\push-to-github.ps1 -User 你的GitHub用户名

会做四件事：把占位用户名替换成你的、提交、加 remote、推送。
前提：先在 GitHub 网页上建好一个空仓库，名字建议就叫 githeat，
      不要勾选 Add README / .gitignore / license，否则首次 push 会冲突。
#>

param(
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Repo = "githeat",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($User -eq "xiaozhenweiyan") {
  Write-Warning "xiaozhenweiyan 只是占位用户名，请填你自己的 GitHub 用户名。"
}

# 1) 把各文件里的占位地址替换成真实地址
$placeholder = "xiaozhenweiyan"
$files = @("package.json", "README.md", "README.zh-CN.md", "CONTRIBUTING.md", "CHANGELOG.md")
$touched = @()
foreach ($f in $files) {
  if (-not (Test-Path $f)) { continue }
  $text = Get-Content $f -Raw
  if ($text -like "*$placeholder*") {
    Set-Content -Path $f -Value ($text -replace $placeholder, $User) -NoNewline
    $touched += $f
  }
}
if ($touched.Count -gt 0) { Write-Host "已替换占位用户名：$($touched -join ', ')" }

# 2) 提交（有改动才提交）
git add -A
if ((git status --porcelain).Length -gt 0) {
  git commit -q -m "chore: point repository metadata at $User/$Repo"
  Write-Host "已提交元数据改动"
} else {
  Write-Host "元数据无需改动"
}

# 3) 配置 remote
$url = "https://github.com/$User/$Repo.git"
$existing = git remote get-url origin 2>$null
if ($existing) {
  git remote set-url origin $url
  Write-Host "已更新 origin -> $url"
} else {
  git remote add origin $url
  Write-Host "已添加 origin -> $url"
}

# 4) 推送
git branch -M $Branch 2>$null
git push -u origin $Branch

Write-Host ""
Write-Host "完成。仓库地址：https://github.com/$User/$Repo"
Write-Host "提醒两件事："
Write-Host "  1. 去仓库 Settings 填 Description 和 Topics（cli, git, hotspots, code-health, treemap, churn），"
Write-Host "     这直接影响能不能被别人搜到。"
Write-Host "  2. 想发 npm 的话执行 npm publish（需要你自己的 npm 账号，我没有也不该有）。"
