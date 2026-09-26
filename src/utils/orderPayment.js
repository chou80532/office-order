export const isCashOrder = order => order.paymentMethod === 'cash'
  || (!order.paymentMethod && !order.paid && !order.walletDebited)

export const orderPaymentStatus = order => {
  if (order.isFree) return '免費'
  if (isCashOrder(order)) {
    if (order.cashStatus === 'cancelled') return '已取消'
    if (order.cashStatus === 'collected') return '已結'
    if (order.cashStatus === 'pending') return '待結'
    // 應收款編號僅代表已建帳，不代表收到現金。舊單則以 paid 作為已付款依據。
    return order.paid ? '已結' : '待結'
  }
  return order.paid || order.walletDebited ? '已結' : '待結'
}
