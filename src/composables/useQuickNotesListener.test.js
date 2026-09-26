import { afterEach, expect, it, vi } from 'vitest'

const subscriptions = vi.hoisted(() => [])
vi.mock('vue', async importOriginal => ({ ...await importOriginal(), provide: vi.fn() }))
vi.mock('../firestore', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  collection: (_db, path) => ({ path }),
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  where: vi.fn(), orderBy: vi.fn(), query: value => value,
  onSnapshot: (ref, ...handlers) => {
    const unsubscribe = vi.fn()
    subscriptions.push({ path: ref.path, callback: handlers.find(value => typeof value === 'function'), unsubscribe })
    return unsubscribe
  },
}))
import { createFirestore } from './useFirestore'

let state
afterEach(() => { state?.stopListeners(); vi.unstubAllGlobals(); subscriptions.length = 0 })
it('購物車及規格共用一個備註監聽，最後釋放才中斷，重開保留資料', async () => {
  vi.stubGlobal('window', { setTimeout })
  state = createFirestore()
  state.requireQuickNotes()
  await state.startListeners()
  const notes = () => subscriptions.filter(item => item.path === 'settings/quickNotes')
  expect(notes()).toHaveLength(1)
  const groups = [{ label: '甜度', notes: ['無糖'] }]
  notes()[0].callback({ exists: () => true, data: () => ({ groups }) })
  state.requireQuickNotes()
  state.releaseQuickNotes()
  expect(notes()).toHaveLength(1)
  expect(notes()[0].unsubscribe).not.toHaveBeenCalled()
  expect(state.noteGroups.value).toEqual(groups)
  state.releaseQuickNotes()
  expect(notes()[0].unsubscribe).toHaveBeenCalledOnce()
  state.requireQuickNotes()
  expect(notes()).toHaveLength(2)
  expect(state.noteGroups.value).toEqual(groups)
  state.stopListeners()
  expect(notes()[1].unsubscribe).toHaveBeenCalledOnce()
})
