@echo off
cd /d "%~dp0"
title Jarvis - password agent
color 0A
echo.
echo   Starting the password agent. Leave this window OPEN.
echo   Closing it drops your master key from memory.
echo.
node scripts/password-agent.mjs
echo.
echo   Agent stopped.
pause