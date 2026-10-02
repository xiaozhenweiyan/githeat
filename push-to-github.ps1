<#
把 githeat 推到 GitHub

用法（在本文件夹执行，一条就够）：
  .\push-to-github.ps1

默认推到 https://github.com/xiaozhenweiyan/githeat
要换用户名或仓库名：.\push-to-github.ps1 -User someone -Repo other-name
只检查不推送（干跑）：.\push-to-github.ps1 -DryRun

前提：先在浏览器里建好空仓库
  https://github.com/new?name=githeat&visibility=public
  不要勾选 Add README / .gitignore / license，否则首次 push 会冲突。
#>

param(
  [string]$User = "xiaozhenweiyan",
  [string]$Repo = "githeat",
  [string]$Branch = "main",
  [string]$ApiBase = "https://api.github.com",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$url = "https://github.com/$User/$Repo.git"
Write-Host ""
Write-Host "目标仓库：$url" -ForegroundColor Cyan

# 0) 远端仓库是否已经建好（只用公开 API 探测，不发任何凭据）
$remoteExists = $false
try {
  $resp = Invoke-WebRequest -Uri "$ApiBase/repos/$User/$Repo" -UseBasicParsing -TimeoutSec 10
  $remoteExists = $true
  Write-Host "远端仓库已存在（HTTP $($resp.StatusCode)）" -ForegroundColor Green
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 404) {
    Write-Host "远端仓库还不存在（404）。请先打开下面这个链接建好，再跑本脚本：" -ForegroundColor Yellow
    Write-Host "  https://github.com/new?name=$Repo&visibility=public" -ForegroundColor Yellow
    if (-not $DryRun) { exit 3 }
  } else {
    Write-Host "探测远端失败（$code），仍会尝试推送。" -ForegroundColor Yellow
  }
}

# 1) 元数据里的用户名兜底（默认用户名下无需改动）
$defaultUser = "xiaozhenweiyan"
if ($User -ne $defaultUser) {
  $files = @("package.json", "README.md", "README.zh-CN.md", "CONTRIBUTING.md", "CHANGELOG.md")
  $touched = @()
  foreach ($f in $files) {
    if (-not (Test-Path $f)) { continue }
    $text = Get-Content $f -Raw
    if ($text -like "*$defaultUser*") {
      Set-Content -Path $f -Value ($text -replace $defaultUser, $User) -NoNewline
      $touched += $f
    }
  }
  if ($touched.Count -gt 0) {
    Write-Host "已替换占位用户名：$($touched -join ', ')"
    git add -A
    git commit -q -m "chore: point repository metadata at $User/$Repo"
  }
}

# 2) 配置 remote
# 注意：PS 5.1 下 `git remote get-url origin` 在没有 origin 时会往 stderr 写字，
# 配合 $ErrorActionPreference="Stop" 会直接中断脚本，所以先列名字再取值。
$remotes = @(git remote)
$existing = if ($remotes -contains "origin") { (git remote get-url origin) } else { $null }
if ($existing) {
  if ($existing -ne $url) {
    git remote set-url origin $url
    Write-Host "已更新 origin -> $url"
  } else {
    Write-Host "origin 已正确指向 $url"
  }
} else {
  git remote add origin $url
  Write-Host "已添加 origin -> $url"
}

git branch -M $Branch 2>$null
Write-Host "=== 待推送的提交 ==="
git log --oneline | Select-Object -First 10

if (-not $remoteExists -and -not $DryRun) {
  Write-Host ""
  Write-Host "远端仓库不存在，已停下（没有推送）。建好仓库后再运行一次本脚本。" -ForegroundColor Yellow
  exit 3
}

if ($DryRun) {
  Write-Host ""
  Write-Host "干跑结束，没有推送。去掉 -DryRun 即可真正推送。" -ForegroundColor Cyan
  exit 0
}

# 3) 推送（会弹窗让你登录 GitHub，凭据只有你自己输入，我看不到也不保存）
Write-Host ""
Write-Host "开始推送……如果弹出登录窗口，用你的 GitHub 账号登录即可。" -ForegroundColor Cyan
git push -u origin $Branch

Write-Host ""
Write-Host "完成：https://github.com/$User/$Repo" -ForegroundColor Green
Write-Host "接下来两件小事（都影响能不能被搜到）："
Write-Host "  1. 仓库页右侧 About 齿轮 -> 填 Description 和 Topics，内容见 docs/launch.md"
Write-Host "  2. 想发 npm：npm publish（需要你自己的 npm 账号）"
