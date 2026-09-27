@echo off
rem ---------------------------------------------------------------------------
rem Hand New Jarvis the key to this machine.
rem
rem Opens New Jarvis with the token in the URL **fragment**. A fragment is never
rem sent to any server — not to Vercel, not to a proxy, not into an access log —
rem so the key to this PC travels from this script to that tab and stops there.
rem The page stores it and strips it from the address bar immediately.
rem
rem It also lands on the clipboard, because the one-button path fails on a PC
rem with no default browser and the owner should not then have to go and find a
rem file.
rem
rem   pair.cmd                     pair the live hub
rem   pair.cmd http://localhost:3210   pair a dev server instead
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

if not exist "out\token.txt" (
  echo No token yet. Start the agent once ^(start.cmd^) and run this again.
  pause
  exit /b 1
)

set "BASE=%~1"
if "%BASE%"=="" set "BASE=https://ultimate-assistant-os.vercel.app"

powershell -NoProfile -Command "$t = (Get-Content 'out\token.txt' -Raw).Trim(); Set-Clipboard -Value $t; $u = $env:BASE + '/apps/new-jarvis#pair=' + $t; Write-Host ''; Write-Host '  Token copied to your clipboard.'; Write-Host ('  Opening ' + $env:BASE + '/apps/new-jarvis'); Start-Process $u"

echo.
echo   If the page did not open, paste the token into New Jarvis - Settings - Local agent.
echo.
pause
