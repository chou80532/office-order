import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { fetchOrdersInRange } from '../src/services/orderHistory'
import { useOrderHistory } from '../src/composables/useOrderHistory'
import { getTaipeiDateRangeBounds } from '../src/utils/format'

const state = vi.hoisted(() => ({ rows: [], calls: [], failPage: 0, hold: false, pending: [] }))
vi.mock('../src/firestore', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ name }),
  where: (field, op, value) => ({ kind: 'where', field, op, value }),
  orderBy: (field, direction) => ({ kind: 'order', field, direction }),
  limit: size => ({ kind: 'limit', size }),
  startAfter: cursor => ({ kind: 'cursor', cursor }),
  query: (source, ...constraints) => ({ source, constraints }),
  async getDocsFromServer(query) {
    state.calls.push(query)
    if (state.calls.length === state.failPage) throw new Error('unavailable')
    const { constraints } = query
    let rows = state.rows.filter(row => constraints.filter(c => c.kind === 'where').every(c =>
      c.op === '>=' ? row[c.field] >= c.value : row[c.field] < c.value
    )).sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))
    const cursor = constraints.find(c => c.kind === 'cursor')?.cursor
    if (cursor) rows = rows.slice(rows.findIndex(row => row.id === cursor.id) + 1)
    const docs = rows.slice(0, constraints.find(c => c.kind === 'limit').size)
      .map(row => ({ id: row.id, data: () => ({ ...row }) }))
    const snapshot = { docs, size: docs.length }
    if (state.hold) return new Promise(resolve => state.pending.push(() => resolve(snapshot)))
    return snapshot
  },
}))

const september = getTaipeiDateRangeBounds('2026-09-01', '2026-09-05')
const rows = (count, timestamp = september.startMs) => Array.from({ length: count }, (_, i) => ({
  id: `order-${i}`, timestamp, price: 100, name: 'Member', meal: 'Meal', storeName: 'Store',
}))
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
let scope
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-06T04:00:00Z'))
  Object.assign(state, { rows: [], calls: [], failPage: 0, hold: false, pending: [] })
  scope = effectScope()
})
afterEach(() => { scope.stop(); vi.useRealTimers() })

describe('所選區間的完整歷史資料', () => {
  it('超過 200 筆自動讀完，跨頁相同時間戳也不漏單', async () => {
    state.rows = [...rows(451), { id: 'before', timestamp: september.startMs - 1 }, { id: 'after', timestamp: september.endMs }]
    const result = await fetchOrdersInRange(september.startMs, september.endMs)
    expect(result).toHaveLength(451)
    expect(new Set(result.map(row => row.id)).size).toBe(451)
    expect(result.reduce((sum, row) => sum + row.price, 0)).toBe(45100)
    expect(state.calls).toHaveLength(3)
  })

  it('恰好整頁時繼續確認下一頁，而非猜測資料已齊', async () => {
    state.rows = rows(400)
    expect(await fetchOrdersInRange(september.startMs, september.endMs)).toHaveLength(400)
    expect(state.calls).toHaveLength(3)
  })

  it('第二頁失敗不可回傳第一頁作為完整資料', async () => {
    state.rows = rows(300)
    state.failPage = 2
    await expect(fetchOrdersInRange(september.startMs, september.endMs)).rejects.toThrow('unavailable')
  })

  it('無效或倒置日期在查詢前拒絕', async () => {
    await expect(fetchOrdersInRange(NaN, september.endMs)).rejects.toThrow('有效')
    await expect(fetchOrdersInRange(september.endMs, september.startMs)).rejects.toThrow('有效')
    expect(state.calls).toHaveLength(0)
  })

  it('中途失敗不顯示不完整 KPI／匯出，重試成功才開放', async () => {
    state.rows = rows(300)
    state.failPage = 2
    const history = scope.run(() => useOrderHistory(ref('2026-09-01'), ref('2026-09-05')))
    await flush()
    expect(history.ready.value).toBe(false)
    expect(history.error.value).toContain('未能完整載入')
    expect(history.orders.value).toEqual([])
    state.failPage = 0
    await history.reload()
    expect(history.ready.value).toBe(true)
    expect(history.orders.value).toHaveLength(300)
  })

  it('切換較早日期會重新查詢，舊請求晚回來不能覆蓋新範圍', async () => {
    const august = getTaipeiDateRangeBounds('2026-08-01', '2026-08-31')
    state.rows = [...rows(250), { id: 'august', timestamp: august.startMs, price: 80 }]
    state.hold = true
    const from = ref('2026-09-01')
    const to = ref('2026-09-05')
    const history = scope.run(() => useOrderHistory(from, to))
    from.value = '2026-08-01'
    to.value = '2026-08-31'
    expect(history.ready.value).toBe(false)
    state.pending[2]()
    await flush()
    expect(history.orders.value.map(row => row.id)).toEqual(['august'])
    state.pending[0]()
    state.pending[1]()
    await flush()
    expect(history.orders.value.map(row => row.id)).toEqual(['august'])
    expect(state.calls).toHaveLength(3)
  })

  it('離開畫面後不再讀取下一頁，也不套用過期結果', async () => {
    state.rows = rows(300)
    state.hold = true
    const history = scope.run(() => useOrderHistory(ref('2026-09-01'), ref('2026-09-05')))
    scope.stop()
    state.pending[0]()
    await flush()
    expect(state.calls).toHaveLength(1)
    expect(history.ready.value).toBe(false)
  })
})
