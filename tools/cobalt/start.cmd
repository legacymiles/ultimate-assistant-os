@echo off
title cobalt - local link-to-video engine
cd /d "%~dp0app\api"
node src/cobalt.js
pause
