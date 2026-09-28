@echo off
rem Stop the local cobalt server starting at login, and stop it now.
setlocal
title cobalt - remove autostart

powershell -NoProfile -Command "$lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\cobalt link-to-video.lnk'; if(Test-Path $lnk){ Remove-Item $lnk -Force; Write-Host ('Removed: ' + $lnk) } else { Write-Host 'It was not installed.' }"

rem Whatever holds 42030 is cobalt, however it was started - a window from
rem start.cmd, the hidden one, or a copy run by hand. Going by the port rather
rem than the command line is the only way to catch all three.
powershell -NoProfile -Command "$p=(Get-NetTCPConnection -LocalPort 42030 -State Listen -ErrorAction SilentlyContinue).OwningProcess; if($p){ $p | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force; Write-Host ('Stopped pid ' + $_) } } else { Write-Host 'It was not running.' }"

echo.
echo Link imports will fall back to yt-dlp alone until you install it again.
pause
