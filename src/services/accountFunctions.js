import { callFunction } from './callableFunctions'

export const completeInviteRegistrationViaFunction = async inviteCode =>
  callFunction('completeInviteRegistration', { inviteCode })

export const deleteUserAccountViaFunction = async uid =>
  callFunction('deleteUserAccount', { uid })

export const setUserAdminStatusViaFunction = async (uid, isAdmin) =>
  callFunction('setUserAdminStatus', { uid, isAdmin })

export const rebuildMemberRosterViaFunction = async () =>
  callFunction('rebuildMemberRoster', {})
