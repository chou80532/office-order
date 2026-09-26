import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { mountComponent } from './helpers/mountComponent'
import DiningRecovery from '../src/components/dashboard/DiningRecovery.vue'
import { useHomeActions } from '../src/composables/useHomeActions'
import { usePendingCart, resetPendingCart } from '../src/composables/usePendingCart'
const mocks = vi.hoisted(() => ({ data: null, push: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: (...args) => mocks.push(...args) }) }))
vi.mock('../src/composables/useFirestore', () => ({ useFirestore: () => mocks.data }))
vi.mock('../src/composables/useAuth', () => ({ useAuth: () => ({ userUid: ref('member') }) }))
vi.mock('../src/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../src/services/walletFunctions', () => ({ cancelDiningNeedViaFunction: vi.fn() }))
const need = { id: 'n', name: 'Guest', uid: '', personKey: 'guest', status: 'pending', sourceStore: 'Old', targetStore: 'New', originals: [] }
let mounted
beforeEach(() => {
  resetPendingCart(); useHomeActions().closePanel()
  mocks.push.mockReset().mockResolvedValue(undefined)
  mocks.data = { diningDay: ref({ needs: { n: need } }), diningLoading: ref(false), diningError: ref('') }
  mounted = mountComponent(DiningRecovery)
})
afterEach(() => mounted?.unmount())
describe('補點與換店跳轉', () => {
  it('代點帶入現金訪客與新店，保留原購物車', async () => {
    const cart = usePendingCart()
    cart.cartItems.value = [{ name: 'Existing', ownerUid: 'member' }]
    await mounted.state.openReorder(need)
    expect(mocks.push).toHaveBeenCalledWith('/')
    expect(cart.cartOwner.value).toMatchObject({ name: 'Guest', uid: '', paymentMethod: 'cash', isManual: true, isProxy: true })
    expect(cart.activeStoreId.value).toBe('New')
    expect(cart.cartItems.value).toHaveLength(1)
  })
  it('換店跳到設定，離開面板就清掉原店提示', async () => {
    const actions = useHomeActions()
    await mounted.state.openStoreChange('Old')
    expect(actions.activePanel.value).toBe('store-manager')
    expect(actions.replacementSource.value).toBe('Old')
    actions.activePanel.value = 'records'
    expect(actions.replacementSource.value).toBe('')
  })
  it('跳轉失敗還原面板與用餐人員，連按不會重複執行', async () => {
    const actions = useHomeActions()
    actions.activePanel.value = 'store-manager'; actions.replacementSource.value = 'Old'
    const cart = usePendingCart()
    cart.cartOwner.value = { name: 'Original' }; cart.activeStoreId.value = 'Old'
    let finish
    mocks.push.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = mounted.state.openReorder(need)
    await mounted.state.openReorder(need)
    expect(mocks.push).toHaveBeenCalledTimes(1)
    finish(new Error('cancelled'))
    await pending
    expect(cart.cartOwner.value.name).toBe('Original')
    expect(cart.activeStoreId.value).toBe('Old')
    expect(actions.activePanel.value).toBe('store-manager')
    expect(actions.replacementSource.value).toBe('Old')
  })
})
