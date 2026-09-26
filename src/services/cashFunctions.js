import { callFunction } from './callableFunctions'

export const getCashPaymentAdminDataViaFunction = async (range = {}) =>
  callFunction('getCashPaymentAdminData', range)

export const createMissingCashPaymentViaFunction = async payload => {
  const result = await callFunction('createMissingCashPayment', payload)
  return result?.cashPaymentId || ''
}

export const markCashPaymentCollectedViaFunction = async payload =>
  callFunction('markCashPaymentCollected', payload)

export const cancelCashPaymentViaFunction = async payload =>
  callFunction('cancelCashPayment', payload)
