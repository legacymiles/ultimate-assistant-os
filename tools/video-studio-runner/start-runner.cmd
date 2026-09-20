@echo off
REM Double-click to start the Video Studio Arena runner.
REM It polls the hub in .env (HUB_URL) and renders the jobs that need a local
REM engine. Leave this window open while you are rendering; Ctrl+C stops it.
cd /d "%~dp0"
title Video Studio Arena runner
node runner.mjs
echo.
echo The runner stopped. Press any key to close.
pause >nul
