import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), signOut: vi.fn(), changed: null }))
vi.mock('vue', async (original) => ({ ...await original(), provide: vi.fn() }))
vi.mock('../firebase', () => ({ auth: {} }))
vi.mock('../firestore', () => ({ db: {} }))
vi.mock('../services/accountFunctions', () => ({ completeInviteRegistrationViaFunction: vi.fn() }))
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: {}, createUserWithEmailAndPassword: vi.fn(),
  onAuthStateChanged: (_auth, callback) => { mocks.changed = callback },
  reauthenticateWithCredential: vi.fn(), sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(), signOut: mocks.signOut, updatePassword: vi.fn(),
}))
vi.mock('firebase/firestore', () => ({
  doc: (_db, _collection, uid) => uid, getDoc: mocks.getDoc,
  serverTimestamp: vi.fn(), setDoc: vi.fn().mockResolvedValue(),
}))
import { createAuth } from './useAuth'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

it.each(['success', 'failure'])('ignores an old profile %s after switching accounts', async (outcome) => {
  let resolveOld, rejectOld
  const oldProfile = new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject })
  mocks.getDoc.mockImplementation(uid => uid === 'old' ? oldProfile : Promise.resolve({
    exists: () => true, data: () => ({ memberName: 'New member', isAdmin: false }),
  }))
  const state = createAuth()
  await state.initAuth()
  await mocks.changed({ uid: 'old', email: 'old@example.com' })
  const oldLoad = state.waitForProfile()
  await vi.waitFor(() => expect(mocks.getDoc).toHaveBeenCalledWith('old'))
  await mocks.changed({ uid: 'new', email: 'new@example.com' })
  await state.waitForProfile()
  if (outcome === 'success') resolveOld({ exists: () => true, data: () => ({ memberName: 'Old admin', isAdmin: true }) })
  else rejectOld(new Error('AUTH_PROFILE_NOT_FOUND'))
  await oldLoad
  expect(state.userDisplayName.value).toBe('New member')
  expect(state.isAdmin.value).toBe(false)
  expect(state.userUid.value).toBe('new')
  expect(mocks.signOut).not.toHaveBeenCalled()
})

it('does not restore the old profile after logout', async () => {
  let resolveProfile
  mocks.getDoc.mockReturnValue(new Promise(resolve => { resolveProfile = resolve }))
  const state = createAuth()
  await state.initAuth()
  await mocks.changed({ uid: 'old', email: 'old@example.com' })
  const loading = state.waitForProfile()
  await vi.waitFor(() => expect(mocks.getDoc).toHaveBeenCalled())
  await mocks.changed(null)
  resolveProfile({ exists: () => true, data: () => ({ memberName: 'Old admin', isAdmin: true }) })
  await loading
  expect(state.isLoggedIn.value).toBe(false)
  expect(state.isAdmin.value).toBe(false)
  expect(state.userDisplayName.value).toBe('')
})
