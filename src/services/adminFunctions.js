import { callFunction } from './callableFunctions'

export const previewTimeRangeCleanupViaFunction = async payload =>
  callFunction('previewTimeRangeCleanup', payload)

export const deleteTimeRangeDataViaFunction = async payload =>
  callFunction('deleteTimeRangeData', payload)

export const deleteUnlinkedOrdersViaFunction = async orderIds =>
  callFunction('deleteUnlinkedOrders', { orderIds })

export const updateSystemSettingsViaFunction = async settings =>
  callFunction('updateSystemSettings', { settings })

export const setDailyCutoffViaFunction = async time =>
  callFunction('setDailyCutoff', { time })

export const grantMonthlyAllowanceViaFunction = async () =>
  callFunction('grantMonthlyAllowance', {})

export const updateNotificationSettingsViaFunction = async settings =>
  callFunction('updateNotificationSettings', { settings })

export const sendTestNotificationViaFunction = async () =>
  callFunction('sendTestNotification', {})
