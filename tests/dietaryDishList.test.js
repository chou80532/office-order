import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mountComponent } from './helpers/mountComponent'
import DishList from '../src/components/order/DishList.vue'
import { readFileSync } from 'node:fs'
import { mountComponent as mountRendered } from './helpers/componentRenderer'
import { t } from '../src/i18n'

const mocks = vi.hoisted(() => ({ settings: null, preferences: null }))
vi.mock('../src/composables/useFirestore', () => ({ useFirestore: () => ({ systemSettings: mocks.settings }) }))
vi.mock('../src/composables/useAuth', () => ({ useAuth: () => ({ dietaryPreferences: mocks.preferences }) }))
let mounted
const items = [
  { name: 'Meal (S)', price: 100, tags: ['Vegan'] },
  { name: 'Meal (L)', price: 120, tags: ['Milk'] },
  { name: 'Unknown', price: 100 },
]
beforeEach(() => {
  mocks.settings = ref({ dietary: { enabled: true, tags: ['Vegan', 'Milk'] } })
  mocks.preferences = ref({ preferredTags: ['Vegan'], avoidedTags: ['Milk'] })
})
afterEach(() => mounted?.unmount())

it('filters individual variants before grouping and emits only a matching variant', async () => {
  const onAdd = vi.fn()
  mounted = mountComponent(DishList, { store: { name: 'Example', menuItems: items }, onAdd })
  expect(mounted.state.filteredMainItems.map(item => item.name)).toEqual(['Meal (S)'])
  expect(mounted.state.filteredMainItems[0]._variants).toBeUndefined()
  mounted.state.onCardClick(mounted.state.filteredMainItems[0])
  expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Meal (S)', tags: ['Vegan'] })
  mounted.state.filterDietary = false
  await nextTick()
  expect(mounted.state.filteredMainItems).toHaveLength(2)
  expect(mounted.state.filteredMainItems[0]._variants).toHaveLength(2)
})

it('renders the filter toggle and updates cards through its real change event', async () => {
  mounted = mountRendered(DishList, { store: { name: 'Example', menuItems: items } },
    readFileSync(new URL('../src/components/order/DishList.vue', import.meta.url), 'utf8'))
  const cards = () => mounted.findAll(node => node.props.role === 'button')
  expect(cards()).toHaveLength(1)
  const checkbox = mounted.findAll(node => node.type === 'input' && node.props.type === 'checkbox')[0]
  checkbox.props['onUpdate:modelValue'](false)
  await nextTick()
  expect(cards()).toHaveLength(2)
  const textOf = node => node.text + node.children.map(textOf).join('')
  expect(mounted.findAll(node => node.props.class === 'card-dietary').some(node => textOf(node).includes(t('dietary.unknown')))).toBe(true)
})

it('applies the same filter to global search and stops filtering when the feature is disabled', async () => {
  mounted = mountComponent(DishList, { searchQuery: 'meal', allStores: [{ name: 'Example', menuItems: items }] })
  expect(mounted.state.globalResults[0].groups[0].items[0].name).toBe('Meal (S)')
  mocks.settings.value.dietary.enabled = false
  await nextTick()
  expect(mounted.state.globalResults[0].groups[0].items[0]._variants).toHaveLength(2)
})
