import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import DiningRecovery from '../src/components/dashboard/DiningRecovery.vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../src/services/walletFunctions', () => ({ cancelDiningNeedViaFunction: vi.fn() }))

const state = vi.hoisted(() => ({ admin: false, uid: 'member', needs: {}, error: '', loading: false, settings: { timeZone: 'Asia/Taipei', paymentMethods: { wallet: true, cash: true }, proxyOrdering: 'all' } }))
vi.mock('../src/composables/useFirestore', () => ({ useFirestore: () => ({
  systemSettings: ref(state.settings),
  diningDay: ref({ needs: state.needs, participants: {}, replacements: {} }), diningLoading: ref(state.loading), diningError: ref(state.error),
  todayOrders: ref([]), allStores: ref([]), requireFullMenuData() {}, releaseFullMenuData() {},
}) }))
vi.mock('../src/composables/useAuth', () => ({ useAuth: () => ({ isAdmin: ref(state.admin), userUid: ref(state.uid) }) }))
vi.mock('../src/composables/useToast', () => ({ useToast: () => ({ showToast() {} }) }))
vi.mock('../src/components/ui/ConfirmDialog.vue', () => ({ default: { render: () => null } }))
const render = () => renderToString(createSSRApp({ render: () => h(DiningRecovery) }))
const need = (id, uid = 'member', status = 'pending') => ({ id, uid, personKey: uid, name: uid, status, sourceStore: '原店', targetStore: '新店', originals: [{ meal: '雞肉飯', note: '飯少' }] })

describe('補點介面', () => {
  beforeEach(() => Object.assign(state, { admin: false, uid: 'member', needs: { a: need('a') }, loading: false, error: '', settings: { timeZone: 'Asia/Taipei', paymentMethods: { wallet: true, cash: true }, proxyOrdering: 'all' } }))
  it('沒有有效訂單時仍顯示人員、原餐點與補點入口', async () => {
    const html = await render()
    expect(html).toContain('待重新點餐 1 人')
    expect(html).toContain('雞肉飯（飯少）')
    expect(html).toContain('原店 → 新店')
    expect(html).toContain('本次不吃了')
  })
  it('同一人兩項需求只算一人，其他已註冊成員可代點及代為確認不吃', async () => {
    state.needs.b = need('b')
    state.uid = 'other'
    const html = await render()
    expect(html).toContain('待重新點餐 1 人')
    expect(html.match(/class="need-row"/g)).toHaveLength(2)
    expect(html).toContain('代點')
    expect(html).toContain('本次不吃了')
  })
  it('僅管理員可代訂時，一般成員只能替自己重新點餐', async () => {
    state.settings = { ...state.settings, proxyOrdering: 'admins' }
    state.needs.b = need('b', 'other')
    const html = await render()
    expect(html).toContain('重新點餐')
    expect(html).not.toContain('代點')
    state.admin = true
    expect(await render()).toContain('代點')
  })
  it('停用現金時不提供替沒有帳號的人重新點餐', async () => {
    state.settings = { ...state.settings, paymentMethods: { wallet: true, cash: false } }
    state.needs = { g: need('g', '') }
    const html = await render()
    expect(html).not.toContain('class="reorder-btn"')
    expect(html).toContain('本次不吃了')
  })
  it('已註冊使用者的換店操作一次呈現，不使用更多操作下拉選單', async () => {
    const html = await render()
    expect(html).toContain('重新點餐')
    expect(html).toContain('再次更換店家')
    expect(html).toContain('本次不吃了')
    expect(html).not.toContain('<details')
    expect(html).not.toContain('more-menu')
  })
  it('只有全部完成或明確不吃，才顯示完成', async () => {
    state.needs = { a: need('a', 'member', 'completed'), b: need('b', 'other', 'declined') }
    expect(await render()).not.toContain('recovery-heading')
    state.needs.c = need('c')
    expect(await render()).toContain('待重新點餐 1 人')
  })
  it('資料讀取失敗不可誤報已完成', async () => {
    state.error = 'permission-denied'
    const html = await render()
    expect(html).toContain('用餐名單讀取失敗')
    expect(html).not.toContain('換店補點已處理完成')
  })
})
