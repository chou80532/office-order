const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { setGlobalOptions } = require('firebase-functions/v2')
const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')
const crypto = require('crypto')

admin.initializeApp()
setGlobalOptions({ maxInstances: 3 })

const db = admin.firestore()
const MAX_ORDER_ITEMS = 100
const MAX_PRICE = 10_000
const MAX_WALLET_TRANSACTION = 1_000_000
const MAX_WALLET_TOP_UP = 10_000
const MAX_NAME_LENGTH = 80
const MAX_STORE_NAME_LENGTH = 120
const MAX_MEAL_LENGTH = 100
const MAX_NOTE_LENGTH = 200
const MAX_CANCEL_ITEMS = 100

const roundMoney = (value) => Math.round(Number(value) || 0)
const finiteMoney = (value, { min, max, code }) => {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new HttpsError('invalid-argument', code)
  const rounded = Math.round(number)
  if ((min !== undefined && rounded < min) || (max !== undefined && rounded > max)) {
    throw new HttpsError('invalid-argument', code)
  }
  return rounded
}
const walletIdForUid = (uid) => String(uid || '').trim()
const walletRefForUid = (uid) => db.collection('wallets').doc(walletIdForUid(uid))
// 代訂公開名單：只鏡射姓名與 uid，供全體成員挑選代訂對象（不含 email／isAdmin）。
const memberRosterRef = (uid) => db.collection('member_roster').doc(String(uid || '').trim())
const walletLogRef = () => db.collection('wallet_logs').doc()
const cashPaymentRef = () => db.collection('cash_payments').doc()
const cashPaymentLogRef = () => db.collection('cash_payment_logs').doc()
const CLEANUP_CONFIRMATION = '刪除選取區間資料'
const MAX_CLEANUP_WRITES = 400

// transaction.getAll 不接受空參數，統一在這裡防守。
const getAllInTransaction = (transaction, refs) =>
  refs.length ? transaction.getAll(...refs) : Promise.resolve([])

// 台北日期 key（YYYY-MM-DD），與前端 getLocalDateKey 及 settings/daily 的 serviceDate 對齊。
const taipeiDateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const taipeiDateKey = (date = new Date()) => taipeiDateKeyFormatter.format(date)
const dinerKey = (uid, name) => crypto.createHash('sha256').update(uid ? `uid:${uid}` : `name:${name}`).digest('hex')
const diningRef = () => db.collection('dining_days').doc(taipeiDateKey())
const readDining = async (transaction) => {
  const ref = diningRef()
  const snap = await transaction.get(ref)
  return { ref, data: { participants: {}, needs: {}, replacements: {}, ...(snap.exists ? snap.data() : {}) } }
}

const normalizeMemberName = (value) => String(value || '').trim().replace(/\s+/g, ' ')
const memberNameKey = (value) => crypto
  .createHash('sha256')
  .update(normalizeMemberName(value).toLocaleLowerCase('zh-TW'), 'utf8')
  .digest('hex')

// 帳號可由 Firebase Auth 建立，但只有成功兌換邀請碼後才會成為系統會員。
exports.completeInviteRegistration = onCall(async (request) => {
  const uid = requireAuth(request)
  const code = String(request.data?.inviteCode || '').trim().toUpperCase()
  if (!code || code.includes('/') || code.length > 32) {
    throw new HttpsError('invalid-argument', 'INVALID_CODE')
  }

  const codeRef = db.collection('inviteCodes').doc(code)
  const userRef = db.collection('users').doc(uid)
  const now = admin.firestore.Timestamp.now()

  const initialCodeSnap = await codeRef.get()
  if (!initialCodeSnap.exists) throw new HttpsError('not-found', 'INVALID_CODE')
  const requestedName = normalizeMemberName(initialCodeSnap.data().memberName)
  const requestedNameKey = memberNameKey(requestedName)
  const nameKeySnap = await db.collection('member_name_keys').doc(requestedNameKey).get()
  if (nameKeySnap.exists) {
    if (nameKeySnap.data().uid !== uid) {
      const ownerSnap = await db.collection('users').doc(String(nameKeySnap.data().uid)).get()
      if (ownerSnap.exists) throw new HttpsError('already-exists', 'MEMBER_NAME_TAKEN')
    }
  } else {
    // 相容既有資料：舊會員尚未建立唯一姓名鍵時，退回全集合掃描擋下正規化後的重名。
    const existingUsers = await db.collection('users').get()
    const duplicate = existingUsers.docs.find(doc =>
      doc.id !== uid && memberNameKey(doc.data().memberName) === requestedNameKey)
    if (duplicate) throw new HttpsError('already-exists', 'MEMBER_NAME_TAKEN')
  }

  return db.runTransaction(async (transaction) => {
    const codeSnap = await transaction.get(codeRef)
    if (!codeSnap.exists) throw new HttpsError('not-found', 'INVALID_CODE')

    const codeData = codeSnap.data()
    if (codeData.used) throw new HttpsError('already-exists', 'CODE_USED')
    if (codeData.expiresAt?.toMillis?.() < now.toMillis()) {
      throw new HttpsError('deadline-exceeded', 'CODE_EXPIRED')
    }

    const name = normalizeMemberName(codeData.memberName)
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new HttpsError('failed-precondition', 'INVALID_MEMBER_NAME')
    }

    const nameRef = db.collection('member_name_keys').doc(memberNameKey(name))
    const userSnap = await transaction.get(userRef)
    const nameSnap = await transaction.get(nameRef)
    if (userSnap.exists) throw new HttpsError('already-exists', 'PROFILE_EXISTS')
    if (nameSnap.exists && nameSnap.data().uid !== uid) {
      const previousOwner = await transaction.get(db.collection('users').doc(nameSnap.data().uid))
      if (previousOwner.exists) throw new HttpsError('already-exists', 'MEMBER_NAME_TAKEN')
    }

    // 若舊帳號已由管理員移除，可安全接管其姓名鍵。
    transaction.set(nameRef, { uid, memberName: name, createdAt: now })
    transaction.create(userRef, {
      email: String(request.auth?.token?.email || ''),
      memberName: name,
      memberNameKey: nameRef.id,
      isAdmin: false,
      createdAt: now,
      lastLoginAt: now,
    })
    // 同步公開名單，讓新成員立即可被代訂。
    transaction.set(memberRosterRef(uid), { uid, name })
    transaction.update(codeRef, { used: true, usedBy: uid, usedAt: now })

    return { ok: true, memberName: name }
  })
})
const validateCleanupRange = (data = {}) => {
  const from = Number(data.from)
  const to = Number(data.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new HttpsError('invalid-argument', '日期時間區間不正確')
  }
  if (to - from > 31 * 24 * 60 * 60 * 1000) {
    throw new HttpsError('invalid-argument', '單次清理區間不可超過 31 天')
  }
  return { from, to }
}

const queryCleanupDocuments = async (from, to, transaction = null) => {
  const read = ref => transaction ? transaction.get(ref) : ref.get()
  const timestampFrom = admin.firestore.Timestamp.fromMillis(from)
  const timestampTo = admin.firestore.Timestamp.fromMillis(to)
  const [orders, cashPaymentsInRange, cashLogsInRange, walletLogsInRange, walletRequests] = await Promise.all([
    read(db.collection('orders').where('timestamp', '>=', from).where('timestamp', '<=', to)),
    read(db.collection('cash_payments').where('createdTimestamp', '>=', from).where('createdTimestamp', '<=', to)),
    read(db.collection('cash_payment_logs').where('timestamp', '>=', from).where('timestamp', '<=', to)),
    read(db.collection('wallet_logs').where('timestamp', '>=', from).where('timestamp', '<=', to)),
    read(db.collection('wallet_requests').where('createdAt', '>=', timestampFrom).where('createdAt', '<=', timestampTo)),
  ])

  const orderIds = orders.docs.map(doc => doc.id)
  const cashPaymentMap = new Map(cashPaymentsInRange.docs.map(doc => [doc.ref.path, doc]))
  const linkedCashPaymentIds = [...new Set(orders.docs
    .map(doc => String(doc.data().cashPaymentId || '').trim())
    .filter(Boolean))]
  for (let index = 0; index < linkedCashPaymentIds.length; index += 100) {
    const refs = linkedCashPaymentIds.slice(index, index + 100).map(id => db.collection('cash_payments').doc(id))
    const snaps = transaction ? await getAllInTransaction(transaction, refs) : await db.getAll(...refs)
    snaps.filter(doc => doc.exists).forEach(doc => cashPaymentMap.set(doc.ref.path, doc))
  }

  const cashLogMap = new Map(cashLogsInRange.docs.map(doc => [doc.ref.path, doc]))
  const paymentIds = [...new Set([...cashPaymentMap.values()].map(doc => doc.id))]
  for (let index = 0; index < paymentIds.length; index += 30) {
    const chunk = paymentIds.slice(index, index + 30)
    const relatedLogs = await read(db.collection('cash_payment_logs').where('cashPaymentId', 'in', chunk))
    relatedLogs.docs.forEach(doc => cashLogMap.set(doc.ref.path, doc))
  }

  const walletLogMap = new Map(walletLogsInRange.docs.map(doc => [doc.ref.path, doc]))
  for (let index = 0; index < orderIds.length; index += 30) {
    const chunk = orderIds.slice(index, index + 30)
    const [groupedLogs, singleLogs] = await Promise.all([
      read(db.collection('wallet_logs').where('orderIds', 'array-contains-any', chunk)),
      read(db.collection('wallet_logs').where('orderId', 'in', chunk)),
    ])
    groupedLogs.docs.forEach(doc => walletLogMap.set(doc.ref.path, doc))
    singleLogs.docs.forEach(doc => walletLogMap.set(doc.ref.path, doc))
  }

  const walletAdjustments = new Map()
  walletLogMap.forEach(doc => {
    const log = doc.data()
    const walletId = String(log.walletId || log.ownerUid || '').trim()
    if (!walletId) return
    const current = walletAdjustments.get(walletId) || {
      walletId,
      ownerName: String(log.ownerName || '').trim(),
      removedNetAmount: 0,
      logCount: 0,
    }
    current.removedNetAmount = roundMoney(current.removedNetAmount + (Number(log.amount) || 0))
    current.logCount += 1
    walletAdjustments.set(walletId, current)
  })

  const documents = [
    ...orders.docs,
    ...cashPaymentMap.values(),
    ...cashLogMap.values(),
    ...walletLogMap.values(),
    ...walletRequests.docs,
  ]

  return {
    documents,
    walletAdjustments: [...walletAdjustments.values()],
    counts: {
      orders: orders.size,
      cashPayments: cashPaymentMap.size,
      cashLogs: cashLogMap.size,
      walletLogs: walletLogMap.size,
      walletRequests: walletRequests.size,
    },
  }
}

const cleanupPreview = (cleanup) => {
  const walletUpdateCount = cleanup.walletAdjustments.length
  const writeCount = cleanup.documents.length + walletUpdateCount
  return {
    counts: cleanup.counts,
    walletAdjustments: cleanup.walletAdjustments.map(item => ({
      ...item,
      balanceCorrection: roundMoney(-item.removedNetAmount),
    })),
    documentCount: cleanup.documents.length,
    writeCount,
    canDelete: writeCount <= MAX_CLEANUP_WRITES,
    maxWrites: MAX_CLEANUP_WRITES,
  }
}

// 清理後的錢包「更新時間」應代表仍保留的最後一筆流水，而不是資料清理的執行時間。
// 舊資料偶爾只有 createdAt，因此 timestamp 缺失時以它作為相容的備援。
const walletLogTimestampMs = (log = {}) => {
  const timestamp = Number(log.timestamp)
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp
  const createdAt = log.createdAt
  const createdAtMs = typeof createdAt?.toMillis === 'function'
    ? createdAt.toMillis()
    : Number(createdAt)
  return Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : null
}

const proxyOrderNote = (ownerName, actorName) => {
  const owner = String(ownerName || '').trim()
  const actor = String(actorName || '').trim()
  if (!owner || !actor || owner === actor) return ''
  return `由 ${actor} 代點`
}

const orderDebitWalletReason = (storeName, ownerName, actorName) => {
  const parts = ['點餐扣款', storeName || '未指定店家']
  const proxyNote = proxyOrderNote(ownerName, actorName)
  if (proxyNote) parts.push(proxyNote)
  return parts.join('｜')
}

