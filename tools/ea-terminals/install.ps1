<#
  EA World > Terminals - one-time install of the three outside terminals.

    OpenTerminal   (MIT)      git clone + npm install           -> web on :3400, API on :4400
    Vibe-Trading   (MIT)      pip install into its own venv     -> web UI on :8899
    Fincept        (AGPL-3.0) download + run the Windows setup  -> desktop app

  Everything goes under -Root (default: %USERPROFILE%\Projects\ea-terminals),
  outside the hub repo, so none of it is ever committed or deployed to Vercel.

  Run from the hub folder:
    powershell -ExecutionPolicy Bypass -File tools\ea-terminals\install.ps1
  Re-running is safe: existing clones are pulled, the venv is upgraded, and the
  Fincept installer is only fetched if Fincept is not installed yet.
#>
param(
  [string]$Root = (Join-Path $env:USERPROFILE "Projects\ea-terminals"),
  [ValidateSet("all", "openterminal", "vibe-trading", "fincept")]
  [string]$Only = "all",
  [string]$FinceptVersion = "4.5.1"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Root | Out-Null

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "  missing: $cmd - $hint" -ForegroundColor Yellow
    return $false
  }
  return $true
}

# ---- OpenTerminal ---------------------------------------------------------
if ($Only -in @("all", "openterminal")) {
  Write-Host "`n== OpenTerminal" -ForegroundColor Cyan
  if ((Need git "install Git for Windows") -and (Need npm "install Node.js 20+ from nodejs.org")) {
    $dir = Join-Path $Root "OpenTerminal"
    if (Test-Path (Join-Path $dir ".git")) { git -C $dir pull --ff-only }
    else { git clone --depth 1 https://github.com/ErTasselli/OpenTerminal $dir }
    Push-Location $dir
    try { npm install --no-audit --no-fund } finally { Pop-Location }
    Write-Host "  ready: $dir"
  }
}

# ---- Vibe-Trading ---------------------------------------------------------
if ($Only -in @("all", "vibe-trading")) {
  Write-Host "`n== Vibe-Trading" -ForegroundColor Cyan
  $py = $null
  if (Get-Command py -ErrorAction SilentlyContinue) { $py = "py -3.11" }
  elseif (Get-Command python -ErrorAction SilentlyContinue) { $py = "python" }
  if (-not $py) {
    Write-Host "  missing: Python 3.11+ - install it from python.org (tick 'Add to PATH')" -ForegroundColor Yellow
  } else {
    $venv = Join-Path $Root "vibe-trading-venv"
    if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
      Invoke-Expression "$py -m venv `"$venv`""
    }
    $vpy = Join-Path $venv "Scripts\python.exe"
    & $vpy -m pip install --upgrade pip
    & $vpy -m pip install --upgrade vibe-trading-ai
    Write-Host "  ready: $venv"
    Write-Host "  next: run '$venv\Scripts\vibe-trading.exe init' once to pick an LLM provider" -ForegroundColor DarkGray
    Write-Host "        (OpenRouter with the hub's OPENROUTER_API_KEY works, or provider claude-cli to use your Claude Code login)" -ForegroundColor DarkGray
  }
}

# ---- Fincept Terminal -----------------------------------------------------
if ($Only -in @("all", "fincept")) {
  Write-Host "`n== Fincept Terminal" -ForegroundColor Cyan
  $exe = Get-ChildItem -Path "$env:ProgramFiles", "${env:ProgramFiles(x86)}", "$env:LOCALAPPDATA\Programs" -Filter "FinceptTerminal.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($exe) {
    Write-Host "  already installed: $($exe.FullName)"
  } else {
    $url = "https://github.com/Fincept-Corporation/FinceptTerminal/releases/download/v$FinceptVersion/FinceptTerminal-$FinceptVersion-windows-x64-setup.exe"
    $setup = Join-Path $Root "FinceptTerminal-$FinceptVersion-setup.exe"
    Write-Host "  downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $setup -UseBasicParsing
    Write-Host "  starting the installer - finish it in its own window"
    Start-Process -FilePath $setup -Wait
  }
}

Write-Host "`nDone. Start them with: powershell -ExecutionPolicy Bypass -File tools\ea-terminals\start.ps1" -ForegroundColor Green
