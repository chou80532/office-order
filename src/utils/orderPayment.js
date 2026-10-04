import { t } from '../i18n'

export const isCashOrder = order => order.paymentMethod === 'cash'
  || (!order.paymentMethod && !order.paid && !order.walletDebited)

export const orderPaymentStatus = order => {
  if (order.isFree) return t('common.status.free')
  // 「只統計不收款」的訂單沒有應付款項。
  if (order.paymentMethod === 'none') return t('common.payment.none')
  if (isCashOrder(order)) {
    if (order.cashStatus === 'cancelled') return t('common.status.cancelled')
    if (order.cashStatus === 'collected') return t('common.status.settled')
    if (order.cashStatus === 'pending') return t('common.status.pending')
    // 應收款編號僅代表已建帳，不代表收到現金。舊單則以 paid 作為已付款依據。
    return order.paid ? t('common.status.settled') : t('common.status.pending')
  }
  return order.paid || order.walletDebited ? t('common.status.settled') : t('common.status.pending')
}
