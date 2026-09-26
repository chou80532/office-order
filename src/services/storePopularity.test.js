import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./orderHistory', () => ({ fetchOrdersInRange: vi.fn() }))

let fetchOrdersInRange
let getCachedStorePopularity
let loadStorePopularity

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))
  ;({ fetchOrdersInRange } = await import('./orderHistory'))
  fetchOrdersInRange.mockReset()
  ;({ getCachedStorePopularity, loadStorePopularity } = await import('./storePopularity'))
})
afterEach(() => vi.useRealTimers())

describe('店家分類預載快取', () => {
  it('預載與打開面板共用一個請求，快取不保留個人訂單欄位', async () => {
    let resolve
    fetchOrdersInRange.mockReturnValue(new Promise(done => { resolve = done }))
    const preload = loadStorePopularity('user-a')
    const panel = loadStorePopularity('user-a')
    expect(panel).toBe(preload)
    expect(fetchOrdersInRange).toHaveBeenCalledTimes(1)
    expect(getCachedStorePopularity('user-a')).toBeNull()
    resolve([{ id: '1', storeName: '店家', timestamp: Date.now(), name: '姓名', note: '備註' }])
    const result = await panel
    expect(result.orders).toEqual([{ id: '1', storeName: '店家', timestamp: Date.now() }])
    expect(getCachedStorePopularity('user-a')).toBe(result)
    await loadStorePopularity('user-a')
    expect(fetchOrdersInRange).toHaveBeenCalledTimes(1)
  })

  it('5 分鐘後重新讀取，失敗時不快取且允許重試', async () => {
    fetchOrdersInRange.mockResolvedValue([])
    await loadStorePopularity('user-a')
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(getCachedStorePopularity('user-a')).toBeNull()
    fetchOrdersInRange.mockRejectedValueOnce(new Error('offline'))
    await expect(loadStorePopularity('user-a')).rejects.toThrow('offline')
    expect(getCachedStorePopularity('user-a')).toBeNull()
    await loadStorePopularity('user-a')
    expect(fetchOrdersInRange).toHaveBeenCalledTimes(3)
  })

  it('切換帳號不共用快取，舊請求完成也不覆蓋新帳號結果', async () => {
    let resolveOld
    fetchOrdersInRange.mockReturnValueOnce(new Promise(done => { resolveOld = done }))
    const oldRequest = loadStorePopularity('user-a')
    fetchOrdersInRange.mockResolvedValueOnce([])
    const current = await loadStorePopularity('user-b')
    resolveOld([{ storeName: '舊資料', timestamp: Date.now() }])
    await oldRequest
    expect(getCachedStorePopularity('user-a')).toBeNull()
    expect(getCachedStorePopularity('user-b')).toBe(current)
    expect(getCachedStorePopularity('')).toBeNull()
  })
})
