@echo off
rem ---------------------------------------------------------------------------
rem Start the DTF print station from this folder.
rem It downloads print jobs into the export folder and shows them at
rem http://127.0.0.1:7316 . It never prints by itself. Close this window to stop.
rem ---------------------------------------------------------------------------
setlocal
set "HERE=%~dp0"
title DTF print station
cd /d "%HERE%"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed on this PC, so the print station cannot run.
  echo Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "%HERE%station.config.json" (
  echo There is no station.config.json in %HERE%
  echo Copy station.config.example.json to station.config.json, paste the token
  echo from DTF Production ^> Print bridge, then run this again.
  pause
  exit /b 1
)

node "%HERE%station.mjs" %*
if errorlevel 1 pause