const cashReceivableReason = (storeName, ownerName, actorName, label = '點餐應收款') => {
  const parts = [label, storeName || '未指定店家']
  const proxyNote = proxyOrderNote(ownerName, actorName)
  if (proxyNote) parts.push(proxyNote)
  return parts.join('｜')
}

const groupOrdersByStore = (orders) => orders.reduce((groups, order) => {
  const storeName = String(order.data?.storeName || '').trim() || '未指定店家'
  if (!groups.has(storeName)) groups.set(storeName, [])
  groups.get(storeName).push(order)
  return groups
}, new Map())

const orderItemSnapshot = (order) => ({
  meal: String(order.data?.meal ?? order.meal ?? '').trim(),
  price: roundMoney(order.data?.price ?? order.price),
  note: String(order.data?.note ?? order.note ?? '').trim(),
  storeName: String(order.data?.storeName ?? order.storeName ?? '').trim(),
})

const orderStoreName = (order) => String(order.storeName || order.data?.storeName || '').trim()

const freeOrderWalletReason = (prefix, order) => {
  const storeName = orderStoreName(order) || '未指定店家'
  const mealName = String(order.meal || '').trim() || '未指定品項'
  return `${prefix}｜${storeName}｜${mealName}`
}

const getUserProfile = async (uid) => {
  if (!uid) return { isAdmin: false, memberName: '', isRegistered: false }
  const snap = await db.collection('users').doc(uid).get()
  return snap.exists
    ? { ...snap.data(), isRegistered: true }
    : { isAdmin: false, memberName: '', isRegistered: false }
}

const requireAuth = (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', '請先登入')
  return uid
}

const requireAdmin = async (uid) => {
  const profile = await getUserProfile(uid)
  if (!profile?.isAdmin) {
    throw new HttpsError('permission-denied', '需要管理員權限')
  }
  return profile
}

exports.deleteUserAccount = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)

  const targetUid = String(request.data?.uid || '').trim()
  if (!targetUid || targetUid.includes('/') || targetUid.length > 128) {
    throw new HttpsError('invalid-argument', 'INVALID_USER_UID')
  }
  if (targetUid === actorUid) {
    throw new HttpsError('failed-precondition', 'CANNOT_DELETE_SELF')
  }

  const userRef = db.collection('users').doc(targetUid)
  const walletRef = walletRefForUid(targetUid)
  const profile = await db.runTransaction(async transaction => {
    const userSnap = await transaction.get(userRef)
    const walletSnap = await transaction.get(walletRef)
    const currentProfile = userSnap.exists ? userSnap.data() : null
    if (walletSnap.exists && roundMoney(walletSnap.data().balance) !== 0) {
      throw new HttpsError('failed-precondition', 'WALLET_BALANCE_NOT_ZERO')
    }
    if (currentProfile?.isAdmin) {
      const adminQuery = db.collection('users').where('isAdmin', '==', true).limit(2)
      const adminSnap = await transaction.get(adminQuery)
      if (adminSnap.size <= 1) {
        throw new HttpsError('failed-precondition', 'CANNOT_DELETE_LAST_ADMIN')
      }
    }
    if (userSnap.exists) {
      transaction.update(userRef, {
        isAdmin: false,
        accountDeletionPending: true,
        accountDeletionRequestedAt: FieldValue.serverTimestamp(),
      })
    }
    return currentProfile
  })

  try {
    await admin.auth().deleteUser(targetUid)
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      if (profile) {
        await userRef.set({
          isAdmin: Boolean(profile.isAdmin),
          accountDeletionPending: FieldValue.delete(),
          accountDeletionRequestedAt: FieldValue.delete(),
        }, { merge: true })
      }
      throw new HttpsError('internal', 'AUTH_USER_DELETE_FAILED')
    }
  }

  const memberName = normalizeMemberName(profile?.memberName)
  const [usedCodes, memberCodes] = await Promise.all([
    db.collection('inviteCodes').where('usedBy', '==', targetUid).get(),
    memberName
      ? db.collection('inviteCodes').where('memberName', '==', memberName).get()
      : Promise.resolve({ docs: [] }),
  ])

  const writer = db.bulkWriter()
  writer.delete(userRef)
  writer.delete(memberRosterRef(targetUid))
  if (profile?.memberNameKey) {
    writer.delete(db.collection('member_name_keys').doc(String(profile.memberNameKey)))
  } else if (memberName) {
    writer.delete(db.collection('member_name_keys').doc(memberNameKey(memberName)))
  }
  const inviteRefs = new Map([...usedCodes.docs, ...memberCodes.docs].map(snap => [snap.ref.path, snap.ref]))
  inviteRefs.forEach(ref => writer.delete(ref))
  await writer.close()

  return { ok: true }
})

exports.setUserAdminStatus = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)
  const targetUid = String(request.data?.uid || '').trim()
  const isAdmin = Boolean(request.data?.isAdmin)
  if (!targetUid || targetUid.includes('/') || targetUid.length > 128) {
    throw new HttpsError('invalid-argument', 'INVALID_USER_UID')
  }
  if (!isAdmin && targetUid === actorUid) {
    throw new HttpsError('failed-precondition', 'CANNOT_DEMOTE_SELF')
  }

  await db.runTransaction(async transaction => {
    const userRef = db.collection('users').doc(targetUid)
    const userSnap = await transaction.get(userRef)
    if (!userSnap.exists) throw new HttpsError('not-found', 'USER_NOT_FOUND')
    const currentIsAdmin = Boolean(userSnap.data().isAdmin)
    if (currentIsAdmin === isAdmin) return
    if (currentIsAdmin && !isAdmin) {
      const adminSnap = await transaction.get(db.collection('users').where('isAdmin', '==', true).limit(2))
      if (adminSnap.size <= 1) {
        throw new HttpsError('failed-precondition', 'CANNOT_DELETE_LAST_ADMIN')
      }
    }
    transaction.update(userRef, { isAdmin })
  })

  return { ok: true }
})

// 依現有 users 重建代訂公開名單：一次性回填既有成員，並清掉已不存在的殘留。
// 平時新增／刪除成員已即時同步，此函式用於首次部署回填或修復。
exports.rebuildMemberRoster = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)

  const [usersSnap, rosterSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('member_roster').get(),
  ])

  const desired = new Map()
  usersSnap.docs.forEach(doc => {
    const name = normalizeMemberName(doc.data().memberName)
    if (name) desired.set(doc.id, name)
  })

  const writer = db.bulkWriter()
  desired.forEach((name, uid) => writer.set(memberRosterRef(uid), { uid, name }))
  rosterSnap.docs.forEach(doc => {
    if (!desired.has(doc.id)) writer.delete(doc.ref)
  })
  await writer.close()

  return { ok: true, count: desired.size }
})

const getVerifiedMember = async (uid, transaction = null) => {
  const id = walletIdForUid(uid)
  if (!id) throw new HttpsError('invalid-argument', 'INVALID_OWNER_UID')
  const ref = db.collection('users').doc(id)
  const snap = transaction ? await transaction.get(ref) : await ref.get()
  const memberName = snap.exists ? String(snap.data().memberName || '').trim() : ''
  if (!memberName || snap.data().accountDeletionPending) throw new HttpsError('failed-precondition', 'OWNER_NOT_FOUND')
  return { uid: id, memberName }
}

const writeWalletLog = (transaction, {
  walletId,
  ownerName,
  ownerUid = '',
  type,
  amount,
  beforeBalance,
  afterBalance,
  operatorName,
  operatorUid,
  reason,
  orderId = '',
  orderIds = [],
  storeName = '',
  items = [],
  itemCount = 0,
  editGroupId = '',
  editDelta = null,
}) => {
  transaction.set(walletLogRef(), {
    walletId,
    ownerName,
    ownerUid,
    type,
    amount: roundMoney(amount),
    beforeBalance: roundMoney(beforeBalance),
    afterBalance: roundMoney(afterBalance),
    operatorName: operatorName || '',
    operatorUid: operatorUid || '',
    reason: reason || '',
    orderId,
    orderIds,
    storeName,
    items,
    itemCount,
    timestamp: Date.now(),
    createdAt: FieldValue.serverTimestamp(),
    // 同一次訂單編輯產生的退款/扣款配對共用 editGroupId，前端據此合併顯示。
    ...(editGroupId ? { editGroupId, editDelta: roundMoney(editDelta) } : {}),
  })
}

const writeCashPaymentLog = (transaction, {
  cashPaymentId,
  ownerName,
  ownerUid = '',
  type,
  amount,
  beforeStatus = '',
  afterStatus = '',
  operatorName,
  operatorUid,
  reason,
  orderIds = [],
  storeName = '',
  items = [],
}) => {
  transaction.set(cashPaymentLogRef(), {
    cashPaymentId,
    ownerName,
    ownerUid,
    type,
    amount: roundMoney(amount),
    beforeStatus,
    afterStatus,
    operatorName: operatorName || '',
    operatorUid: operatorUid || '',
    reason: reason || '',
    orderIds,
    storeName,
    items,
    timestamp: Date.now(),
    createdAt: FieldValue.serverTimestamp(),
  })
}

const getWalletLedgerForOrders = async (transaction, orderIds) => {
  const logs = new Map()
  for (let index = 0; index < orderIds.length; index += 30) {
    const chunk = orderIds.slice(index, index + 30)
    const [grouped, single] = await Promise.all([
      transaction.get(db.collection('wallet_logs').where('orderIds', 'array-contains-any', chunk)),
      transaction.get(db.collection('wallet_logs').where('orderId', 'in', chunk)),
    ])
    grouped.docs.forEach(doc => logs.set(doc.id, doc.data()))
    single.docs.forEach(doc => logs.set(doc.id, doc.data()))
  }

  const debits = new Map()
  const refundedOrderIds = new Set()
  const outstandingAmounts = new Map()
  const originalOperators = new Map()
  const debitTypes = new Set(['order_debit', 'order_edit_debit', 'free_debit'])
  const refundTypes = new Set(['cancel_refund', 'free_refund', 'order_edit_refund'])
  logs.forEach(log => {
    const ids = Array.isArray(log.orderIds) && log.orderIds.length
      ? log.orderIds.map(String)
      : [String(log.orderId || '')].filter(Boolean)
    if (log.type === 'order_debit' || log.type === 'free_order') {
      ids.forEach(id => originalOperators.set(id, String(log.operatorUid || '').trim()))
    }
    if (!debitTypes.has(log.type) && !refundTypes.has(log.type)) return

    const items = Array.isArray(log.items) ? log.items : []
    ids.forEach((id, itemIndex) => {
      const timestamp = Number(log.timestamp) || 0
      const item = items[itemIndex] || {}
      const amount = finiteMoney(item.price, { min: 1, max: MAX_PRICE, code: 'INVALID_ORDER_AMOUNT' })
      outstandingAmounts.set(id, (outstandingAmounts.get(id) || 0) + (debitTypes.has(log.type) ? amount : -amount))
      if (!debitTypes.has(log.type)) return
      const previous = debits.get(id)
      if (previous && timestamp < previous.timestamp) return
      debits.set(id, {
        ownerUid: String(log.ownerUid || log.walletId || '').trim(),
        ownerName: String(log.ownerName || '').trim(),
        orderedByUid: String(log.operatorUid || '').trim(),
        amount,
        storeName: String(item.storeName || log.storeName || '').trim(),
        meal: String(item.meal || '').trim(),
        note: String(item.note || '').trim(),
        timestamp,
      })
    })
  })

  // 用實際扣退款淨額判斷，免費後重新扣款不再被舊退款永久標記；亦不依賴流水回傳順序。
  debits.forEach((debit, id) => {
    const outstanding = roundMoney(outstandingAmounts.get(id))
    if (outstanding <= 0) refundedOrderIds.add(id)
    else debit.amount = outstanding
    if (originalOperators.has(id)) debit.orderedByUid = originalOperators.get(id)
  })

  return { debits, refundedOrderIds }
}
const getCashFreeAdjustedOrderIds = async (transaction, orderIds) => {
  const adjustmentTotals = new Map()
  for (let index = 0; index < orderIds.length; index += 30) {
    const chunk = orderIds.slice(index, index + 30)
    const logs = await transaction.get(
      db.collection('cash_payment_logs').where('orderIds', 'array-contains-any', chunk),
    )
    logs.docs.forEach(doc => {
      const log = doc.data()
      if (log.type !== 'cash_adjustment') return
      // 改價流水包含前後兩份快照；不可把降價誤認為免費減免。
      if (!Array.isArray(log.items) || log.items.length !== 1) return
      const ids = Array.isArray(log.orderIds) ? log.orderIds.map(String) : []
      if (ids.length !== 1) return
      const orderId = ids[0]
      // 免費期間可能改價，恢復收費的金額未必等於原減免金額。
      adjustmentTotals.set(orderId, (adjustmentTotals.get(orderId) || 0) + Math.sign(Number(log.amount) || 0))
    })
  }
  return new Set([...adjustmentTotals.entries()]
    .filter(([, total]) => total < 0)
    .map(([orderId]) => orderId))
}
const normalizeOrderItems = (items, fallbackName, selectedStoreName) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', '購物車是空的')
  }
  if (items.length > MAX_ORDER_ITEMS) {
    throw new HttpsError('invalid-argument', 'TOO_MANY_ORDER_ITEMS')
  }

  return items.map((item) => {
    const ownerName = String(item?.ownerName || item?.who || '').trim() || String(fallbackName || '').trim()
    const ownerUid = String(item?.ownerUid || '').trim()
    const paymentMethod = String(item?.paymentMethod || 'wallet').trim() || 'wallet'
    const meal = String(item?.name || '').trim()
    const amount = finiteMoney(item?.price, { min: 1, max: MAX_PRICE, code: 'INVALID_ORDER_AMOUNT' })
    const storeName = String(item?.storeName || selectedStoreName || '').trim()
    const note = String(item?.note || '').trim()

    if (!['wallet', 'cash'].includes(paymentMethod)) {
      throw new HttpsError('invalid-argument', 'INVALID_PAYMENT_METHOD')
    }
    if (!ownerName || !meal || amount <= 0 || (paymentMethod === 'wallet' && !ownerUid)) {
      throw new HttpsError('invalid-argument', '訂單資料不完整')
    }
    if (
      ownerName.length > MAX_NAME_LENGTH ||
      meal.length > MAX_MEAL_LENGTH ||
      storeName.length > MAX_STORE_NAME_LENGTH ||
      note.length > MAX_NOTE_LENGTH
    ) {
      throw new HttpsError('invalid-argument', 'ORDER_TEXT_TOO_LONG')
    }

    return { ownerName, ownerUid, paymentMethod, meal, amount, storeName, note }
  })
}

