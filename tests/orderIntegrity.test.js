import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from './helpers/backend'

describe('訂單資料完整性回歸', () => {
  let backend
  const edit = (id, price, meal = 'Meal', uid = 'admin') => backend.call('updateOrderWithPaymentAdjustment', { orderId: id, price, meal, note: '新版備註' }, uid)
  const free = (id, isFree) => backend.call('setOrderFreeStatusWithWalletAdjustment', { orderId: id, isFree })
  const cancel = id => backend.call('cancelOrdersWithWalletRefund', { orderIds: [id] }, 'member')
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T04:00:00Z'))
    backend = createBackend()
  })
  afterEach(() => vi.useRealTimers())

  it('現金單降價後取消，不留下幽靈應收款', async () => {
    const id = await backend.order({ paymentMethod: 'cash', ownerUid: '', ownerName: 'Guest' })
    const paymentId = backend.records.get(`orders/${id}`).cashPaymentId
    await edit(id, 80)
    await cancel(id)
    expect(backend.records.get(`cash_payments/${paymentId}`)).toMatchObject({ amount: 0, remainingAmount: 0, status: 'cancelled', orderIds: [] })
  })

  it.each([80, 150])('現金單免費期間改為 %s 元，恢復收費後按新價編輯及取消', async price => {
    const id = await backend.order({ paymentMethod: 'cash', ownerUid: '', ownerName: 'Guest' })
    const paymentId = backend.records.get(`orders/${id}`).cashPaymentId
    await free(id, true)
    await edit(id, price)
    await free(id, false)
    expect(backend.records.get(`cash_payments/${paymentId}`)).toMatchObject({ amount: price, remainingAmount: price, items: [expect.objectContaining({ price })] })
    await edit(id, price + 10)
    expect(backend.records.get(`cash_payments/${paymentId}`).amount).toBe(price + 10)
    await cancel(id)
    expect(backend.records.get(`cash_payments/${paymentId}`)).toMatchObject({ amount: 0, remainingAmount: 0, status: 'cancelled' })
  })

  it('免費取消僅移除該筆，不扣掉同一應收款其他人的餐點金額', async () => {
    const items = [100, 200].map(price => ({ name: 'Meal', price, paymentMethod: 'cash', ownerUid: '', ownerName: 'Guest', storeName: 'Store' }))
    const { orderIds } = await backend.call('createOrdersWithWalletDebit', { requestId: 'cash-batch', items }, 'member')
    const paymentId = backend.records.get(`orders/${orderIds[0]}`).cashPaymentId
    await free(orderIds[0], true)
    await edit(orderIds[0], 80)
    await cancel(orderIds[0])
    expect(backend.records.get(`cash_payments/${paymentId}`)).toMatchObject({ amount: 200, remainingAmount: 200, orderIds: [orderIds[1]] })
  })

  it('編輯舊訂單保留原點餐日期，另記編輯時間', async () => {
    const id = await backend.order()
    const original = backend.records.get(`orders/${id}`).timestamp
    vi.setSystemTime(new Date('2026-09-07T04:00:00Z'))
    await edit(id, 120)
    expect(backend.records.get(`orders/${id}`)).toMatchObject({ timestamp: original, editedAtTimestamp: Date.now() })
  })

  it('等價改餐後，會員仍可修改備註，不被旧扣款快照阻擋', async () => {
    const id = await backend.order()
    await edit(id, 100, '新餐點')
    await expect(edit(id, 100, '新餐點', 'member')).resolves.toEqual({ ok: true })
    expect(backend.balance()).toBe(900)
  })

  it('免費期間改價後，會員可繼續修改備註', async () => {
    const id = await backend.order()
    await free(id, true)
    await edit(id, 150)
    await expect(edit(id, 150, 'Meal', 'member')).resolves.toEqual({ ok: true })
    expect(backend.balance()).toBe(1000)
  })

  it('未完成邀請註冊的 Auth 帳號不能代訂扣別人的錢包', async () => {
    const before = structuredClone([...backend.records])
    await expect(backend.order({}, 'unregistered')).rejects.toThrow('需要已註冊使用者權限')
    expect([...backend.records]).toEqual(before)
  })

  it('相同送單 requestId 重試不重複扣款或建單', async () => {
    const payload = { requestId: 'retry', items: [{ name: 'Meal', price: 100, ownerUid: 'member', ownerName: 'member', paymentMethod: 'wallet', storeName: 'Store' }] }
    const first = await backend.call('createOrdersWithWalletDebit', payload, 'member')
    const second = await backend.call('createOrdersWithWalletDebit', payload, 'member')
    expect(second).toMatchObject({ orderIds: first.orderIds, duplicate: true })
    expect(backend.balance()).toBe(900)
  })

  it('前次代訂已成功，即使對象帳號後來移除，重試仍回傳原訂單', async () => {
    const payload = { requestId: 'retry-after-removal', items: [{ name: 'Meal', price: 100, ownerUid: 'member', ownerName: 'member', paymentMethod: 'wallet', storeName: 'Store' }] }
    const first = await backend.call('createOrdersWithWalletDebit', payload, 'proxy')
    backend.records.delete('users/member')
    const before = structuredClone([...backend.records])
    const retry = await backend.call('createOrdersWithWalletDebit', payload, 'proxy')
    expect(retry).toMatchObject({ duplicate: true, orderIds: first.orderIds })
    expect([...backend.records]).toEqual(before)
  })

  it('正在刪除的會員不能再被新單扣款', async () => {
    backend.records.get('users/member').accountDeletionPending = true
    const before = structuredClone([...backend.records])
    await expect(backend.order({}, 'proxy')).rejects.toThrow('OWNER_NOT_FOUND')
    expect([...backend.records]).toEqual(before)
  })
})
