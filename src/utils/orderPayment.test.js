import { describe, expect, it } from 'vitest'
import { orderPaymentStatus } from './orderPayment'

describe('CSV 付款狀態', () => {
  it.each([
    [{ paymentMethod: 'cash', cashPaymentId: 'payment', cashStatus: 'pending', paid: false }, '待結'],
    [{ paymentMethod: 'cash', cashStatus: 'pending', paid: true }, '待結'],
    [{ paymentMethod: 'cash', cashPaymentId: 'payment', cashStatus: 'collected', paid: true }, '已結'],
    [{ paymentMethod: 'cash', cashStatus: 'cancelled' }, '已取消'],
    [{ paymentMethod: 'cash', cashPaymentId: 'payment' }, '待結'],
    [{ paymentMethod: 'cash', paid: true }, '已結'],
    [{ paid: false }, '待結'],
    [{ paymentMethod: 'wallet', paid: true, walletDebited: true }, '已結'],
    [{ paymentMethod: 'wallet', paid: false }, '待結'],
    [{ paymentMethod: 'cash', isFree: true, cashStatus: 'pending' }, '免費'],
  ])('依實際收款狀態分類 %j', (order, expected) => {
    expect(orderPaymentStatus(order)).toBe(expected)
  })
})
