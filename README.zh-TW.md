# Office Order

[English](./README.md)

## 專案簡介

Office Order 是一套以 Firebase 為後端的開源團體訂購系統，適合小型團隊與辦公室使用。你可以用它協調午餐、飲料、下午茶、團購及其他團體訂購需求。網頁應用程式與 Cloud Functions 可部署到你自行管理的 Firebase 專案；後端使用 Firebase Authentication、Firestore、Cloud Storage 與 Cloud Functions。

Repository：[chou80532/office-order](https://github.com/chou80532/office-order)

專案預設以本機 Emulator 開始。範例設定使用保留用途的 `demo-office-lunch` 專案 ID，並將 Authentication、Firestore、Storage 與 Functions 連線到本機。

## 功能特色

- 建立及管理店家、菜單與每日訂購設定。
- 送出、修改及取消團體訂單，並由伺服器端驗證。
- 管理成員錢包、現金收款與訂單金額。
- 由管理員建立邀請碼，供成員註冊。
- 查看訂單摘要並匯出 Excel 檔案。
- 使用 Firebase Emulator 與虛構的示範資料進行開發。

## 使用情境

可用於辦公室午餐、飲料、下午茶、團購及其他團隊訂購情境。專案提供的是團體訂購管理功能；實際使用方式取決於各部署者設定的店家、菜單與訂購規則。

## 技術架構

- 前端：Vue 3、Vue Router、Vite
- Firebase Authentication、Firestore、Cloud Storage 與 Cloud Functions
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

4. 在第二個終端機啟動網頁應用程式：

   ```sh
   npm run dev
   ```

5. 在第三個終端機建立本機示範帳號與菜單資料：

   ```sh
   npm run seed:demo
   ```

   Seed 指令只允許使用示範 Firebase 專案 ID 與本機 Emulator 主機。執行後會印出本機管理員電子郵件與隨機產生的密碼；這組帳密只能用於本機 Authentication Emulator。

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
| `VITE_USE_FIREBASE_EMULATORS` | 預設啟用 Emulator。只有確定要連線至自己的 Firebase 專案時才設為 `false`。 |
| `VITE_FIREBASE_EMULATOR_HOST` | 本機 Emulator 主機，預設為 `127.0.0.1`。 |

Firebase web 設定屬於前端公開設定。請勿將 service account 檔案、private key 或伺服器憑證放進前端環境變數或 Git。

## 資料庫與第一位管理員

本機開發會透過 Emulator 使用 repository 內的 Firestore 與 Storage Rules。示範 Seed 只會寫入本機 Authentication、Firestore 與 Storage Emulator。

新的 Firebase 部署需要先透過 Firebase Console 建立第一位管理員，之後才能使用邀請碼註冊。請依照[第一位管理員設定指南](./docs/production-bootstrap.md)，建立 Authentication 使用者與對應的 Firestore 文件。示範 Seed 可用來了解預期的欄位格式，但僅限本機示範專案。部署前請先檢查 Firestore 與 Storage Rules。

## 部署

1. 建立自己的 Firebase 專案，啟用 Authentication、Firestore、Storage、Cloud Functions 與 Hosting。
2. 從 `.env.example` 建立 `.env`，並以該 Firebase 專案的 web app 設定取代所有示範值。將 `VITE_USE_FIREBASE_EMULATORS` 設為 `false`，並設定該專案的 ID 與 Functions 區域。
3. 建置網頁應用程式，並明確指定 Firebase 專案 ID 部署：

   ```sh
   npm run build
   firebase deploy --project YOUR_FIREBASE_PROJECT_ID
   ```

4. 在該專案建立第一位管理員，再從管理介面建立邀請碼。
5. 將 service account 憑證留在 repository 之外。升級前備份 Firestore 與 Storage，部署前檢查 Rules 與 Functions 的變更。

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

## 畫面截圖

目前沒有提供畫面截圖。
