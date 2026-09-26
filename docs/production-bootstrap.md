# First administrator bootstrap

The application uses invitation codes for member registration. A new Firebase project therefore needs one administrator account before the app can issue invitations. This procedure is manual; the included demo seed is restricted to local emulators.

1. In Firebase Authentication, enable Email/Password and create the first administrator account. Record the Auth UID.
2. In Firestore, create `users/{uid}` with the Auth email, a member name, `isAdmin: true`, and Firestore timestamps for `createdAt` and `lastLoginAt`.
3. Create `member_roster/{uid}` with `uid` and `name` fields.
4. Create `wallets/{uid}` with `ownerUid`, `ownerName`, `balance: 0`, `updatedAt`, `updatedByUid`, and `lastTransactionType` fields.
5. Create the member name index used by invite registration. The key is SHA-256 of the member name after trimming, collapsing spaces, and lowercasing with the `zh-TW` locale. The matching document contains `uid`, `memberName`, and `createdAt`.
6. Sign in as that administrator, configure the first stores and daily menu settings, then create invitation codes for team members.

The exact document shapes for the local-only demo are in `functions/seedEmulatorAdmin.cjs`. Do not run that script against a real Firebase project. Verify the UID and project ID carefully before making any manual console changes.
