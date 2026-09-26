import { reactive, ref } from 'vue'
import { remainingCartItems } from '../utils/orderSubmission'

const lastSubmission = ref(null)
const pendingItem = ref(null)
const cartOwner = ref(null)
// 草稿屬於目前登入工作階段，切頁與面板卸載都不會清除；登出時統一重設。
const cartItems = ref([])
const activeStoreId = ref(null)
const submitting = ref(false)
const pendingSubmitAttempt = ref(null)
const cartSession = ref(0)
const manualDraft = reactive({ meal: '', price: '', note: '' })
let restoreGeneration = 0

export function completeCartSubmission(items) {
  // 送單成功後舊復原通知失效，避免另一顆通知把已送出的餐點放回購物車。
  restoreGeneration += 1
  cartItems.value = remainingCartItems(cartItems.value, items)
}

// 復原只補回被刪除的品項，不以舊快照覆蓋使用者之後新增的餐點。
export function createCartRestore(items, index = 0) {
  const session = cartSession.value
  const generation = restoreGeneration
  const removed = [...items]
  let restored = false
  return () => {
    if (restored || submitting.value || session !== cartSession.value || generation !== restoreGeneration) return
    restored = true
    const keys = new Set(cartItems.value.map(item => item._key))
    const missing = removed.filter(item => !keys.has(item._key))
    const next = [...cartItems.value]
    next.splice(Math.min(index, next.length), 0, ...missing)
    cartItems.value = next
  }
}

export function resetPendingCart() {
  cartSession.value += 1
  lastSubmission.value = null
  pendingItem.value = null
  cartOwner.value = null
  cartItems.value = []
  activeStoreId.value = null
  submitting.value = false
  pendingSubmitAttempt.value = null
  Object.assign(manualDraft, { meal: '', price: '', note: '' })
}

export function usePendingCart() {
  return { lastSubmission, pendingItem, cartOwner, cartItems, activeStoreId, submitting, pendingSubmitAttempt, cartSession, manualDraft }
}
