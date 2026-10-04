// ==========================================
// 瀏覽器推播（Firebase Cloud Messaging）。部署者需在 .env 設定 VITE_FIREBASE_VAPID_KEY
// （Firebase Console → 專案設定 → Cloud Messaging → Web Push 憑證）；未設定或使用
// Emulator 時整個功能隱藏。裝置 token 交給 Cloud Functions 保存，通知由伺服器發送。
// ==========================================
import { app, useEmulators } from '../firebase'
import { registerPushTokenViaFunction, unregisterPushTokenViaFunction } from './accountFunctions'
import { readStorage, removeStorage, writeStorage } from '../utils/storage'

const VAPID_KEY = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim()
const TOKEN_KEY = 'pushToken'

export const pushAvailable = () => Boolean(VAPID_KEY)
  && !useEmulators
  && typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window

export const pushPermission = () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission)

export const pushEnabledOnDevice = () => Boolean(readStorage(TOKEN_KEY)) && pushPermission() === 'granted'

export async function enablePush() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('PUSH_DENIED')
  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging')
  if (!await isSupported()) throw new Error('PUSH_UNSUPPORTED')
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration })
  await registerPushTokenViaFunction(token)
  writeStorage(TOKEN_KEY, token)
}

export async function disablePush() {
  const token = readStorage(TOKEN_KEY)
  removeStorage(TOKEN_KEY)
  if (!token) return
  await unregisterPushTokenViaFunction(token).catch(() => {})
  try {
    const { getMessaging, deleteToken } = await import('firebase/messaging')
    await deleteToken(getMessaging(app))
  } catch { /* token 已失效時忽略 */ }
}
