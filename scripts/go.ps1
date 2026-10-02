<#
一步到位：建仓库 + 推代码 + 填仓库信息

用法（就这一条）：
  cd "E:\爆火软件"
  .\scripts\go.ps1

它会弹出提示让你粘贴一次 GitHub token（输入时不显示），然后自动做完所有事。
token 只存在于这次运行的内存里：不写文件、不回显、不存 git config，跑完自动清除。

没有 token 的话，先去这里生成一个（勾 Administration 和 Contents = Read and write）：
  https://github.com/settings/personal-access-tokens/new
#>

param(
  [string]$User = "xiaozhenweiyan",
  [string]$Repo = "githeat",
  [string]$Branch = "main",
  [string]$Description = "Find the git files that quietly cost you the most - hotspot ranking + SVG heatmap. Zero dependencies.",
  [string[]]$Topics = @("cli", "git", "hotspots", "churn", "code-health", "treemap", "heatmap", "developer-tools", "refactoring", "nodejs"),
  [string]$ApiBase = "https://api.github.com"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ""
Write-Host "=== githeat 一键发布 ===" -ForegroundColor Cyan
Write-Host ""

# ---------- 取 token：优先环境变量，否则提示粘贴（不显示输入） ----------
if ($env:GH_TOKEN) {
  Write-Host "使用当前会话里已有的 `$env:GH_TOKEN" -ForegroundColor Green
  $secure = $null
} else {
  Write-Host "请粘贴你的 GitHub token，然后回车（输入时不会显示，直接粘贴即可）：" -ForegroundColor Yellow
  $secure = Read-Host -AsSecureString
}

$plain = $null
if ($secure) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
} else {
  $plain = $env:GH_TOKEN
}

$token = $plain.Trim()
if (-not $token) {
  Write-Host "没有拿到 token，退出。请去 https://github.com/settings/personal-access-tokens/new 生成一个。" -ForegroundColor Red
  exit 2
}

$headers = @{
  Authorization          = "Bearer $token"
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

# ---------- 1. 验证身份 ----------
Write-Host ""
Write-Host "[1/5] 验证 token……" -ForegroundColor Cyan
try {
  $me = (Invoke-GitHub -Method GET -Uri "$ApiBase/user").Content | ConvertFrom-Json
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Host "      token 无效或权限不足（HTTP $status）。" -ForegroundColor Red
  Write-Host "      检查两件事：token 没过期；Permissions 里 Administration 和 Contents 都给了 Read and write。" -ForegroundColor Yellow
  exit 1
}
Write-Host "      身份确认：$($me.login)" -ForegroundColor Green
if ($me.login -ne $User) {
  Write-Host "      注意：token 属于 $($me.login)，目标按这个账号走。" -ForegroundColor Yellow
  $User = $me.login
}

# ---------- 2. 建仓库 ----------
Write-Host "[2/5] 创建仓库 $User/$Repo ……" -ForegroundColor Cyan
try {
  $repoObj = (Invoke-GitHub -Method POST -Uri "$ApiBase/user/repos" -Body @{
      name        = $Repo
      description = $Description
      private     = $false
      has_issues  = $true
      has_wiki    = $false
      auto_init   = $false
    }).Content | ConvertFrom-Json
  Write-Host "      已创建：$($repoObj.html_url)" -ForegroundColor Green
  $created = $true
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  if ($status -eq 422) {
    Write-Host "      仓库已存在，跳过创建（不会覆盖任何东西）。" -ForegroundColor Yellow
    $created = $false
  } else {
    Write-Host "      创建失败（HTTP $status）。" -ForegroundColor Red
    exit 1
  }
}

# ---------- 3. 配置 remote ----------
Write-Host "[3/5] 配置 git remote ……" -ForegroundColor Cyan
$url = "https://github.com/$User/$Repo.git"
$remotes = @(git remote)
if ($remotes -contains "origin") { git remote set-url origin $url } else { git remote add origin $url }
git branch -M $Branch 2>$null
Write-Host "      origin -> $url" -ForegroundColor Green

# ---------- 4. 推送 ----------
Write-Host "[4/5] 推送代码……" -ForegroundColor Cyan
$authHeader = "AUTHORIZATION: bearer $token"
git -c "http.extraHeader=$authHeader" push -u origin $Branch
if ($LASTEXITCODE -ne 0) {
  Write-Host "      推送失败（HTTP 403 通常是 token 缺少 Contents 写权限）。" -ForegroundColor Red
  Write-Host "      代码还在本地，补好权限后再跑一次本脚本即可，不会重复建仓库。" -ForegroundColor Yellow
  exit 1
}
Write-Host "      推送完成。" -ForegroundColor Green

# ---------- 5. 仓库信息 ----------
Write-Host "[5/5] 填写 Description 与 Topics ……" -ForegroundColor Cyan
try {
  Invoke-GitHub -Method PATCH -Uri "$ApiBase/repos/$User/$Repo" -Body @{ description = $Description } | Out-Null
  Invoke-GitHub -Method PUT -Uri "$ApiBase/repos/$User/$Repo/topics" -Body @{ names = $Topics } | Out-Null
  Write-Host "      已设置 Description 与 $($Topics.Count) 个 Topics。" -ForegroundColor Green
} catch {
  Write-Host "      这步失败不影响代码，可稍后在网页上手工填：$($_.Exception.Message)" -ForegroundColor Yellow
}

# ---------- 收尾：把 token 从内存和会话里清掉 ----------
$token = $null
$plain = $null
$headers = $null
Remove-Item Env:\GH_TOKEN -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "全部完成：https://github.com/$User/$Repo" -ForegroundColor Green
if ($created) { Write-Host "（仓库是这次新建的）" }
Write-Host ""
Write-Host "最后一步：去 https://github.com/settings/personal-access-tokens 把这个 token 删掉。" -ForegroundColor Yellow
Write-Host "推广文案在 docs/launch.md，Description 和 Topics 已经替你填好了。" -ForegroundColor Cyan
