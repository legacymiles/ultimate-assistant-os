@echo off
rem ---------------------------------------------------------------------------
rem Start the local cobalt server at login, and start it now.
rem
rem Run this once, after install.cmd. After it, every hub app that imports from
rem a pasted link has a second engine behind yt-dlp without anyone remembering
rem to open a window first. Undo it with uninstall-autostart.
rem ---------------------------------------------------------------------------
setlocal
set "HERE=%~dp0"
title cobalt - install autostart

if not exist "%HERE%app\api\src\cobalt.js" (
  echo cobalt is not built yet. Run install.cmd first.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not on this PC's PATH, so cobalt cannot run.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

powershell -NoProfile -Command "$q=[char]34; $h=$env:HERE; $lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\cobalt link-to-video.lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath='wscript.exe'; $s.Arguments=$q+(Join-Path $h 'start-hidden.vbs')+$q; $s.WorkingDirectory=$h; $s.Description='cobalt - local link-to-video engine for the hub'; $s.Save(); Write-Host ('Installed: ' + $lnk)"
if errorlevel 1 (
  echo Could not write the Startup shortcut.
  pause
  exit /b 1
)

echo Starting it now...
wscript "%HERE%start-hidden.vbs"

powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){ try { $r=Invoke-RestMethod -Uri 'http://localhost:42030/' -TimeoutSec 2; Write-Host ('cobalt ' + $r.cobalt.version + ' is up, serving ' + $r.cobalt.services.Count + ' sites.'); exit 0 } catch { Start-Sleep -Milliseconds 500 } }; Write-Host 'It has not answered yet - see out\cobalt.log.'; exit 1"

echo.
echo Done. It will start again every time you sign in to Windows.
echo Make sure .env.local has:  COBALT_API_URL=http://localhost:42030/
pause
