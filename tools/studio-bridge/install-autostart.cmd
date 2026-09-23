@echo off
rem ---------------------------------------------------------------------------
rem Start the Jarvis Studio renderer at login, and start it now.
rem
rem Run this once. After it, Studio's "Make the film" works on this PC without
rem anyone remembering to open a window first. Undo it with uninstall-autostart.
rem ---------------------------------------------------------------------------
setlocal
set "HERE=%~dp0"
title Jarvis Studio - install the renderer

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not on this PC's PATH, so the renderer cannot run.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

powershell -NoProfile -Command "$q=[char]34; $h=$env:HERE; $lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Jarvis Studio renderer.lnk'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($lnk); $s.TargetPath='wscript.exe'; $s.Arguments=$q+(Join-Path $h 'start-hidden.vbs')+$q; $s.WorkingDirectory=$h; $s.Description='Jarvis Studio local video renderer'; $s.Save(); Write-Host ('Installed: ' + $lnk)"
if errorlevel 1 (
  echo Could not write the Startup shortcut.
  pause
  exit /b 1
)

echo Starting it now...
wscript "%HERE%start-hidden.vbs"

powershell -NoProfile -Command "for($i=0;$i -lt 20;$i++){ try { Invoke-RestMethod -Uri 'http://127.0.0.1:42010/health' -TimeoutSec 2 | Out-Null; Write-Host 'The renderer is up. Studio can make films on this PC.'; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; Write-Host 'It has not answered yet - see out\bridge.log.'; exit 1"

echo.
echo Done. It will start again every time you sign in to Windows.
pause
