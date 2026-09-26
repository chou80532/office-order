import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from './helpers/backend'

describe('免費、收費與退款的帳務流程', () => {
  let backend
  const free = (id, isFree) => backend.call('setOrderFreeStatusWithWalletAdjustment', { orderId: id, isFree })
  const cancel = (id, uid = 'member') => backend.call('cancelOrdersWithWalletRefund', { orderIds: [id] }, uid)
  const edit = (id, price) => backend.call('updateOrderWithPaymentAdjustment', { orderId: id, meal: 'Meal', price })
  beforeEach(() => {
    // 同毫秒流水也必須正確，不可只依 timestamp 判斷最後一次扣退款。
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T04:00:00Z'))
    backend = createBackend()
  })
  afterEach(() => vi.useRealTimers())

  it('收費 → 免費 → 收費 → 刪除，完整退回最後一次扣款', async () => {
    const id = await backend.order()
    expect(backend.balance()).toBe(900)
    await free(id, true)
    expect(backend.balance()).toBe(1000)
    await free(id, false)
    expect(backend.balance()).toBe(900)
    await cancel(id)
    expect(backend.balance()).toBe(1000)
    await expect(cancel(id)).rejects.toThrow('ORDER_NOT_FOUND')
    expect(backend.balance()).toBe(1000)
  })

  it('恢復收費後加價、降價及取消均按實際金額處理', async () => {
    const id = await backend.order()
    await free(id, true)
    await free(id, false)
    await edit(id, 150)
    expect(backend.balance()).toBe(850)
    await edit(id, 80)
    expect(backend.balance()).toBe(920)
    await cancel(id)
    expect(backend.balance()).toBe(1000)
  })

  it('免費期間改價，恢復收費扣新價格，反覆切換不重複扣退', async () => {
    const id = await backend.order()
    await free(id, true)
    await edit(id, 150)
    expect(backend.balance()).toBe(1000)
    for (let i = 0; i < 3; i++) {
      await free(id, false)
      await free(id, false)
      expect(backend.balance()).toBe(850)
      await free(id, true)
      await free(id, true)
      expect(backend.balance()).toBe(1000)
    }
    await cancel(id)
    expect(backend.balance()).toBe(1000)
  })

  it('原本免費的錢包單改收費會扣款、更新付款狀態且可退款', async () => {
    backend.freeStore()
    const id = await backend.order()
    expect(backend.balance()).toBe(1000)
    await free(id, false)
    expect(backend.balance()).toBe(900)
    expect(backend.records.get(`orders/${id}`)).toMatchObject({ isFree: false, walletDebited: true, walletAmount: 100, paidByWallet: true })
    await cancel(id)
    expect(backend.balance()).toBe(1000)
  })

  it('原本免費的單改收費若餘額不足，整筆交易不生效', async () => {
    backend.freeStore()
    const id = await backend.order()
    backend.records.get('wallets/member').balance = 50
    const before = structuredClone([...backend.records])
    await expect(free(id, false)).rejects.toThrow('INSUFFICIENT_WALLET_BALANCE')
    expect([...backend.records]).toEqual(before)
  })

  it.each([false, true])('管理員切換免費不剝奪原代訂人的取消權限（原本免費：%s）', async initiallyFree => {
    if (initiallyFree) backend.freeStore()
    const id = await backend.order({}, 'proxy')
    if (!initiallyFree) await free(id, true)
    await free(id, false)
    await cancel(id, 'proxy')
    expect(backend.balance()).toBe(1000)
  })

  it('同一批多筆訂單中僅切換一筆免費，退款不影響其他訂單', async () => {
    const { orderIds } = await backend.call('createOrdersWithWalletDebit', {
      requestId: 'batch', items: [100, 200].map(price => ({ name: 'Meal', price, ownerUid: 'member', ownerName: 'member', paymentMethod: 'wallet', storeName: 'Store' })),
    }, 'member')
    await free(orderIds[0], true)
    await free(orderIds[0], false)
    await cancel(orderIds[0])
    expect(backend.balance()).toBe(800)
    await cancel(orderIds[1])
    expect(backend.balance()).toBe(1000)
  })

  it('原本免費的現金單改收費會建立應收，並可取消', async () => {
    backend.freeStore()
    const id = await backend.order({ ownerUid: '', ownerName: 'Guest', paymentMethod: 'cash' })
    await free(id, false)
    const order = backend.records.get(`orders/${id}`)
    expect(order).toMatchObject({ isFree: false, paid: false, cashStatus: 'pending' })
    const paymentPath = `cash_payments/${order.cashPaymentId}`
    expect(backend.records.get(paymentPath)).toMatchObject({ amount: 100, remainingAmount: 100, status: 'pending' })
    await free(id, true)
    await free(id, false)
    expect(backend.records.get(paymentPath)).toMatchObject({ amount: 100, remainingAmount: 100 })
    await cancel(id)
    expect(backend.records.get(paymentPath)).toMatchObject({ remainingAmount: 0, status: 'cancelled' })
    expect(backend.balance()).toBe(1000)
  })
})
