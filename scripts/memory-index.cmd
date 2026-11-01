@echo off
rem ---------------------------------------------------------------------------
rem Refresh the folder index in Jarvis's memory. What the scheduled task runs.
rem
rem A wrapper rather than a bare command in the task because three things have
rem to be true and none of them is the default:
rem   * --root is passed explicitly, so the script finds .env.local wherever the
rem     Task Scheduler decides to start us (it does not inherit a working dir);
rem   * node is called by full path, because a task started before logon does
rem     not necessarily have the user PATH;
rem   * the output goes to a log, because a scheduled run nobody can read is a
rem     scheduled run nobody can trust. Task Scheduler keeps only the exit code.
rem
rem Safe to run by hand, and safe to run twice: unchanged chunks are skipped.
rem Register it with scripts/install-memory-index-task.ps1.
rem ---------------------------------------------------------------------------

set REPO=C:\dev\claude-code-files
set LOG=%REPO%\.data\memory-index.log
set NODE=C:\Program Files\nodejs\node.exe

if not exist "%REPO%\.data" mkdir "%REPO%\.data"

echo ===== %DATE% %TIME% =====>> "%LOG%"
"%NODE%" "%REPO%\scripts\sync-folder-rag.mjs" --root "%REPO%" >> "%LOG%" 2>&1
set CODE=%ERRORLEVEL%
echo ----- exit %CODE% ----->> "%LOG%"
exit /b %CODE%