const verifyOrderOwners = async (items, transaction) => {
  const ownerUids = [...new Set(items.map(item => item.ownerUid).filter(Boolean))]
  const verifiedOwners = new Map()
  for (const uid of ownerUids) {
    const member = await getVerifiedMember(uid, transaction)
    verifiedOwners.set(uid, member)
  }

  return items.map(item => {
    if (!item.ownerUid) return item
    const member = verifiedOwners.get(item.ownerUid)
    return { ...item, ownerName: member.memberName }
  })
}

exports.createOrdersWithWalletDebit = onCall(async (request) => {
  const actorUid = requireAuth(request)

  const {
    items,
    fallbackName,
    actorName,
    selectedStoreName,
    requestId,
  } = request.data || {}

  const idempotencyKey = String(requestId || '').trim()
  if (!idempotencyKey || idempotencyKey.includes('/') || idempotencyKey.length > 500) {
    throw new HttpsError('invalid-argument', 'INVALID_REQUEST_ID')
  }

  const profile = await getUserProfile(actorUid)
  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  if (!profile.isRegistered) throw new HttpsError('permission-denied', '需要已註冊使用者權限')
  // 代訂已對全體成員開放：任何登入者皆可為他人建立訂單（含直接扣對方錢包）。
  // verifyOrderOwners 已逐筆驗證 ownerUid 對應真實成員並校正姓名，避免代訂到不存在的錢包。
  const requestRef = db.collection('wallet_requests').doc(`${actorUid}_${idempotencyKey}`)
  const now = Date.now()

  try {
    return await db.runTransaction(async (transaction) => {
      const requestSnap = await transaction.get(requestRef)
      if (requestSnap.exists) {
        return {
          ok: true,
          orderIds: requestSnap.data().orderIds || [],
          duplicate: true,
        }
      }

      // 已成功的請求先回傳原結果；新請求才驗證對象，並納入交易以避免帳號刪除競爭。
      const normalizedItems = await verifyOrderOwners(normalizeOrderItems(items, fallbackName, selectedStoreName), transaction)

      // 免費店家以後端交易當下的今日設定為準，不信任前端傳來的狀態。
      const dailySnap = await transaction.get(db.collection('settings').doc('daily'))
      const daily = dailySnap.exists ? dailySnap.data() : null
      const todayKey = taipeiDateKey()
      const dailyIsToday = Boolean(daily)
        && (String(daily.serviceDate || '').trim() === todayKey || String(daily.date || '').trim() === todayKey)
      const activeStoreSet = new Set(dailyIsToday && Array.isArray(daily.activeStores)
        ? daily.activeStores.map(name => String(name || '').trim()).filter(Boolean)
        : [])
      const freeStoreSet = new Set(dailyIsToday && Array.isArray(daily.freeStores)
        ? daily.freeStores.map(name => String(name || '').trim()).filter(name => activeStoreSet.has(name))
        : [])
      const isFreeStoreToday = (storeName) => freeStoreSet.has(String(storeName || '').trim())
      const dining = await readDining(transaction)
      if (normalizedItems.some(item => dining.data.replacements[item.storeName])) {
        throw new HttpsError('failed-precondition', '店家已更換，請重新選擇餐點')
      }
      const needId = String(request.data?.reorderNeedId || '')
      const need = needId ? dining.data.needs[needId] : null
      if (needId && (!need || need.status !== 'pending' || normalizedItems.some(item =>
        dinerKey(item.ownerUid, item.ownerName) !== need.personKey || item.storeName !== need.targetStore))) {
        throw new HttpsError('failed-precondition', '補點狀態已更新，請重新整理名單')
      }
      if (need && !activeStoreSet.has(need.targetStore)) throw new HttpsError('failed-precondition', '補點店家尚未開放')

      const cashGroups = new Map()
      normalizedItems.forEach((item) => {
        if (item.paymentMethod !== 'cash' || isFreeStoreToday(item.storeName)) return
        const key = item.ownerName
        if (!cashGroups.has(key)) {
          const ref = cashPaymentRef()
          cashGroups.set(key, {
            ref,
            id: ref.id,
            ownerName: item.ownerName,
            ownerUid: item.ownerUid || '',
            items: [],
          })
        }
        cashGroups.get(key).items.push(item)
      })

      const preparedOrders = normalizedItems.map((item, index) => {
        const orderRef = db.collection('orders').doc()
        const proxyNote = proxyOrderNote(item.ownerName, operatorName)
        const isWalletPayment = item.paymentMethod === 'wallet'
        const freeToday = isFreeStoreToday(item.storeName)
        const cashGroup = isWalletPayment || freeToday ? null : cashGroups.get(item.ownerName)
        return {
          ref: orderRef,
          ownerName: item.ownerName,
          ownerUid: item.ownerUid,
          paymentMethod: item.paymentMethod,
          isFreeToday: freeToday,
          cashPaymentId: cashGroup?.id || '',
          amount: item.amount,
          data: {
            storeName: item.storeName,
            name: item.ownerName,
            uid: isWalletPayment ? item.ownerUid : actorUid,
            ownerName: item.ownerName,
            ownerUid: item.ownerUid,
            orderedByName: operatorName,
            orderedByUid: actorUid,
            isProxyOrder: Boolean(proxyNote),
            proxyOrderedByName: proxyNote ? operatorName : '',
            meal: item.meal,
            price: item.amount,
            note: item.note,
            paid: freeToday ? true : isWalletPayment,
            paymentMethod: item.paymentMethod,
            paidByWallet: freeToday ? false : isWalletPayment,
            paidAt: !freeToday && isWalletPayment ? FieldValue.serverTimestamp() : null,
            isFree: freeToday,
            freeSource: freeToday ? 'daily_store_setting' : '',
            freeAppliedAt: freeToday ? FieldValue.serverTimestamp() : null,
            freeStoreName: freeToday ? item.storeName : '',
            originalPrice: item.amount,
            walletDebited: freeToday ? false : isWalletPayment,
            walletOwnerUid: isWalletPayment ? item.ownerUid : '',
            walletOwnerName: isWalletPayment ? item.ownerName : '',
            walletAmount: !freeToday && isWalletPayment ? item.amount : 0,
            walletRefunded: false,
            cashPaymentId: cashGroup?.id || '',
            cashStatus: isWalletPayment || freeToday ? '' : 'pending',
            cashCollectedAt: null,
            cashCollectedByUid: '',
            cashCollectedByName: '',
            timestamp: now + index,
            createdAt: FieldValue.serverTimestamp(),
          },
        }
      })

      const walletOrders = preparedOrders.filter(order => order.paymentMethod === 'wallet' && !order.isFreeToday)
      const freeWalletOrders = preparedOrders.filter(order => order.paymentMethod === 'wallet' && order.isFreeToday)
      const totalsByWallet = walletOrders.reduce((map, order) => {
        const current = map.get(order.ownerUid) || { ownerUid: order.ownerUid, ownerName: order.ownerName, total: 0 }
        current.total = roundMoney(current.total + order.amount)
        map.set(order.ownerUid, current)
        return map
      }, new Map())

      // 免費單不扣款也不驗餘額，但仍讀取餘額供 0 元流水記錄 before/after。
      const walletOwners = new Map()
      totalsByWallet.forEach(({ ownerUid, ownerName }) => walletOwners.set(ownerUid, { ownerUid, ownerName }))
      freeWalletOrders.forEach(({ ownerUid, ownerName }) => {
        if (!walletOwners.has(ownerUid)) walletOwners.set(ownerUid, { ownerUid, ownerName })
      })

      const walletMap = new Map()
      const walletEntries = [...walletOwners.values()]
      const walletRefs = walletEntries.map(({ ownerUid }) => walletRefForUid(ownerUid))
      const walletSnaps = await getAllInTransaction(transaction, walletRefs)
      walletEntries.forEach(({ ownerUid, ownerName }, index) => {
        walletMap.set(ownerUid, {
          ref: walletRefs[index],
          ownerName,
          balance: roundMoney(walletSnaps[index].exists ? walletSnaps[index].data().balance : 0),
        })
      })

      for (const { ownerUid, total } of totalsByWallet.values()) {
        const wallet = walletMap.get(ownerUid)
        if (wallet.balance < total) {
          throw new HttpsError('failed-precondition', 'INSUFFICIENT_WALLET_BALANCE')
        }
      }

      for (const { ownerUid, ownerName, total } of totalsByWallet.values()) {
        const wallet = walletMap.get(ownerUid)
        const relatedOrders = walletOrders.filter(order => order.ownerUid === ownerUid)
        const afterBalance = roundMoney(wallet.balance - total)
        const walletId = walletIdForUid(ownerUid)

        transaction.set(wallet.ref, {
          ownerUid,
          ownerName,
          balance: afterBalance,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: operatorName,
          updatedByUid: actorUid,
          lastTransactionType: 'order_debit',
        }, { merge: true })

        let runningBalance = wallet.balance
        for (const [storeName, storeOrders] of groupOrdersByStore(relatedOrders).entries()) {
          const storeTotal = roundMoney(storeOrders.reduce((sum, order) => sum + order.amount, 0))
          const nextBalance = roundMoney(runningBalance - storeTotal)
          writeWalletLog(transaction, {
            walletId,
            ownerUid,
            ownerName,
            type: 'order_debit',
            amount: -storeTotal,
            beforeBalance: runningBalance,
            afterBalance: nextBalance,
            operatorName,
            operatorUid: actorUid,
            reason: orderDebitWalletReason(storeName, ownerName, operatorName),
            orderId: storeOrders.length === 1 ? storeOrders[0].ref.id : '',
            orderIds: storeOrders.map(order => order.ref.id),
            storeName,
            items: storeOrders.map(orderItemSnapshot),
            itemCount: storeOrders.length,
          })
          runningBalance = nextBalance
        }
      }

      // 免費店家的錢包單：不扣款，但寫一筆 0 元流水讓對帳看得到「有下單、因免費未扣款」。
      for (const { ownerUid, ownerName } of walletOwners.values()) {
        const relatedOrders = freeWalletOrders.filter(order => order.ownerUid === ownerUid)
        if (!relatedOrders.length) continue
        const wallet = walletMap.get(ownerUid)
        const debitTotal = totalsByWallet.get(ownerUid)?.total || 0
        const balance = roundMoney(wallet.balance - debitTotal)
        const walletId = walletIdForUid(ownerUid)
        for (const [storeName, storeOrders] of groupOrdersByStore(relatedOrders).entries()) {
          writeWalletLog(transaction, {
            walletId,
            ownerUid,
            ownerName,
            type: 'free_order',
            amount: 0,
            beforeBalance: balance,
            afterBalance: balance,
            operatorName,
            operatorUid: actorUid,
            reason: `今日店家免費｜${storeName}`,
            orderId: storeOrders.length === 1 ? storeOrders[0].ref.id : '',
            orderIds: storeOrders.map(order => order.ref.id),
            storeName,
            items: storeOrders.map(orderItemSnapshot),
            itemCount: storeOrders.length,
          })
        }
      }

      preparedOrders.forEach(order => {
        transaction.set(order.ref, {
          ...order.data,
          walletId: order.paymentMethod === 'wallet' ? walletIdForUid(order.ownerUid) : '',
        })
      })

      normalizedItems.forEach(item => {
        dining.data.participants[dinerKey(item.ownerUid, item.ownerName)] = { name: item.ownerName, uid: item.ownerUid }
      })
      Object.values(dining.data.needs).filter(n => ['pending', 'completed'].includes(n.status)).forEach(n => {
        const matching = preparedOrders.filter(order =>
          dinerKey(order.ownerUid, order.ownerName) === n.personKey && order.data.storeName === n.targetStore)
        if (matching.length) Object.assign(n, { status: 'completed', orderIds: [...new Set([...(n.orderIds || []), ...matching.map(order => order.ref.id)])], resolvedBy: actorUid, resolvedAt: now })
      })
      transaction.set(dining.ref, dining.data)

      for (const cashGroup of cashGroups.values()) {
        const relatedOrders = preparedOrders.filter(order => order.cashPaymentId === cashGroup.id)
        const amount = roundMoney(relatedOrders.reduce((sum, order) => sum + order.amount, 0))
        const storeNames = [...new Set(relatedOrders.map(order => order.data.storeName).filter(Boolean))]
        const items = relatedOrders.map(order => ({
          orderId: order.ref.id,
          storeName: order.data.storeName,
          meal: order.data.meal,
          price: order.data.price,
          note: order.data.note,
        }))
        const orderIds = relatedOrders.map(order => order.ref.id)
        transaction.set(cashGroup.ref, {
          cashPaymentId: cashGroup.id,
          ownerName: cashGroup.ownerName,
          ownerUid: cashGroup.ownerUid,
          payerType: cashGroup.ownerUid ? 'member_without_wallet' : 'manual',
          amount,
          collectedAmount: 0,
          remainingAmount: amount,
          status: 'pending',
          paymentMethod: 'cash',
          orderIds,
          storeNames,
          items,
          orderedByUid: actorUid,
          orderedByName: operatorName,
          collectedByUid: '',
          collectedByName: '',
          collectedAt: null,
          cancelledByUid: '',
          cancelledByName: '',
          cancelledAt: null,
          cancelReason: '',
          createdAt: FieldValue.serverTimestamp(),
          createdTimestamp: now,
          updatedAt: FieldValue.serverTimestamp(),
          updatedTimestamp: now,
        })
        writeCashPaymentLog(transaction, {
          cashPaymentId: cashGroup.id,
          ownerName: cashGroup.ownerName,
          ownerUid: cashGroup.ownerUid,
          type: 'cash_order_created',
          amount,
          beforeStatus: '',
          afterStatus: 'pending',
          operatorName,
          operatorUid: actorUid,
          reason: cashReceivableReason(storeNames.join('、'), cashGroup.ownerName, operatorName),
          orderIds,
          storeName: storeNames.join('、'),
          items,
        })
      }

      const orderIds = preparedOrders.map(order => order.ref.id)
      transaction.set(requestRef, {
        actorUid,
        actorName: operatorName,
        orderIds,
        createdAt: FieldValue.serverTimestamp(),
      })

      return { ok: true, orderIds, duplicate: false }
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', error?.message || '送出失敗')
  }
})

exports.cancelOrdersWithWalletRefund = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const {
    orderIds,
    actorName,
    reason = '取消訂單退款',
  } = request.data || {}

  let ids = [...new Set((Array.isArray(orderIds) ? orderIds : [])
    .map(id => String(id).trim())
    .filter(id => id && !id.includes('/') && id.length <= 1500))]
  const settings = request.data?.dailyStoreSettings
  const replacements = request.data?.storeReplacements ?? (request.data?.storeReplacement ? [request.data.storeReplacement] : [])
  if (!Array.isArray(replacements) || replacements.length > 100) throw new HttpsError('invalid-argument', '換店設定格式錯誤')
  const replacementMap = new Map()
  for (const entry of replacements) {
    const source = String(entry?.source || '').trim()
    const target = String(entry?.target || '').trim()
    if (!source || !target || source === target || source.length > MAX_STORE_NAME_LENGTH || target.length > MAX_STORE_NAME_LENGTH || replacementMap.has(source)) throw new HttpsError('invalid-argument', '請選擇不同的新店家')
    replacementMap.set(source, target)
  }
  const changingStores = replacementMap.size > 0 || Boolean(settings)
  if (!ids.length && !changingStores) throw new HttpsError('invalid-argument', '缺少訂單')
  if (ids.length > MAX_CANCEL_ITEMS) throw new HttpsError('invalid-argument', 'TOO_MANY_ORDERS')
  if (changingStores && ids.length) throw new HttpsError('invalid-argument', '換店不可指定個別訂單')
  const storeList = value => {
    if (!Array.isArray(value) || value.length > 100 || value.some(name => typeof name !== 'string' || !name.trim() || name.length > MAX_STORE_NAME_LENGTH)) throw new HttpsError('invalid-argument', '店家設定格式錯誤')
    return [...new Set(value.map(name => name.trim()))]
  }
  const desiredStores = settings ? storeList(settings.activeStores) : null
  const desiredFree = settings ? storeList(settings.freeStores) : null
  const expectedStores = settings ? storeList(settings.expectedActiveStores) : null
  const expectedFree = settings ? storeList(settings.expectedFreeStores) : null
  if (settings && desiredFree.some(name => !desiredStores.includes(name))) throw new HttpsError('invalid-argument', '免費店家必須是今日店家')

  const profile = await getUserProfile(actorUid)
  const isAdmin = Boolean(profile?.isAdmin)
  if (!profile?.isRegistered) throw new HttpsError('permission-denied', '需要已註冊使用者權限')
  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()

  try {
    await db.runTransaction(async (transaction) => {
      const dining = await readDining(transaction)
      let dailyRef, daily, nextStores, nextFree
      if (changingStores) {
        const todayKey = taipeiDateKey()
        dailyRef = db.collection('settings').doc('daily')
        const dailySnap = await transaction.get(dailyRef)
        daily = dailySnap.exists ? dailySnap.data() : {}
        const dailyIsToday = [daily.serviceDate, daily.date].includes(todayKey)
        const currentStores = dailyIsToday ? (daily.activeStores || []) : []
        const currentFree = dailyIsToday ? (daily.freeStores || []).filter(name => currentStores.includes(name)) : []
        if (settings) {
          const sameSet = (a, b) => a.length === b.length && a.every(name => b.includes(name))
          if (settings.serviceDate !== todayKey || !sameSet(currentStores, expectedStores) || !sameSet(currentFree, expectedFree)) throw new HttpsError('failed-precondition', '今日店家已更新，請重新開啟設定後再試')
          nextStores = desiredStores
          nextFree = desiredFree
        } else {
          if (!dailyIsToday) throw new HttpsError('failed-precondition', '今日店家尚未設定')
          nextStores = [...new Set([...currentStores.filter(name => !replacementMap.has(name)), ...replacementMap.values()])]
          nextFree = currentFree.filter(name => nextStores.includes(name))
        }
        if (nextStores.some(name => dining.data.replacements[name])) throw new HttpsError('failed-precondition', '不可選擇今日已停用店家')
        for (const [source, target] of replacementMap) {
          if (dining.data.replacements[source]) throw new HttpsError('failed-precondition', '此店家已更換，請重新整理')
          if (!currentStores.includes(source) || nextStores.includes(source) || !nextStores.includes(target) || replacementMap.has(target)) throw new HttpsError('invalid-argument', '換店與今日店家設定不一致')
        }
        for (const name of nextStores.filter(name => !currentStores.includes(name))) {
          const menu = await transaction.get(db.collection('menu_images').where('storeName', '==', name))
          if (menu.empty) throw new HttpsError('not-found', '新店家不存在')
        }
        const start = new Date(`${todayKey}T00:00:00+08:00`).getTime()
        const today = await transaction.get(db.collection('orders').where('timestamp', '>=', start).where('timestamp', '<', start + 86400000))
        const protectedStores = new Set([
          ...today.docs.map(doc => doc.data().storeName),
          ...Object.values(dining.data.needs).filter(need => need.status === 'pending').map(need => need.targetStore),
        ])
        if (currentStores.some(name => !nextStores.includes(name) && protectedStores.has(name) && !replacementMap.has(name))) throw new HttpsError('failed-precondition', '移除的店家已有訂單或待補點人員，請重新確認接替店家')
        ids = today.docs.filter(doc => replacementMap.has(doc.data().storeName)).map(doc => doc.id)
        if (ids.length > MAX_CANCEL_ITEMS) throw new HttpsError('failed-precondition', '換店訂單超過單次上限 100 筆')
        if (!settings && [...replacementMap.keys()].some(name => !protectedStores.has(name))) throw new HttpsError('failed-precondition', '沒有需要換店的訂單或補點人員')
      }
      const orderRefs = ids.map(id => db.collection('orders').doc(id))
      const orderSnaps = await getAllInTransaction(transaction, orderRefs)

      const orders = orderSnaps
        .map((snap, index) => snap.exists ? { id: ids[index], ref: orderRefs[index], ...snap.data() } : null)
        .filter(Boolean)

      if (orders.length !== ids.length) throw new HttpsError('not-found', 'ORDER_NOT_FOUND')
      const walletLedger = await getWalletLedgerForOrders(transaction, ids)
      const cashFreeAdjustedOrderIds = await getCashFreeAdjustedOrderIds(transaction, ids)

      const referencedCashPaymentIds = [...new Set(orders
        .map(order => String(order.cashPaymentId || '').trim())
        .filter(Boolean))]
      const cashPaymentMap = new Map()
      const cashPaymentRefs = referencedCashPaymentIds.map(id => db.collection('cash_payments').doc(id))
      const cashPaymentSnaps = await getAllInTransaction(transaction, cashPaymentRefs)
      cashPaymentSnaps.forEach((paymentSnap, index) => {
        if (paymentSnap.exists) {
          cashPaymentMap.set(referencedCashPaymentIds[index], { ref: cashPaymentRefs[index], ...paymentSnap.data() })
        }
      })

      if (!isAdmin && !changingStores && orders.some(order => {
        const debit = walletLedger.debits.get(order.id)
        if (debit) return ![debit.ownerUid, debit.orderedByUid].includes(actorUid)
        const cashPaymentId = String(order.cashPaymentId || '').trim()
        if (!cashPaymentId) {
          // 免費店家等無金流連結的訂單：本人或代點人可取消。
          return ![order.ownerUid, order.uid, order.orderedByUid].map(String).includes(String(actorUid))
        }
        const cashPayment = cashPaymentMap.get(cashPaymentId)
        const linkedOrderIds = Array.isArray(cashPayment?.orderIds) ? cashPayment.orderIds.map(String) : []
        const isLinkedCashOrder = linkedOrderIds.includes(order.id)
        return !isLinkedCashOrder || ![cashPayment.ownerUid, cashPayment.orderedByUid].map(String).includes(actorUid)
      })) {
        throw new HttpsError('permission-denied', 'ORDER_CANCEL_NOT_ALLOWED')
      }
      if ([...cashPaymentMap.values()].some(payment => payment.status === 'collected')) {
        throw new HttpsError('failed-precondition', 'CASH_PAYMENT_ALREADY_COLLECTED')
      }

      const refundOrders = orders
        .filter(order => walletLedger.debits.has(order.id) && !walletLedger.refundedOrderIds.has(order.id))
        .map(order => {
          const debit = walletLedger.debits.get(order.id)
          // 金額一律以扣款流水為準；描述文字（店家/品項/備註）優先取訂單文件的最新內容，
          // 因為「金額沒變的編輯」不會寫流水，流水上的描述可能是舊的。
          return {
            ...order,
            walletOwnerUid: debit.ownerUid,
            walletOwnerName: debit.ownerName,
            walletAmount: debit.amount,
            storeName: String(order.storeName || debit.storeName || '').trim(),
            meal: String(order.meal ?? debit.meal ?? '').trim(),
            note: String(order.note ?? debit.note ?? '').trim(),
            price: debit.amount,
          }
        })
      const totalsByWallet = refundOrders.reduce((map, order) => {
        const ownerUid = String(order.walletOwnerUid || '').trim()
        const ownerName = String(order.walletOwnerName || '').trim()
        const amount = finiteMoney(order.walletAmount, { min: 1, max: MAX_PRICE, code: 'INVALID_ORDER_AMOUNT' })
        if (!ownerUid || !ownerName) return map
        const current = map.get(ownerUid) || { ownerUid, ownerName, total: 0 }
        current.total = roundMoney(current.total + amount)
        map.set(ownerUid, current)
        return map
      }, new Map())
      const walletMap = new Map()
      const walletEntries = [...totalsByWallet.values()]
      const walletRefs = walletEntries.map(({ ownerUid }) => walletRefForUid(ownerUid))
      const walletSnaps = await getAllInTransaction(transaction, walletRefs)
      walletEntries.forEach(({ ownerUid, ownerName }, index) => {
        walletMap.set(ownerUid, {
          ref: walletRefs[index],
          ownerName,
          balance: roundMoney(walletSnaps[index].exists ? walletSnaps[index].data().balance : 0),
        })
      })

      const cashCancelGroups = orders.reduce((map, order) => {
        const cashPaymentId = String(order.cashPaymentId || '').trim()
        const payment = cashPaymentMap.get(cashPaymentId)
        const paymentItems = Array.isArray(payment?.items) ? payment.items : []
        const trustedItem = paymentItems.find(item => String(item?.orderId || '') === order.id)
        if (!payment || !trustedItem || payment.status === 'cancelled') return map
        if (!map.has(cashPaymentId)) map.set(cashPaymentId, [])
        map.get(cashPaymentId).push({
          ...order,
          price: cashFreeAdjustedOrderIds.has(order.id)
            ? 0
            : finiteMoney(trustedItem.price, { min: 1, max: MAX_PRICE, code: 'INVALID_CASH_AMOUNT' }),
          storeName: String(trustedItem.storeName || '').trim(),
          meal: String(trustedItem.meal || '').trim(),
          note: String(trustedItem.note || '').trim(),
        })
        return map
      }, new Map())

      for (const { ownerUid, ownerName, total } of totalsByWallet.values()) {
        const wallet = walletMap.get(ownerUid)
        const afterBalance = roundMoney(wallet.balance + total)
        const relatedOrders = refundOrders.filter(order => String(order.walletOwnerUid || order.uid || '').trim() === ownerUid)
        const walletId = walletIdForUid(ownerUid)

        transaction.set(wallet.ref, {
          ownerUid,
          ownerName,
          balance: afterBalance,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: operatorName,
          updatedByUid: actorUid,
          lastTransactionType: 'cancel_refund',
        }, { merge: true })

        let runningBalance = wallet.balance
        for (const [storeName, storeOrders] of groupOrdersByStore(relatedOrders.map(order => ({ ...order, data: order }))).entries()) {
          const storeTotal = roundMoney(storeOrders.reduce((sum, order) => sum + (Number(order.walletAmount ?? order.price) || 0), 0))
          const nextBalance = roundMoney(runningBalance + storeTotal)
          writeWalletLog(transaction, {
            walletId,
            ownerUid,
            ownerName,
            type: 'cancel_refund',
            amount: storeTotal,
            beforeBalance: runningBalance,
            afterBalance: nextBalance,
            operatorName,
            operatorUid: actorUid,
            reason: `${reason}｜${storeName}`,
            orderId: storeOrders.length === 1 ? storeOrders[0].id : '',
            orderIds: storeOrders.map(order => order.id),
            storeName,
            items: storeOrders.map(orderItemSnapshot),
            itemCount: storeOrders.length,
          })
          runningBalance = nextBalance
        }
      }

      for (const [cashPaymentId, cashOrders] of cashCancelGroups.entries()) {
        const payment = cashPaymentMap.get(cashPaymentId)
        if (!payment) continue
        const cancelAmount = roundMoney(cashOrders.reduce((sum, order) => sum + (Number(order.price) || 0), 0))
        const beforeStatus = payment.status || 'pending'
        const currentRemaining = roundMoney(Number(payment.remainingAmount ?? payment.amount) || 0)
        const nextRemaining = Math.max(0, roundMoney(currentRemaining - cancelAmount))
        const nextAmount = Math.max(0, roundMoney((Number(payment.amount) || 0) - cancelAmount))
        const nextStatus = nextRemaining <= 0 && beforeStatus !== 'collected' ? 'cancelled' : beforeStatus
        const storeNames = [...new Set(cashOrders.map(order => order.storeName).filter(Boolean))]
        const cancelledOrderIds = new Set(cashOrders.map(order => String(order.id)))
        const remainingOrderIds = (Array.isArray(payment.orderIds) ? payment.orderIds : [])
          .map(String)
          .filter(orderId => !cancelledOrderIds.has(orderId))
        const remainingItems = (Array.isArray(payment.items) ? payment.items : [])
          .filter(item => !cancelledOrderIds.has(String(item?.orderId || '')))
        const remainingStoreNames = [...new Set(remainingItems.map(item => item?.storeName).filter(Boolean))]
        const items = cashOrders.map(order => ({
          orderId: order.id,
          storeName: order.storeName || '',
          meal: order.meal || '',
          price: Number(order.price) || 0,
          note: order.note || '',
        }))

        transaction.update(payment.ref, {
          amount: nextAmount,
          remainingAmount: nextRemaining,
          status: nextStatus,
          orderIds: remainingOrderIds,
          items: remainingItems,
          storeNames: remainingStoreNames,
          cancelledByUid: nextStatus === 'cancelled' ? actorUid : (payment.cancelledByUid || ''),
          cancelledByName: nextStatus === 'cancelled' ? operatorName : (payment.cancelledByName || ''),
          cancelledAt: nextStatus === 'cancelled' ? FieldValue.serverTimestamp() : (payment.cancelledAt || null),
          cancelReason: nextStatus === 'cancelled' ? reason : (payment.cancelReason || ''),
          updatedAt: FieldValue.serverTimestamp(),
          updatedTimestamp: Date.now(),
        })
        writeCashPaymentLog(transaction, {
          cashPaymentId,
          ownerName: payment.ownerName || '',
          ownerUid: payment.ownerUid || '',
          type: 'cash_cancelled',
          amount: cancelAmount,
          beforeStatus,
          afterStatus: nextStatus,
          operatorName,
          operatorUid: actorUid,
          reason,
          orderIds: cashOrders.map(order => order.id),
          storeName: storeNames.join('、'),
          items,
        })
      }

      // 保留用餐人員及原餐點；刪除有效訂單僅發生於同一筆退款交易。
      const removed = new Set(ids)
      orders.filter(order => Number.isFinite(Number(order.timestamp)) && taipeiDateKey(new Date(Number(order.timestamp))) === taipeiDateKey()).forEach(order => {
        const uid = String(order.ownerUid || order.walletOwnerUid || '')
        const name = String(order.name || order.ownerName || '')
        dining.data.participants[dinerKey(uid, name)] = { uid, name }
      })
      Object.values(dining.data.needs).forEach(need => {
        if (need.status === 'completed' && need.orderIds?.some(id => removed.has(id))) {
          need.orderIds = need.orderIds.filter(id => !removed.has(id))
          if (!need.orderIds.length) need.status = 'pending'
        }
      })
      for (const [source, target] of replacementMap) {
        const eventId = crypto.randomUUID()
        for (const order of orders.filter(order => order.storeName === source)) {
          const uid = String(order.ownerUid || order.walletOwnerUid || '')
          const name = String(order.name || order.ownerName || '')
          const personKey = dinerKey(uid, name)
          dining.data.participants[personKey] = { uid, name }
          let need = Object.values(dining.data.needs).find(n => n.personKey === personKey && n.status === 'pending' && n.targetStore === source)
          if (!need) {
            const id = `${eventId}_${personKey}`
            need = dining.data.needs[id] = { id, personKey, uid, name, sourceStore: source, targetStore: source, status: 'pending', originals: [], orderIds: [], createdAt: Date.now() }
          }
          need.originals.push({ storeName: source, meal: order.meal || '', note: order.note || '', price: Number(order.price) || 0, orderId: order.id })
        }
        Object.values(dining.data.needs).forEach(need => {
          if (need.status === 'pending' && need.targetStore === source) need.targetStore = target
        })
        dining.data.replacements[source] = { target, actorUid, timestamp: Date.now() }

      }
      if (changingStores) transaction.set(dailyRef, { ...daily, activeStores: nextStores, freeStores: nextFree, date: taipeiDateKey(), serviceDate: taipeiDateKey(), updatedAt: FieldValue.serverTimestamp() })
      transaction.set(dining.ref, dining.data)
      orders.forEach(order => transaction.delete(order.ref))
    })

    return { ok: true }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', error?.message || '取消失敗')
  }
})

