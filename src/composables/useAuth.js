import { computed, inject, provide, ref } from 'vue'
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
} from 'firebase/auth'
import { auth } from '../firebase'
import {
  completeDomainRegistrationViaFunction,
  completeFirstAdminSetupViaFunction,
  completeInviteRegistrationViaFunction,
  updateMyPreferencesViaFunction,
} from '../services/accountFunctions'
import { readStorage, removeStorage, writeStorage } from '../utils/storage'
import { normalizeDietaryPreferences } from '../utils/dietaryTags'

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
  // 成員自己的「允許他人代訂」授權（代訂規則為「需本人同意」時才有作用）。
  const allowProxyOrders = ref(false)
  const dietaryPreferences = ref(normalizeDietaryPreferences())
  // 已通過 Firebase 驗證、但還不是系統成員的帳號（Google 首次登入、公司信箱待驗證等）。
  const pendingRegistration = ref(null)

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
      allowProxyOrders.value = data.allowProxyOrders === true
      dietaryPreferences.value = normalizeDietaryPreferences(data.dietary)
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
        dietaryPreferences.value = normalizeDietaryPreferences()
        profileLoaded.value = false

        if (!user) {
          isLoggedIn.value = false
          isAdmin.value = false
          adminEmail.value = ''
          userDisplayName.value = ''
          allowProxyOrders.value = false
          pendingRegistration.value = null
          // 移除舊版未綁定 UID 的快取；新版快取保留供同帳號下次登入立即顯示。
          removeStorage('cachedDisplayName')
          removeStorage('cachedIsAdmin')
          profileLoaded.value = true
          profileLoadPromise = Promise.resolve()
          resolveInit(user)
          return
        }

        // Firebase 建立帳號後立即送出登入事件；邀請驗證完成前不可進入首頁。
        isLoggedIn.value = !skipProfileLoad
        adminEmail.value = user.email || ''
        const cachedProfile = readCachedProfile(user.uid)
        userDisplayName.value = cachedProfile?.displayName || ''
        isAdmin.value = false

        // 先完成初始化，避免等待 Firestore user profile 造成登入後畫面卡住。
        resolveInit(user)

        if (skipProfileLoad) {
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
        dietaryPreferences.value = normalizeDietaryPreferences()
        profileLoaded.value = true
        userDisplayName.value = ''
        adminEmail.value = ''
        isAdmin.value = false
        profileLoadPromise = Promise.resolve()
        resolveInit(null)
      }
    )
  }

  // 讀取自己的成員資料；尚未註冊的帳號會被規則拒絕，視為沒有資料。
  const readOwnProfile = async (uid) => {
    const { db, doc, getDoc } = await getFirestoreContext()
    try {
      const snap = await getDoc(doc(db, 'users', uid))
      return snap.exists() ? snap.data() : null
    } catch (error) {
      if (error?.code === 'permission-denied') return null
      throw error
    }
  }

  const activateProfile = (user, profile) => {
    userDisplayName.value = profile.memberName || user.email?.split('@')[0] || ''
    isAdmin.value = !!profile.isAdmin
    allowProxyOrders.value = profile.allowProxyOrders === true
    dietaryPreferences.value = normalizeDietaryPreferences(profile.dietary)
    adminEmail.value = user.email || ''
    writeCachedProfile(user.uid, userDisplayName.value)
    pendingRegistration.value = null
    profileLoadPromise = Promise.resolve()
    profileLoaded.value = true
    isLoggedIn.value = true
  }

  const describePendingUser = user => ({
    email: user.email || '',
    emailVerified: user.emailVerified === true,
    providerId: user.providerData?.[0]?.providerId || 'password',
  })

  // 登入後先確認是否已是成員：是就直接進入系統，不是就保留登入狀態讓使用者完成註冊。
  const finishSignIn = async (user) => {
    try {
      const profile = await readOwnProfile(user.uid)
      if (profile && !profile.accountDeletionPending) {
        activateProfile(user, profile)
        return { needsRegistration: false }
      }
      pendingRegistration.value = describePendingUser(user)
      return { needsRegistration: true }
    } finally {
      skipProfileLoad = false
    }
  }

  const login = async (email, password) => {
    skipProfileLoad = true
    let credential
    try {
      credential = await signInWithEmailAndPassword(auth, email, password)
    } catch (error) {
      skipProfileLoad = false
      throw error
    }
    return finishSignIn(credential.user)
  }

  const signInWithGoogle = async () => {
    skipProfileLoad = true
    let credential
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      credential = await signInWithPopup(auth, provider)
    } catch (error) {
      skipProfileLoad = false
      throw error
    }
    return finishSignIn(credential.user)
  }

  // 公司信箱自助註冊：建立帳號並寄出驗證信，驗證完成後再呼叫 completeRegistration。
  const registerWithEmail = async (email, password) => {
    skipProfileLoad = true
    try {
      const { user } = await createUserWithEmailAndPassword(auth, email, password)
      await sendEmailVerification(user).catch(() => {})
      pendingRegistration.value = describePendingUser(user)
      return user
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') throw new Error('EMAIL_EXISTS', { cause: error })
      throw error
    } finally {
      skipProfileLoad = false
    }
  }

  const refreshEmailVerification = async () => {
    const user = auth.currentUser
    if (!user) return false
    await user.reload()
    if (pendingRegistration.value) pendingRegistration.value = describePendingUser(user)
    return user.emailVerified === true
  }

  const resendEmailVerification = async () => {
    if (auth.currentUser) await sendEmailVerification(auth.currentUser)
  }

  // 已登入但尚未註冊的帳號：用邀請碼或公司信箱完成註冊。
  const completeRegistration = async ({ inviteCode = '', memberName = '' } = {}) => {
    const user = auth.currentUser
    if (!user) throw new Error('UNAUTHENTICATED')
    let result
    if (inviteCode) {
      result = await completeInviteRegistrationViaFunction(inviteCode.toUpperCase().trim())
    } else {
      // 剛點完驗證連結時，ID token 的 email_verified 還是舊值，要先強制更新。
      await user.reload()
      await user.getIdToken(true)
      result = await completeDomainRegistrationViaFunction(memberName.trim())
    }
    const name = result?.memberName || ''
    if (!name) throw new Error('INVALID_MEMBER_NAME')
    activateProfile(user, { memberName: name, isAdmin: false })
    return user
  }

  const cancelPendingRegistration = async () => {
    pendingRegistration.value = null
    await signOut(auth)
  }

  const updatePreferences = async (preferences) => {
    const revision = authRevision
    const result = await updateMyPreferencesViaFunction(preferences)
    if (revision !== authRevision) return result
    if (typeof result?.allowProxyOrders === 'boolean') allowProxyOrders.value = result.allowProxyOrders
    if (result?.dietary) dietaryPreferences.value = normalizeDietaryPreferences(result.dietary)
    return result
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
      profileLoaded.value = true
      isLoggedIn.value = true
    } catch (error) {
      skipProfileLoad = false
      try { await newUser.delete() } catch { /* 保留原始註冊錯誤 */ }
      throw error
    }

    skipProfileLoad = false
    return newUser
  }

  // 首次部署：建立（或沿用 Firebase Console 已建立的）帳號，再以 SETUP_TOKEN 升為第一位管理員。
  const setupFirstAdmin = async ({ email, password, setupToken, memberName, settings }) => {
    skipProfileLoad = true
    let user
    let createdNewUser = false

    try {
      user = (await createUserWithEmailAndPassword(auth, email, password)).user
      createdNewUser = true
    } catch (error) {
      if (error.code !== 'auth/email-already-in-use') {
        skipProfileLoad = false
        throw error
      }
      try {
        user = (await signInWithEmailAndPassword(auth, email, password)).user
      } catch (signInError) {
        skipProfileLoad = false
        throw new Error('EMAIL_EXISTS', { cause: signInError })
      }
    }

    try {
      const result = await completeFirstAdminSetupViaFunction({ setupToken, memberName, settings })
      const name = result.memberName || ''
      if (!name) throw new Error('INVALID_MEMBER_NAME')

      userDisplayName.value = name
      isAdmin.value = true
      writeCachedProfile(user.uid, name)
      profileLoaded.value = true
      isLoggedIn.value = true
    } catch (error) {
      skipProfileLoad = false
      // 只刪除這次流程新建的帳號；沿用的既有帳號改為登出。
      if (createdNewUser) {
        try { await user.delete() } catch { /* 保留原始錯誤 */ }
      } else {
        try { await signOut(auth) } catch { /* 保留原始錯誤 */ }
      }
      throw error
    }

    skipProfileLoad = false
    return user
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
    allowProxyOrders,
    dietaryPreferences,
    pendingRegistration,
    initAuth,
    login,
    signInWithGoogle,
    register,
    registerWithEmail,
    refreshEmailVerification,
    resendEmailVerification,
    completeRegistration,
    cancelPendingRegistration,
    updatePreferences,
    setupFirstAdmin,
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
      allowProxyOrders: ref(false),
      dietaryPreferences: ref(normalizeDietaryPreferences()),
      pendingRegistration: ref(null),
      auth,
    }
  }

  return injected
}
