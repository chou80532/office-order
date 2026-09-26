import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

const projectId = 'demo-office-lunch'
const rules = readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8')
let testEnv

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  })
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    const fixtures = [
      ['users/alice', { memberName: 'Alice', isAdmin: false, lastLoginAt: 0 }],
      ['users/bob', { memberName: 'Bob', isAdmin: false, lastLoginAt: 0 }],
      ['users/admin', { memberName: 'Admin', isAdmin: true, lastLoginAt: 0 }],
      ['orders/alice-order', { ownerUid: 'alice', uid: 'alice', name: 'Alice', price: 120 }],
      ['orders/bob-order', { ownerUid: 'bob', uid: 'bob', name: 'Bob', price: 90 }],
      ['wallets/alice', { ownerUid: 'alice', ownerName: 'Alice', balance: 500 }],
      ['wallets/bob', { ownerUid: 'bob', ownerName: 'Bob', balance: 250 }],
      ['wallet_logs/alice-log', { ownerUid: 'alice', walletId: 'alice', amount: -120 }],
      ['wallet_logs/bob-log', { ownerUid: 'bob', walletId: 'bob', amount: -90 }],
      ['menu_images/store-a', { storeName: 'Store A', menuItems: [{ name: 'Lunch', price: 120 }] }],
      ['settings/daily', { serviceDate: '2026-09-26', activeStores: ['Store A'], freeStores: [] }],
      ['settings/members', { names: ['Alice', 'Bob'] }],
      ['settings/quickNotes', { groups: [] }],
      ['inviteCodes/invite-a', { memberName: 'New Member', used: false }],
      ['cash_payments/cash-a', { ownerUid: 'alice', amount: 120, status: 'pending' }],
      ['cash_payment_logs/cash-log-a', { ownerUid: 'alice', amount: 120 }],
    ]
    for (const [path, value] of fixtures) {
      await setDoc(doc(db, ...path.split('/')), value)
    }
  })
})

after(async () => {
  await testEnv?.cleanup()
})

test('unauthenticated users cannot read or write private application data', async () => {
  const db = testEnv.unauthenticatedContext().firestore()
  await assertFails(getDoc(doc(db, 'orders/alice-order')))
  await assertFails(getDoc(doc(db, 'menu_images/store-a')))
  await assertFails(getDoc(doc(db, 'settings/daily')))
  await assertFails(getDoc(doc(db, 'cash_payments/cash-a')))
  await assertFails(setDoc(doc(db, 'orders/unauth-order'), { ownerUid: 'unauth' }))
  await assertFails(updateDoc(doc(db, 'orders/alice-order'), { price: 1 }))
  await assertFails(deleteDoc(doc(db, 'orders/alice-order')))
  await assertFails(setDoc(doc(db, 'menu_images/unauth-store'), { storeName: 'Injected' }))
})

test('registered members can read shared ordering data but not other private profiles or cash records', async () => {
  const db = testEnv.authenticatedContext('alice').firestore()
  assert.equal((await assertSucceeds(getDoc(doc(db, 'orders/alice-order')))).exists(), true)
  // Orders and menus are shared among registered coworkers by this app's rules.
  assert.equal((await assertSucceeds(getDoc(doc(db, 'orders/bob-order')))).exists(), true)
  assert.equal((await assertSucceeds(getDoc(doc(db, 'menu_images/store-a')))).exists(), true)
  assert.equal((await assertSucceeds(getDoc(doc(db, 'settings/daily')))).exists(), true)
  assert.equal((await assertSucceeds(getDoc(doc(db, 'settings/members')))).exists(), true)
  assert.equal((await assertSucceeds(getDoc(doc(db, 'users/alice')))).exists(), true)
  await assertFails(getDoc(doc(db, 'users/bob')))
  await assertFails(getDoc(doc(db, 'cash_payments/cash-a')))
  await assertFails(getDocs(collection(db, 'cash_payment_logs')))
})

test('order writes go through Cloud Functions, never direct Firestore writes', async () => {
  for (const uid of ['alice', 'admin']) {
    const db = testEnv.authenticatedContext(uid).firestore()
    await assertFails(setDoc(doc(db, `orders/${uid}-new`), { ownerUid: uid }))
    await assertFails(updateDoc(doc(db, 'orders/alice-order'), { price: 121 }))
    await assertFails(deleteDoc(doc(db, 'orders/alice-order')))
  }
})

