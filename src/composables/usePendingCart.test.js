import { beforeEach, describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { resetPendingCart, usePendingCart, createCartRestore, completeCartSubmission } from './usePendingCart'

beforeEach(resetPendingCart)

describe('切頁保留購物車草稿', () => {
  it('多顆復原通知交錯使用，送單成功後舊通知不能復活已送餐點', () => {
    const cart = usePendingCart()
    const item = { _key: 1, name: '飯', price: 100 }
    const earlierRestore = createCartRestore([item])
    const laterRestore = createCartRestore([item])
    laterRestore()
    completeCartSubmission([item])
    earlierRestore()
    expect(cart.cartItems.value).toEqual([])
  })

  it('完成送單仍保留送單途中新增的餐點，新的復原通知可正常使用', () => {
    const cart = usePendingCart()
    const sent = { _key: 1, price: 100 }
    const added = { _key: 2, price: 50 }
    cart.cartItems.value = [sent, added]
    completeCartSubmission([sent])
    expect(cart.cartItems.value).toEqual([added])
    const restore = createCartRestore([added])
    cart.cartItems.value = []
    restore()
    expect(cart.cartItems.value).toEqual([added])
  })
  it('復原只補回刪除項目，保留後續新增，且不重複插入', () => {
    const cart = usePendingCart()
    const removed = { _key: 1, name: '飯' }
    const restore = createCartRestore([removed])
    cart.cartItems.value = [{ _key: 2, name: '湯' }]
    restore()
    restore()
    expect(cart.cartItems.value.map(item => item._key)).toEqual([1, 2])
  })

  it('舊帳號的復原通知無法把餐點帶進下一個登入工作階段', () => {
    const restore = createCartRestore([{ _key: 1, name: 'private' }])
    resetPendingCart()
    restore()
    expect(usePendingCart().cartItems.value).toEqual([])
  })

  it('送單期間不復原草稿，避免修改正在提交的購物車', () => {
    const cart = usePendingCart()
    const restore = createCartRestore([{ _key: 1 }])
    cart.submitting.value = true
    restore()
    expect(cart.cartItems.value).toEqual([])
  })
  it('離開點餐頁再進入，保留品項、備註、加料、代訂人與店家', () => {
    const page = effectScope()
    const original = page.run(usePendingCart)
    original.cartItems.value = [{ _key: 1, name: '飯', price: 120, note: '少飯', addons: [{ name: '蛋', price: 20 }], ownerUid: 'other', paymentMethod: 'wallet', storeName: 'Store' }]
    original.cartOwner.value = { name: 'Other', uid: 'other', isProxy: true, paymentMethod: 'wallet' }
    original.activeStoreId.value = 'Store'
    Object.assign(original.manualDraft, { meal: '湯', price: 30, note: '不加蔥' })
    page.stop()
    const nextPage = effectScope()
    const restored = nextPage.run(usePendingCart)
    expect(restored.cartItems.value).toEqual(original.cartItems.value)
    expect(restored.cartOwner.value.uid).toBe('other')
    expect(restored.activeStoreId.value).toBe('Store')
    expect(restored.manualDraft).toEqual({ meal: '湯', price: 30, note: '不加蔥' })
    nextPage.stop()
  })

  it('送出期間切頁保留忙碌狀態及請求編號，避免重複扣款', () => {
    const cart = usePendingCart()
    cart.submitting.value = true
    cart.pendingSubmitAttempt.value = { fingerprint: 'cart', requestId: 'request-1' }
    const reopened = usePendingCart()
    expect(reopened.submitting.value).toBe(true)
    expect(reopened.pendingSubmitAttempt.value.requestId).toBe('request-1')
  })

  it('登出重設會清除全部草稿、失效舊請求，下一帳號無法看到內容', () => {
    const cart = usePendingCart()
    const previousSession = cart.cartSession.value
    cart.cartItems.value = [{ _key: 1, note: 'private' }]
    cart.cartOwner.value = { uid: 'other' }
    cart.pendingItem.value = { meal: 'copy' }
    cart.lastSubmission.value = { items: [{ meal: 'private receipt' }] }
    cart.activeStoreId.value = 'Store'
    cart.manualDraft.meal = '湯'
    cart.submitting.value = true
    cart.pendingSubmitAttempt.value = { requestId: 'old' }
    resetPendingCart()
    const next = usePendingCart()
    expect(next.cartItems.value).toEqual([])
    expect(next.cartOwner.value).toBeNull()
    expect(next.pendingItem.value).toBeNull()
    expect(next.lastSubmission.value).toBeNull()
    expect(next.activeStoreId.value).toBeNull()
    expect(next.submitting.value).toBe(false)
    expect(next.pendingSubmitAttempt.value).toBeNull()
    expect(next.manualDraft).toEqual({ meal: '', price: '', note: '' })
    expect(next.cartSession.value).not.toBe(previousSession)
  })
})
