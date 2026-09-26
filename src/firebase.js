import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'

const demoProjectId = 'demo-office-lunch'
const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS !== 'false'
const emulatorHost = String(import.meta.env.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1').trim()
const configuredProjectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim()
const requiredDeploymentValues = [
  import.meta.env.VITE_FIREBASE_API_KEY,
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  configuredProjectId,
  import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  import.meta.env.VITE_FIREBASE_APP_ID,
]

if (!useEmulators && requiredDeploymentValues.some((value) => !String(value || '').trim())) {
  throw new Error('Set the complete Firebase web app configuration, or keep emulator mode enabled.')
}

const firebaseConfig = {
  apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key'),
  authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${demoProjectId}.firebaseapp.com`),
  projectId: useEmulators ? demoProjectId : configuredProjectId,
  storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${demoProjectId}.firebasestorage.app`),
  messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000'),
  appId: String(import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:demo'),
}

const app = initializeApp(firebaseConfig)

// App Check is optional and only applies when using a real Firebase project.
const appCheckSiteKey = String(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY || '').trim()
if (appCheckSiteKey && !useEmulators) {
  import('firebase/app-check')
    .then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      })
    })
    .catch((error) => console.error('[AppCheck] Initialization failed:', error))
}

const auth = getAuth(app)
if (useEmulators) {
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
}

export { app, auth, emulatorHost, useEmulators }
