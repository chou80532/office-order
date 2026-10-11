import { beforeEach, expect, it } from 'vitest'
import { createBackend } from './helpers/backend'

let backend
const preferences = dietary => backend.call('updateMyPreferences', { dietary }, 'member')
beforeEach(() => {
  backend = createBackend()
  backend.records.set('settings/system', { dietary: { enabled: true, tags: ['Vegan', 'Milk'] } })
})

it('stores preferences only on the caller profile and preserves proxy consent and roster', async () => {
  await backend.call('updateMyPreferences', { allowProxyOrders: true }, 'member')
  const roster = structuredClone(backend.records.get('member_roster/member'))
  await preferences({ preferredTags: ['Vegan'], avoidedTags: ['Milk'] })
  expect(backend.records.get('users/member')).toMatchObject({
    allowProxyOrders: true, dietary: { preferredTags: ['Vegan'], avoidedTags: ['Milk'] },
  })
  expect(backend.records.get('users/proxy').dietary).toBeUndefined()
  expect(backend.records.get('member_roster/member')).toEqual(roster)
  await backend.call('updateMyPreferences', { allowProxyOrders: false }, 'member')
  expect(backend.records.get('users/member').dietary.preferredTags).toEqual(['Vegan'])
  await preferences({ preferredTags: [], avoidedTags: [] })
  expect(backend.records.get('users/member').dietary).toEqual({ preferredTags: [], avoidedTags: [] })
})

it.each([
  { preferredTags: ['Unknown'], avoidedTags: [] },
  { preferredTags: ['Milk'], avoidedTags: ['Milk'] },
  { preferredTags: 'Vegan', avoidedTags: [] },
  { preferredTags: [], avoidedTags: ['x'.repeat(25)] },
  { preferredTags: Array(31).fill('Vegan'), avoidedTags: [] },
])('rejects invalid preferences atomically: %j', async dietary => {
  await expect(preferences(dietary)).rejects.toThrow('INVALID_PREFERENCES')
  expect(backend.records.get('users/member').dietary).toBeUndefined()
})

it('rejects saving when disabled, and rejects unregistered callers', async () => {
  backend.records.set('settings/system', { dietary: { enabled: false, tags: ['Vegan'] } })
  await expect(preferences({ preferredTags: ['Vegan'], avoidedTags: [] })).rejects.toThrow('INVALID_PREFERENCES')
  await expect(backend.call('updateMyPreferences', { allowProxyOrders: true }, 'unknown')).rejects.toThrow('需要已註冊使用者權限')
})

it('restricts catalog changes to admins, validates limits, and preserves settings on other updates', async () => {
  const update = (dietary, uid = 'admin') => backend.call('updateSystemSettings', { settings: { dietary } }, uid)
  await expect(update({ tags: ['Spicy'] }, 'member')).rejects.toThrow('需要管理員權限')
  await expect(update({ tags: ['x'.repeat(25)] })).rejects.toThrow('INVALID_DIETARY_SETTINGS')
  await expect(update({ enabled: 'true' })).rejects.toThrow('INVALID_DIETARY_SETTINGS')
  await update({ tags: ['Vegan', ' Spicy ', 'Vegan'] })
  await backend.call('updateSystemSettings', { settings: { ordering: { defaultCutoff: '11:00' } } }, 'admin')
  expect(backend.records.get('settings/system').dietary).toEqual({ enabled: true, tags: ['Vegan', 'Spicy'] })
})
