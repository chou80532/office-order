import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions'
import { app, emulatorHost, useEmulators } from '../firebase'

const region = String(import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1').trim()
const functions = getFunctions(app, region)
if (useEmulators) connectFunctionsEmulator(functions, emulatorHost, 5001)

export const callFunction = async (name, data = {}) => {
  try {
    const result = await httpsCallable(functions, name)(data)
    return result.data
  } catch (error) {
    const wrapped = new Error(error?.message || '伺服器操作失敗')
    wrapped.code = error?.code || ''
    wrapped.details = error?.details
    throw wrapped
  }
}
