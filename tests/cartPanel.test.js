import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import CartPanel from '../src/components/order/CartPanel.vue'
import { mountComponent } from './helpers/mountComponent'
import { resetPendingCart } from '../src/composables/usePendingCart'

const state = vi.hoisted(() => ({
  admin: false, balance: 500, failRead: false,
  reads: [], freeStores: [],
}))
vi.mock('../src/firestore', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db, _collection, uid) => uid,
  onSnapshot(uid, success, error) {
    state.reads.push(uid)
    if (state.failRead) error(new Error('permission-denied'))
    else success({ exists: () => true, data: () => ({ balance: state.balance }) })
    return () => {}
  },
}))
vi.mock('../src/composables/useAuth', () => ({
  useAuth: () => ({ userDisplayName: { value: 'Member' }, userUid: { value: 'member' }, isAdmin: { value: state.admin } }),
}))
vi.mock('../src/composables/useFirestore', () => ({
  useFirestore: () => ({
    membersWithUid: { value: [{ name: 'Other', uid: 'other' }] },
    noteGroups: { value: [] }, dailyFreeStores: { value: state.freeStores },
    requireMemberData() {}, releaseMemberData() {}, requireQuickNotes() {}, releaseQuickNotes() {},
  }),
}))
vi.mock('../src/composables/useToast', () => ({ useToast: () => ({ showToast() {} }) }))

async function render(proxy = false, item = {}) {
  const html = await renderToString(createSSRApp({
    render: () => h(CartPanel, {
      items: [{ _key: 1, name: 'Meal', price: 100, ownerUid: proxy ? 'other' : 'member', ownerName: proxy ? 'Other' : 'Member', paymentMethod: 'wallet', ...item }],
      initialOwner: proxy ? { name: 'Other', uid: 'other', paymentMethod: 'wallet', isProxy: true } : null,
    }),
  }))
  return { html, submitDisabled: /<button[^>]*class="submit-btn"[^>]*\sdisabled(?:\s|[=>])/.test(html) }
}

describe('購物車餘額與代訂送出', () => {
  it('手動價格四捨五入後不能為零，合法的小數仍按既有規則計價', () => {
    resetPendingCart()
    vi.stubGlobal('document', { removeEventListener() {} })
    const mounted = mountComponent(CartPanel)
    try {
      mounted.state.manualMeal = '飯'
      mounted.state.manualPrice = '0.4'
      expect(mounted.state.canAddManualItem).toBe(false)
      mounted.state.manualPrice = '0.5'
      expect(mounted.state.canAddManualItem).toBe(true)
    } finally {
      mounted.unmount()
      resetPendingCart()
      vi.unstubAllGlobals()
    }
  })
  beforeEach(() => Object.assign(state, { admin: false, balance: 500, failRead: false, reads: [], freeStores: [] }))
  it('餐點列顯示規格、加料與備註，不重複店名，份數與合計一致', async () => {
    const { html } = await render(false, { name: '牛肉麵(大)', displayName: '牛肉麵', storeName: '隱藏店名', variantLabel: '大', quantity: 2, price: 250, customNote: '不加蔥', note: '2份、不加蔥', addons: [{ name: '蛋', price: 15 }] })
    expect(html).not.toContain('隱藏店名')
    expect(html).toContain('大 · 2份 · 蛋')
    expect(html).toContain('送出 2 份 · NT$ 250')
    expect(html).not.toContain('餐點原價')
    expect(html).toContain('NT$ 500 →')
  })
  it('免費餐點保留原價與減免明細，合計不收費', async () => {
    state.freeStores = ['免費店家']
    const { html } = await render(false, { storeName: '免費店家' })
    expect(html).toContain('餐點原價')
    expect(html).toContain('今日免費不收費')
    expect(html).toContain('送出 1 份 · NT$ 0')
  })
  it('一般會員代訂不讀對方私人錢包，允許送出由後端驗證', async () => {
    const result = await render(true)
    expect(state.reads).toEqual([])
    expect(result.submitDisabled).toBe(false)
    expect(result.html).toContain('送出時會確認錢包餘額')
    expect(result.html).not.toContain('目前餘額')
  })
  it('自己的餘額確實不足時仍禁止送出', async () => {
    state.balance = 50
    const result = await render()
    expect(state.reads).toEqual(['member'])
    expect(result.submitDisabled).toBe(true)
    expect(result.html).toContain('餘額不足')
  })
  it('自己的餘額足夠時正常送出', async () => {
    expect((await render()).submitDisabled).toBe(false)
  })
  it('管理員代訂仍可讀取並預檢對方餘額', async () => {
    state.admin = true
    state.balance = 50
    expect((await render(true)).submitDisabled).toBe(true)
    expect(state.reads).toEqual(['other'])
  })
  it('讀取失敗顯示未知餘額，不誤報 0 元或鎖死送出', async () => {
    state.failRead = true
    const result = await render()
    expect(result.submitDisabled).toBe(false)
    expect(result.html).toContain('送出時會確認錢包餘額')
    expect(result.html).not.toContain('目前餘額')
  })
})
