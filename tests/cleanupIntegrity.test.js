import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from './helpers/backend'

describe('清理資料的帳務完整性', () => {
  let backend
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T04:00:00Z'))
    backend = createBackend()
  })
  afterEach(() => vi.useRealTimers())
  const clean = (from, to) => backend.call('deleteTimeRangeData', { from, to, confirmation: '刪除選取區間資料' })

  it('完整清理後再次操作，不會再次調整錢包', async () => {
    const id = await backend.order()
    const now = Date.now()
    expect(backend.balance()).toBe(900)
    await clean(now - 1, now + 10)
    expect(backend.balance()).toBe(1000)
    expect(backend.records.has(`orders/${id}`)).toBe(false)
    expect((await clean(now - 1, now + 10)).documentCount).toBe(0)
    expect(backend.balance()).toBe(1000)
  })

  it('時間區間切開同批多筆訂單時，整筆拒絕，避免保留沒有流水的訂單', async () => {
    await backend.call('createOrdersWithWalletDebit', {
      requestId: 'batch', items: [100, 200].map(price => ({ name: 'Meal', price, ownerUid: 'member', ownerName: 'member', paymentMethod: 'wallet', storeName: 'Store' })),
    }, 'member')
    const before = structuredClone([...backend.records])
    await expect(clean(Date.now() - 1, Date.now())).rejects.toThrow('清理區間未涵蓋關聯訂單')
    expect([...backend.records]).toEqual(before)
  })

  it('只選到後一天的改價流水時，不清掉前一天仍存在的訂單帳務依據', async () => {
    const id = await backend.order()
    vi.setSystemTime(new Date('2026-09-07T04:00:00Z'))
    await backend.call('updateOrderWithPaymentAdjustment', { orderId: id, meal: 'Meal', price: 150 })
    const before = structuredClone([...backend.records])
    await expect(clean(Date.now() - 1, Date.now() + 1)).rejects.toThrow('清理區間未涵蓋關聯訂單')
    expect([...backend.records]).toEqual(before)
  })
})
