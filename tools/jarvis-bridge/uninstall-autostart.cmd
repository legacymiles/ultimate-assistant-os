@echo off
rem Stop New Jarvis's local agent starting at sign-in, and stop the one running.
rem The token, the browser profile and its logins are left alone, so running
rem install.cmd again puts everything back without a re-pair.
setlocal
title New Jarvis - remove the local agent from startup

powershell -NoProfile -Command "$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\New Jarvis agent.lnk'; if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host ('  Removed: ' + $lnk) } else { Write-Host '  It was not set to start at sign-in.' }"

rem Stop the running agent by the PORT it holds, not by image name: there are
rem other node processes on this machine and stopping the wrong one is a silent
rem way to break a render.
rem
rem The port, specifically, and not the command line. Started from the Startup
rem shortcut the command line carries the full script path and matching it
rem works; started from start.cmd it is only "node server.mjs", matches
rem nothing, and this would report success while the agent kept running — which
rem is the worst of the three outcomes, because nobody goes and checks.
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 42020 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($p) { Stop-Process -Id $p -Force; Write-Host ('  Stopped the agent, pid ' + $p) } else { Write-Host '  Nothing was running.' }"

rem The browser it drove is a child that outlives it. Only the one running out
rem of this bridge's own profile, so a Chrome the owner has open stays open.
powershell -NoProfile -Command "$n = 0; Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*jarvis-bridge*browser-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ }; if ($n) { Write-Host ('  Closed its browser (' + $n + ' processes).') }"

echo.
echo   Done. New Jarvis will now say the local agent is offline, and everything
echo   that does not need this PC keeps working.
pause
