# Contributing

Thanks for considering a contribution to Office Order.

## Before opening an issue or pull request

- Describe the user problem and the expected behavior.
- Use fictional data in examples, tests and screenshots.
- Do not include Firebase project configuration that identifies a private deployment, service account files, employee information, store contacts or real orders.
- Check the issue tracker for an existing report before opening a duplicate.

## Local setup

Follow the emulator based steps in `README.md`. Keep `VITE_USE_FIREBASE_EMULATORS=true` while developing locally.

## Checks

Run the relevant checks before submitting:

```sh
npm run lint
npm test
npm run build
node --check functions/index.js
```

Changes to Firestore or Storage permissions should explain the access model and include emulator rules tests when that test harness is available.

## Pull requests

Keep changes focused, explain any data schema or deployment impact, and include screenshots only when they contain fully fictional data. Do not deploy or test against a production Firebase project from a pull request.
