@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
cd /d "%~dp0\..\.." || goto :root_error
if not exist "package.json" goto :root_error
where git >nul 2>&1 || goto :git_error
git rev-parse --show-toplevel >nul 2>&1 || goto :repo_error
git status --short
for /f "delims=" %%L in ('git status --porcelain') do set "DIRTY=1"
if defined DIRTY goto :dirty_error
for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not defined BRANCH goto :branch_error
git remote get-url origin >nul 2>&1 || goto :remote_error
git fetch origin || goto :fetch_error
git pull --ff-only origin "%BRANCH%" || goto :pull_error
git log -1 --oneline
echo [完成] 目前分支已安全同步。
pause
exit /b 0
:root_error
echo [錯誤] 找不到 repository root 或 package.json。
goto :fail
:git_error
echo [錯誤] 找不到 Git，請先安裝 Git。
goto :fail
:repo_error
echo [錯誤] 目前目錄不是 Git repository。
goto :fail
:dirty_error
echo [錯誤] 目前有尚未提交的修改，為避免 Pull 造成衝突，已停止同步。
goto :fail
:branch_error
echo [錯誤] 目前不是有效的 Git branch。
goto :fail
:remote_error
echo [錯誤] 找不到 origin remote。
goto :fail
:fetch_error
echo [錯誤] Git fetch 失敗。
goto :fail
:pull_error
echo [錯誤] 無法以 fast-forward 同步；請人工檢查分支。
:fail
pause
exit /b 1
