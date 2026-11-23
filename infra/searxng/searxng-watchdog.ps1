# Is SearXNG answering? If not, re-trigger the boot task.
#
# This exists for a specific reason: the boot task holds WSL open by blocking
# forever, and Windows stops a scheduled task after 72 hours by default. That
# limit cannot be changed without re-supplying the task's stored password, so
# instead of fighting it, this notices the stack is down and starts it again.
# It covers every other way it could stop too - a crash, a WSL hiccup, someone
# ending the process.
#
# Runs as SYSTEM: starting a password-protected task does NOT require the
# password, only changing it does.
$ErrorActionPreference = "Continue"
$url = "https://search.bighomieai.com/search?q=ping&format=json"

# 401 is the healthy answer - the bearer gate refusing an untokened request.
# Anything that is not an HTTP status at all means nothing is listening.
$code = 0
try {
    $r = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 15 -UseBasicParsing -ErrorAction Stop
    $code = [int]$r.StatusCode
} catch {
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode } else { $code = 0 }
}

$stamp = (Get-Date).ToString("s")
if ($code -eq 401 -or $code -eq 200) {
    Add-Content -Path "C:\searxng-watchdog.log" -Value "$stamp up ($code)"
    exit 0
}

Add-Content -Path "C:\searxng-watchdog.log" -Value "$stamp DOWN ($code) - restarting"
schtasks /Run /TN "SearXNG boot" 2>&1 | Out-Null

# Keep the log from growing without bound on a box nobody logs into.
$log = "C:\searxng-watchdog.log"
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 200kb)) {
    Get-Content $log -Tail 500 | Set-Content "$log.tmp"
    Move-Item "$log.tmp" $log -Force
}
