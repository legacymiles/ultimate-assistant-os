@echo off
title EA Lab runner
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed on this machine, so the EA Lab runner cannot run.
  echo Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
start "" http://127.0.0.1:42030
node server.mjs
pause