exports.cancelDiningNeed = onCall(async (request) => {
  const uid = requireAuth(request)
  const profile = await getUserProfile(uid)
  if (!profile?.isRegistered) throw new HttpsError('permission-denied', '需要已註冊使用者權限')
  return db.runTransaction(async transaction => {
    const dining = await readDining(transaction)
    const need = dining.data.needs[String(request.data?.needId || '')]
    if (!need || need.status !== 'pending') throw new HttpsError('failed-precondition', '補點狀態已更新')
    Object.assign(need, { status: 'declined', resolvedBy: uid, resolvedAt: Date.now() })
    transaction.set(dining.ref, dining.data)
    return { ok: true }
  })
})

exports.setOrderFreeStatusWithWalletAdjustment = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)

  const { orderId, isFree, actorName } = request.data || {}
  if (!orderId) throw new HttpsError('invalid-argument', '缺少訂單')

  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()

  try {
    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection('orders').doc(String(orderId))
      const orderSnap = await transaction.get(orderRef)
      if (!orderSnap.exists) throw new HttpsError('not-found', 'ORDER_NOT_FOUND')

      const order = { id: String(orderId), ref: orderRef, ...orderSnap.data() }
      const nextIsFree = Boolean(isFree)
      if (Boolean(order.isFree) === nextIsFree) return

      const ownerUid = String(order.walletOwnerUid || order.ownerUid || order.uid || '').trim()
      const ownerName = String(order.walletOwnerName || order.name || '').trim()
      const amountSource = nextIsFree && order.walletDebited ? (order.walletAmount ?? order.price) : order.price
      const amount = finiteMoney(amountSource, { min: 1, max: MAX_PRICE, code: 'INVALID_ORDER_AMOUNT' })
      const isWalletOrder = order.paymentMethod === 'wallet' || (!order.paymentMethod && order.walletDebited)
      const shouldAdjustWallet = isWalletOrder && ownerUid && ownerName && amount > 0
      if (isWalletOrder && !shouldAdjustWallet) throw new HttpsError('failed-precondition', 'ORDER_WALLET_OWNER_MISSING')
      const shouldAdjustCash = order.paymentMethod === 'cash' && order.cashPaymentId && amount > 0
      let wallet = null
      if (shouldAdjustWallet) {
        const walletRef = walletRefForUid(ownerUid)
        const walletSnap = await transaction.get(walletRef)
        wallet = {
          ref: walletRef,
          balance: roundMoney(walletSnap.exists ? walletSnap.data().balance : 0),
        }
      }
      let cashPayment = null
      if (shouldAdjustCash) {
        const cashRef = db.collection('cash_payments').doc(String(order.cashPaymentId))
        const cashSnap = await transaction.get(cashRef)
        if (cashSnap.exists) cashPayment = { ref: cashRef, ...cashSnap.data() }
      }
      if (shouldAdjustCash && (order.cashStatus === 'collected' || cashPayment?.status === 'collected')) {
        throw new HttpsError('failed-precondition', 'CASH_PAYMENT_ALREADY_COLLECTED')
      }
      const walletId = ownerUid ? walletIdForUid(ownerUid) : ''

      if (nextIsFree) {
        if (shouldAdjustWallet && order.walletDebited && !order.walletRefunded) {
          const afterBalance = roundMoney(wallet.balance + amount)
          transaction.set(wallet.ref, {
            ownerUid,
            ownerName,
            balance: afterBalance,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: operatorName,
            updatedByUid: actorUid,
            lastTransactionType: 'free_refund',
          }, { merge: true })
          writeWalletLog(transaction, {
            walletId,
            ownerUid,
            ownerName,
            type: 'free_refund',
            amount,
            beforeBalance: wallet.balance,
            afterBalance,
            operatorName,
            operatorUid: actorUid,
            reason: freeOrderWalletReason('免費訂單退款', order),
            orderId: order.id,
            orderIds: [order.id],
            storeName: orderStoreName(order) || '未指定店家',
            items: [orderItemSnapshot(order)],
            itemCount: 1,
          })
        }

        if (shouldAdjustCash && cashPayment && !order.cashFreeAdjusted) {
          const beforeStatus = cashPayment.status || 'pending'
          const nextAmount = Math.max(0, roundMoney((Number(cashPayment.amount) || 0) - amount))
          const nextRemaining = Math.max(0, roundMoney((Number(cashPayment.remainingAmount ?? cashPayment.amount) || 0) - amount))
          const nextStatus = nextRemaining <= 0 && beforeStatus !== 'collected' ? 'cancelled' : beforeStatus
          transaction.update(cashPayment.ref, {
            amount: nextAmount,
            remainingAmount: nextRemaining,
            status: nextStatus,
            updatedAt: FieldValue.serverTimestamp(),
            updatedTimestamp: Date.now(),
          })
          writeCashPaymentLog(transaction, {
            cashPaymentId: String(order.cashPaymentId),
            ownerName,
            ownerUid,
            type: 'cash_adjustment',
            amount: -amount,
            beforeStatus,
            afterStatus: nextStatus,
            operatorName,
            operatorUid: actorUid,
            reason: freeOrderWalletReason('免費訂單現金扣除', order),
            orderIds: [order.id],
            storeName: orderStoreName(order) || '未指定店家',
            items: [orderItemSnapshot(order)],
          })
        }

        transaction.update(order.ref, {
          isFree: true,
          freeMarkedAt: FieldValue.serverTimestamp(),
          freeMarkedBy: operatorName,
          freeMarkedByUid: actorUid,
          walletRefunded: shouldAdjustWallet ? true : Boolean(order.walletRefunded),
          cashFreeAdjusted: shouldAdjustCash ? true : Boolean(order.cashFreeAdjusted),
        })
        return
      }

      if (shouldAdjustWallet && (order.walletRefunded || !order.walletDebited)) {
        if (wallet.balance < amount) throw new HttpsError('failed-precondition', 'INSUFFICIENT_WALLET_BALANCE')

        const afterBalance = roundMoney(wallet.balance - amount)
        transaction.set(wallet.ref, {
          ownerUid,
          ownerName,
          balance: afterBalance,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: operatorName,
          updatedByUid: actorUid,
          lastTransactionType: 'free_debit',
        }, { merge: true })
        writeWalletLog(transaction, {
          walletId,
          ownerUid,
          ownerName,
          type: 'free_debit',
          amount: -amount,
          beforeBalance: wallet.balance,
          afterBalance,
          operatorName,
          operatorUid: actorUid,
          reason: freeOrderWalletReason('取消免費訂單扣回', order),
          orderId: order.id,
          orderIds: [order.id],
          storeName: orderStoreName(order) || '未指定店家',
          items: [orderItemSnapshot(order)],
          itemCount: 1,
        })
      }

      if (shouldAdjustCash && cashPayment && order.cashFreeAdjusted) {
        const beforeStatus = cashPayment.status || 'pending'
        const nextAmount = roundMoney((Number(cashPayment.amount) || 0) + amount)
        const nextRemaining = roundMoney((Number(cashPayment.remainingAmount) || 0) + amount)
        const nextStatus = beforeStatus === 'cancelled' ? 'pending' : beforeStatus
        transaction.update(cashPayment.ref, {
          amount: nextAmount,
          remainingAmount: nextRemaining,
          status: nextStatus,
          items: (cashPayment.items || []).map(item => String(item.orderId) === order.id
            ? { ...item, ...orderItemSnapshot(order) } : item),
          updatedAt: FieldValue.serverTimestamp(),
          updatedTimestamp: Date.now(),
        })
        writeCashPaymentLog(transaction, {
          cashPaymentId: String(order.cashPaymentId),
          ownerName,
          ownerUid,
          type: 'cash_adjustment',
          amount,
          beforeStatus,
          afterStatus: nextStatus,
          operatorName,
          operatorUid: actorUid,
          reason: freeOrderWalletReason('取消免費訂單現金加回', order),
          orderIds: [order.id],
          storeName: orderStoreName(order) || '未指定店家',
          items: [orderItemSnapshot(order)],
        })
      }

      // 今日免費的現金單建單時沒有應收款；恢復收費時一併建立，供總務收款。
      const newCashPayment = !nextIsFree && order.paymentMethod === 'cash' && !order.cashPaymentId
        ? cashPaymentRef()
        : null
      if (newCashPayment) {
        const now = Date.now()
        const items = [{ orderId: order.id, ...orderItemSnapshot(order) }]
        transaction.set(newCashPayment, {
          cashPaymentId: newCashPayment.id,
          ownerName: order.ownerName || order.name || '',
          ownerUid: order.ownerUid || '',
          payerType: order.ownerUid ? 'member_without_wallet' : 'manual',
          amount,
          collectedAmount: 0,
          remainingAmount: amount,
          status: 'pending',
          paymentMethod: 'cash',
          orderIds: [order.id],
          storeNames: [orderStoreName(order)].filter(Boolean),
          items,
          orderedByUid: order.orderedByUid || order.uid || '',
          orderedByName: order.orderedByName || '',
          collectedByUid: '',
          collectedByName: '',
          collectedAt: null,
          cancelledByUid: '',
          cancelledByName: '',
          cancelledAt: null,
          cancelReason: '',
          createdAt: FieldValue.serverTimestamp(),
          createdTimestamp: now,
          updatedAt: FieldValue.serverTimestamp(),
          updatedTimestamp: now,
        })
        writeCashPaymentLog(transaction, {
          cashPaymentId: newCashPayment.id,
          ownerName: order.ownerName || order.name || '',
          ownerUid: order.ownerUid || '',
          type: 'cash_order_created',
          amount,
          afterStatus: 'pending',
          operatorName,
          operatorUid: actorUid,
          reason: freeOrderWalletReason('取消免費訂單建立現金應收', order),
          orderIds: [order.id],
          storeName: orderStoreName(order),
          items,
        })
      }

      transaction.update(order.ref, {
        isFree: false,
        freeMarkedAt: null,
        freeMarkedBy: '',
        freeMarkedByUid: '',
        walletRefunded: shouldAdjustWallet ? false : Boolean(order.walletRefunded),
        ...(shouldAdjustWallet ? {
          walletDebited: true,
          walletAmount: amount,
          walletId,
          walletOwnerUid: ownerUid,
          walletOwnerName: ownerName,
          paid: true,
          paidByWallet: true,
          paidAt: FieldValue.serverTimestamp(),
        } : {}),
        ...(newCashPayment ? { cashPaymentId: newCashPayment.id } : {}),
        ...(order.paymentMethod === 'cash' && (newCashPayment || shouldAdjustCash) ? {
          paid: false,
          paidByWallet: false,
          cashStatus: 'pending',
        } : {}),
        cashFreeAdjusted: shouldAdjustCash ? false : Boolean(order.cashFreeAdjusted),
      })
    })

    return { ok: true }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', error?.message || '免費操作失敗')
  }
})

