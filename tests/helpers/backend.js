import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'

// 執行真正的 callable handler，僅替換 Firebase I/O；不連線任何專案。
export function createBackend() {
  const records = new Map()
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
        const ref = { id, path: `${name}/${id}`, parent: { id: name }, get: async () => snapshot(ref) }
        return ref
      },
      where(field, op, value) { return collection(name, [...filters, [field, op, value]]) },
      get() { return db.runTransaction(transaction => transaction.get(this)) },
    }
  }
  const db = {
    collection,
    getAll(...refs) { return Promise.all(refs.map(ref => ref.get())) },
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
        delete(ref) { writes.push(() => records.delete(ref.path)) },
      }
      const result = await handler(transaction)
      writes.forEach(write => write())
      return result
    },
  }
  const firestore = Object.assign(() => db, { FieldValue: { serverTimestamp: () => Date.now() }, Timestamp: { fromMillis: value => value } })
  const context = {
    exports: {}, Date,
    require(name) {
      if (name === 'firebase-functions/v2/https') return { HttpsError, onCall: (...args) => args.at(-1) }
      if (name === 'firebase-functions/v2') return { setGlobalOptions() {} }
      if (name === 'firebase-admin') return { initializeApp() {}, firestore }
      if (name === 'firebase-admin/firestore') return { FieldValue: firestore.FieldValue }
      if (name === 'crypto') return crypto
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
  vm.runInNewContext(fs.readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8'), context)
  const call = (name, data, uid = 'admin') => context.exports[name]({ auth: { uid, token: {} }, data })
  records.set('users/admin', { isAdmin: true, memberName: 'Admin' })
  for (const uid of ['member', 'proxy']) {
    records.set(`users/${uid}`, { isAdmin: false, memberName: uid })
    records.set(`wallets/${uid}`, { balance: 1000, ownerUid: uid, ownerName: uid })
  }
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  records.set('settings/daily', { serviceDate: date, activeStores: ['Store'], freeStores: [] })
  return {
    call, records,
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
