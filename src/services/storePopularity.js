import { fetchOrdersInRange } from './orderHistory'
import { STORE_POPULARITY_DAYS } from '../utils/storePopularity'

const CACHE_TTL_MS = 5 * 60 * 1000
let cache = null

export function getCachedStorePopularity(uid, now = Date.now()) {
  if (!uid || cache?.uid !== uid || !cache.data) return null
  const age = now - cache.data.now
  return age >= 0 && age < CACHE_TTL_MS ? cache.data : null
}

// 首頁預載與面板共用同一請求；僅在記憶體保留分類所需欄位。
export function loadStorePopularity(uid) {
  if (!uid) return Promise.reject(new Error('尚未登入'))
  const cached = getCachedStorePopularity(uid)
  if (cached) return Promise.resolve(cached)
  if (cache?.uid !== uid) cache = { uid, data: null, pending: null }
  const entry = cache
  if (entry.pending) return entry.pending
  const now = Date.now()
  entry.pending = fetchOrdersInRange(now - STORE_POPULARITY_DAYS * 86400000, now + 1)
    .then(orders => {
      entry.data = {
        now,
        orders: orders.map(({ id, storeName, timestamp }) => ({ id, storeName, timestamp })),
      }
      return entry.data
    })
    .finally(() => { entry.pending = null })
  return entry.pending
}
