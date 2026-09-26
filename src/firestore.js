import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { app, emulatorHost, useEmulators } from './firebase'

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
})

if (useEmulators) connectFirestoreEmulator(db, emulatorHost, 8080)

export { db }
