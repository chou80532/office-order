import { compareText } from './format'
import { t } from '../i18n'

const DAY_MS = 24 * 60 * 60 * 1000
export const STORE_POPULARITY_DAYS = 30
// 名稱與說明依介面語言即時取得。
const popularityGroup = id => ({
  id,
  get label() { return t(`data.popularity.${id}.label`) },
  get description() { return t(`data.popularity.${id}.description`) },
})
export const STORE_POPULARITY_GROUPS = ['popular', 'regular', 'explore'].map(popularityGroup)

// 每筆餐點訂單計一次；包含免費餐點，取消後刪除的訂單不會計入。
export function buildStorePopularity(stores, orders, now = Date.now()) {
  const stats = new Map(stores.map(store => [store.name, { count: 0 }]))
  const seen = new Set()
  for (const order of orders) {
    if (order.id && seen.has(order.id)) continue
    if (order.id) seen.add(order.id)
    const timestamp = Number(order.timestamp)
    const stat = stats.get(String(order.storeName || '').trim())
    if (!stat || !Number.isFinite(timestamp) || timestamp < now - STORE_POPULARITY_DAYS * DAY_MS || timestamp > now) continue
    stat.count += 1
  }
  const result = new Map()
  for (const category of ['lunch', 'drink']) {
    const categoryStores = stores.filter(store => (store.category === 'drink' ? 'drink' : 'lunch') === category)
    // 同分時按店名排序，讓前五名固定且不受傳入順序影響。
    const ranked = categoryStores.filter(store => stats.get(store.name).count > 0)
      .sort((a, b) => stats.get(b.name).count - stats.get(a.name).count || compareText(a.name, b.name))
    const popularNames = new Set(ranked.slice(0, 5).map(store => store.name))
    for (const store of categoryStores) {
      const count = stats.get(store.name).count
      const group = count === 0 ? 'explore' : popularNames.has(store.name) ? 'popular' : 'regular'
      result.set(store.name, { count, group })
    }
  }
  return result
}
