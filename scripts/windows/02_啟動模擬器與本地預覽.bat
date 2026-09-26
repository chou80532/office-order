@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
cd /d "%~dp0\..\.." || goto :root_error
where node >nul 2>&1 || goto :node_error
where npm >nul 2>&1 || goto :npm_error
if not exist "package.json" goto :root_error
if not exist "node_modules\" goto :modules_error
node -e "const p=require('./package.json');process.exit(typeof p.scripts?.emulators==='string' && typeof p.scripts?.dev==='string'?0:1)" || goto :script_error
set "VITE_USE_FIREBASE_EMULATORS=true"
set "VITE_FIREBASE_PROJECT_ID=demo-office-lunch"
set "VITE_FIREBASE_EMULATOR_HOST=127.0.0.1"
echo [執行] 同時啟動 Firebase 模擬器與 Vite 本地預覽。
echo [提示] 請等模擬器顯示就緒，再以 Vite 顯示的網址開啟網頁。輸入 q 後按 Enter 會先保存資料再停止；Ctrl+C 可能中斷保存。
node "%~dp0run-local-dev.cjs"
if errorlevel 1 goto :run_error
echo [完成] 本機模擬器與預覽已停止。
exit /b 0
:root_error
echo [錯誤] 找不到 repository root 或 package.json。
goto :fail
:node_error
echo [錯誤] 找不到 Node.js。
goto :fail
:npm_error
echo [錯誤] 找不到 npm。
goto :fail
:modules_error
echo [錯誤] 找不到 node_modules。請先執行 npm ci 安裝相依套件。
goto :fail
:script_error
echo [錯誤] package.json 必須同時有 emulators 與 dev script。
goto :fail
:run_error
echo [錯誤] 本機模擬器或預覽執行失敗，另一個程序已停止。
:fail
pause
exit /b 1
