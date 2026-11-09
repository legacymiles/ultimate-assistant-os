@echo off
rem Stop the EA Lab runner starting at sign-in, and stop it now.
setlocal
title EA Lab - remove the runner

powershell -NoProfile -Command "$lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\EA Lab runner.lnk'; if(Test-Path $lnk){ Remove-Item $lnk -Force; Write-Host ('Removed: ' + $lnk) } else { Write-Host 'It was not installed.' }"

rem Whatever holds 42030 is the runner, however it was started.
powershell -NoProfile -Command "$p=(Get-NetTCPConnection -LocalPort 42030 -State Listen -ErrorAction SilentlyContinue).OwningProcess; if($p){ $p | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force; Write-Host ('Stopped pid ' + $_) } } else { Write-Host 'It was not running.' }"

echo.
echo Your EAs, runs and reports are still in C:\EA-Lab.
pause
