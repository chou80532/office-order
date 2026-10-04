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
    // 後端錯誤代碼原樣保留，畫面再用 translateError 轉成目前語言。
    const wrapped = new Error(error?.message || 'SERVER_ERROR')
    wrapped.code = error?.code || ''
    wrapped.details = error?.details
    throw wrapped
  }
}
