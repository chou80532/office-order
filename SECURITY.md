# Security Policy

## Supported versions

Security fixes are made on the current development branch. Published support windows will be documented when the first release is approved.

## Reporting a vulnerability

After the repository is public, use GitHub's private Security Advisory reporting flow. Do not open a public issue for an unpatched vulnerability. Include affected version or commit, impact, and reproduction steps using fictional data.

## Deployment responsibilities

Each operator controls their Firebase project and is responsible for restricting access, protecting service credentials, reviewing Firestore and Storage rules, backing up data, and applying security updates. Never commit a service account, private key, production database export, real order, employee record or customer data.

The local seed script is restricted to the `demo-office-lunch` project and local emulator hosts. Keep emulator mode enabled for development and tests. Review any configuration that sets `VITE_USE_FIREBASE_EMULATORS=false` before running the app.
