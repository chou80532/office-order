# Changelog

Changes to the project are recorded here. No public release history is claimed.

## Unreleased

- Prepared a sanitized Open Source working copy from the private source.
- Added emulator-first Firebase configuration and fictional local seed data.
- Tightened writes to `settings/daily` to administrators because those values affect server-side order totals.
- Fixed a gap where any registered member could mark stores as free through the `dailyStoreSettings` parameter of `cancelOrdersWithWalletRefund`. Members can still replace today's stores, but only administrators can add or remove free stores.
- Added project documentation and CI checks.
- Added a first-run setup page (`/setup`) that creates the first administrator with a one-time `SETUP_TOKEN` and closes once an administrator exists.
- Added `settings/system` and a System settings tab for the time zone, enabled payment methods and proxy ordering rules. Cloud Functions enforce the payment and proxy rules; existing deployments without the document keep the previous behavior.
- Date boundaries (today, reports, store rollover and dining records) now follow the configured time zone, including daylight saving time transitions, instead of a fixed UTC+8 offset.
- Cloud Functions now import `Timestamp` from `firebase-admin/firestore`, which also fixes invite registration and range cleanup in the Functions emulator.
- Added English alongside Traditional Chinese (vue-i18n). The organization sets a default language and each member can choose their own; dates, numbers and server-generated texts (notifications, ledger descriptions) follow the system language.
- Added configurable currency and amount limits. Amounts are stored as integers in the currency's smallest unit, so existing New Taiwan dollar data is unchanged.
- Added a tracking-only payment mode (orders recorded, nobody charged) and a "members who agree" proxy ordering mode with per-member consent.
- Added a daily order cutoff with server-side enforcement and per-day overrides from Today's orders.
- Added self-registration for verified company email domains and optional Google sign-in.
- Added a monthly allowance credited to member wallets, organization branding (name, logo, accent color) and optional automatic data retention.
- Added notifications through a generic JSON webhook (Slack, Discord, Teams, Telegram) and browser push via Firebase Cloud Messaging.
- Added menu import and export as CSV or JSON.
- Locale-dependent defaults: quick notes, phone formatting and form placeholders follow the system language.

## v1.0.0 - Initial Open Source Release

Draft release notes are in `RELEASE_NOTES_v1.0.0.md`. This version has not been published or tagged.
