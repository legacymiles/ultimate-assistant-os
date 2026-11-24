@echo off
REM Double-click to start the H3 Prompt Lab worker in a window.
REM It polls the hub in .env (HUB_URL), renders on WanGP's MiniMax H3, measures
REM the clips with ffmpeg and keeps the lab's agent ticking. Ctrl+C stops it.
cd /d "%~dp0"
title H3 Prompt Lab worker
if not exist ".env" (
  echo There is no .env here yet. Copy .env.example to .env and paste your worker token into it.
  echo Mint the token in the H3 Prompt Lab, on the H3 Connection page.
  pause
  exit /b 1
)
node worker.mjs %*
echo.
echo The worker stopped. Press any key to close.
pause >nul
