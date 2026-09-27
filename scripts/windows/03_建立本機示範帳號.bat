@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
cd /d "%~dp0\..\.." || goto :root_error
where node >nul 2>&1 || goto :node_error
where npm >nul 2>&1 || goto :npm_error
if not exist "package.json" goto :root_error
if not exist "node_modules\" goto :modules_error
if not exist "functions\node_modules\" goto :functions_modules_error
node -e "const p=require('./package.json');process.exit(typeof p.scripts?.['seed:demo']==='string'?0:1)" || goto :script_error
node -e "const net=require('node:net');let pending=2;for(const port of [9099,8080]){const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(1500);socket.once('connect',()=>{socket.end();if(--pending===0)process.exit(0)});socket.once('error',()=>process.exit(1));socket.once('timeout',()=>process.exit(1))}" || goto :emulator_error
set "GCLOUD_PROJECT=demo-office-lunch"
set "FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099"
set "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080"
set "FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199"
if exist ".local\emulator-data\firebase-export-metadata.json" goto :confirm_reseed
goto :seed
:confirm_reseed
echo [提示] 已有保存的測試資料。重新執行 03 會重新套用示範帳號、錢包餘額、菜單與每日設定。
set "RESEED_CONFIRM="
set /p "RESEED_CONFIRM=確定重建示範資料請輸入 SEED，其他輸入取消："
if not "%RESEED_CONFIRM%"=="SEED" goto :cancel
:seed
echo [執行] 建立本機示範帳號與菜單資料。
call npm run seed:demo
if errorlevel 1 goto :seed_error
echo [完成] 本機示範帳號已建立。管理員：admin@example.test；密碼：office-order-demo（所有示範帳號共用）。
pause
exit /b 0
:cancel
echo [取消] 未修改本機測試資料。
pause
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
echo [錯誤] 找不到 node_modules。請先執行 npm ci。
goto :fail
:functions_modules_error
echo [錯誤] 找不到 functions\node_modules。請先執行 npm ci --prefix functions。
goto :fail
:script_error
echo [錯誤] package.json 沒有 seed:demo script。
goto :fail
:emulator_error
echo [錯誤] 本機 Authentication 或 Firestore 模擬器未啟動。請先執行 02，待模擬器顯示就緒。
goto :fail
:seed_error
echo [錯誤] 建立本機示範帳號失敗，請查看上方訊息。
:fail
pause
exit /b 1
