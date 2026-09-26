import { callFunction } from './callableFunctions'

export const previewTimeRangeCleanupViaFunction = async payload =>
  callFunction('previewTimeRangeCleanup', payload)

export const deleteTimeRangeDataViaFunction = async payload =>
  callFunction('deleteTimeRangeData', payload)

export const deleteUnlinkedOrdersViaFunction = async orderIds =>
  callFunction('deleteUnlinkedOrders', { orderIds })
