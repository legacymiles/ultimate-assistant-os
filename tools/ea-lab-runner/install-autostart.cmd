@echo off
rem ---------------------------------------------------------------------------
rem Start the EA Lab runner at sign-in, start it now, and open the page.
rem
rem Run this once on the VPS (or any Windows machine with MetaTrader 4). After
rem it, http://127.0.0.1:42030 is EA Lab on that machine. Undo it with
rem uninstall-autostart.
rem ---------------------------------------------------------------------------
setlocal
set "HERE=%~dp0"
title EA Lab - install the runner

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed on this machine, so the EA Lab runner cannot run.
  echo Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "%HERE%ui\index.html" (
  echo The EA Lab page is missing from %HERE%ui
  echo Copy the whole ea-lab-runner folder, including ui\, and run this again.
  pause
  exit /b 1
)

powershell -NoProfile -Command "$q=[char]34; $h=$env:HERE; $lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\EA Lab runner.lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath='wscript.exe'; $s.Arguments=$q+(Join-Path $h 'start-hidden.vbs')+$q; $s.WorkingDirectory=$h; $s.Description='EA Lab - MetaTrader EA backtest runner'; $s.Save(); Write-Host ('Installed: ' + $lnk)"
if errorlevel 1 (
  echo Could not write the Startup shortcut.
  pause
  exit /b 1
)

echo Starting it now...
wscript "%HERE%start-hidden.vbs"

powershell -NoProfile -Command "for($i=0;$i -lt 20;$i++){ try { Invoke-RestMethod -Uri 'http://127.0.0.1:42030/health' -TimeoutSec 2 | Out-Null; Write-Host 'The runner is up.'; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; Write-Host 'It has not answered yet - see out\runner.log.'; exit 1"
if errorlevel 1 (
  pause
  exit /b 1
)

start "" http://127.0.0.1:42030

echo.
echo Done. EA Lab is open in your browser at http://127.0.0.1:42030
echo The runner starts again every time you sign in to Windows.
pause