exports.updateOrderWithPaymentAdjustment = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await getUserProfile(actorUid)
  if (!profile.isRegistered) throw new HttpsError('permission-denied', '需要已註冊使用者權限')
  const isAdmin = Boolean(profile?.isAdmin)
  const { orderId, meal, note = '', price, actorName } = request.data || {}
  const id = String(orderId || '').trim()
  const nextMeal = String(meal || '').trim()
  const nextNote = String(note || '').trim()
  const nextPrice = finiteMoney(price, { min: 1, max: MAX_PRICE, code: 'INVALID_ORDER_AMOUNT' })
  if (!id || id.includes('/') || id.length > 1500 || !nextMeal) {
    throw new HttpsError('invalid-argument', '訂單資料不完整')
  }
  if (nextMeal.length > MAX_MEAL_LENGTH || nextNote.length > MAX_NOTE_LENGTH) {
    throw new HttpsError('invalid-argument', 'ORDER_TEXT_TOO_LONG')
  }
  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()

  try {
    await db.runTransaction(async transaction => {
      const orderRef = db.collection('orders').doc(id)
      const orderSnap = await transaction.get(orderRef)
      if (!orderSnap.exists) throw new HttpsError('not-found', 'ORDER_NOT_FOUND')
      const order = { id, ref: orderRef, ...orderSnap.data() }

      const walletLedger = await getWalletLedgerForOrders(transaction, [id])
      const debit = walletLedger.debits.get(id)
      const cashPaymentId = String(order.cashPaymentId || '').trim()
      let cashPayment = null
      let cashItem = null
      if (cashPaymentId) {
        const paymentRef = db.collection('cash_payments').doc(cashPaymentId)
        const paymentSnap = await transaction.get(paymentRef)
        if (paymentSnap.exists) {
          cashPayment = { ref: paymentRef, ...paymentSnap.data() }
          cashItem = (Array.isArray(cashPayment.items) ? cashPayment.items : [])
            .find(item => String(item?.orderId || '') === id) || null
        }
      }

      const permittedUids = debit
        ? [debit.ownerUid, debit.orderedByUid]
        : cashItem
          ? [cashPayment.ownerUid, cashPayment.orderedByUid]
          : [order.ownerUid, order.uid, order.orderedByUid]
      if (!isAdmin && !permittedUids.map(String).includes(actorUid)) {
        throw new HttpsError('permission-denied', 'ORDER_EDIT_NOT_ALLOWED')
      }

      const previousPrice = finiteMoney(
        order.isFree ? order.price : (debit?.amount ?? cashItem?.price ?? order.price),
        { min: 1, max: MAX_PRICE, code: 'INVALID_ORDER_AMOUNT' },
      )
      const previousSnapshot = {
        meal: String(order.meal ?? debit?.meal ?? cashItem?.meal ?? '').trim(),
        price: previousPrice,
        note: String(order.note ?? debit?.note ?? cashItem?.note ?? '').trim(),
        storeName: String(debit?.storeName ?? cashItem?.storeName ?? order.storeName ?? '').trim(),
      }
      const menuSelectionChanged = nextMeal !== previousSnapshot.meal || nextPrice !== previousPrice
      if (!isAdmin && menuSelectionChanged) {
        const storeName = previousSnapshot.storeName
        if (!storeName) throw new HttpsError('failed-precondition', 'MENU_ITEM_PRICE_MISMATCH')
        const menuSnap = await transaction.get(
          db.collection('menu_images').where('storeName', '==', storeName),
        )
        const isVerifiedMenuSelection = menuSnap.docs.some(doc => {
          const menuItems = Array.isArray(doc.data().menuItems) ? doc.data().menuItems : []
          return menuItems.some(item => {
            const isAddon = item?.type === 'addon' || String(item?.category || '').trim() === '加點'
            return !isAddon
              && String(item?.name || '').trim() === nextMeal
              && roundMoney(item?.price) === nextPrice
          })
        })
        if (!isVerifiedMenuSelection) {
          throw new HttpsError('failed-precondition', 'MENU_ITEM_PRICE_MISMATCH')
        }
      }
      const nextSnapshot = {
        meal: nextMeal,
        price: nextPrice,
        note: nextNote,
        storeName: String(order.storeName || previousSnapshot.storeName || '').trim(),
      }
      const editedTimestamp = Date.now()
      const updates = {
        meal: nextMeal,
        note: nextNote,
        price: nextPrice,
        editedAtTimestamp: editedTimestamp,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: actorUid,
        updatedByName: operatorName,
      }

      if (debit) updates.walletAmount = nextPrice
      const isRefunded = walletLedger.refundedOrderIds.has(id)
      // 金額沒變（只改品名或備註）就不動錢包：沒有錢移動就不該有流水，
      // 訂單文件本身已更新，取消退款的明細描述也改由訂單文件取得最新內容。
      const priceChanged = nextPrice !== previousPrice
      const shouldAdjustWallet = Boolean(debit) && !isRefunded && !order.isFree && priceChanged
      if (shouldAdjustWallet) {
        const ownerUid = String(debit.ownerUid || '').trim()
        const ownerName = String(debit.ownerName || '').trim()
        if (!ownerUid || !ownerName) throw new HttpsError('failed-precondition', 'ORDER_WALLET_OWNER_MISSING')
        const walletRef = walletRefForUid(ownerUid)
        const walletSnap = await transaction.get(walletRef)
        const beforeBalance = roundMoney(walletSnap.exists ? walletSnap.data().balance : 0)
        const afterRefundBalance = roundMoney(beforeBalance + previousPrice)
        const afterDebitBalance = roundMoney(afterRefundBalance - nextPrice)
        if (afterDebitBalance < 0) throw new HttpsError('failed-precondition', 'INSUFFICIENT_WALLET_BALANCE')
        const editGroupId = crypto.randomUUID()
        const editDelta = roundMoney(previousPrice - nextPrice)
        transaction.set(walletRef, {
          ownerUid,
          ownerName,
          balance: afterDebitBalance,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: operatorName,
          updatedByUid: actorUid,
          lastTransactionType: 'order_edit_debit',
        }, { merge: true })
        writeWalletLog(transaction, {
          walletId: walletIdForUid(ownerUid),
          ownerUid,
          ownerName,
          type: 'order_edit_refund',
          amount: previousPrice,
          beforeBalance,
          afterBalance: afterRefundBalance,
          operatorName,
          operatorUid: actorUid,
          reason: `訂單編輯退款｜${previousSnapshot.storeName || '未指定店家'}｜${previousSnapshot.meal}`,
          orderId: id,
          orderIds: [id],
          storeName: previousSnapshot.storeName || '未指定店家',
          items: [previousSnapshot],
          itemCount: 1,
          editGroupId,
          editDelta,
        })
        writeWalletLog(transaction, {
          walletId: walletIdForUid(ownerUid),
          ownerUid,
          ownerName,
          type: 'order_edit_debit',
          amount: -nextPrice,
          beforeBalance: afterRefundBalance,
          afterBalance: afterDebitBalance,
          operatorName,
          operatorUid: actorUid,
          reason: `訂單編輯扣款｜${nextSnapshot.storeName || '未指定店家'}｜${nextMeal}`,
          orderId: id,
          orderIds: [id],
          storeName: nextSnapshot.storeName || '未指定店家',
          items: [nextSnapshot],
          itemCount: 1,
          editGroupId,
          editDelta,
        })
      }

      if (cashPayment && cashItem && !order.isFree) {
        const delta = roundMoney(nextPrice - previousPrice)
        if (cashPayment.status === 'collected' && delta !== 0) {
          throw new HttpsError('failed-precondition', 'CASH_PAYMENT_ALREADY_COLLECTED')
        }
        if (cashPayment.status === 'cancelled') {
          throw new HttpsError('failed-precondition', 'CASH_PAYMENT_CANCELLED')
        }
        const nextAmount = Math.max(0, roundMoney((Number(cashPayment.amount) || 0) + delta))
        const nextRemaining = Math.max(0, roundMoney((Number(cashPayment.remainingAmount ?? cashPayment.amount) || 0) + delta))
        const items = cashPayment.items.map(item => String(item?.orderId || '') === id
          ? { ...item, ...nextSnapshot }
          : item)
        transaction.update(cashPayment.ref, {
          amount: nextAmount,
          remainingAmount: nextRemaining,
          items,
          updatedAt: FieldValue.serverTimestamp(),
          updatedTimestamp: Date.now(),
        })
        if (delta !== 0) {
          writeCashPaymentLog(transaction, {
            cashPaymentId,
            ownerName: cashPayment.ownerName || '',
            ownerUid: cashPayment.ownerUid || '',
            type: 'cash_adjustment',
            amount: delta,
            beforeStatus: cashPayment.status || 'pending',
            afterStatus: cashPayment.status || 'pending',
            operatorName,
            operatorUid: actorUid,
            reason: `訂單編輯調整｜${nextSnapshot.storeName || '未指定店家'}｜${previousSnapshot.meal} → ${nextMeal}`,
            orderIds: [id],
            storeName: nextSnapshot.storeName,
            items: [previousSnapshot, nextSnapshot],
          })
        }
      }

      transaction.update(orderRef, updates)
    })
    return { ok: true }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', error?.message || '訂單更新失敗')
  }
})

