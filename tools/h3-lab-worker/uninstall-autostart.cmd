@echo off
rem Stop the H3 Prompt Lab worker starting at login, and stop it now.
setlocal
set "HERE=%~dp0"
title H3 Prompt Lab - remove the worker

powershell -NoProfile -Command "$lnk=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\H3 Prompt Lab worker.lnk'; if(Test-Path $lnk){ Remove-Item $lnk -Force; Write-Host ('Removed: ' + $lnk) } else { Write-Host 'It was not installed.' }"

rem The worker has no port, so it is found by the full path of worker.mjs on its
rem command line. That catches the hidden copy and any window started by hand.
rem WanGP itself is left running: it may be serving the studio bridge too.
powershell -NoProfile -Command "$w=(Join-Path $env:HERE 'worker.mjs'); $p=Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like ('*' + $w + '*') }; if($p){ $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Stopped pid ' + $_.ProcessId) } } else { Write-Host 'It was not running.' }"

echo.
echo The lab will show the PC worker as offline until you start it again.
pause
