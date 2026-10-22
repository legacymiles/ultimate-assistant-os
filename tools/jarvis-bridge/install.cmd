@echo off
rem ---------------------------------------------------------------------------
rem Set up New Jarvis's local agent, start it, start it at every login, and
rem pair it.
rem
rem Run this once. After it, New Jarvis can drive a real browser, run commands,
rem read files and see the screen on this PC, and it can do all of that again
rem tomorrow without anyone remembering to open a window first.
rem
rem Undo the login part with uninstall-autostart.cmd. Pairing is automatic
rem now (the page asks the agent); pair.cmd is only a manual backup.
rem ---------------------------------------------------------------------------
setlocal
set "HERE=%~dp0"
title New Jarvis - install the local agent
cd /d "%HERE%"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not on this PC's PATH, so the agent cannot run.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

echo [1/4] Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo npm install failed. The agent will still run, but without browser control.
)

echo.
echo [2/4] Downloading the browser New Jarvis drives ^(about 150 MB, once^)...
call npx --yes playwright install chromium
if errorlevel 1 (
  echo Chromium did not install. Everything except browser control will still work.
)

echo.
echo [3/4] Starting it, now and at every sign-in...
powershell -NoProfile -Command "$q=[char]34; $h=$env:HERE; $lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\New Jarvis agent.lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath='wscript.exe'; $s.Arguments=$q+(Join-Path $h 'start-hidden.vbs')+$q; $s.WorkingDirectory=$h; $s.Description='New Jarvis local agent'; $s.Save(); Write-Host ('  Installed: ' + $lnk)"
if errorlevel 1 (
  echo Could not write the Startup shortcut.
  pause
  exit /b 1
)

wscript "%HERE%start-hidden.vbs"

powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){ try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:42020/health' -TimeoutSec 2; Write-Host ''; Write-Host '  The agent is up.'; if(-not $r.capabilities.browser){ Write-Host '  Browser control is OFF - Chromium did not install.' }; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; Write-Host '  It has not answered yet - see out\bridge.log.'; exit 1"

echo.
echo [4/4] Opening Jarvis - it connects to this PC by itself.
start "" "https://ultimate-assistant-os.vercel.app/apps/jarvis"
echo.
echo   Done. Jarvis starts with Windows from now on, and fixes itself if
echo   this folder ever moves. You can close this window.
timeout /t 8 >nul
