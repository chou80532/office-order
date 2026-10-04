import { callFunction } from './callableFunctions'

export const completeInviteRegistrationViaFunction = async inviteCode =>
  callFunction('completeInviteRegistration', { inviteCode })

export const deleteUserAccountViaFunction = async uid =>
  callFunction('deleteUserAccount', { uid })

export const setUserAdminStatusViaFunction = async (uid, isAdmin) =>
  callFunction('setUserAdminStatus', { uid, isAdmin })

export const rebuildMemberRosterViaFunction = async () =>
  callFunction('rebuildMemberRoster', {})

export const getSetupStatusViaFunction = async () =>
  callFunction('getSetupStatus', {})

export const completeFirstAdminSetupViaFunction = async ({ setupToken, memberName, settings }) =>
  callFunction('completeFirstAdminSetup', { setupToken, memberName, settings })

export const getPublicConfigViaFunction = async () =>
  callFunction('getPublicConfig', {})

export const completeDomainRegistrationViaFunction = async memberName =>
  callFunction('completeDomainRegistration', { memberName })

export const updateMyPreferencesViaFunction = async preferences =>
  callFunction('updateMyPreferences', preferences)

export const registerPushTokenViaFunction = async token =>
  callFunction('registerPushToken', { token })

export const unregisterPushTokenViaFunction = async token =>
  callFunction('unregisterPushToken', { token })