exports.addWalletCredit = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)

  const { ownerUid, amount, actorName, reason = '後台人工儲值' } = request.data || {}
  const uid = walletIdForUid(ownerUid)
  const member = await getVerifiedMember(uid)
  const name = member.memberName
  const credit = finiteMoney(amount, { min: 1, max: MAX_WALLET_TOP_UP, code: 'INVALID_WALLET_TRANSACTION' })
  const memo = String(reason || '').trim() || '後台人工儲值'
  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  if (memo.length > MAX_NOTE_LENGTH) throw new HttpsError('invalid-argument', 'INVALID_WALLET_TRANSACTION')

  await db.runTransaction(async (transaction) => {
    const walletRef = walletRefForUid(uid)
    const snap = await transaction.get(walletRef)
    const beforeBalance = roundMoney(snap.exists ? snap.data().balance : 0)
    const afterBalance = roundMoney(beforeBalance + credit)
    const walletId = walletIdForUid(uid)

    transaction.set(walletRef, {
      ownerUid: uid,
      ownerName: name,
      balance: afterBalance,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: operatorName,
      updatedByUid: actorUid,
      lastTransactionType: 'top_up',
    }, { merge: true })

    writeWalletLog(transaction, {
      walletId,
      ownerUid: uid,
      ownerName: name,
      type: 'top_up',
      amount: credit,
      beforeBalance,
      afterBalance,
      operatorName,
      operatorUid: actorUid,
      reason: memo,
    })
  })

  return { ok: true }
})

