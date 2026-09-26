import { afterEach, expect, it, vi } from 'vitest'
import { getLocalDateKey } from '../utils/format'

const subscriptions = vi.hoisted(() => [])
vi.mock('vue', async importOriginal => ({ ...await importOriginal(), provide: vi.fn() }))
vi.mock('../firestore', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: (_db, path) => ({ path }),
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  where: (...args) => args, orderBy: vi.fn(), query: value => value,
  onSnapshot: (ref, ...handlers) => {
    const unsubscribe = vi.fn()
    subscriptions.push({ path: ref.path, callback: handlers.find(value => typeof value === 'function'), unsubscribe })
    return unsubscribe
  },
}))
import { createFirestore } from './useFirestore'

let state
afterEach(() => { state?.stopListeners(); vi.unstubAllGlobals(); subscriptions.length = 0 })

it('套用店家不重載完整菜單，返回點餐保留菜單，重複快照不重啟監聽', async () => {
  vi.stubGlobal('window', { setTimeout })
  state = createFirestore()
  state.requireFullMenuData()
  await state.startListeners()
  const daily = subscriptions.find(item => item.path === 'settings/daily')
  const updateDaily = names => daily.callback({
    exists: () => true, metadata: { fromCache: false },
    data: () => ({ serviceDate: getLocalDateKey(), activeStores: names }),
  })
  const menus = () => subscriptions.filter(item => item.path === 'menu_images')
  updateDaily(['舊店'])
  menus()[0].callback({ docs: [{ id: 'menu', data: () => ({ storeName: '新店', menuItems: [{ name: '便當', price: 100 }] }) }] })
  const loaded = state.rawMenuData.value

  updateDaily(['新店'])
  expect(menus()).toHaveLength(1)
  expect(menus()[0].unsubscribe).not.toHaveBeenCalled()
  expect(state.menuLoading.value).toBe(false)

  state.releaseFullMenuData()
  expect(menus()).toHaveLength(2)
  expect(state.rawMenuData.value).toBe(loaded)
  updateDaily(['新店'])
  expect(menus()).toHaveLength(2)

  updateDaily(['另一間店'])
  expect(menus()).toHaveLength(3)
  state.stopListeners({ clearData: false })
  await state.startListeners()
  state.requireFullMenuData()
  expect(menus()).toHaveLength(4)
})
