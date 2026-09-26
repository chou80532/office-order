# Office Order

[繁體中文](./README.zh-TW.md) | **English**

Office Order is a Firebase-powered open-source group ordering system for small teams and offices. Use it to coordinate lunch, drinks, afternoon tea, group purchases, and other team orders. You can deploy the web app and Cloud Functions to a Firebase project that you control. Firebase Authentication, Firestore, Cloud Storage and Cloud Functions provide the backend.

Repository: [chou80532/office-order](https://github.com/chou80532/office-order)

The repository starts in local emulator mode. Its example configuration uses the reserved `demo-office-lunch` project and connects Auth, Firestore, Storage and Functions to localhost. Emulator mode uses local emulator services only and does not connect to a production Firebase project.

## Features

- Create and manage stores, menus and daily ordering settings.
- Submit, edit and cancel individual orders with server-side validation and aggregation.
- Track member wallets, cash collection and order totals.
- Register members through admin-created invitation codes.
- Review order summaries and export records to Excel.
- Develop against Firebase emulators with fictional seed data.

## Technology

- Vue 3, Vue Router and Vite
- Firebase Authentication, Firestore, Cloud Storage and Cloud Functions
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

4. Start the app in a second terminal:

   ```sh
   npm run dev
   ```

5. In a third terminal, create fictional local demo accounts and menus:

   ```sh
   npm run seed:demo
   ```

   The seed command refuses non-demo Firebase project IDs and non-local emulator hosts. It prints the local admin email and a randomly generated password. Use these credentials only with the local Auth emulator.

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
| `VITE_USE_FIREBASE_EMULATORS` | Defaults to emulator mode. Set to `false` only when intentionally using your own Firebase project. |
| `VITE_FIREBASE_EMULATOR_HOST` | Local emulator host; defaults to `127.0.0.1`. |

Firebase web configuration is public client configuration. Never put Service Account JSON files, private keys, Firebase Admin credentials or server secrets in Git or frontend environment variables.

## Database and first administrator

Local development uses the included Firestore and Storage rules with the emulator. The demo seed writes only to the local Auth, Firestore and Storage emulators.

A fresh Firebase deployment needs one administrator bootstrapped through the Firebase Console before invitation based registration can begin. Follow [the first administrator guide](docs/production-bootstrap.md) to create the Auth user and matching Firestore documents. The demo seed shows the expected field shapes, but is deliberately restricted to the local demo project. Review the Firestore and Storage rules before deploying.

## Production deployment

1. Create and configure your own Firebase project with Authentication, Firestore, Storage, Cloud Functions and Hosting enabled.
2. Create `.env` from `.env.example` and replace every demo value with that project's web app configuration. Set `VITE_USE_FIREBASE_EMULATORS=false` and set the project's ID and Functions region.
3. Build the web app and deploy with an explicit project ID:

   ```sh
   npm run build
   firebase deploy --project YOUR_FIREBASE_PROJECT_ID
   ```

4. Bootstrap the first administrator in that project, then create invitation codes from the admin interface.
5. Keep service account credentials outside the repository. Back up Firestore and Storage before upgrades, and review the rules and Functions changes before deploying.

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
