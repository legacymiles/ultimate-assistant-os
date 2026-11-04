@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Jarvis - password import
color 0B

echo.
echo   ============================================
echo    Jarvis  -  Chrome password import
echo   ============================================
echo.

if not exist "package.json" (
  echo   ERROR: this file must sit in the Jarvis project folder.
  echo   Expected to find package.json next to it.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo   ERROR: Node.js was not found. Install it, then run this again.
  echo.
  pause
  exit /b 1
)

set count=0
for %%F in (chrome-passwords*.csv) do set /a count+=1

if !count!==0 (
  echo   No chrome-passwords*.csv found in this folder.
  echo.
  echo   How to make one:
  echo     1. In Chrome, open  chrome://password-manager/settings
  echo     2. Click  Export passwords  and save the file HERE
  echo     3. Name it  chrome-passwords-profile2.csv  ^(any name starting
  echo        with "chrome-passwords" works^)
  echo.
  echo   You can drop several files here at once - they import together.
  echo.
  pause
  exit /b 1
)

echo   Found !count! CSV file^(s^). Importing...
echo.
echo   You will be asked for a master password.
echo   Pick one you will remember, and WRITE DOWN the recovery key it prints.
echo.

node scripts/import-chrome-passwords.mjs run --apply

echo.
echo   --------------------------------------------
echo   When Jarvis shows your logins correctly:
echo     - delete the CSV files in this folder
echo     - delete the "backups" folder
echo   Both contain readable passwords.
echo   --------------------------------------------
echo.
pause