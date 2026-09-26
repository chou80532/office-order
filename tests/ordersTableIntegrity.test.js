import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mountComponent } from './helpers/mountComponent'
import OrdersTable from '../src/components/dashboard/OrdersTable.vue'
import StoreSidebar from '../src/components/dashboard/StoreSidebar.vue'

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('../src/composables/useAuth', () => ({ useAuth: () => ({ isAdmin: ref(false), userUid: ref('member') }) }))
vi.mock('../src/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../src/composables/useDialog', () => ({ confirmDialog: (...args) => mocks.confirm(...args) }))
vi.mock('../src/composables/useScrollLock', () => ({ useScrollLock() {} }))
let mounted
afterEach(() => { mounted?.unmount(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('訂單操作與電話餐點彙整', () => {
  it('取消修改先詢問，選擇繼續編輯不丟失內容', async () => {
    mounted = mountComponent(OrdersTable)
    const s = mounted.state
    s.startEdit({ id: 'order', meal: '飯', price: 100 })
    s.editForm.note = '不加蔥'
    mocks.confirm.mockResolvedValueOnce(false)
    await s.cancelEdit()
    expect(mocks.confirm).toHaveBeenCalledOnce()
    expect(s.editingId).toBe('order')
    mocks.confirm.mockResolvedValueOnce(true)
    await s.cancelEdit()
    expect(s.editingId).toBeNull()
  })

  it('一般會員只能取消本人或自己代訂的未收現金訂單', () => {
    mounted = mountComponent(OrdersTable)
    expect(mounted.state.canDelete({ uid: 'other', orderedByUid: 'other' })).toBe(false)
    expect(mounted.state.canDelete({ uid: 'member' })).toBe(true)
    expect(mounted.state.canDelete({ uid: 'other', orderedByUid: 'member' })).toBe(true)
    expect(mounted.state.canDelete({ uid: 'member', paymentMethod: 'cash', cashStatus: 'collected' })).toBe(false)
  })

  it('三份餐點加一份餐點彙整為四份，備註數量同步，秤重單不誤判', () => {
    vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} })
    mounted = mountComponent(StoreSidebar, { orders: [
      { storeName: 'Store', meal: '飯', note: '3份、少飯', price: 300 },
      { storeName: 'Store', meal: '飯', note: '', price: 100 },
      { storeName: 'Store', meal: '水餃', note: '10顆', price: 70 },
    ] })
    expect(mounted.state.groupedMeals[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '飯', count: 4, noteSummary: '3 份少飯' }),
      expect.objectContaining({ name: '水餃', count: 1, noteSummary: '1 份10顆' }),
    ]))
  })
})
