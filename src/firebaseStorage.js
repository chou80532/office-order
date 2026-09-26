import { connectStorageEmulator, getStorage } from 'firebase/storage'
import { app, emulatorHost, useEmulators } from './firebase'

const storage = getStorage(app)
if (useEmulators) connectStorageEmulator(storage, emulatorHost, 9199)

export { storage }
