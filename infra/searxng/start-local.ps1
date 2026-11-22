# ---------------------------------------------------------------------------
# SearXNG on this machine, for while the laptop is on.
#
#   cd infra\searxng
#   .\start-local.ps1
#
# No TLS, no Caddy, no token: it binds to 127.0.0.1 only, so nothing outside
# this machine can reach it. That is also why the hub prefers it — a search
# that never leaves the laptop is both free and private — and why it can only
# be the first choice for code RUNNING here. `npm run dev` gets it; the
# deployed site cannot, and falls through to the VPS.
#
# Needs Docker Desktop. If `docker` is missing, the script says so and stops
# rather than guessing.
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Say  { param($m) Write-Host "`n== $m" -ForegroundColor Cyan }
function Warn { param($m) Write-Host "!! $m" -ForegroundColor Yellow }

Say "Docker"
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($null -eq $docker) {
  Warn "Docker isn't installed. Install Docker Desktop, then run this again:"
  Write-Host "    winget install Docker.DockerDesktop" -ForegroundColor Gray
  Write-Host "  Without it, the hub just uses the VPS instance instead — nothing breaks." -ForegroundColor Gray
  exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Warn "Docker is installed but not running. Start Docker Desktop and run this again."
  exit 1
}
Write-Host "Docker is up."

Say "Secret"
# A local instance still needs a secret_key, and it is worth keeping the same
# one across restarts so sessions in the SearXNG UI survive.
$envFile = Join-Path $PSScriptRoot ".env.local"
if (-not (Test-Path $envFile)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  @(
    "SEARXNG_SECRET=$secret",
    "SEARXNG_BASE_URL=http://localhost:8080/",
    "SEARXNG_BIND=127.0.0.1",
    "SEARXNG_WORKERS=2"
  ) | Set-Content -Path $envFile -Encoding utf8
  Write-Host "Wrote .env.local with a fresh secret."
} else {
  Write-Host "Using the existing .env.local."
}

Say "Starting SearXNG"
docker compose --env-file .env.local --profile local pull
docker compose --env-file .env.local --profile local up -d
if ($LASTEXITCODE -ne 0) { Warn "Compose failed — see the output above."; exit 1 }

Say "Waiting for the JSON API"
# The JSON API, not the container's health: a stock settings.yml serves HTML
# only, and that is the failure worth catching here rather than in the hub.
$ok = $false
foreach ($i in 1..30) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/search?q=ping&format=json" -TimeoutSec 5 -UseBasicParsing
    if ($response.Content -match '"results"') { $ok = $true; break }
  } catch { }
  Start-Sleep -Seconds 2
  Write-Host "." -NoNewline
}
Write-Host ""

if (-not $ok) {
  Warn "SearXNG didn't answer on the JSON API."
  Warn "Check searxng\settings.yml still has 'formats: [html, json]', then: docker compose logs -f searxng"
  exit 1
}

Write-Host "`nSearXNG is answering at http://127.0.0.1:8080" -ForegroundColor Green
Write-Host @"

Add this to .env.local in the repo root (NOT this folder's .env.local):

  SEARXNG_LOCAL_URL=http://127.0.0.1:8080

Then restart `npm run dev`. The Search Infrastructure dashboard
(/apps/search-infrastructure) will show "This machine" at the head of the chain.

  Stop it:    docker compose --env-file .env.local --profile local down
  Watch it:   docker compose --env-file .env.local --profile local logs -f searxng
  Its own UI: http://127.0.0.1:8080
"@ -ForegroundColor Gray
