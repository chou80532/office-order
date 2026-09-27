@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
cd /d "%~dp0\..\.." || goto :root_error
where node >nul 2>&1 || goto :node_error
if not exist "package.json" goto :root_error
if not exist "firebase.json" goto :root_error
node "%~dp0reset-local-data.cjs"
if errorlevel 1 goto :fail
pause
exit /b 0
:root_error
echo [錯誤] 找不到 Office Order 開源專案根目錄。
goto :fail
:node_error
echo [錯誤] 找不到 Node.js。
:fail
pause
exit /b 1