exports.adjustWalletBalance = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)

  const { ownerUid, amount, actorName, reason } = request.data || {}
  const uid = walletIdForUid(ownerUid)
  const member = await getVerifiedMember(uid)
  const name = member.memberName
  const delta = finiteMoney(amount, { min: -MAX_WALLET_TRANSACTION, max: MAX_WALLET_TRANSACTION, code: 'INVALID_WALLET_TRANSACTION' })
  const memo = String(reason || '').trim()
  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  if (delta === 0 || !memo || memo.length > MAX_NOTE_LENGTH) throw new HttpsError('invalid-argument', 'INVALID_WALLET_TRANSACTION')

  await db.runTransaction(async (transaction) => {
    const walletRef = walletRefForUid(uid)
    const snap = await transaction.get(walletRef)
    const beforeBalance = roundMoney(snap.exists ? snap.data().balance : 0)
    const afterBalance = roundMoney(beforeBalance + delta)
    const walletId = walletIdForUid(uid)

    transaction.set(walletRef, {
      ownerUid: uid,
      ownerName: name,
      balance: afterBalance,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: operatorName,
      updatedByUid: actorUid,
      lastTransactionType: 'admin_adjustment',
    }, { merge: true })

    writeWalletLog(transaction, {
      walletId,
      ownerUid: uid,
      ownerName: name,
      type: 'admin_adjustment',
      amount: delta,
      beforeBalance,
      afterBalance,
      operatorName,
      operatorUid: actorUid,
      reason: memo,
    })
  })

  return { ok: true }
})

exports.createMissingCashPayment = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)
  const { orderId, actorName } = request.data || {}
  const id = String(orderId || '').trim()
  if (!id) throw new HttpsError('invalid-argument', '缺少訂單')

  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  const newCashRef = cashPaymentRef()

  return db.runTransaction(async (transaction) => {
    const orderRef = db.collection('orders').doc(id)
    const orderSnap = await transaction.get(orderRef)
    if (!orderSnap.exists) throw new HttpsError('not-found', 'ORDER_NOT_FOUND')

    const order = { id, ...orderSnap.data() }
    const isCashOrder = order.paymentMethod === 'cash' || (!order.paymentMethod && !order.paid && !order.walletDebited)
    if (!isCashOrder || order.isFree || order.cashStatus === 'cancelled') {
      throw new HttpsError('failed-precondition', 'ORDER_IS_NOT_PENDING_CASH')
    }

    const existingCashPaymentId = String(order.cashPaymentId || '').trim()
    if (existingCashPaymentId) {
      const existingRef = db.collection('cash_payments').doc(existingCashPaymentId)
      const existingSnap = await transaction.get(existingRef)
      if (existingSnap.exists) return { ok: true, cashPaymentId: existingCashPaymentId, duplicate: true }
    }

    const amount = finiteMoney(order.price, { min: 1, max: MAX_PRICE, code: 'INVALID_CASH_AMOUNT' })

    const ownerName = String(order.ownerName || order.name || '').trim()
    const ownerUid = String(order.ownerUid || '').trim()
    const storeName = String(order.storeName || '').trim()
    const orderedByName = String(order.orderedByName || operatorName).trim()
    const createdTimestamp = Number(order.timestamp) || Date.now()
    const item = {
      orderId: id,
      storeName,
      meal: String(order.meal || '').trim(),
      price: amount,
      note: String(order.note || '').trim(),
    }

    transaction.set(newCashRef, {
      cashPaymentId: newCashRef.id,
      ownerName,
      ownerUid,
      payerType: ownerUid ? 'member_without_wallet' : 'manual',
      amount,
      collectedAmount: 0,
      remainingAmount: amount,
      status: 'pending',
      paymentMethod: 'cash',
      orderIds: [id],
      storeNames: storeName ? [storeName] : [],
      items: [item],
      orderedByUid: String(order.orderedByUid || actorUid),
      orderedByName,
      collectedByUid: '',
      collectedByName: '',
      collectedAt: null,
      cancelledByUid: '',
      cancelledByName: '',
      cancelledAt: null,
      cancelReason: '',
      createdAt: FieldValue.serverTimestamp(),
      createdTimestamp,
      updatedAt: FieldValue.serverTimestamp(),
      updatedTimestamp: Date.now(),
      repairedAt: FieldValue.serverTimestamp(),
      repairedByUid: actorUid,
      repairedByName: operatorName,
    })

    transaction.update(orderRef, {
      cashPaymentId: newCashRef.id,
      cashStatus: 'pending',
      paymentMethod: 'cash',
      paidByWallet: false,
      paid: false,
    })

    writeCashPaymentLog(transaction, {
      cashPaymentId: newCashRef.id,
      ownerName,
      ownerUid,
      type: 'cash_order_created',
      amount,
      beforeStatus: '',
      afterStatus: 'pending',
      operatorName,
      operatorUid: actorUid,
      reason: cashReceivableReason(storeName, ownerName, orderedByName, '補建點餐應收款'),
      orderIds: [id],
      storeName,
      items: [item],
    })

    return { ok: true, cashPaymentId: newCashRef.id, duplicate: false }
  })
})

