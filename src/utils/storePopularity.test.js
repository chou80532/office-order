import { describe, expect, it } from 'vitest'
import { buildStorePopularity } from './storePopularity'

const DAY = 86400000
const now = Date.UTC(2026, 8, 6)
const store = (name, category = 'lunch', createdAtTs = now - 100 * DAY) => ({ name, category, createdAtTs })
const orders = (name, count, days = 3) => Array.from({ length: count }, (_, i) => ({
  id: `${name}-${i}`, storeName: name, timestamp: now - (i % days) * DAY,
}))

describe('近期店家分類', () => {
  it('午餐與飲料各取前五名，其餘有訂單的列為常選', () => {
    const stores = [...Array.from({ length: 6 }, (_, i) => store(`午餐${i}`)), store('飲料', 'drink')]
    const result = buildStorePopularity(stores, [
      ...stores.flatMap((s, i) => orders(s.name, 10 - i)),
    ], now)
    for (let i = 0; i < 5; i++) expect(result.get(`午餐${i}`).group).toBe('popular')
    expect(result.get('午餐5').group).toBe('regular')
    expect(result.get('飲料').group).toBe('popular')
  })

  it('新店、少量訂購與單日訂購均可上榜，只有零紀錄列為探索', () => {
    const stores = [store('新店', 'lunch', now - DAY), store('零'), store('少'), store('單日')]
    const result = buildStorePopularity(stores, [...orders('新店', 30), ...orders('少', 4), ...orders('單日', 100, 1)], now)
    expect(result.get('零').group).toBe('explore')
    for (const name of ['新店', '少', '單日']) expect(result.get(name).group).toBe('popular')
  })

  it('排除區間外訂單、去除重複紀錄，免費餐點仍計入', () => {
    const result = buildStorePopularity([store('店家')], [
      { id: 'old', storeName: '店家', timestamp: now - 31 * DAY },
      { id: 'future', storeName: '店家', timestamp: now + DAY },
      { id: 'free', storeName: '店家', timestamp: now, isFree: true },
      { id: 'free', storeName: '店家', timestamp: now, isFree: true },
    ], now)
    expect(result.get('店家').count).toBe(1)
  })

  it('同分依店名固定排序，熱門不超過五家', () => {
    const stores = Array.from({ length: 7 }, (_, i) => store(`店家${i}`))
    const records = stores.flatMap(s => orders(s.name, 1))
    const result = buildStorePopularity(stores, records, now)
    expect([...result.values()].filter(s => s.group === 'popular')).toHaveLength(5)
    expect(buildStorePopularity([...stores].reverse(), records, now)).toEqual(result)
    expect(result.get('店家4').group).toBe('popular')
    expect(result.get('店家5').group).toBe('regular')
  })
})
