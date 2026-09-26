$ErrorActionPreference = 'Stop'
$env:GCLOUD_PROJECT = 'demo-office-lunch'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
$env:VITE_USE_FIREBASE_EMULATORS = 'true'
$env:VITE_FIREBASE_PROJECT_ID = 'demo-office-lunch'
$env:VITE_FIREBASE_EMULATOR_HOST = '127.0.0.1'

npm run emulators