exports.getCashPaymentAdminData = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)

  const fromTimestamp = Number(request.data?.fromTimestamp)
  const toTimestamp = Number(request.data?.toTimestamp)
  const hasRange = Number.isFinite(fromTimestamp) && Number.isFinite(toTimestamp)
  if (hasRange && fromTimestamp > toTimestamp) {
    throw new HttpsError('invalid-argument', 'INVALID_CASH_EXPORT_RANGE')
  }

  const paymentQuery = hasRange
    ? db.collection('cash_payments')
      .where('createdTimestamp', '>=', fromTimestamp)
      .where('createdTimestamp', '<=', toTimestamp)
      .orderBy('createdTimestamp', 'desc')
    : db.collection('cash_payments').orderBy('createdTimestamp', 'desc').limit(500)
  const logQuery = hasRange
    ? db.collection('cash_payment_logs')
      .where('timestamp', '>=', fromTimestamp)
      .where('timestamp', '<=', toTimestamp)
      .orderBy('timestamp', 'desc')
    : db.collection('cash_payment_logs').orderBy('timestamp', 'desc').limit(1000)

  const [paymentSnap, logSnap] = await Promise.all([
    paymentQuery.get(),
    logQuery.get(),
  ])

  const serializeValue = (value) => {
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (Array.isArray(value)) return value.map(serializeValue)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serializeValue(nested)]))
    }
    return value
  }
  const serializeDoc = (snap) => ({ id: snap.id, ...serializeValue(snap.data()) })

  return {
    payments: paymentSnap.docs.map(serializeDoc),
    logs: logSnap.docs.map(serializeDoc),
  }
})

exports.markCashPaymentCollected = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)
  const { cashPaymentId, actorName, reason = '管理員標記現金已收' } = request.data || {}
  const id = String(cashPaymentId || '').trim()
  if (!id) throw new HttpsError('invalid-argument', '缺少現金單')

  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()

  await db.runTransaction(async (transaction) => {
    const paymentRef = db.collection('cash_payments').doc(id)
    const paymentSnap = await transaction.get(paymentRef)
    if (!paymentSnap.exists) throw new HttpsError('not-found', 'CASH_PAYMENT_NOT_FOUND')

    const payment = { id, ref: paymentRef, ...paymentSnap.data() }
    if (payment.status === 'collected') return
    if (payment.status === 'cancelled') throw new HttpsError('failed-precondition', 'CASH_PAYMENT_CANCELLED')

    const amount = roundMoney(Number(payment.remainingAmount ?? payment.amount) || 0)
    const orderIds = Array.isArray(payment.orderIds) ? payment.orderIds : []
    const orderRefs = orderIds.map(orderId => db.collection('orders').doc(String(orderId)))
    const orderSnaps = await getAllInTransaction(transaction, orderRefs)
    const existingOrderRefs = orderRefs.filter((_, index) => orderSnaps[index].exists)
    const existingOrderIds = existingOrderRefs.map(orderRef => orderRef.id)

    transaction.update(paymentRef, {
      status: 'collected',
      collectedAmount: roundMoney(Number(payment.collectedAmount || 0) + amount),
      remainingAmount: 0,
      orderIds: existingOrderIds,
      collectedByUid: actorUid,
      collectedByName: operatorName,
      collectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedTimestamp: Date.now(),
    })

    existingOrderRefs.forEach(orderRef => transaction.update(orderRef, {
      paid: true,
      cashStatus: 'collected',
      cashCollectedAt: FieldValue.serverTimestamp(),
      cashCollectedByUid: actorUid,
      cashCollectedByName: operatorName,
    }))

    writeCashPaymentLog(transaction, {
      cashPaymentId: id,
      ownerName: payment.ownerName || '',
      ownerUid: payment.ownerUid || '',
      type: 'cash_collected',
      amount,
      beforeStatus: payment.status || 'pending',
      afterStatus: 'collected',
      operatorName,
      operatorUid: actorUid,
      reason,
      orderIds: existingOrderIds,
      storeName: Array.isArray(payment.storeNames) ? payment.storeNames.join('、') : '',
      items: Array.isArray(payment.items) ? payment.items : [],
    })
  })

  return { ok: true }
})

exports.cancelCashPayment = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)
  const { cashPaymentId, actorName, reason = '現金單取消' } = request.data || {}
  const id = String(cashPaymentId || '').trim()
  const memo = String(reason || '').trim()
  if (!id || !memo) throw new HttpsError('invalid-argument', '缺少現金單或原因')

  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()

  await db.runTransaction(async (transaction) => {
    const paymentRef = db.collection('cash_payments').doc(id)
    const paymentSnap = await transaction.get(paymentRef)
    if (!paymentSnap.exists) throw new HttpsError('not-found', 'CASH_PAYMENT_NOT_FOUND')

    const payment = { id, ref: paymentRef, ...paymentSnap.data() }
    if (payment.status === 'cancelled') return
    if (payment.status === 'collected') throw new HttpsError('failed-precondition', 'CASH_PAYMENT_ALREADY_COLLECTED')

    const amount = roundMoney(Number(payment.remainingAmount ?? payment.amount) || 0)
    const orderIds = Array.isArray(payment.orderIds) ? payment.orderIds : []
    const orderRefs = orderIds.map(orderId => db.collection('orders').doc(String(orderId)))
    const orderSnaps = await getAllInTransaction(transaction, orderRefs)
    const existingOrderRefs = orderRefs.filter((_, index) => orderSnaps[index].exists)
    const existingOrderIds = existingOrderRefs.map(orderRef => orderRef.id)

    transaction.update(paymentRef, {
      status: 'cancelled',
      remainingAmount: 0,
      orderIds: existingOrderIds,
      cancelledByUid: actorUid,
      cancelledByName: operatorName,
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: memo,
      updatedAt: FieldValue.serverTimestamp(),
      updatedTimestamp: Date.now(),
    })

    existingOrderRefs.forEach(orderRef => transaction.update(orderRef, {
      paid: false,
      cashStatus: 'cancelled',
    }))

    writeCashPaymentLog(transaction, {
      cashPaymentId: id,
      ownerName: payment.ownerName || '',
      ownerUid: payment.ownerUid || '',
      type: 'cash_cancelled',
      amount,
      beforeStatus: payment.status || 'pending',
      afterStatus: 'cancelled',
      operatorName,
      operatorUid: actorUid,
      reason: memo,
      orderIds: existingOrderIds,
      storeName: Array.isArray(payment.storeNames) ? payment.storeNames.join('、') : '',
      items: Array.isArray(payment.items) ? payment.items : [],
    })
  })

  return { ok: true }
})

exports.previewTimeRangeCleanup = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)
  const { from, to } = validateCleanupRange(request.data)
  const cleanup = await queryCleanupDocuments(from, to)
  return cleanupPreview(cleanup)
})

exports.deleteUnlinkedOrders = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)
  const orderIds = [...new Set((Array.isArray(request.data?.orderIds) ? request.data.orderIds : [])
    .map(id => String(id).trim())
    .filter(id => id && !id.includes('/') && id.length <= 1500))]
  if (!orderIds.length) throw new HttpsError('invalid-argument', '缺少訂單')
  if (orderIds.length > 400) throw new HttpsError('invalid-argument', 'TOO_MANY_ORDERS')

  return db.runTransaction(async transaction => {
    const orderRefs = orderIds.map(id => db.collection('orders').doc(id))
    const orderSnaps = await getAllInTransaction(transaction, orderRefs)
    const existingOrders = orderSnaps.filter(snap => snap.exists)
    const walletLedger = await getWalletLedgerForOrders(transaction, orderIds)
    const linkedCashLogs = []
    for (let index = 0; index < orderIds.length; index += 30) {
      const chunk = orderIds.slice(index, index + 30)
      const logs = await transaction.get(
        db.collection('cash_payment_logs').where('orderIds', 'array-contains-any', chunk),
      )
      linkedCashLogs.push(...logs.docs)
    }
    const hasFinancialLink = existingOrders.some(snap => {
      const order = snap.data()
      return Boolean(order.walletDebited || order.cashPaymentId || order.paymentMethod === 'wallet' || order.paymentMethod === 'cash')
    }) || walletLedger.debits.size > 0 || linkedCashLogs.length > 0
    if (hasFinancialLink) {
      throw new HttpsError('failed-precondition', 'FINANCIAL_ORDERS_REQUIRE_LINKED_CLEANUP')
    }
    existingOrders.forEach(snap => transaction.delete(snap.ref))
    return { ok: true, deletedCount: existingOrders.length }
  })
})

exports.deleteTimeRangeData = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)
  const { from, to } = validateCleanupRange(request.data)
  if (String(request.data?.confirmation || '').trim() !== CLEANUP_CONFIRMATION) {
    throw new HttpsError('invalid-argument', '確認文字不正確')
  }

  return db.runTransaction(async transaction => {
    // 交易重試時重新查詢，避免重複清理或並行編輯造成重複調整餘額。
    const cleanup = await queryCleanupDocuments(from, to, transaction)
    const preview = cleanupPreview(cleanup)
    if (!preview.canDelete) {
      throw new HttpsError('resource-exhausted', `資料量超過 ${MAX_CLEANUP_WRITES} 筆，請縮小區間`)
    }
    if (preview.documentCount === 0) return { ok: true, ...preview }

    // 一筆合併流水可能對應區間外的訂單，不可刪掉仍保留訂單的帳務依據。
    const selectedOrderIds = new Set(cleanup.documents.filter(doc => doc.ref.parent.id === 'orders').map(doc => doc.id))
    const linkedOrderIds = new Set(cleanup.documents.flatMap(doc => {
      const data = doc.data()
      return [...(Array.isArray(data.orderIds) ? data.orderIds : []), data.orderId].filter(Boolean).map(String)
    }))
    const retainedOrderRefs = [...linkedOrderIds].filter(id => !selectedOrderIds.has(id)).map(id => db.collection('orders').doc(id))
    const retainedOrders = await getAllInTransaction(transaction, retainedOrderRefs)
    if (retainedOrders.some(doc => doc.exists)) {
      throw new HttpsError('failed-precondition', '清理區間未涵蓋關聯訂單，請調整區間後重新預覽')
    }
    const walletRefs = cleanup.walletAdjustments.map(item => walletRefForUid(item.walletId))
    const walletSnaps = await getAllInTransaction(transaction, walletRefs)
    const deletedWalletLogPaths = new Set(cleanup.documents
      .filter(doc => doc.ref.parent.id === 'wallet_logs')
      .map(doc => doc.ref.path))

    // 所有讀取必須在 transaction 寫入前完成；同時相容僅以 ownerUid 留存的舊流水。
    const retainedWalletLogs = await Promise.all(cleanup.walletAdjustments.map(async item => {
      const [byWalletId, byOwnerUid] = await Promise.all([
        transaction.get(db.collection('wallet_logs').where('walletId', '==', item.walletId)),
        transaction.get(db.collection('wallet_logs').where('ownerUid', '==', item.walletId)),
      ])
      const uniqueLogs = new Map()
      ;[...byWalletId.docs, ...byOwnerUid.docs].forEach(doc => {
        if (!deletedWalletLogPaths.has(doc.ref.path)) uniqueLogs.set(doc.ref.path, doc)
      })
      return [...uniqueLogs.values()]
    }))

    cleanup.walletAdjustments.forEach((item, index) => {
      const walletSnap = walletSnaps[index]
      if (!walletSnap.exists) return
      const currentBalance = Number(walletSnap.data().balance) || 0
      const lastRetainedLogMs = retainedWalletLogs[index].reduce((latest, log) => {
        const timestamp = walletLogTimestampMs(log.data())
        return timestamp && (!latest || timestamp > latest) ? timestamp : latest
      }, null)
      const walletUpdate = {
        balance: roundMoney(currentBalance - item.removedNetAmount),
        updatedByUid: actorUid,
        lastTransactionType: 'time_range_cleanup',
      }
      // 沒有保留流水時，維持錢包原有 updatedAt，避免以清理當下時間覆寫它。
      if (lastRetainedLogMs) {
        walletUpdate.updatedAt = admin.firestore.Timestamp.fromMillis(lastRetainedLogMs)
      }
      transaction.update(walletSnap.ref, walletUpdate)
    })

    cleanup.documents.forEach(doc => transaction.delete(doc.ref))
    return { ok: true, ...preview }
  })
})
