@echo off
rem ---------------------------------------------------------------------------
rem Start the H3 Prompt Lab worker at login, and start it now.
rem
rem Run this once, after .env has your worker token. From then on the lab's
rem renders, measurements and agent ticks run on this PC without anyone opening
rem a window. Undo it with uninstall-autostart.
rem ---------------------------------------------------------------------------
setlocal
set "HERE=%~dp0"
title H3 Prompt Lab - install the worker

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not on this PC's PATH, so the worker cannot run.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "%HERE%.env" (
  echo There is no .env yet. Copy .env.example to .env, paste your worker token
  echo from the lab's H3 Connection page, then run this again.
  pause
  exit /b 1
)

powershell -NoProfile -Command "$q=[char]34; $h=$env:HERE; $lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\H3 Prompt Lab worker.lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath='wscript.exe'; $s.Arguments=$q+(Join-Path $h 'start-hidden.vbs')+$q; $s.WorkingDirectory=$h; $s.Description='H3 Prompt Lab PC worker'; $s.Save(); Write-Host ('Installed: ' + $lnk)"
if errorlevel 1 (
  echo Could not write the Startup shortcut.
  pause
  exit /b 1
)

rem Only one worker: stop any copy already running from this folder first.
powershell -NoProfile -Command "$w=(Join-Path $env:HERE 'worker.mjs'); Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like ('*' + $w + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Stopped an older worker, pid ' + $_.ProcessId) }"

echo Starting it now...
wscript "%HERE%start-hidden.vbs"

echo.
echo Done. It starts again every time you sign in to Windows.
echo Its log is %HERE%out\worker.log - the lab's H3 Connection page shows it as online within a few seconds.
pause
