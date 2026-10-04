# First administrator bootstrap

The application uses invitation codes for member registration. A new Firebase project therefore needs one administrator account before the app can issue invitations. Use the first-run setup page; the manual Firebase Console procedure remains available as a fallback.

## Recommended: first-run setup page

1. Generate a random token of at least 16 characters, for example:

   ```sh
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

2. Create `functions/.env.<your-project-id>` (ignored by Git) with:

   ```sh
   SETUP_TOKEN=<the token you generated>
   ```

   `functions/.env.example` documents the variable. Do not commit the real value.

3. In Firebase Authentication, enable the Email/Password sign-in provider. Enable the Google provider too if you plan to allow Google sign-in.
4. Deploy as described in the README (`firebase deploy --project YOUR_FIREBASE_PROJECT_ID`).
5. Open the deployed site. The sign-in page shows a link to **first-run setup** while no administrator exists; you can also open `/setup` directly.
6. Enter the token, the administrator's name, email and password, and choose the language, time zone, currency, payment methods and who may order on behalf of others. Choose the currency carefully: amounts are stored in its smallest unit, so switching later between currencies with different decimals changes the meaning of existing amounts. Everything else can be changed later under **Settings → System settings**.

The setup page creates the Authentication account (or reuses an existing one with the same email and password), the administrator profile, the member roster entry, an empty wallet and the `settings/system` document in one server-side transaction. Setup closes permanently as soon as an administrator exists, even if the token is still configured. You may remove `SETUP_TOKEN` and redeploy Functions afterwards.

To try the flow locally, put `SETUP_TOKEN` in `functions/.env.local`, start the emulators without the demo seed data, and open `http://localhost:5173/setup`. The demo seed already contains an administrator, so setup is closed after `npm run seed:demo`.

## Fallback: manual Firebase Console procedure

Use this only when you cannot deploy with `SETUP_TOKEN`.

1. In Firebase Authentication, enable Email/Password and create the first administrator account. Record the Auth UID.
2. In Firestore, create `users/{uid}` with the Auth email, a member name, `isAdmin: true`, and Firestore timestamps for `createdAt` and `lastLoginAt`.
3. Create `member_roster/{uid}` with `uid` and `name` fields.
4. Create `wallets/{uid}` with `ownerUid`, `ownerName`, `balance: 0`, `updatedAt`, `updatedByUid`, and `lastTransactionType` fields.
5. Create the member name index used by invite registration. The key is SHA-256 of the member name after trimming, collapsing spaces, and lowercasing with the `zh-TW` locale. The matching document contains `uid`, `memberName`, and `createdAt`.
6. Sign in as that administrator, open **Settings → System settings** to choose the time zone and ordering rules, configure the first stores and daily menu settings, then create invitation codes for team members.

Without a `settings/system` document the app uses the defaults: Traditional Chinese, `Asia/Taipei`, New Taiwan dollars, wallet and cash payments enabled, every member may order on behalf of others, and no cutoff time.

The exact document shapes for the local-only demo are in `functions/seedEmulatorAdmin.cjs`. Do not run that script against a real Firebase project. Verify the UID and project ID carefully before making any manual console changes.
