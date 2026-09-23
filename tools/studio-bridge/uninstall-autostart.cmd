@echo off
rem Stop the Jarvis Studio renderer starting at login, and stop it now.
setlocal
title Jarvis Studio - remove the renderer

powershell -NoProfile -Command "$lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Jarvis Studio renderer.lnk'; if(Test-Path $lnk){ Remove-Item $lnk -Force; Write-Host ('Removed: ' + $lnk) } else { Write-Host 'It was not installed.' }"

rem Whatever holds 42010 is the bridge, however it was started - a window from
rem start.cmd, the hidden one, or a copy run by hand. Going by the port rather
rem than the command line is the only way to catch all three.
powershell -NoProfile -Command "$p=(Get-NetTCPConnection -LocalPort 42010 -State Listen -ErrorAction SilentlyContinue).OwningProcess; if($p){ $p | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force; Write-Host ('Stopped pid ' + $_) } } else { Write-Host 'It was not running.' }"

echo.
echo Studio will say the local renderer is off until you install it again.
pause
