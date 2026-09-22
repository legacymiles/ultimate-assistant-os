# Start the Realtime Lucy GPU server with a config the card can actually hold.
#
#   powershell -File tools/realtime-lucy/start.ps1
#   powershell -File tools/realtime-lucy/start.ps1 -Size 288*384   # override
#
# Why this exists: size is the one setting that decides whether this works.
# Measured on an RTX 3050 6 GB (bench/RESULTS.md): 384x288 allocates ~7.2 GB,
# the Windows driver spills it into system RAM and one chunk takes 20.7 s;
# 256x192 fits in 5.2 GB and a chunk takes 2.6 s. Over the card it is not
# "slow", it looks broken.
#
# Ctrl+C stops the server. Redirect stdout if you want a log file.

param(
  [int]$Port = 8765,
  [string]$Size = "",
  [string]$Token = ""
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Join-Path $env:USERPROFILE "realtime-lucy"
$python = Join-Path $root "venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
  Write-Host "No venv at $python - see tools/realtime-lucy/README.md for the install."
  exit 1
}

# How much VRAM the card reports, 0 if nvidia-smi is not usable. Native stderr
# is deliberately not redirected here: under PowerShell 5.1 that turns a plain
# warning line into a terminating NativeCommandError.
$vramMb = 0
$smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($smi) {
  $raw = & $smi.Source --query-gpu=memory.total --format=csv,noheader,nounits
  if ($LASTEXITCODE -eq 0 -and $raw) {
    $first = @($raw)[0]
    if ($first) { $vramMb = [int]($first.ToString().Trim()) }
  }
}

# Pick the config. A 12 GB card runs 288x384 comfortably; anything smaller
# gets the 192x256 config that was measured to fit in 5.2 GB.
if ($Size -eq "") {
  if ($vramMb -ge 11000) { $Size = "288*384" } else { $Size = "192*256" }
}
if ($Size -eq "288*384") { $attn = 9; $sink = 3 } else { $attn = 6; $sink = 2 }

if ($vramMb -gt 0) {
  $gb = [math]::Round($vramMb / 1024, 1)
  Write-Host "GPU reports $gb GB; running $Size with a $attn-latent KV window."
  if ($Size -eq "288*384" -and $vramMb -lt 11000) {
    Write-Host "WARNING: 288*384 wants ~7.2 GB. On this card it spills to system RAM (~21 s per chunk)."
  }
} else {
  Write-Host "nvidia-smi unavailable - assuming a small card, running $Size."
}

$serverArgs = @(
  (Join-Path $here "server\server.py"),
  "--port", "$Port",
  "--size", "$Size",
  "--chunk_size", "1",
  "--local_attn_size", "$attn",
  "--sink_size", "$sink"
)
if ($Token -ne "") { $serverArgs += @("--token", $Token) }

Write-Host "Loading the model (20-30 s). The dot on /apps/realtime-lucy goes green when it is ready."
Write-Host "It then warms the six preset prompts while idle, so picking one is instant."

& $python @serverArgs