test('a member can update only the permitted login timestamp and cannot escalate privileges', async () => {
  const aliceDb = testEnv.authenticatedContext('alice').firestore()
  await assertSucceeds(updateDoc(doc(aliceDb, 'users/alice'), { lastLoginAt: 100 }))
  await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { isAdmin: true }))
  await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { memberName: 'Changed Name' }))
  await assertFails(updateDoc(doc(aliceDb, 'users/bob'), { lastLoginAt: 100 }))
  await assertFails(setDoc(doc(aliceDb, 'users/attacker'), { isAdmin: true }))
})

test('wallets and wallet ledgers are readable only by their owner or an admin and are server-write-only', async () => {
  const aliceDb = testEnv.authenticatedContext('alice').firestore()
  assert.equal((await assertSucceeds(getDoc(doc(aliceDb, 'wallets/alice')))).exists(), true)
  assert.equal((await assertSucceeds(getDoc(doc(aliceDb, 'wallet_logs/alice-log')))).exists(), true)
  await assertFails(getDoc(doc(aliceDb, 'wallets/bob')))
  await assertFails(getDoc(doc(aliceDb, 'wallet_logs/bob-log')))
  await assertFails(updateDoc(doc(aliceDb, 'wallets/alice'), { balance: 999999 }))
  await assertFails(setDoc(doc(aliceDb, 'wallet_logs/fake'), { amount: 999999 }))

  const adminDb = testEnv.authenticatedContext('admin').firestore()
  assert.equal((await assertSucceeds(getDoc(doc(adminDb, 'wallets/bob')))).exists(), true)
  await assertFails(updateDoc(doc(adminDb, 'wallets/bob'), { balance: 0 }))
})

test('members cannot manage stores, menus, settings, invite codes, or cash payment records', async () => {
  const db = testEnv.authenticatedContext('alice').firestore()
  await assertFails(updateDoc(doc(db, 'menu_images/store-a'), { storeName: 'Injected Store' }))
  await assertFails(setDoc(doc(db, 'menu_images/injected'), { storeName: 'Injected Store' }))
  await assertFails(updateDoc(doc(db, 'settings/daily'), { activeStores: [] }))
  await assertFails(updateDoc(doc(db, 'settings/members'), { names: ['Attacker'] }))
  await assertFails(getDoc(doc(db, 'inviteCodes/invite-a')))
  await assertFails(setDoc(doc(db, 'inviteCodes/injected'), { used: false }))
  await assertFails(updateDoc(doc(db, 'cash_payments/cash-a'), { amount: 0 }))
})

test('admins can manage menus, settings and invitations but still cannot bypass server-only ledgers', async () => {
  const db = testEnv.authenticatedContext('admin').firestore()
  await assertSucceeds(updateDoc(doc(db, 'menu_images/store-a'), { storeName: 'Store A Updated' }))
  await assertSucceeds(updateDoc(doc(db, 'settings/daily'), { activeStores: ['Store A', 'Store B'] }))
  await assertSucceeds(updateDoc(doc(db, 'settings/quickNotes'), { groups: ['No onion'] }))
  assert.equal((await assertSucceeds(getDoc(doc(db, 'inviteCodes/invite-a')))).exists(), true)
  await assertSucceeds(setDoc(doc(db, 'inviteCodes/invite-b'), { memberName: 'Another Member', used: false }))
  assert.equal((await assertSucceeds(getDoc(doc(db, 'cash_payments/cash-a')))).exists(), true)
  assert.equal((await assertSucceeds(getDoc(doc(db, 'orders/bob-order')))).exists(), true)
  await assertFails(setDoc(doc(db, 'orders/admin-injected'), { ownerUid: 'admin' }))
  await assertFails(updateDoc(doc(db, 'wallets/alice'), { balance: 0 }))
  await assertFails(updateDoc(doc(db, 'users/alice'), { isAdmin: true }))
})

test('authenticated but unregistered accounts and unmatched private paths remain denied', async () => {
  const db = testEnv.authenticatedContext('not-registered').firestore()
  await assertFails(getDoc(doc(db, 'orders/alice-order')))
  await assertFails(getDoc(doc(db, 'settings/daily')))
  await assertFails(getDoc(doc(db, 'menu_images/store-a')))
  await assertFails(getDoc(doc(db, 'private_records/secret')))
})
