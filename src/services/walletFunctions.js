import { callFunction } from './callableFunctions'

export const createOrderRequestId = (uid) => {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`
  return `${uid || 'guest'}_${randomPart}`
}

export const createOrdersWithWalletDebitViaFunction = async ({
  items,
  fallbackName,
  actorName,
  selectedStoreName,
  formatItemNote,
  requestId,
  reorderNeedId,
}) => {
  const normalizedItems = (Array.isArray(items) ? items : []).map(item => ({
    ...item,
    note: String(typeof formatItemNote === 'function' ? formatItemNote(item) : item?.note || '').trim(),
  }))
  const result = await callFunction('createOrdersWithWalletDebit', {
    items: normalizedItems,
    fallbackName,
    actorName,
    selectedStoreName,
    requestId,
    reorderNeedId,
  })
  return result?.orderIds || []
}

export const cancelOrdersWithWalletRefundViaFunction = async payload =>
  callFunction('cancelOrdersWithWalletRefund', payload)

export const cancelDiningNeedViaFunction = async payload =>
  callFunction('cancelDiningNeed', payload)

export const setOrderFreeStatusWithWalletAdjustmentViaFunction = async payload =>
  callFunction('setOrderFreeStatusWithWalletAdjustment', payload)

export const updateOrderWithPaymentAdjustmentViaFunction = async payload =>
  callFunction('updateOrderWithPaymentAdjustment', payload)

export const addWalletCreditViaFunction = async payload =>
  callFunction('addWalletCredit', payload)

export const adjustWalletBalanceViaFunction = async payload =>
  callFunction('adjustWalletBalance', payload)
