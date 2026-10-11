import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mountComponent } from './helpers/mountComponent'
import PersonalSettingsModal from '../src/components/layout/PersonalSettingsModal.vue'

const mocks = vi.hoisted(() => ({ preferences: null, save: vi.fn(), toast: vi.fn() }))
vi.mock('../src/composables/useAuth', () => ({ useAuth: () => ({ allowProxyOrders: ref(false), dietaryPreferences: mocks.preferences, updatePreferences: mocks.save }) }))
vi.mock('../src/composables/useFirestore', () => ({ useFirestore: () => ({ systemSettings: ref({ dietary: { enabled: true, tags: ['Vegan', 'Milk'] } }) }) }))
vi.mock('../src/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.toast }) }))
vi.mock('../src/composables/useModalA11y', () => ({ useModalA11y: () => {} }))
vi.mock('../src/services/push', () => ({ pushAvailable: () => false, pushEnabledOnDevice: () => false }))
let mounted
afterEach(() => mounted?.unmount())

it('keeps required and avoided labels mutually exclusive and sends only the dietary patch', async () => {
  mocks.preferences = ref({ preferredTags: ['Vegan'], avoidedTags: ['Milk'] })
  mocks.save.mockReset().mockResolvedValue({ ok: true })
  mounted = mountComponent(PersonalSettingsModal)
  mounted.state.toggleDietary('preferredTags', 'Milk', true)
  expect(mounted.state.dietaryDraft.avoidedTags).toEqual([])
  await mounted.state.saveDietary()
  expect(mocks.save).toHaveBeenCalledWith({ dietary: { preferredTags: ['Vegan', 'Milk'], avoidedTags: [] } })
  expect(mocks.preferences.value.avoidedTags).toEqual(['Milk'])
})

it('loads late profile preferences and allows removing a label retired by the admin', async () => {
  mocks.preferences = ref({ preferredTags: [], avoidedTags: [] })
  mounted = mountComponent(PersonalSettingsModal)
  mocks.preferences.value = { preferredTags: ['Retired'], avoidedTags: ['Milk'] }
  await nextTick()
  expect(mounted.state.dietaryCatalog).toContain('Retired')
  mounted.state.toggleDietary('preferredTags', 'Retired', false)
  expect(mounted.state.dietaryDraft.preferredTags).toEqual([])
})
