# Office Order

[繁體中文](./README.zh-TW.md) | **English**

Office Order is a Firebase-powered open-source group ordering system for small teams and offices. Use it to coordinate lunch, drinks, afternoon tea, group purchases, and other team orders. You can deploy the web app and Cloud Functions to a Firebase project that you control. Firebase Authentication, Firestore, Cloud Storage and Cloud Functions provide the backend.

Repository: [chou80532/office-order](https://github.com/chou80532/office-order)

The repository starts in local emulator mode. Its example configuration uses the reserved `demo-office-lunch` project and connects Auth, Firestore, Storage and Functions to localhost. Emulator mode uses local emulator services only and does not connect to a production Firebase project.

## Features

- Create and manage stores, menus and daily ordering settings. Import and export menus as CSV (for spreadsheets) or JSON (for backups and moving between deployments).
- Submit, edit and cancel individual orders with server-side validation and aggregation.
- Close ordering at a daily cutoff time. The server rejects member orders, edits and cancellations after the cutoff; administrators can move, lift or close today's cutoff from **Today's orders**.
- Choose how money is handled: member wallets, cash collection, both, or tracking only (orders are recorded and summarized, nobody is charged).
- Optionally credit a monthly meal allowance to every member's wallet.
- Register members with administrator-created invitation codes, an allowlist of company email domains, or Google sign-in.
- Decide who may order on behalf of others: everyone, members who have agreed to it, administrators only, or nobody.
- English and Traditional Chinese interface. The organization picks a default language and each member can choose their own.
- Configure the time zone, currency, amount limits, organization name, logo and accent color from the admin interface.
- Send notifications when ordering opens, shortly before the cutoff, when ordering closes and when a store is replaced, to Slack, Discord, Microsoft Teams, Telegram or any JSON webhook, and as browser push notifications.
- Optionally delete old orders and ledger entries automatically after a retention period.
- Create the first administrator from a one-time setup page instead of editing the Firebase Console.
- Review order summaries and export records to Excel.
- Develop against Firebase emulators with fictional seed data.

## Technology

- Vue 3, Vue Router, vue-i18n and Vite
- Firebase Authentication, Firestore, Cloud Storage, Cloud Functions and Cloud Messaging
- Node.js 22 for Cloud Functions
- Vitest and ESLint

## External resources

The browser loads DM Sans and Noto Sans TC from Google Fonts and Font Awesome Free 6.7.2 from cdnjs. These requests expose the visitor's network request to those providers. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and license review notes.

## Requirements

- Node.js 22.12 or newer
- npm
- Firebase CLI for local emulators and deployment
- Java runtime supported by the Firebase Firestore emulator

## Quick start

1. Install the frontend and Functions dependencies:

   ```sh
   npm ci
   npm ci --prefix functions
   ```

2. Copy `.env.example` to `.env`. The sample settings keep emulator mode enabled.

3. Start the local Firebase emulators in one terminal:

   ```sh
   npm run emulators
   ```

   The Emulator UI is available at `http://127.0.0.1:4000`.

   This command imports existing local test data from `.local/emulator-data/`. Enter `q` and press Enter to save Auth, Firestore and Storage data before stopping; on Windows, `Ctrl+C` may interrupt the save. The directory is ignored by Git. On Windows, `scripts/windows/02_啟動模擬器與本地預覽.bat` starts the emulators and Vite together. To clear only local emulator data, close the emulators and use `scripts/windows/05_重建本地測試資料.bat`.

4. Start the app in a second terminal:

   ```sh
   npm run dev
   ```

5. On the first run, create fictional local demo accounts and menus in a third terminal:

   ```sh
   npm run seed:demo
   ```

   The seed command refuses non-demo Firebase project IDs and non-local emulator hosts. Sign in to the local Auth emulator with `admin@example.test` and `office-order-demo`. All included demo accounts use this password. These credentials are for the local emulator only. Existing data is imported on later starts; rerunning the seed reapplies the demo accounts, wallet balances, menus and daily settings.

## Configuration

`.env.example` documents the supported frontend settings. `.env` is ignored by Git.

| Variable | Purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase web app key for your own project; the demo value is a placeholder. |
| `VITE_FIREBASE_AUTH_DOMAIN` | Auth domain for your own Firebase project. |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID; emulator mode always uses `demo-office-lunch`. |
| `VITE_FIREBASE_STORAGE_BUCKET` | Storage bucket for your own Firebase project. |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Sender ID for your own Firebase project. |
| `VITE_FIREBASE_APP_ID` | Web app ID for your own Firebase project. |
| `VITE_FIREBASE_FUNCTIONS_REGION` | Cloud Functions region; defaults to `us-central1`. |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | Optional App Check site key for a real Firebase deployment. |
| `VITE_FIREBASE_VAPID_KEY` | Optional Web Push certificate key (Firebase Console → Project settings → Cloud Messaging). Browser notifications stay hidden without it. |
| `VITE_USE_FIREBASE_EMULATORS` | Defaults to emulator mode. Set to `false` only when intentionally using your own Firebase project. |
| `VITE_FIREBASE_EMULATOR_HOST` | Local emulator host; defaults to `127.0.0.1`. |

Firebase web configuration is public client configuration. Never put Service Account JSON files, private keys, Firebase Admin credentials or server secrets in Git or frontend environment variables.

Cloud Functions read server-side values from `functions/.env.<project-id>` (deployment) or `functions/.env.local` (emulators). Both are ignored by Git; `functions/.env.example` documents them.

| Variable | Purpose |
| --- | --- |
| `SETUP_TOKEN` | One-time token for the first-run setup page; at least 16 random characters. Setup closes automatically once an administrator exists. |

Organization settings are stored in Firestore (`settings/system`) and changed under **Settings → System settings**, so they do not require a rebuild. Without that document the app keeps the defaults of earlier versions: Traditional Chinese, `Asia/Taipei`, New Taiwan dollars, wallet and cash enabled, every member may order for others, and no cutoff. Webhook settings are stored separately in `settings/notifications`, which only administrators can read.

## Settings for your organization

| Section | What it controls |
| --- | --- |
| General | Default language, time zone, currency and amount limits (highest item price, highest single top-up, low-balance warning). |
| Payment | Wallet, cash, both, or tracking only; who may order for others; the monthly allowance. |
| Ordering | The default daily cutoff time. Administrators can change today's cutoff from **Today's orders**. |
| Registration | Company email domains that may register themselves, and Google sign-in. Invitation codes always work. |
| Branding | Organization name, logo URL (https) and accent color. The name and logo also appear on the sign-in page. |
| Notifications | Webhook URL, which events to send and how many minutes before the cutoff to remind. |
| Retention | Delete orders and ledger entries older than a number of days (at least 30). Off by default. |

Things to know before changing them:

- **Currency.** Amounts are stored as integers in the currency's smallest unit (cents for USD, yen for JPY, dollars for TWD). Pick the currency during setup. Switching later between currencies with a different number of decimals reinterprets existing amounts (for example 110 TWD becomes 1.10 USD); the settings page warns before saving.
- **Tracking only.** When both wallet and cash are off, orders are recorded and summarized but nobody is charged and no cash receivables are created. The wallet and cash pages are hidden.
- **Proxy consent.** In "members who agree" mode each member allows or refuses proxy orders under **Personal settings** in the navigation menu. Administrators can always order for others. The setup page proposes this mode for new deployments.
- **Dietary preferences and meal labels.** Enable this optional feature under **System settings → Ordering rules** and define up to 30 custom labels (24 characters each). Admins assign labels in the menu editor; members save required and avoided labels under **Personal settings**. Ordering filters require all selected required labels and exclude any avoided label, as well as meals without labels. Filters apply to each variant before grouping. Labels describe the base meal; check options and add-ons separately. Preferences are stored on the member profile and excluded from the shared proxy roster. Existing deployments leave the feature disabled until an admin enables it. Removing or renaming catalog labels does not rewrite menus or member preferences: review menus and remove obsolete preferences before saving.
- **Monthly allowance.** Credited once per member per month to the wallet, starting with the month you choose; Cloud Functions check every hour. Administrators can also credit the current month by hand. Requires the wallet to be enabled.
- **Self registration.** Members whose verified email belongs to an allowed domain can set their name and join without an invitation. Google accounts are verified automatically; email/password accounts must click the verification email first. Enable the **Google** provider in Firebase Authentication before turning on Google sign-in.
- **Notifications.** The webhook receives a JSON `POST` with `event`, `title`, `body`, `text` (used by Slack and Telegram), `content` (used by Discord), `data` and `timestamp`. For Telegram use `https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat id>`. For Microsoft Teams, use a Workflows "post to a channel when a webhook request is received" flow that reads `text`. Services that need custom headers, such as the LINE Messaging API, need a small relay in between. Browser push requires `VITE_FIREBASE_VAPID_KEY`.
- **Retention.** Runs once a day. It deletes orders, cash receivables, cash and wallet logs, request records, expired invitation codes and dining records older than the limit. Unpaid cash receivables and their orders are kept, and wallet balances are not changed. Use **Settings → Cleanup** for one-off cleanups that also correct balances.
- **Menu import and export.** Open **Settings → Stores → Import / export**. CSV needs the columns `store`, `item` and `price` (optional: `store_category`, `phone`, `address`, `category`, `unit`, `options`); prices are written in normal units such as `12.50`, and option groups use the same text format as the menu editor, separated by `;`. JSON files must come from this app and use the same currency. Existing stores can be replaced or skipped; their menu images are never changed.

Menu labels are preserved in JSON exports and the optional CSV `tags` column. CSV exports use a JSON array in that cell; imports also accept labels separated by semicolons. The menu editor preserves labels when copying and reparsing text using a line such as `@tags ["Vegan","Spicy"]` immediately after a meal. Labels remain stored when the feature is disabled.

## Database and first administrator

Local development uses the included Firestore and Storage rules with the emulator. The demo seed writes only to the local Auth, Firestore and Storage emulators.

A fresh Firebase deployment needs one administrator before invitation based registration can begin. Set `SETUP_TOKEN` before deploying, then open `/setup` on the deployed site to create that administrator and choose the initial time zone and ordering rules. The sign-in page links to it while no administrator exists. [The first administrator guide](docs/production-bootstrap.md) describes the setup page and a manual Firebase Console fallback. Review the Firestore and Storage rules before deploying.

## Production deployment

1. Create and configure your own Firebase project with Authentication, Firestore, Storage, Cloud Functions and Hosting enabled. Cloud Functions, including the scheduled jobs for reminders, the monthly allowance and retention, require the Blaze plan. Enable the Email/Password provider, and the Google provider if you plan to offer Google sign-in.
2. Create `.env` from `.env.example` and replace every demo value with that project's web app configuration. Set `VITE_USE_FIREBASE_EMULATORS=false` and set the project's ID and Functions region. Add `VITE_FIREBASE_VAPID_KEY` if you want browser notifications.
3. Create `functions/.env.YOUR_FIREBASE_PROJECT_ID` with a random `SETUP_TOKEN` (see `functions/.env.example`).
4. Build the web app and deploy with an explicit project ID:

   ```sh
   npm run build
   firebase deploy --project YOUR_FIREBASE_PROJECT_ID
   ```

5. Open `/setup` on the deployed site to create the first administrator and choose the language, time zone, currency and payment rules. Then add members with invitation codes, or allow company email domains under **Settings → System settings**.
6. Keep service account credentials outside the repository. Back up Firestore and Storage before upgrades, and review the rules and Functions changes before deploying.

The repository has no default Firebase project alias. Deployment commands require an explicit project ID.

## Development checks

```sh
npm run lint
npm test
npm run build
node --check functions/index.js
```

With the Firebase CLI and Java installed, also run the emulator-backed Firestore rules and callable Functions integration suites:

```sh
npm run test:rules
npm run test:functions:emulator
```

Both commands pin the local Firebase project to `demo-office-lunch`; they do not deploy or target a production Firebase project. GitHub Actions runs the frontend checks and Functions syntax check.

## Backup and upgrades

Back up Firestore data and Storage objects before deploying changes to an existing project. Review `firestore.rules`, `storage.rules`, Cloud Functions and indexes with each update. This project currently has no automated production migration tool.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Never include real employee, customer, store, order or account data in issues, tests or pull requests.

## Security

See [SECURITY.md](SECURITY.md). Report security issues through GitHub's private Security Advisory feature.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
