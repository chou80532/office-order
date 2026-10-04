# Office Order

**繁體中文** | [English](./README.md)

## 專案簡介

Office Order 是一套以 Firebase 為後端的開源團體訂購系統，適合小型團隊與辦公室使用。你可以用它協調午餐、飲料、下午茶、團購及其他團體訂購需求。網頁應用程式與 Cloud Functions 可部署到你自行管理的 Firebase 專案；後端使用 Firebase Authentication、Firestore、Cloud Storage 與 Cloud Functions。

Repository：[chou80532/office-order](https://github.com/chou80532/office-order)

專案預設以本機 Emulator 開始。範例設定使用保留用途的 `demo-office-lunch` 專案 ID，並將 Authentication、Firestore、Storage 與 Functions 連線到本機。Emulator 模式只使用本機模擬服務，不會連線至任何正式 Firebase 專案。

## 功能特色

- 建立及管理店家、菜單與每日訂購設定；菜單可匯入／匯出 CSV（用試算表編輯）或 JSON（備份、搬到另一套部署）。
- 送出、修改及取消個人訂單，並由伺服器端驗證與彙整。
- 每日收單時間：時間一到，伺服器拒絕一般成員下單、修改與取消；管理員可在「今日訂單」延後、取消或立即收單。
- 選擇金流方式：錢包、現金、兩者皆可，或「只統計不收錢」（只記錄與彙整訂單，不扣款也不建立應收）。
- 可設定每月餐費補助，自動撥入每位成員的錢包。
- 成員註冊方式：管理員邀請碼、公司信箱網域白名單，或 Google 登入。
- 代訂規則：全體可代訂、需本人同意、僅管理員，或關閉。
- 介面支援繁體中文與英文；組織設定預設語言，每位成員也能自選。
- 在管理介面設定時區、幣別、金額上限、組織名稱、Logo 與主題色。
- 開放點餐、收單前提醒、收單後彙整與店家更換時，可通知到 Slack、Discord、Microsoft Teams、Telegram 或任何 JSON webhook，也支援瀏覽器推播。
- 可選擇自動刪除超過保留天數的訂單與流水。
- 透過一次性的首次設定頁建立第一位管理員，不必手動編輯 Firebase Console。
- 查看訂單摘要並匯出 Excel 檔案。
- 使用 Firebase Emulator 與虛構的示範資料進行開發。

## 使用情境

可用於辦公室午餐、飲料、下午茶、團購及其他團隊訂購情境。專案提供的是團體訂購管理功能；實際使用方式取決於各部署者設定的店家、菜單與訂購規則。

## 技術架構

- 前端：Vue 3、Vue Router、vue-i18n、Vite
- Firebase Authentication、Firestore、Cloud Storage、Cloud Functions 與 Cloud Messaging
- Cloud Functions 執行環境：Node.js 22
- 測試與程式碼檢查：Vitest、ESLint
- 本機開發及整合測試：Firebase Emulator Suite
- CI：GitHub Actions 會執行前端檢查與 Functions 語法檢查

## 外部資源

瀏覽器會向 Google Fonts 載入 DM Sans 與 Noto Sans TC，並從 cdnjs 載入 Font Awesome Free 6.7.2。載入時，瀏覽器會向這些服務提供者發出網路請求。授權與來源資訊請參閱 [第三方授權說明](./THIRD_PARTY_NOTICES.md)。

## 系統需求

- Node.js 22.12 或更新版本
- npm
- Firebase CLI（執行本機 Emulator 與部署時需要）
- Firebase Firestore Emulator 支援的 Java runtime

## 快速開始

1. 安裝前端與 Functions 相依套件：

   ```sh
   npm ci
   npm ci --prefix functions
   ```

2. 將 `.env.example` 複製為 `.env`。範例設定會啟用 Emulator 模式。

3. 在第一個終端機啟動 Firebase Emulator：

   ```sh
   npm run emulators
   ```

   Emulator UI 位於 `http://127.0.0.1:4000`。

   此指令會自動載入 `.local/emulator-data/` 內既有的本機測試資料。結束前輸入 `q` 並按 Enter，會保存 Authentication、Firestore 與 Storage 資料；Windows 上的 `Ctrl+C` 可能中斷保存。該目錄已由 Git 忽略。Windows 使用者也可執行 `scripts/windows/02_啟動模擬器與本地預覽.bat`，同時啟動 Emulator 與網頁預覽。若要清除本機測試資料，先關閉 Emulator，再執行 `scripts/windows/05_重建本地測試資料.bat`。

4. 在第二個終端機啟動網頁應用程式：

   ```sh
   npm run dev
   ```

5. 第一次使用時，在第三個終端機建立本機示範帳號與菜單資料：

   ```sh
   npm run seed:demo
   ```

   Seed 指令只允許使用示範 Firebase 專案 ID 與本機 Emulator 主機。登入本機 Authentication Emulator 時，管理員帳號使用 `admin@example.test`，密碼使用 `office-order-demo`；其他示範帳號也使用相同密碼。這組帳密只能用於本機 Emulator。下次啟動會載入既有資料；重新執行 Seed 會重新套用示範帳號、錢包餘額、菜單與每日設定。

## Firebase 設定與環境變數

正式部署時，請建立並使用自己的 Firebase 專案。每位部署者都需使用自己專案的 Authentication、Firestore、Cloud Storage、Cloud Functions 與 Hosting；本專案不會替你連線到 Office Order 維護者的 Firebase 專案。

`.env.example` 列出前端支援的環境變數，`.env` 已加入 Git 忽略清單。

| 變數 | 用途 |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | 自己 Firebase web app 的 API key；範例值為佔位值。 |
| `VITE_FIREBASE_AUTH_DOMAIN` | 自己 Firebase 專案的 Authentication 網域。 |
| `VITE_FIREBASE_PROJECT_ID` | 自己 Firebase 專案 ID；啟用 Emulator 模式時固定使用 `demo-office-lunch`。 |
| `VITE_FIREBASE_STORAGE_BUCKET` | 自己 Firebase 專案的 Storage bucket。 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | 自己 Firebase 專案的 Sender ID。 |
| `VITE_FIREBASE_APP_ID` | 自己 Firebase web app 的 App ID。 |
| `VITE_FIREBASE_FUNCTIONS_REGION` | Cloud Functions 區域，預設為 `us-central1`。 |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | 選填；部署到實際 Firebase 專案時可設定 App Check site key。 |
| `VITE_FIREBASE_VAPID_KEY` | 選填；Web Push 憑證金鑰（Firebase Console → 專案設定 → Cloud Messaging）。未設定時不顯示瀏覽器通知選項。 |
| `VITE_USE_FIREBASE_EMULATORS` | 預設啟用 Emulator。只有確定要連線至自己的 Firebase 專案時才設為 `false`。 |
| `VITE_FIREBASE_EMULATOR_HOST` | 本機 Emulator 主機，預設為 `127.0.0.1`。 |

Firebase web 設定屬於前端公開設定。請勿將 Service Account JSON、private key、Firebase Admin 憑證或伺服器端 secret 放進 Git 或前端環境變數。

Cloud Functions 從 `functions/.env.<專案 ID>`（部署）或 `functions/.env.local`（Emulator）讀取伺服器端設定。這兩個檔案都已由 Git 忽略，變數說明見 `functions/.env.example`。

| 變數 | 用途 |
| --- | --- |
| `SETUP_TOKEN` | 首次設定頁使用的一次性 token，至少 16 個隨機字元。系統有管理員後會自動關閉首次設定。 |

組織設定存放在 Firestore 的 `settings/system`，由「設定 → 系統設定」修改，不需要重新建置。沒有這份文件時沿用舊版的預設值：繁體中文、`Asia/Taipei`、新台幣、錢包與現金皆可、全體成員都能代訂、不設收單時間。Webhook 設定另外存放在只有管理員能讀取的 `settings/notifications`。

## 組織設定

| 區塊 | 內容 |
| --- | --- |
| 一般 | 預設語言、時區、幣別與金額上限（單品最高價、單次儲值上限、低餘額提醒）。 |
| 付款 | 錢包、現金、兩者皆可或只統計不收錢；誰可以代訂；每月補助。 |
| 點餐 | 每日預設收單時間。當天的收單時間可在「今日訂單」調整。 |
| 註冊 | 允許自助註冊的公司信箱網域，以及 Google 登入。邀請碼永遠可用。 |
| 品牌 | 組織名稱、Logo 網址（https）與主題色；名稱與 Logo 也會出現在登入頁。 |
| 通知 | Webhook 網址、要通知的事件，以及收單前幾分鐘提醒。 |
| 資料保留 | 自動刪除超過指定天數（至少 30 天）的訂單與流水，預設關閉。 |

調整前請注意：

- **幣別**：金額以幣別最小單位的整數儲存（美元為分、日圓為圓、新台幣為元）。請在首次設定時選好幣別；之後若在小數位數不同的幣別間切換，既有金額會被重新解讀（例如 110 元會變成 1.10 美元），儲存前設定頁會提醒。
- **只統計不收錢**：錢包與現金都關閉時，訂單照常記錄與彙整，但不扣款也不建立現金應收，錢包與現金頁面會隱藏。
- **需本人同意**：每位成員在選單中的「個人設定」決定是否允許別人幫自己點餐；管理員永遠可以代訂。首次設定頁預設採用這個模式。
- **每月補助**：從指定月份起，每月每人撥入錢包一次；Cloud Functions 每小時檢查一次，管理員也可手動發放當月補助。需啟用錢包。
- **自助註冊**：信箱已驗證且屬於允許網域的人，可自行填寫姓名加入，不需要邀請碼。Google 帳號會自動視為已驗證；Email／密碼帳號需先點驗證信。開啟 Google 登入前，請先在 Firebase Authentication 啟用 **Google** 登入方式。
- **通知**：Webhook 會收到 JSON `POST`，欄位有 `event`、`title`、`body`、`text`（Slack、Telegram 使用）、`content`（Discord 使用）、`data` 與 `timestamp`。Telegram 請使用 `https://api.telegram.org/bot<token>/sendMessage?chat_id=<聊天室 ID>`；Microsoft Teams 請建立「收到 webhook 要求時張貼到頻道」的 Workflows 流程並讀取 `text`。需要自訂標頭的服務（例如 LINE Messaging API）需另外架設轉發程式。瀏覽器推播需要設定 `VITE_FIREBASE_VAPID_KEY`。
- **資料保留**：每天執行一次，刪除超過天數的訂單、現金應收、現金與錢包流水、請求紀錄、過期邀請碼與用餐紀錄。尚未收款的現金單與其訂單會保留，也不會變更錢包餘額。需要同時回沖餘額的一次性清理，請使用「設定 → 舊檔清理」。
- **菜單匯入／匯出**：在「設定 → 店家管理 → 匯入／匯出」。CSV 需要 `store`、`item`、`price` 欄位（可另加 `store_category`、`phone`、`address`、`category`、`unit`、`options`），金額寫一般單位（例如 `12.50`），選項群組使用與菜單編輯器相同的文字格式，多個群組以 `;` 分隔。JSON 必須是本系統匯出的檔案且幣別相同。已存在的店家可選擇取代或略過，菜單圖片不會被變更。

## 資料庫與第一位管理員

本機開發會透過 Emulator 使用 repository 內的 Firestore 與 Storage Rules。示範 Seed 只會寫入本機 Authentication、Firestore 與 Storage Emulator。

新的 Firebase 部署需要先有一位管理員，之後才能使用邀請碼註冊。部署前設定 `SETUP_TOKEN`，部署後在網站開啟 `/setup`，即可建立第一位管理員並選擇初始的時區與點餐規則；尚無管理員時，登入頁也會顯示前往首次設定的連結。[第一位管理員設定指南](./docs/production-bootstrap.md)說明首次設定頁的使用方式，以及手動在 Firebase Console 建立的備用做法。部署前請先檢查 Firestore 與 Storage Rules。

## 部署

1. 建立自己的 Firebase 專案，啟用 Authentication、Firestore、Storage、Cloud Functions 與 Hosting。Cloud Functions（含提醒、每月補助與資料保留的排程）需要 Blaze 方案。啟用 Email／密碼登入；若要提供 Google 登入，也一併啟用 Google 登入方式。
2. 從 `.env.example` 建立 `.env`，並以該 Firebase 專案的 web app 設定取代所有示範值。將 `VITE_USE_FIREBASE_EMULATORS` 設為 `false`，並設定該專案的 ID 與 Functions 區域。需要瀏覽器通知時，另外設定 `VITE_FIREBASE_VAPID_KEY`。
3. 建立 `functions/.env.YOUR_FIREBASE_PROJECT_ID`，填入隨機產生的 `SETUP_TOKEN`（參考 `functions/.env.example`）。
4. 建置網頁應用程式，並明確指定 Firebase 專案 ID 部署：

   ```sh
   npm run build
   firebase deploy --project YOUR_FIREBASE_PROJECT_ID
   ```

5. 在網站開啟 `/setup` 建立第一位管理員，並選擇語言、時區、幣別與付款規則。之後可用邀請碼新增成員，或在「設定 → 系統設定」允許公司信箱網域自助註冊。
6. 將 service account 憑證留在 repository 之外。升級前備份 Firestore 與 Storage，部署前檢查 Rules 與 Functions 的變更。

Repository 沒有預設 Firebase 專案 alias；部署指令必須明確指定專案 ID。

## 開發與測試

執行一般檢查：

```sh
npm run lint
npm test
npm run build
node --check functions/index.js
```

安裝 Firebase CLI 與 Java 後，也可執行使用 Emulator 的 Firestore Rules 與 callable Functions 整合測試：

```sh
npm run test:rules
npm run test:functions:emulator
```

這兩個指令都固定使用本機示範專案 `demo-office-lunch`，不會部署到或連線至正式 Firebase 專案。GitHub Actions 會執行前端檢查與 Functions 語法檢查。

## 備份與升級

升級既有專案前，請先備份 Firestore 資料與 Storage 檔案。每次更新時檢查 `firestore.rules`、`storage.rules`、Cloud Functions 與索引。本專案目前沒有自動化的正式環境資料遷移工具。

## 參與貢獻

請參閱 [CONTRIBUTING.md](./CONTRIBUTING.md)。在 issue、測試或 Pull Request 中請勿放入真實員工、客戶、店家、訂單或帳號資料。

## 安全性

如要回報安全性問題，請參閱 [SECURITY.md](./SECURITY.md)，並使用 GitHub 私下回報流程。

## 授權

本專案採用 MIT License，詳見 [LICENSE](./LICENSE)。
