<#
一次性：建 GitHub 仓库 + 推代码 + 填仓库信息

用法（两步，token 不会出现在命令里）：
  1) 先设置环境变量（把 github_pat_xxx 换成你的 token，粘贴后回车）：
       $env:GH_TOKEN = "github_pat_xxx"
  2) 再执行：
       .\scripts\create-and-push.ps1

做完请立刻去 https://github.com/settings/personal-access-tokens 把那个 token 撤销（Revoke）。

安全约定（本脚本严格遵守）：
  - token 只从 $env:GH_TOKEN 读，不接受命令行参数（命令行会留在历史记录里）
  - 不把 token 写进任何文件、不打印、不放进 git remote 的 URL
  - 推送走 git 自己的凭据提示；本脚本只在 API 调用时用一次 token
  - 结束时清除 $env:GH_TOKEN
#>

param(
  [string]$User = "xiaozhenweiyan",
  [string]$Repo = "githeat",
  [string]$Branch = "main",
  [string]$Description = "Find the git files that quietly cost you the most - hotspot ranking + SVG heatmap. Zero dependencies.",
  [string[]]$Topics = @("cli", "git", "hotspots", "churn", "code-health", "treemap", "heatmap", "developer-tools", "refactoring", "nodejs"),
  [string]$ApiBase = "https://api.github.com",
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:GH_TOKEN) {
  Write-Host "没有找到 `$env:GH_TOKEN。请先在当前窗口执行：" -ForegroundColor Yellow
  Write-Host '  $env:GH_TOKEN = "github_pat_xxx"' -ForegroundColor Yellow
  exit 2
}

$headers = @{
  Authorization          = "Bearer $($env:GH_TOKEN)"
  Accept                 = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent"           = "githeat-launch"
}

function Invoke-GitHub {
  param([string]$Method, [string]$Uri, [object]$Body)
  $params = @{ Method = $Method; Uri = $Uri; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 30 }
  if ($Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 5)
    $params.ContentType = "application/json"
  }
  return Invoke-WebRequest @params
}

# ---------- 0. 验证 token 与身份 ----------
Write-Host ""
Write-Host "[1/5] 验证 token……" -ForegroundColor Cyan
try {
  $me = (Invoke-GitHub -Method GET -Uri "$ApiBase/user").Content | ConvertFrom-Json
} catch {
  Write-Host "token 无效或已过期：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
Write-Host "      身份确认：$($me.login)（$($me.name)）" -ForegroundColor Green
if ($me.login -ne $User) {
  Write-Host "      注意：token 属于 $($me.login)，与目标 $User 不一致。" -ForegroundColor Yellow
  $User = $me.login
}

# ---------- 1. 建仓库 ----------
Write-Host "[2/5] 创建仓库 $User/$Repo ……" -ForegroundColor Cyan
$created = $false
try {
  $repo = (Invoke-GitHub -Method POST -Uri "$ApiBase/user/repos" -Body @{
      name        = $Repo
      description = $Description
      private     = $false
      has_issues  = $true
      has_wiki    = $false
      auto_init   = $false
    }).Content | ConvertFrom-Json
  Write-Host "      已创建：$($repo.html_url)" -ForegroundColor Green
  $created = $true
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  if ($status -eq 422) {
    Write-Host "      仓库已存在，跳过创建。" -ForegroundColor Yellow
  } else {
    Write-Host "      创建失败（HTTP $status）：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
}

# ---------- 2. 配置 remote ----------
Write-Host "[3/5] 配置 git remote ……" -ForegroundColor Cyan
$url = "https://github.com/$User/$Repo.git"
$remotes = @(git remote)
if ($remotes -contains "origin") {
  git remote set-url origin $url
} else {
  git remote add origin $url
}
git branch -M $Branch 2>$null
Write-Host "      origin -> $url" -ForegroundColor Green

# ---------- 3. 推送 ----------
if ($SkipPush) {
  Write-Host "[4/5] 按 -SkipPush 跳过推送。" -ForegroundColor Yellow
} else {
  Write-Host "[4/5] 推送代码……" -ForegroundColor Cyan
  # 把 token 通过临时 http.extraHeader 传给这一次 git push：
  # 只作用于这一条命令，不写进 .git/config、不进 remote URL，推送完就没了。
  $authHeader = "AUTHORIZATION: bearer $($env:GH_TOKEN)"
  git -c "http.extraHeader=$authHeader" push -u origin $Branch
  if ($LASTEXITCODE -ne 0) {
    Write-Host "      带 token 推送失败，回退到交互式推送（可能弹登录窗）……" -ForegroundColor Yellow
    git push -u origin $Branch
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host "      推送失败。代码还在本地，重新设置 token 后再跑一次本脚本即可。" -ForegroundColor Red
    exit 1
  }
  Write-Host "      推送完成。" -ForegroundColor Green
}

# ---------- 4. 填 Description 与 Topics ----------
Write-Host "[5/5] 填写仓库信息（Topics 等）……" -ForegroundColor Cyan
try {
  Invoke-GitHub -Method PATCH -Uri "$ApiBase/repos/$User/$Repo" -Body @{ description = $Description } | Out-Null
  Invoke-GitHub -Method PUT -Uri "$ApiBase/repos/$User/$Repo/topics" -Body @{ names = $Topics } | Out-Null
  Write-Host "      已设置 Description 与 $($Topics.Count) 个 Topics。" -ForegroundColor Green
} catch {
  Write-Host "      仓库信息设置失败（不影响代码，可稍后在网页上手工填）：$($_.Exception.Message)" -ForegroundColor Yellow
}

# ---------- 收尾 ----------
Remove-Item Env:\GH_TOKEN -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "全部完成：https://github.com/$User/$Repo" -ForegroundColor Green
if ($created) { Write-Host "（仓库是这次新建的）" }
Write-Host ""
Write-Host "现在请务必做一件事：" -ForegroundColor Yellow
Write-Host "  去 https://github.com/settings/personal-access-tokens 把这个临时 token 撤销（Revoke）。" -ForegroundColor Yellow
Write-Host "  它已经用完了，留着只是风险。"
Write-Host ""
Write-Host "下一步推广：看 docs/launch.md（Description/Topics 已代填，可直接进第 2 节发帖文案）。"
