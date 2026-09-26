import { computed, inject, provide, ref } from 'vue'
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth'
import { auth } from '../firebase'
import { completeInviteRegistrationViaFunction } from '../services/accountFunctions'
import { readStorage, removeStorage, writeStorage } from '../utils/storage'

const AUTH_KEY = Symbol('auth')
const PROFILE_CACHE_KEY = 'cachedAuthProfile'
const AUTH_INIT_TIMEOUT_MS = 8_000
let firestoreContextPromise

const getFirestoreContext = () => {
  firestoreContextPromise ||= Promise.all([
    import('firebase/firestore'),
    import('../firestore'),
  ]).then(([firestoreApi, { db }]) => ({ ...firestoreApi, db }))
  return firestoreContextPromise
}

const readCachedProfile = (uid) => {
  try {
    const cached = JSON.parse(readStorage(PROFILE_CACHE_KEY, 'null'))
    return cached?.uid === uid && cached?.displayName ? cached : null
  } catch {
    return null
  }
}

const writeCachedProfile = (uid, displayName) => {
  if (!uid || !displayName) return
  writeStorage(PROFILE_CACHE_KEY, JSON.stringify({ uid, displayName }))
}

export const createAuth = () => {
  let skipProfileLoad = false
  let authRevision = 0

  const isAdmin = ref(false)
  const isLoggedIn = ref(false)
  const isInitialized = ref(false)
  const adminEmail = ref('')
  const currentUser = ref(null)
  const profileLoaded = ref(false)
  let profileLoadPromise = Promise.resolve()
  const userDisplayName = ref('')
  const userUid = computed(() => currentUser.value?.uid || '')

  const loadUserProfile = async (user, revision) => {
    if (!user) return

    const { db, doc, getDoc, serverTimestamp, setDoc } = await getFirestoreContext()

    const userDocRef = doc(db, 'users', user.uid)
    const snap = await getDoc(userDocRef)
    if (revision !== authRevision) return

    if (snap.exists()) {
      const data = snap.data()
      userDisplayName.value = data.memberName || user.email?.split('@')[0] || ''
      isAdmin.value = !!data.isAdmin
      writeCachedProfile(user.uid, userDisplayName.value)
      setDoc(userDocRef, { lastLoginAt: serverTimestamp() }, { merge: true }).catch(() => {})
      return
    }


    throw new Error('AUTH_PROFILE_NOT_FOUND')

  }

  let initResolve
  const initPromise = new Promise((resolve) => {
    initResolve = resolve
  })

  const resolveInit = (user) => {
    if (isInitialized.value) return
    isInitialized.value = true
    initResolve(user)
  }

  const initAuth = async () => {
    const initTimeout = window.setTimeout(() => {
      console.warn('[Auth] Initialization timed out; continuing as signed out.')
      currentUser.value = null
      isLoggedIn.value = false
      profileLoaded.value = true
      profileLoadPromise = Promise.resolve()
      resolveInit(null)
    }, AUTH_INIT_TIMEOUT_MS)

    onAuthStateChanged(
      auth,
      async (user) => {
        const revision = ++authRevision
        window.clearTimeout(initTimeout)
        currentUser.value = user
        profileLoaded.value = false

        if (!user) {
          isLoggedIn.value = false
          isAdmin.value = false
          adminEmail.value = ''
          userDisplayName.value = ''
          // 移除舊版未綁定 UID 的快取；新版快取保留供同帳號下次登入立即顯示。
          removeStorage('cachedDisplayName')
          removeStorage('cachedIsAdmin')
          profileLoaded.value = true
          profileLoadPromise = Promise.resolve()
          resolveInit(user)
          return
        }

        isLoggedIn.value = true
        adminEmail.value = user.email || ''
        const cachedProfile = readCachedProfile(user.uid)
        userDisplayName.value = cachedProfile?.displayName || ''
        isAdmin.value = false

        // 先完成初始化，避免等待 Firestore user profile 造成登入後畫面卡住。
        resolveInit(user)

        if (skipProfileLoad) {
          profileLoaded.value = true
          profileLoadPromise = Promise.resolve()
          return
        }

        profileLoadPromise = (async () => {
          try {
            await loadUserProfile(user, revision)
          } catch (error) {
            if (revision !== authRevision) return
            console.error('[Auth] Failed to load user profile:', error)
            userDisplayName.value = user.email?.split('@')[0] || ''
            isAdmin.value = false
            if (error.message === 'AUTH_PROFILE_NOT_FOUND') await signOut(auth)
          } finally {
            if (revision === authRevision) profileLoaded.value = true
          }
        })()
      },
      (error) => {
        authRevision += 1
        window.clearTimeout(initTimeout)
        console.error('[Auth] Failed to initialize auth state:', error)
        currentUser.value = null
        isLoggedIn.value = false
        profileLoaded.value = true
        userDisplayName.value = ''
        adminEmail.value = ''
        isAdmin.value = false
        profileLoadPromise = Promise.resolve()
        resolveInit(null)
      }
    )
  }

  const login = async (email, password) => {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    return cred.user
  }

  const register = async (email, password, inviteCode) => {
    const code = inviteCode.toUpperCase().trim()
    skipProfileLoad = true
    let userCredential

    try {
      userCredential = await createUserWithEmailAndPassword(auth, email, password)
    } catch (error) {
      skipProfileLoad = false
      if (error.code === 'auth/email-already-in-use') throw new Error('EMAIL_EXISTS', { cause: error })
      throw error
    }

    const newUser = userCredential.user
    try {
      const result = await completeInviteRegistrationViaFunction(code)
      const memberName = result.memberName || ''
      if (!memberName) throw new Error('INVALID_MEMBER_NAME')

      userDisplayName.value = memberName
      isAdmin.value = false
      writeCachedProfile(newUser.uid, memberName)
    } catch (error) {
      skipProfileLoad = false
      try { await newUser.delete() } catch { /* 保留原始註冊錯誤 */ }
      throw error
    }

    skipProfileLoad = false
    return newUser
  }
  const logout = async () => {
    await signOut(auth)
  }

  const changePassword = async (currentPassword, newPassword) => {
    const user = auth.currentUser
    if (!user || !user.email) throw new Error('AUTH_USER_NOT_FOUND')

    const credential = EmailAuthProvider.credential(user.email, currentPassword)
    await reauthenticateWithCredential(user, credential)
    await updatePassword(user, newPassword)
  }

  const resetPassword = async (email) => {
    await sendPasswordResetEmail(auth, email)
  }

  const waitForProfile = () => profileLoadPromise

  const state = {
    isAdmin,
    isLoggedIn,
    isInitialized,
    profileLoaded,
    waitForProfile,
    currentUser,
    userDisplayName,
    userUid,
    adminEmail,
    initAuth,
    login,
    register,
    logout,
    changePassword,
    resetPassword,
    auth,
  }

  provide(AUTH_KEY, state)

  return { ...state, initPromise }
}

export const useAuth = () => {
  const injected = inject(AUTH_KEY, null)

  if (!injected) {
    console.warn('[useAuth] Missing auth provider. Call createAuth() from App.vue first.')
    return {
      isAdmin: ref(false),
      isLoggedIn: ref(false),
      isInitialized: ref(false),
      profileLoaded: ref(true),
      waitForProfile: () => Promise.resolve(),
      currentUser: ref(null),
      userDisplayName: ref(''),
      userUid: computed(() => ''),
      adminEmail: ref(''),
      auth,
    }
  }

  return injected
}
