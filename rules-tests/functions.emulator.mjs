import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'

const projectId = 'demo-office-lunch'
const authEmulatorHost = '127.0.0.1:9099'
const firestoreEmulatorHost = '127.0.0.1:8080'
const functionsBase = `http://127.0.0.1:5001/${projectId}/us-central1`
const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url))
const admin = requireFunctions('firebase-admin')
let app
let db
let auth
let users = []
let member
let otherMember
let administrator

const signIn = async (email, password) => {
  const response = await fetch(`http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  const body = await response.json()
  assert.equal(response.ok, true, `Auth emulator sign-in failed: ${JSON.stringify(body)}`)
  return body.idToken
}

const callFunction = async (name, data = {}, idToken = '') => {
  const headers = { 'content-type': 'application/json' }
  if (idToken) headers.authorization = `Bearer ${idToken}`
  const response = await fetch(`${functionsBase}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  })
  return { status: response.status, body: await response.json() }
}

before(async () => {
  assert.equal(process.env.GCLOUD_PROJECT || projectId, projectId, 'Functions tests must use only demo-office-lunch')
  process.env.GCLOUD_PROJECT = projectId
  process.env.FIREBASE_AUTH_EMULATOR_HOST = authEmulatorHost
  process.env.FIRESTORE_EMULATOR_HOST = firestoreEmulatorHost
  app = admin.initializeApp({ projectId }, `functions-emulator-test-${randomBytes(4).toString('hex')}`)
  db = app.firestore()
  auth = app.auth()

  const password = randomBytes(24).toString('base64url')
  const createUser = async (email, memberName, isAdmin = false) => {
    const user = await auth.createUser({ email, password, emailVerified: true, displayName: memberName })
    users.push(user)
    await db.collection('users').doc(user.uid).set({
      memberName,
      memberNameKey: user.uid,
      isAdmin,
      accountDeletionPending: false,
    })
    return { ...user, password, memberName }
  }

  const stamp = Date.now().toString(36)
  member = await createUser(`member-${stamp}@example.test`, 'Smoke Member')
  otherMember = await createUser(`other-${stamp}@example.test`, 'Other Member')
  administrator = await createUser(`admin-${stamp}@example.test`, 'Smoke Admin', true)

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  await Promise.all([
    db.collection('settings').doc('daily').set({
      serviceDate: today,
      activeStores: ['Emulator Test Store'],
      freeStores: [],
    }),
    db.collection('menu_images').doc('emulator-smoke-store').set({
      storeName: 'Emulator Test Store',
      menuItems: [{ type: 'main', category: 'Lunch', name: 'Emulator Test Meal', price: 120 }],
    }),
  ])
})

after(async () => {
  await Promise.all(users.map(async (user) => {
    await Promise.all([
      db?.collection('users').doc(user.uid).delete(),
      auth?.deleteUser(user.uid),
    ])
  }))
  if (app) await app.delete()
})

test('Functions emulator loads, enforces auth/admin checks, and completes a member order lifecycle', async (t) => {
  const unauthenticated = await callFunction('getCashPaymentAdminData')
  assert.equal(unauthenticated.body?.error?.status, 'UNAUTHENTICATED')
  await t.test('rejects unauthenticated callable requests', () => {})

  const memberToken = await signIn(member.email, member.password)
  const otherToken = await signIn(otherMember.email, otherMember.password)
  const adminToken = await signIn(administrator.email, administrator.password)

  const deniedAdminData = await callFunction('getCashPaymentAdminData', {}, memberToken)
  assert.equal(deniedAdminData.body?.error?.status, 'PERMISSION_DENIED')
  await t.test('rejects an authenticated non-admin from admin summaries', () => {})

  const requestId = `emulator-smoke-${randomBytes(8).toString('hex')}`
  const created = await callFunction('createOrdersWithWalletDebit', {
    requestId,
    fallbackName: member.memberName,
    actorName: member.memberName,
    selectedStoreName: 'Emulator Test Store',
    items: [{
      name: 'Emulator Test Meal',
      price: 120,
      storeName: 'Emulator Test Store',
      ownerName: member.memberName,
      ownerUid: member.uid,
      paymentMethod: 'cash',
      note: 'initial smoke note',
    }],
  }, memberToken)
  assert.equal(created.body?.error, undefined, `Order creation failed: ${JSON.stringify(created.body)}`)
  const orderIds = created.body?.result?.orderIds
  assert.equal(Array.isArray(orderIds), true)
  assert.equal(orderIds.length, 1)
  const orderId = orderIds[0]
  const orderRef = db.collection('orders').doc(orderId)
  const storedOrder = (await orderRef.get()).data()
  assert.equal(storedOrder.price, 120)
  assert.equal(storedOrder.ownerUid, member.uid)
  await t.test('allows a registered member to create their own order through the callable function', () => {})

  const crossUserEdit = await callFunction('updateOrderWithPaymentAdjustment', {
    orderId,
    meal: 'Emulator Test Meal',
    price: 120,
    note: 'unauthorized edit',
  }, otherToken)
  assert.equal(crossUserEdit.body?.error?.status, 'PERMISSION_DENIED')
  await t.test('prevents another member from editing the order', () => {})

  const ownEdit = await callFunction('updateOrderWithPaymentAdjustment', {
    orderId,
    meal: 'Emulator Test Meal',
    price: 120,
    note: 'updated smoke note',
  }, memberToken)
  assert.equal(ownEdit.body?.error, undefined, `Own-order edit failed: ${JSON.stringify(ownEdit.body)}`)
  assert.equal((await orderRef.get()).data().note, 'updated smoke note')
  await t.test('allows the owner to edit their order through the callable function', () => {})

  const adminSummary = await callFunction('getCashPaymentAdminData', {}, adminToken)
  assert.equal(adminSummary.body?.error, undefined, `Admin summary failed: ${JSON.stringify(adminSummary.body)}`)
  assert.equal(Array.isArray(adminSummary.body?.result?.payments), true)
  assert.equal(adminSummary.body.result.payments.some(payment =>
    (payment.items || []).some(item => item.orderId === orderId && item.price === 120)), true)
  await t.test('allows an admin to load payment summaries with the expected amount', () => {})

  const crossUserCancel = await callFunction('cancelOrdersWithWalletRefund', { orderIds: [orderId] }, otherToken)
  assert.equal(crossUserCancel.body?.error?.status, 'PERMISSION_DENIED')
  const ownCancel = await callFunction('cancelOrdersWithWalletRefund', { orderIds: [orderId] }, memberToken)
  assert.equal(ownCancel.body?.error, undefined, `Own-order cancellation failed: ${JSON.stringify(ownCancel.body)}`)
  assert.equal((await orderRef.get()).exists, false)
  await t.test('prevents cross-user cancellation and allows the owner to cancel', () => {})
})
