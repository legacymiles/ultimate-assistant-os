<#
  EA World > Terminals - start the three outside terminals.

    OpenTerminal  -> http://localhost:3400  (its API on :4400)
    Vibe-Trading  -> http://localhost:8899
    Fincept       -> desktop window

  Ports are fixed because EA World > Terminals looks for them there, and kept
  off 3000 so they never collide with the hub's own dev server.

    powershell -ExecutionPolicy Bypass -File tools\ea-terminals\start.ps1
    powershell -ExecutionPolicy Bypass -File tools\ea-terminals\start.ps1 -Only openterminal
#>
param(
  [string]$Root = (Join-Path $env:USERPROFILE "Projects\ea-terminals"),
  [ValidateSet("all", "openterminal", "vibe-trading", "fincept")]
  [string]$Only = "all"
)

$ErrorActionPreference = "Stop"

if ($Only -in @("all", "openterminal")) {
  $dir = Join-Path $Root "OpenTerminal"
  if (Test-Path (Join-Path $dir "package.json")) {
    # Each service gets its port from the environment of its own window.
    $cmd = "`$env:PORT='3400'; `$env:API_PORT='4400'; `$env:API_URL='http://localhost:4400'; Set-Location '$dir'; npm run dev"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd -WindowStyle Minimized
    Write-Host "OpenTerminal starting on http://localhost:3400"
  } else {
    Write-Host "OpenTerminal is not installed - run install.ps1 -Only openterminal" -ForegroundColor Yellow
  }
}

if ($Only -in @("all", "vibe-trading")) {
  $vt = Join-Path $Root "vibe-trading-venv\Scripts\vibe-trading.exe"
  if (Test-Path $vt) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$vt' serve --port 8899" -WindowStyle Minimized
    Write-Host "Vibe-Trading starting on http://localhost:8899"
  } else {
    Write-Host "Vibe-Trading is not installed - run install.ps1 -Only vibe-trading" -ForegroundColor Yellow
  }
}

if ($Only -in @("all", "fincept")) {
  $exe = Get-ChildItem -Path "$env:ProgramFiles", "${env:ProgramFiles(x86)}", "$env:LOCALAPPDATA\Programs" -Filter "FinceptTerminal.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) {
    Start-Process -FilePath $exe.FullName
    Write-Host "Fincept Terminal opening"
  } else {
    Write-Host "Fincept is not installed - run install.ps1 -Only fincept" -ForegroundColor Yellow
  }
}
