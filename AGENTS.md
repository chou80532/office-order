# Open-source development requirements

This repository is public open-source software. Apply these requirements when
designing features, writing code, preparing examples, and making commits.

- Keep secrets, access tokens, passwords, service account credentials, private
  keys, and private deployment configuration out of tracked files and Git history.
- Use fictional data and placeholder configuration in examples, fixtures, seeds,
  screenshots, and documentation. Never include real member or employee details,
  store contacts, orders, payment records, or other private operational data.
- Keep local environment files, emulator exports, database dumps, logs, caches,
  generated builds, and internal reports untracked. Update `.gitignore` when new
  features introduce these files; provide sanitized examples when needed.
- Avoid embedding workstation paths or machine-specific settings in shared code.
  Use portable paths and documented configuration.
- Before committing, inspect the staged file list and diff for sensitive data and
  unintended files. Stage intended files explicitly. A `.gitignore` rule does not
  protect files that are already tracked.
- If sensitive material is discovered in tracked files or history, do not repeat
  its contents in output or publish it. Report the affected location and arrange
  remediation; do not rewrite shared history without explicit authorization.

Follow `CONTRIBUTING.md` and `SECURITY.md` for additional contribution and security
guidance. Local demo credentials must remain clearly fictional and emulator-only.
