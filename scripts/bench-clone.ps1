# Clone two large real repositories (metadata only) for benchmarking.
# ASCII only: Windows PowerShell 5.1 parses BOM-less .ps1 as the ANSI codepage.
param([int]$Attempts = 5)

$ErrorActionPreference = "Continue"
$work = Join-Path $env:TEMP "githeat-bench"
New-Item -ItemType Directory -Path $work -Force | Out-Null
Set-Location $work

$repos = @(
  @{ name = "vue";     url = "https://github.com/vuejs/core" },
  @{ name = "express"; url = "https://github.com/expressjs/express" }
)

foreach ($r in $repos) {
  $dir = Join-Path $work $r.name
  if (Test-Path (Join-Path $dir ".git")) {
    $n0 = git -C $dir rev-list --count HEAD 2>$null
    if ($n0) { Write-Host ("SKIP {0} ({1} commits, already usable)" -f $r.name, $n0); continue }
    Write-Host ("REMOVE broken partial clone: {0}" -f $r.name)
    Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
  }
  $done = $false
  for ($attempt = 1; $attempt -le $Attempts -and -not $done; $attempt++) {
    if ($attempt -gt 1) {
      $wait = 8 * $attempt
      Write-Host ("  retry {0}/{1} for {2} in {3}s" -f $attempt, $Attempts, $r.name, $wait)
      Start-Sleep -Seconds $wait
      Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
    }
    # --depth keeps the transfer small; enough history for a meaningful benchmark.
    $sw = [Diagnostics.Stopwatch]::StartNew()
    git clone -q --filter=blob:none --no-checkout --depth 5000 $r.url $dir 2>&1 | Out-Null
    $code = $LASTEXITCODE
    $sw.Stop()
    $n = git -C $dir rev-list --count HEAD 2>$null
    if ($code -eq 0 -and $n) {
      Write-Host ("OK   {0}: {1} commits in {2}s" -f $r.name, $n, [math]::Round($sw.Elapsed.TotalSeconds))
      $done = $true
    } else {
      Write-Host ("  attempt {0} failed (exit {1}, commits '{2}')" -f $attempt, $code, $n)
    }
  }
  if (-not $done) { Write-Host ("GIVE UP {0}" -f $r.name) }
}
Write-Host "clone phase finished"
