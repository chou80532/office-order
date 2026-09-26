import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mountComponent } from './helpers/mountComponent'
import StoreManagerPanel from '../src/components/modals/StoreManagerPanel.vue'

const mocks = vi.hoisted(() => ({ data: null, save: vi.fn() }))
vi.mock('../src/composables/useFirestore', () => ({ useFirestore: () => mocks.data }))
vi.mock('../src/composables/useAuth', () => ({ useAuth: () => ({ userUid: ref('member') }) }))
vi.mock('../src/services/walletFunctions', () => ({ cancelOrdersWithWalletRefundViaFunction: (...args) => mocks.save(...args) }))
vi.mock('../src/services/storePopularity', () => ({ getCachedStorePopularity: () => ({ orders: [], now: Date.now() }), loadStorePopularity: vi.fn() }))
vi.mock('../src/components/ui/ConfirmDialog.vue', () => ({ default: { render: () => null } }))
vi.mock('../src/components/modals/MenuPreviewModal.vue', () => ({ default: { render: () => null } }))
let mounted
const mount = () => (mounted = mountComponent(StoreManagerPanel, { allStores: [{ name: 'Old' }, { name: 'New' }], replacementSource: 'Old' }))
beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue({ ok: true })
  mocks.data = {
    dailyStores: ref(['Old']), dailyFreeStores: ref(['Old']), dailyStoresReady: ref(true), dailyStoresError: ref(''),
    todayOrders: ref([{ storeName: 'Old' }]), ordersLoading: ref(false), menuLoading: ref(false),
    diningDay: ref({ needs: {}, replacements: {} }), diningLoading: ref(false), diningError: ref(''),
  }
})
afterEach(() => mounted?.unmount())
describe('設定店家草稿與交易', () => {
  it('取消勾選不會被後續快照勾回，也不恢復已取消的免費設定', async () => {
    const { state } = mount()
    expect(state.selected).toEqual([])
    state.toggle('New'); state.toggleFree('New'); state.clearAll()
    mocks.data.dailyStores.value = ['Old', 'New']
    mocks.data.dailyFreeStores.value = ['New']
    await nextTick()
    expect(state.selected).toEqual([])
    expect(state.freeSelected).toEqual([])
  })
  it('選店與退款只送出一個交易，並保留面板開啟時的版本', async () => {
    const { state } = mount()
    state.toggle('New'); state.toggleFree('New')
    await state.save()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(state.replacementOpen).toBe(true)
    await state.save(true)
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.save.mock.calls[0][0]).toMatchObject({
      storeReplacements: [{ source: 'Old', target: 'New' }],
      dailyStoreSettings: { activeStores: ['New'], freeStores: ['New'], expectedActiveStores: ['Old'], expectedFreeStores: ['Old'] },
    })
  })
  it('快照未準備或訂單尚在載入，不可送出設定', async () => {
    mocks.data.dailyStoresReady.value = false
    const { state } = mount()
    state.toggle('New'); await state.save()
    expect(state.selected).toEqual([])
    expect(mocks.save).not.toHaveBeenCalled()
    mocks.data.dailyStoresReady.value = true
    await nextTick()
    state.toggle('New')
    mocks.data.ordersLoading.value = true
    await state.save(true)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
