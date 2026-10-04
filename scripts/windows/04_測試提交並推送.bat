@echo off
chcp 65001 >nul
rem Keep this file ASCII-only: cmd.exe can resume at the wrong byte offset in UTF-8
rem batch files after goto. The workflow and its messages live in commit-and-push.cjs.
cd /d "%~dp0\..\.." || goto :root_error
where node >nul 2>&1 || goto :node_error
node "%~dp0commit-and-push.cjs"
if errorlevel 1 goto :fail
pause
exit /b 0
:root_error
echo [ERROR] Cannot find the repository root.
goto :fail
:node_error
echo [ERROR] Node.js was not found.
:fail
pause
exit /b 1
