@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
cd /d "%~dp0\..\.." || goto :root_error
if not exist "package.json" goto :root_error
where git >nul 2>&1 || goto :git_error
where node >nul 2>&1 || goto :node_error
where npm >nul 2>&1 || goto :npm_error
where powershell >nul 2>&1 || goto :powershell_error
git rev-parse --show-toplevel >nul 2>&1 || goto :repo_error
git -c core.quotepath=false status
for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not defined BRANCH goto :branch_error
git remote get-url origin >nul 2>&1 || goto :remote_error
git fetch origin || goto :fetch_error
git show-ref --verify --quiet "refs/remotes/origin/%BRANCH%"
if errorlevel 1 goto :run_checks
git merge-base --is-ancestor "refs/remotes/origin/%BRANCH%" HEAD || goto :outdated_error
:run_checks
call :run_script lint || goto :checks_error
call :run_script test || goto :checks_error
call :run_script build || goto :checks_error
git ls-files --cached --others --exclude-standard -z | node "%~dp0check-sensitive-files.cjs" || goto :sensitive_error
echo [檢查] 目前可提交變更：
git -c core.quotepath=false status --short
echo 即將暫存、提交目前 Git 可提交變更，並推送到 origin/%BRANCH%。
set "ADD_CONFIRM="
set /p "ADD_CONFIRM=輸入 Y 確認暫存、提交並推送，其他輸入取消："
if /i not "%ADD_CONFIRM%"=="Y" goto :cancel
git add -A || goto :stage_error
git ls-files --cached --others --exclude-standard -z | node "%~dp0check-sensitive-files.cjs" || goto :unstage_sensitive_error
git -c core.quotepath=false diff --cached --name-only
git diff --cached --quiet
if not errorlevel 1 goto :nothing_error
git -c core.quotepath=false status
set "COMMIT_MESSAGE="
for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm'"') do set "COMMIT_MESSAGE=%%T"
set /p "COMMIT_MESSAGE=請輸入 Commit Message（直接 Enter 使用 %COMMIT_MESSAGE%）："
node -e "process.exit(process.env.COMMIT_MESSAGE?.trim()?0:1)" || goto :empty_message
powershell -NoProfile -Command "$m=$env:COMMIT_MESSAGE -replace [char]34, ([string][char]92 + [string][char]34); & git commit -m $m; exit $LASTEXITCODE" || goto :commit_error
git fetch origin || goto :post_fetch_error
git show-ref --verify --quiet "refs/remotes/origin/%BRANCH%"
if errorlevel 1 goto :first_push
git pull --ff-only origin "%BRANCH%" || goto :post_pull_error
git push origin "%BRANCH%" || goto :push_error
goto :done
:first_push
git push -u origin "%BRANCH%" || goto :push_error
:done
echo 目前 Branch: %BRANCH%
for /f "delims=" %%U in ('git remote get-url origin') do echo Remote URL: %%U
for /f "delims=" %%H in ('git rev-parse --short HEAD') do echo Commit Hash: %%H
git log -1 --pretty=format:"最新 Commit Message: %%s"
echo.
echo [完成] Commit 與 Push 已完成。
pause
exit /b 0
:run_script
node -e "const p=require('./package.json');process.exit(typeof p.scripts?.[process.argv[1]]==='string'?0:2)" %1
if errorlevel 2 echo [略過] %1 script 不存在
if errorlevel 2 exit /b 0
if errorlevel 1 exit /b 1
echo [執行] npm run %1
call npm run %1
exit /b %errorlevel%
:root_error
echo [錯誤] 找不到 repository root 或 package.json。
goto :fail
:git_error
echo [錯誤] 找不到 Git。
goto :fail
:node_error
echo [錯誤] 找不到 Node.js。
goto :fail
:npm_error
echo [錯誤] 找不到 npm。
goto :fail
:powershell_error
echo [錯誤] 找不到 Windows PowerShell。
goto :fail
:repo_error
echo [錯誤] 目前目錄不是 Git repository。
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
:outdated_error
echo [錯誤] 遠端分支有本機尚未包含的 Commit，請先人工同步。
goto :fail
:checks_error
echo [錯誤] 檢查未通過，未提交也未推送。
goto :fail
:sensitive_error
echo [錯誤] 發現可能的敏感檔案，未暫存任何新變更。
goto :fail
:stage_error
echo [錯誤] Git 暫存失敗。
goto :fail
:unstage_sensitive_error
git reset
echo [錯誤] 暫存後發現可能的敏感檔案，已取消暫存。
goto :fail
:nothing_error
git reset
echo [錯誤] 沒有可提交的變更。
goto :fail
:cancel
echo [取消] 未建立 Commit，工作目錄修改已保留。
pause
exit /b 0
:empty_message
git reset
echo [錯誤] Commit Message 不可空白，已取消暫存。
goto :fail
:commit_error
echo [錯誤] Commit 失敗，未推送。
goto :fail
:post_fetch_error
echo [錯誤] Commit 已保留在本機；再次 fetch 失敗，未推送。
goto :fail
:post_pull_error
echo [錯誤] Commit 已保留在本機；無法 fast-forward，未推送。
goto :fail
:push_error
echo [錯誤] Push 失敗，Commit 已保留在本機。
:fail
pause
exit /b 1
