import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'

// 執行真正的 callable handler，僅替換 Firebase I/O；不連線任何專案。
export function createBackend({ env = {}, fetch = null } = {}) {
  const records = new Map()
  const webhookCalls = []
  const pushes = []
  let sequence = 0
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code }
  }
  const snapshot = ref => ({
    id: ref.id,
    ref,
    exists: records.has(ref.path),
    data: () => structuredClone(records.get(ref.path)),
  })
  function collection(name, filters = []) {
    return {
      name, filters,
      doc(id = `auto${++sequence}`) {
        const ref = {
          id,
          path: `${name}/${id}`,
          parent: { id: name },
          get: async () => snapshot(ref),
          set: async (data, options) => { records.set(ref.path, structuredClone(options?.merge ? { ...records.get(ref.path), ...data } : data)) },
          update: async (data) => {
            if (!records.has(ref.path)) throw new Error(`Missing document: ${ref.path}`)
            records.set(ref.path, structuredClone({ ...records.get(ref.path), ...data }))
          },
          delete: async () => { records.delete(ref.path) },
        }
        return ref
      },
      where(field, op, value) { return collection(name, [...filters, [field, op, value]]) },
      limit() { return this },
      get() { return db.runTransaction(transaction => transaction.get(this)) },
    }
  }
  const db = {
    collection,
    getAll(...refs) { return Promise.all(refs.map(ref => ref.get())) },
    bulkWriter() {
      const writes = []
      return {
        set(ref, data) { writes.push(() => records.set(ref.path, structuredClone(data))) },
        delete(ref) { writes.push(() => records.delete(ref.path)) },
        async close() { writes.forEach(write => write()) },
      }
    },
    async runTransaction(handler) {
      const writes = []
      const transaction = {
        async get(ref) {
          if (writes.length) throw new Error('Transaction read after write')
          if (ref.path) return snapshot(ref)
          const docs = [...records.keys()]
            .filter(path => path.startsWith(`${ref.name}/`))
            .map(path => snapshot(collection(ref.name).doc(path.split('/')[1])))
            .filter(snap => ref.filters.every(([key, op, value]) => {
              const field = snap.data()[key]
              if (op === '==') return field === value
              if (op === '>=') return field >= value
              if (op === '<') return field < value
              if (op === '<=') return field <= value
              if (op === 'in') return value.includes(field)
              if (op === 'array-contains-any') return Array.isArray(field) && field.some(item => value.includes(item))
              throw new Error(`Unsupported query: ${op}`)
            }))
            .reverse() // 查詢未指定排序，不得假設流水回傳先後。
          return { docs, empty: !docs.length, size: docs.length }
        },
        getAll(...refs) { return Promise.all(refs.map(ref => this.get(ref))) },
        set(ref, data, options) { writes.push(() => records.set(ref.path, structuredClone(options?.merge ? { ...records.get(ref.path), ...data } : data))) },
        update(ref, data) {
          if (!records.has(ref.path)) throw new Error(`Missing document: ${ref.path}`)
          this.set(ref, data, { merge: true })
        },
        create(ref, data) {
          if (records.has(ref.path)) throw new Error(`Document already exists: ${ref.path}`)
          this.set(ref, data)
        },
        delete(ref) { writes.push(() => records.delete(ref.path)) },
      }
      const result = await handler(transaction)
      writes.forEach(write => write())
      return result
    },
  }
  const firestore = Object.assign(() => db, { FieldValue: { serverTimestamp: () => Date.now() }, Timestamp: { fromMillis: value => value, now: () => Date.now() } })
  const messaging = {
    async sendEachForMulticast(message) {
      pushes.push(structuredClone(message))
      return { successCount: message.tokens.length, responses: message.tokens.map(() => ({ success: true })) }
    },
  }
  const recordWebhook = async (url, init) => {
    webhookCalls.push({ url, body: JSON.parse(init.body) })
    return { ok: true, status: 200 }
  }
  const context = {
    exports: {}, Date, URL, process: { env }, AbortSignal, console,
    fetch: fetch || recordWebhook,
    require(name) {
      if (name === 'firebase-functions/v2/https') return { HttpsError, onCall: (...args) => args.at(-1) }
      if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (...args) => args.at(-1) }
      if (name === 'firebase-functions/v2/firestore') return { onDocumentWritten: (...args) => args.at(-1) }
      if (name === 'firebase-admin/messaging') return { getMessaging: () => messaging }
      if (name === 'firebase-functions/v2') return { setGlobalOptions() {} }
      if (name === 'firebase-admin') return { initializeApp() {}, firestore }
      if (name === 'firebase-admin/firestore') return { FieldValue: firestore.FieldValue, Timestamp: firestore.Timestamp }
      if (name === 'crypto') return crypto
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
  vm.runInNewContext(fs.readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8'), context)
  const call = (name, data, uid = 'admin', token = {}) => context.exports[name]({ auth: { uid, token }, data })
  const callAnonymous = (name, data) => context.exports[name]({ data })
  records.set('users/admin', { isAdmin: true, memberName: 'Admin' })
  for (const uid of ['member', 'proxy']) {
    records.set(`users/${uid}`, { isAdmin: false, memberName: uid })
    records.set(`wallets/${uid}`, { balance: 1000, ownerUid: uid, ownerName: uid })
  }
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  records.set('settings/daily', { serviceDate: date, activeStores: ['Store'], freeStores: [] })
  return {
    call, callAnonymous, records, webhookCalls, pushes, exports: context.exports,
    balance: () => records.get('wallets/member').balance,
    freeStore() { records.get('settings/daily').freeStores = ['Store'] },
    async order(overrides = {}, uid = 'member') {
      const result = await call('createOrdersWithWalletDebit', {
        requestId: `request${++sequence}`,
        items: [{ name: 'Meal', price: 100, ownerUid: 'member', ownerName: 'member', paymentMethod: 'wallet', storeName: 'Store', ...overrides }],
      }, uid)
      return result.orderIds[0]
    },
  }
}
