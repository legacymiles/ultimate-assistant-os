@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Jarvis - password vault setup
color 0B

echo.
echo   ============================================
echo    Jarvis  -  password vault
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
  echo   No chrome-passwords*.csv here, so this will:
  echo     - create the vault
  echo     - seal every password still stored in the clear
  echo.
  echo   To ALSO import Chrome exports, save them in this folder named
  echo   chrome-passwords-*.csv and run this again.
  echo.
) else (
  echo   Found !count! CSV file^(s^). Importing them as well.
  echo.
)

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
echo.
echo   To run the browser extension afterwards:
echo     npm run passwords:agent
echo   --------------------------------------------
echo.
pause