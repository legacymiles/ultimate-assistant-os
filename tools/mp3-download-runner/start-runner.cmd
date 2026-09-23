@echo off
REM Double-click to start the MP3 Download runner.
REM It asks the hub in .env (HUB_URL) for YouTube jobs and fetches them here,
REM because yt-dlp lives on this PC and not on the website's server.
REM Leave this window open while you are downloading; Ctrl+C stops it.
cd /d "%~dp0"
title MP3 Download runner
node runner.mjs
echo.
echo The runner stopped. Press any key to close.
pause >nul
