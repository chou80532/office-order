// Firebase Authentication 錯誤代碼轉成目前語言的訊息；其他錯誤交給 translateError。
import { t, translateError } from '../i18n'

const FIREBASE_AUTH_KEYS = {
  'auth/user-not-found': 'userNotFound',
  'auth/wrong-password': 'wrongPassword',
  'auth/invalid-credential': 'invalidCredential',
  'auth/too-many-requests': 'tooManyRequests',
  'auth/weak-password': 'weakPassword',
  'auth/invalid-email': 'invalidEmail',
  'auth/email-already-in-use': 'emailInUse',
  'auth/popup-closed-by-user': 'popupClosed',
  'auth/cancelled-popup-request': 'popupClosed',
  'auth/popup-blocked': 'popupBlocked',
  'auth/operation-not-allowed': 'providerDisabled',
}

export const firebaseAuthMessage = (error, fallbackKey = 'errors.generic') => {
  const key = FIREBASE_AUTH_KEYS[error?.code]
  return key ? t(`auth.firebase.${key}`) : translateError(error, fallbackKey)
}
