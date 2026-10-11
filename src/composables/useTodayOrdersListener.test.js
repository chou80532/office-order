import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getTodayBounds, setAppTimeZone } from '../utils/format'

const subscriptions = vi.hoisted(() => [])
vi.mock('vue', async importOriginal => ({ ...await importOriginal(), provide: vi.fn() }))
vi.mock('../firestore', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: (_db, path) => ({ path }),
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  where: (...args) => args,
  orderBy: (...args) => args,
  query: (ref, ...constraints) => ({ ...ref, constraints }),
  onSnapshot: (ref, ...handlers) => {
    const unsubscribe = vi.fn()
    const callbacks = handlers.filter(value => typeof value === 'function')
    subscriptions.push({ ...ref, callback: callbacks[0], error: callbacks[1], unsubscribe })
    return unsubscribe
  },
}))
import { createFirestore } from './useFirestore'

let state
beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-11T04:00:00Z'))
  vi.stubGlobal('window', { setTimeout })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  state = createFirestore()
  await state.startListeners()
})
afterEach(() => {
  state?.stopListeners()
  setAppTimeZone('Asia/Taipei')
  subscriptions.length = 0
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const orders = () => subscriptions.filter(item => item.path === 'orders')
const updateTimeZone = timeZone => subscriptions.find(item => item.path === 'settings/system').callback({
  exists: () => true, data: () => ({ timeZone }),
})

it('時區改變且日期相同時，今日訂單查詢仍更新日界', () => {
  const original = orders()[0]
  updateTimeZone('Asia/Tokyo')
  expect(original.unsubscribe).toHaveBeenCalledOnce()
  expect(orders()).toHaveLength(2)
  const { startMs, endMs } = getTodayBounds()
  expect(orders()[1].constraints).toEqual([
    ['timestamp', '>=', startMs], ['timestamp', '<', endMs], ['timestamp', 'desc'],
  ])
  expect(startMs).toBe(Date.parse('2026-10-10T15:00:00Z'))

  // 同一時區的重複快照或視窗恢復焦點不重開查詢。
  updateTimeZone('Asia/Tokyo')
  state.refreshTodayOrdersListener()
  expect(orders()).toHaveLength(2)
})

it('跨日後更新今日訂單及用餐名單，停止後不再建立監聽', () => {
  vi.setSystemTime(new Date('2026-10-11T16:01:00Z'))
  state.refreshTodayOrdersListener()
  expect(orders()).toHaveLength(2)
  expect(orders()[0].unsubscribe).toHaveBeenCalledOnce()
  expect(subscriptions.some(item => item.path === 'dining_days/2026-10-12')).toBe(true)
  state.stopListeners()
  state.refreshTodayOrdersListener()
  expect(orders()).toHaveLength(2)
})
