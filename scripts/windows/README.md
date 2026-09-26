# Windows 開發輔助工具

在已安裝 Git、Node.js、npm 與 Windows PowerShell 的 Windows CMD 中，直接執行下列批次檔。每個工具會自行切換至專案根目錄，並在目前視窗執行。

| 工具 | 用途 |
| --- | --- |
| `01_同步GitHub.bat` | 開發前更新目前 Git branch；工作目錄必須乾淨，僅允許 fast-forward。 |
| `02_啟動模擬器與本地預覽.bat` | 在同一視窗啟動 Firebase Emulator Suite 與 Vite；需先執行 `npm ci` 與 `npm ci --prefix functions`。輸入 `q` 並按 Enter 會保存本機資料，再一起停止。 |
| `03_建立本機示範帳號.bat` | 首次啟動 02 後，建立本機測試帳號與菜單；執行結果會印出帳號及當次隨機密碼。有保存資料時，重建需要輸入 `SEED`。 |
| `04_測試提交並推送.bat` | 依序執行存在的 lint、test、build script，檢查敏感檔案，人工確認後 Commit 與 Push。 |
| `07_重建本地測試資料.bat` | 先確認模擬器已關閉，再要求輸入 `RESET`，只清除本機 Emulator 資料；之後依提示啟動 02 與 03。 |

`04` 會將 Git 目前可提交的變更全部暫存，請在確認前仔細閱讀 staged files 與 `git status`。取消或留空 Commit Message 時，只取消暫存，不刪除工作目錄修改。若遠端已有本機不包含的 Commit，請先人工同步。這些工具不會部署 Firebase。

`02` 會強制啟用本機 Emulator 模式與 `demo-office-lunch` 測試專案。`run-local-dev.cjs` 直接啟動已安裝的 Firebase CLI 與 Vite，並管理兩個本機程序；需要 Firebase CLI 已安裝。請等模擬器顯示就緒後再測試登入與訂餐功能。`npm run emulators` 與 `scripts/start-emulators.ps1` 使用同一個持久化程序，但只啟動模擬器；兩者也以 `q` 加 Enter 保存並停止。

本機測試資料保存於 repository 內的 `.local/emulator-data/`，此目錄已由 `.gitignore` 排除。輸入 `q` 後，`02` 會匯出 Authentication、Firestore、Storage 的資料；下次啟動會自動匯入。請以 `q` 正常結束；Windows 上的 `Ctrl+C` 可能讓 Firebase 先關閉，導致本次資料來不及保存。Windows 上的 Firebase CLI 可能顯示 `EPERM ... rename` 警告；若隨後出現「本機測試資料已保存」與「本機模擬器與預覽已停止」，代表已自動恢復並成功保存。若保存失敗，服務會繼續執行，請看錯誤訊息後再試。這些資料不會提交到公開 Git，也不會同步或部署到正式 Firebase。

原本的本地預覽已併入 `02`。首次需要登入測試時，保持 `02` 執行，另開一個 CMD 執行 `03`。本機管理員帳號是 `admin@example.test`；密碼由 `03` 隨機產生並印在視窗中。保存資料後，帳號、密碼與訂餐資料會在下次啟動時載入，毋須每次重建。若再次執行 `03`，示範帳號密碼與部分示範設定會更新。`03` 只連接 `demo-office-lunch` 的本機 Authentication 與 Firestore 模擬器。

需要從頭測試時，先以 `q` 關閉 02，再執行 `07` 並輸入 `RESET`。`07` 不會自行啟動模擬器或執行 Seed，也不會清除 `node_modules`、程式碼、Git 或私人版。取消輸入不會刪除資料。清除後依序執行 02、03；03 會產生新的本機密碼。

`check-sensitive-files.cjs` 是 `04` 使用的檔名檢查器；它會檢查 Git 已追蹤與未追蹤檔案的名稱。檔名檢查無法取代提交前的內容審閱。
