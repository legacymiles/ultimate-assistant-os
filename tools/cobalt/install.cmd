@echo off
rem ---------------------------------------------------------------------------
rem Fetch and build the local cobalt server. Run this once.
rem ---------------------------------------------------------------------------
setlocal
title cobalt - install
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not on this PC's PATH, so cobalt cannot be built.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

node install.mjs
if errorlevel 1 (
  echo.
  echo Install failed - see the message above.
  pause
  exit /b 1
)
pause
