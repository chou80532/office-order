<script setup>
import LoadingState from '../components/ui/LoadingState.vue'

import { formatMoney } from '../utils/format'
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '../firestore'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useFirestore } from '../composables/useFirestore'
import { useToast } from '../composables/useToast'
import { useHomeActions } from '../composables/useHomeActions'
import { usePendingCart, createCartRestore, completeCartSubmission } from '../composables/usePendingCart'
import { useScrollLock } from '../composables/useScrollLock'
import { useDebouncedRef } from '../composables/useDebounce'
import { fireConfetti } from '../utils'
import { countCartDishes } from '../utils/cart'
import { prepareSubmission, submissionDefinitelyRejected } from '../utils/orderSubmission'
import { CONFETTI_SUBMIT, SUBMIT_UNDO_DURATION_MS } from '../constants'
import {
  cancelOrdersWithWalletRefundViaFunction,
  createOrderRequestId,
  createOrdersWithWalletDebitViaFunction,
} from '../services/walletFunctions'
import TopHeader from '../components/layout/TopHeader.vue'
import StoreSidebar from '../components/order/StoreSidebar.vue'
import DishList from '../components/order/DishList.vue'
import CartPanel from '../components/order/CartPanel.vue'
import DishOptionsModal from '../components/order/DishOptionsModal.vue'
import { groupDishOptions, cartPortions } from '../utils/dishOptions'
import { menuItemKey } from '../utils/menuCategories'

// These panels are not part of the primary ordering flow. Loading them only
// when opened keeps the menu interactive sooner on both desktop and mobile.
const RecordTable = defineAsyncComponent(() => import('../components/order/RecordTable.vue'))
const WalletPanel = defineAsyncComponent(() => import('../components/order/WalletPanel.vue'))
const StatsPanel = defineAsyncComponent(() => import('../components/modals/StatsPanel.vue'))
const StoreManagerPanel = defineAsyncComponent(() => import('../components/modals/StoreManagerPanel.vue'))

const router = useRouter()
const { userDisplayName, userUid } = useAuth()
const {
  allStores, dailyStores, dailyFreeStores, dailyStoresConfigured, dailyStoresReady, dailySettingsExists,
  dailyStoreDateMatched, dailyActiveStoreCount,
  dailyStoresError, todayOrders, ordersLoading, menuLoading, diningDay,
  requireFullMenuData, releaseFullMenuData
} = useFirestore()
const myTodayOrders = computed(() => todayOrders.value.filter(o =>
  o.ownerUid ? o.ownerUid === userUid.value : o.name === userDisplayName.value))
const myPendingNeeds = computed(() => Object.values(diningDay.value.needs || {}).filter(n =>
  n.status === 'pending' && (n.uid ? n.uid === userUid.value : n.name === userDisplayName.value)))
const mobileCartDue = computed(() => cartItems.value.reduce((sum, item) =>
  sum + (dailyFreeStores.value.includes(item.storeName) ? 0 : Number(item.price) || 0), 0))
const pendingDiningPeople = computed(() => new Set(Object.values(diningDay.value.needs || {})
  .filter(need => need.status === 'pending')
  .map(need => need.personKey || need.uid || need.name)).size)
const { showToast } = useToast()
const { pendingItem, cartOwner, cartItems, activeStoreId, submitting, pendingSubmitAttempt, cartSession, lastSubmission } = usePendingCart()

const homeBootLoading = computed(() => !dailyStoresReady.value)
const menuInitialLoading = computed(() =>
  dailyStoresConfigured.value && menuLoading.value && allStores.value.length === 0
)
const bootLoadingText = computed(() => {
  if (!dailyStoresReady.value) {
    return {
      title: '正在確認今日開放店家…',
      subtitle: '確認完成前不會顯示舊店家，避免誤點昨天的菜單。'
    }
  }
  if (menuLoading.value && allStores.value.length === 0) {
    return {
      title: '正在載入店家菜單…',
      subtitle: '正在同步最新菜單與店家資訊。'
    }
  }
  return {
    title: '正在同步點餐資料…',
    subtitle: '正在整理訂單與購物車狀態。'
  }
})
// ── Keyboard shortcuts ────────────────────────
function handleGlobalKeydown(e) {
  // 對話框處理自己的快捷鍵，避免 Escape 同時關掉背後的設定面板。
  if (document.querySelector('[role="alertdialog"]')) return
  const tag = e.target.tagName
  const isInputField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable

  // '/' — focus search (only on order screen, not in panel mode)
  if (e.key === '/' && !isInputField && !activePanel.value) {
    e.preventDefault()
    searchInput.value?.focus()
    return
  }
  // Escape — close active panel
  if (e.key === 'Escape' && activePanel.value) {
    closePanel()
    return
  }
  // Cmd/Ctrl+Enter — trigger cart submit
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !activePanel.value) {
    cartPanel.value?.triggerSubmit?.()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown)
  // 在點餐頁背景準備分類；開啟店家設定時共用快取，不阻塞點餐。
  if (userUid.value) {
    import('../services/storePopularity')
      .then(({ loadStorePopularity }) => loadStorePopularity(userUid.value))
      .catch(() => { /* 面板開啟時可重試，背景預載失敗不打斷點餐。 */ })
  }
  if (pendingItem.value) {
    const item = pendingItem.value
    pendingItem.value = null
    cartItems.value = [...cartItems.value, {
      _key: Date.now() + Math.random(),
      name:      item.meal,
      price:     item.price,
      note:      item.note || '',
      who:       cartOwnerName.value || userDisplayName.value,
      ...currentCartOwnerPayload(),
      storeName: item.storeName || ''
    }]
    showToast(`已加入：${item.meal}`)
  }
})
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
})

// ── Search ────────────────────────────────────
const searchQuery = ref('')
const debouncedSearchQuery = useDebouncedRef(searchQuery, 160)
const searchInput = ref(null)
const recentUserOrders = ref([])

function clearSearch() {
  searchQuery.value = ''
  searchInput.value?.focus()
}

// ── Stores ────────────────────────────────────
const todayStores = computed(() => {
  if (!dailyStoresConfigured.value) return []
  if (!dailyStores.value?.length) return []
  return allStores.value.filter(s => dailyStores.value.includes(s.name))
})

const dailyStoreIssue = computed(() => {
  if (!dailyStoresReady.value) return null

  if (dailyStoresError.value) {
    return {
      type: 'error',
      icon: '⚠️',
      title: '今日店家設定讀取失敗',
      message: '暫時無法載入今日店家，請確認網路後重新整理。',
      details: []
    }
  }

  if (!dailySettingsExists.value) {
    return {
      type: 'missing',
      icon: '📅',
      title: '今日尚未設定店家',
      message: '今天的開放店家尚未設定，設定完成後就會顯示點餐菜單。',
      details: []
    }
  }

  if (!dailyStoreDateMatched.value) {
    return {
      type: 'date-mismatch',
      icon: '📅',
      title: '今日尚未設定店家',
      message: '今天的開放店家尚未設定，設定完成後就會顯示點餐菜單。',
      details: []
    }
  }

  if (dailyActiveStoreCount.value === 0) {
    return {
      type: 'empty-stores',
      icon: '🍽️',
      title: '今天還沒開放店家',
      message: '請先選擇今天要開放的店家，設定完成後大家就能開始點餐。',
      details: []
    }
  }

  if (!menuLoading.value && dailyStoresConfigured.value && todayStores.value.length === 0) {
    return {
      type: 'unmatched-stores',
      icon: '🔎',
      title: '已設定今日店家，但找不到對應菜單',
      message: '今日店家的菜單尚未準備完成，請聯繫總務確認。',
      details: []
    }
  }

  return null
})

const shouldShowDailyStoreIssue = computed(() => !!dailyStoreIssue.value)
const dailyStoreWarningShown = ref('')

watch(dailyStoreIssue, (issue) => {
  if (!issue) {
    dailyStoreWarningShown.value = ''
    return
  }
  if (dailyStoreWarningShown.value === issue.type) return
  dailyStoreWarningShown.value = issue.type
  showToast(issue.title, 'warning')
}, { immediate: true })

const storesForSidebar = computed(() =>
  todayStores.value.map(s => ({
    ...s,
    id: s.name,
    items: s.menuItems || [],
    isFreeToday: dailyFreeStores.value.includes(s.name)
  }))
)

const dishSignalKey = (storeName, mealName, price) =>
  `${String(storeName || '').trim()}::${String(mealName || '').trim()}::${Number(price) || 0}`

const userDishStats = computed(() => {
  const name = String(cartPanel.value?.currentName || userDisplayName.value || '').trim()
  if (!name) return {}

  const byId = new Map()
  const combinedOrders = [...todayOrders.value, ...recentUserOrders.value]
  combinedOrders.forEach(order => {
    if (order?.id) byId.set(order.id, order)
  })

  const ordered = [...byId.values()]
    .filter(order => String(order.name || '').trim() === name)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))

  const stats = {}
  const latestKeyByStore = new Map()
  ordered.forEach((order) => {
    if (!String(order.meal || '').trim()) return
    const key = dishSignalKey(order.storeName, order.meal, order.price)
    const storeName = String(order.storeName || '').trim()
    if (storeName && !latestKeyByStore.has(storeName)) latestKeyByStore.set(storeName, key)
    if (!stats[key]) {
      stats[key] = {
        count: 0,
        lastTimestamp: order.timestamp || 0,
        isLast: false,
      }
    }
    stats[key].count += 1
  })
  latestKeyByStore.forEach(key => {
    if (stats[key]) stats[key].isLast = true
  })
  return stats
})

const activeStore = computed(() => storesForSidebar.value.find(s => s.id === activeStoreId.value) || storesForSidebar.value[0] || null)
const activeStoreIsFree = computed(() =>
  !!activeStore.value && dailyFreeStores.value.includes(activeStore.value.name)
)

watch(storesForSidebar, (stores) => {
  if (!dailyStoresReady.value || menuLoading.value) return
  if (stores.length === 0) {
    activeStoreId.value = null
    return
  }

  const currentStoreExists = stores.some(store => store.id === activeStoreId.value)
  if (!currentStoreExists) activeStoreId.value = stores[0].id
}, { immediate: true })

// ── Cart ──────────────────────────────────────
const cartPanel = ref(null)
const cartOwnerName = ref(String(cartOwner.value?.name || '').trim())
const lastOrder = ref(null)
const lastOrderLoading = ref(false)
let lastOrderRequestId = 0
let lastOrderDebounceTimer = null
const lastOrderCache = new Map()
const LAST_ORDER_CACHE_TTL_MS = 5 * 60 * 1000

const cartPortionCount = computed(() => cartItems.value.reduce((sum, item) => sum + cartPortions(item), 0))
const cartCounts = computed(() => countCartDishes(cartItems.value, currentCartOwnerPayload()))


const currentCartOwnerPayload = () => {
  const owner = cartPanel.value?.currentOwner || cartOwner.value
  const ownerName = String(owner?.name || '').trim()
  if (!ownerName) {
    return {
      ownerName: String(userDisplayName.value || '').trim(),
      ownerUid: userUid.value || '',
      paymentMethod: 'wallet',
    }
  }
  return {
    ownerName,
    ownerUid: owner.uid || '',
    paymentMethod: owner?.paymentMethod || 'wallet',
  }
}

function rememberCartOwner(owner) {
  cartOwner.value = owner ? { ...owner } : null
  cartOwnerName.value = String(owner?.name || '').trim()
}

function formatItemNote(item) {
  const addons = Array.isArray(item.addons) ? item.addons : []
  const addonText = addons.map(addon => addon.name).filter(Boolean).join('、')
  return [item.note || '', addonText && `加料${item.addonMultiplier > 1 ? '（每份）' : ''}：${addonText}`].filter(Boolean).join('；')
}

const dishOptions = ref(null)

function addToCart(dish) {
  const storeName = dish._storeName || activeStore.value?.name || ''
  const store = allStores.value.find(s => s.name === storeName) || activeStore.value
  const owner = currentCartOwnerPayload()
  dishOptions.value = { dish, store, storeName, owner }
}

function editCartItem(index) {
  const original = cartItems.value[index]
  if (!original || submitting.value) return
  const store = allStores.value.find(s => s.name === original.storeName)
  const groups = groupDishOptions(store?.menuItems || [])
  const dish = groups.find(g => (g._variants || [g]).some(v => menuItemKey(v, original.storeName) === original._dishKey || (v.name === original.name && v.category === original.category)))
    || { name: original.name, category: original.category, unit: original.unit || '', price: original.unitPrice ?? original.basePrice ?? (original.price - (original.addons || []).reduce((sum, a) => sum + Number(a.price || 0), 0)) }
  dishOptions.value = { dish, original, store, storeName: original.storeName, owner: currentCartOwnerPayload() }
}

function saveDishOptions(item) {
  if (submitting.value) return
  const original = dishOptions.value?.original
  if (original) {
    cartItems.value = cartItems.value.map(row => row._key === original._key ? item : row)
  } else {
    cartItems.value = [...cartItems.value, item]
  }
  dishOptions.value = null
  showToast(original ? '已更新餐點' : `已加入 ${item.name}`)
}

function removeFromCart(index) {
  // 選了一堆規格、加料的品項一點就沒，重建很痛。跟「清空購物車」一樣給復原。
  const removed = cartItems.value[index]
  if (!removed) return
  const restore = createCartRestore([removed], index)
  cartItems.value = cartItems.value.filter((_, i) => i !== index)
  showToast(`已移除 ${removed.name}`, 'success', {
    duration: 6000,
    undoLabel: '復原',
    undoFn: restore,
  })
}

function updateItems(newItems) {
  cartItems.value = newItems
}

function pickLastOrderForStore(records, storeName) {
  if (!Array.isArray(records)) return null
  return records.find(order => !storeName || String(order.storeName || '').trim() === storeName) || null
}

// 用手上已有的資料（今日訂單 / 快取）同步算出「上一筆」。
// 算得出來就回傳結果，算不出來回 null 代表真的需要連線查詢。
function resolveLastOrderLocally(name, storeName) {
  const liveMatch = [...todayOrders.value]
    .filter(o => String(o.name || '').trim() === name && (!storeName || o.storeName === storeName))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0]
  if (liveMatch) return { records: [liveMatch], lastOrder: liveMatch }

  // 快取以「人」為單位，不含店名：一次查到的 50 筆足以回答任何店家，
  // 所以切換店家不必重查，也就不會出現載入中閃一下又消失。
  const cached = lastOrderCache.get(name)
  if (cached && Date.now() - cached.cachedAt < LAST_ORDER_CACHE_TTL_MS) {
    return { records: cached.records, lastOrder: pickLastOrderForStore(cached.records, storeName) }
  }
  return null
}

function applyLastOrderResult(result) {
  recentUserOrders.value = result.records
  lastOrder.value = result.lastOrder
  lastOrderLoading.value = false
}

async function loadLastOrderForCart() {
  const requestId = ++lastOrderRequestId
  const name = String(cartOwnerName.value || userDisplayName.value || '').trim()
  const storeName = String(activeStore.value?.name || '').trim()
  if (!name) {
    applyLastOrderResult({ records: [], lastOrder: null })
    return
  }

  const local = resolveLastOrderLocally(name, storeName)
  if (local) {
    applyLastOrderResult(local)
    return
  }

  // 真的要連線查詢時才清掉舊店家的結果，避免顯示到別家的上一筆
  lastOrder.value = null
  recentUserOrders.value = []
  lastOrderLoading.value = true
  try {
    let records = []
    try {
      const personalSnap = await getDocs(query(
        collection(db, 'orders'),
        where('name', '==', name),
        orderBy('timestamp', 'desc'),
        limit(50)
      ))
      records = personalSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (indexedQueryError) {
      console.warn('[Firestore] personal last order query failed, falling back to recent orders:', indexedQueryError)
      const fallbackCutoff = Date.now() - 180 * 24 * 60 * 60 * 1000
      const recentSnap = await getDocs(query(
        collection(db, 'orders'),
        where('timestamp', '>=', fallbackCutoff),
        orderBy('timestamp', 'desc'),
        limit(500)
      ))
      records = recentSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(order => String(order.name || '').trim() === name)
    }

    if (requestId !== lastOrderRequestId) return
    lastOrderCache.set(name, { records, cachedAt: Date.now() })
    recentUserOrders.value = records
    lastOrder.value = pickLastOrderForStore(records, storeName)
  } catch (error) {
    if (requestId !== lastOrderRequestId) return
    console.error('[Firestore] last order query error:', error)
    showToast('查詢上一筆訂單失敗，請稍後再試', 'error')
  } finally {
    if (requestId === lastOrderRequestId) lastOrderLoading.value = false
  }
}

function scheduleLastOrderLoad() {
  clearTimeout(lastOrderDebounceTimer)

  const name = String(cartOwnerName.value || userDisplayName.value || '').trim()
  const storeName = String(activeStore.value?.name || '').trim()

  if (!name) {
    lastOrderRequestId++
    applyLastOrderResult({ records: [], lastOrder: null })
    return
  }

  // 能同步決定就同步決定：切換店家時直接定案，不進 loading 狀態
  const local = resolveLastOrderLocally(name, storeName)
  if (local) {
    lastOrderRequestId++
    applyLastOrderResult(local)
    return
  }

  lastOrderLoading.value = true
  lastOrderDebounceTimer = setTimeout(loadLastOrderForCart, 280)
}


function repeatLast(currentName) {
  const last = lastOrder.value
  if (!last) { showToast('此店沒有找到上次訂單', 'error'); return }
  cartItems.value = [...cartItems.value, {
    _key: Date.now() + Math.random(),
    name: last.meal,
    price: last.price,
    note: last.note || '',
    who: currentName || userDisplayName.value,
    ...currentCartOwnerPayload(),
    storeName: last.storeName || activeStore.value?.name || ''
  }]
  showToast(`已加入：${last.meal}`)
}

// ── Submit ────────────────────────────────────
function submissionFingerprint(items, currentName) {
  return JSON.stringify({
    currentName,
    items: items.map(item => ({
      name: item.name,
      price: item.price,
      ownerName: item.ownerName,
      ownerUid: item.ownerUid,
      paymentMethod: item.paymentMethod,
      storeName: item.storeName,
      note: formatItemNote(item),
    }))
  })
}

async function submitOrder(currentName) {
  if (!cartItems.value.length || submitting.value) return
  if (!currentName) { showToast('請輸入姓名', 'error'); return }
  const session = cartSession.value
  submitting.value = true
  try {
    const fingerprint = submissionFingerprint(cartItems.value, currentName)
    pendingSubmitAttempt.value = prepareSubmission(pendingSubmitAttempt.value, {
      items: cartItems.value,
      fallbackName: currentName,
      selectedStoreName: activeStore.value?.name || '',
      fingerprint,
      requestId: createOrderRequestId(userUid.value),
    })
    const attempt = pendingSubmitAttempt.value
    const submitItems = attempt.items
    const recoveringChangedCart = attempt.fingerprint !== fingerprint
    const orderIds = await createOrdersWithWalletDebitViaFunction({
      items: submitItems,
      fallbackName: attempt.fallbackName,
      actorName: userDisplayName.value,
      actorUid: userUid.value,
      selectedStoreName: attempt.selectedStoreName,
      formatItemNote,
      requestId: pendingSubmitAttempt.value.requestId,
    })
    if (session !== cartSession.value) return
    pendingSubmitAttempt.value = null
    const submitCount = submitItems.length
    fireConfetti(CONFETTI_SUBMIT)
    // 送出等待期間可能切頁再加入餐點；只移除這次已成功送出的品項。
    completeCartSubmission(submitItems)
    if (!cartItems.value.length) {
      cartPanel.value?.resetToSelf?.()
      cartOwner.value = null
    }
    lastSubmission.value = { ids: orderIds, date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }), items: submitItems.map(item => ({ ...item, isFree: dailyFreeStores.value.includes(item.storeName) })) }
    showToast(recoveringChangedCart ? `已確認前次 ${submitCount} 筆訂單；購物車後續修改尚未送出，請核對今日訂單` : `🎉 ${submitCount} 筆訂單送出！`, 'success', {
      duration: SUBMIT_UNDO_DURATION_MS,
      undoLabel: '↶ 撤銷',
      undoFn: async () => {
        if (session !== cartSession.value) return
        try {
          await cancelOrdersWithWalletRefundViaFunction({
            orderIds,
            actorName: userDisplayName.value,
            reason: '送出後撤銷退款',
          })
          if (session !== cartSession.value) return
          if (lastSubmission.value?.ids.length === orderIds.length && lastSubmission.value.ids.every(id => orderIds.includes(id))) lastSubmission.value = null
          showToast('已撤銷送出')
        } catch {
          if (session !== cartSession.value) return
          showToast('撤銷失敗', 'error')
        }
      }
    })
    mobileCartOpen.value = false
    if (!cartItems.value.length && router.currentRoute.value.name === 'home') router.push('/dashboard').catch(() => {})
  } catch (err) {
    if (session !== cartSession.value) return
    if (submissionDefinitelyRejected(err)) pendingSubmitAttempt.value = null
    const message = err.message === 'INSUFFICIENT_WALLET_BALANCE'
      ? '餘額不足，請聯繫總務儲值'
      : err.message?.includes('補點') || err.message?.includes('店家已更換') ? err.message : '送出失敗，請再試一次'
    showToast(message, 'error')
  } finally {
    if (session === cartSession.value) submitting.value = false
  }
}

// ── Mobile cart drawer ────────────────────────
const mobileCartOpen = ref(false)

useScrollLock(mobileCartOpen)

// Swipe down to close cart drawer
let _swipeStartY = 0
function onCartTouchStart(e) { _swipeStartY = e.touches[0].clientY }
function onCartTouchEnd(e) {
  if (e.changedTouches[0].clientY - _swipeStartY > 60) mobileCartOpen.value = false
}

// ── Right panel ───────────────────────────────
const { activePanel, replacementSource, closePanel } = useHomeActions()
watch(activePanel, () => { mobileCartOpen.value = false })
watch([cartOwnerName, () => activeStore.value?.name], () => {
  scheduleLastOrderLoad()
}, { immediate: true })
onUnmounted(() => clearTimeout(lastOrderDebounceTimer))

let fullMenuRequested = false
function syncFullMenuRequest(needed) {
  if (needed && !fullMenuRequested) {
    requireFullMenuData()
    fullMenuRequested = true
  } else if (!needed && fullMenuRequested) {
    releaseFullMenuData()
    fullMenuRequested = false
  }
}

watch(() => activePanel.value === 'store-manager', syncFullMenuRequest, { immediate: true })
onUnmounted(() => syncFullMenuRequest(false))

const panelTitle = computed(() => {
  if (activePanel.value === 'records') return '歷史訂單'
  if (activePanel.value === 'wallet') return '虛擬錢包'
  if (activePanel.value === 'stats') return '統計'
  if (activePanel.value === 'store-manager') return '今日開放店家'
  return '點餐'
})

function copyToCart(order) {
  cartItems.value = [...cartItems.value, {
    _key: Date.now() + Math.random(),
    name: order.meal,
    price: order.price,
    note: order.note || '',
    who: cartOwnerName.value || userDisplayName.value,
    ...currentCartOwnerPayload(),
    storeName: order.storeName || activeStore.value?.name || ''
  }]
  showToast(`已加入：${order.meal}`)
}
</script>

<template>
  <div class="page">
    <button v-if="pendingDiningPeople" class="dining-alert" @click="router.push('/dashboard')">
      <span class="dining-alert-summary"><i class="fas fa-right-left" aria-hidden="true"></i><span>店家異動 · <strong>{{ pendingDiningPeople }} 人待補點</strong></span></span>
      <span class="dining-alert-action">查看名單 <i class="fas fa-chevron-right" aria-hidden="true"></i></span>
    </button>

    <!-- ── Header ── -->
    <TopHeader :title="panelTitle" :wide-center="['records', 'stats', 'wallet'].includes(activePanel)">
      <template v-if="!activePanel" #center>
        <div class="search-wrap app-search-shell">
          <input
            ref="searchInput"
            v-model="searchQuery"
            class="search-input"
            placeholder="搜尋餐點..."
            @keyup.escape="searchQuery = ''"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="search-clear app-search-clear"
            aria-label="清除搜尋"
            @click="clearSearch"
          >
            <i class="fas fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
      </template>
      <template v-else-if="['records', 'stats', 'wallet'].includes(activePanel)" #center>
        <div :id="`${activePanel}-toolbar-target`" class="panel-toolbar-target"></div>
      </template>
    </TopHeader>

    <LoadingState v-if="homeBootLoading" class="home-loading-state" :title="bootLoadingText.title" :description="bootLoadingText.subtitle" />

    <div v-else-if="shouldShowDailyStoreIssue && !activePanel" class="daily-empty-state">
      <div class="daily-empty-card">
        <span class="daily-empty-icon">{{ dailyStoreIssue.icon }}</span>
        <h2>{{ dailyStoreIssue.title }}</h2>
        <p>{{ dailyStoreIssue.message }}</p>
        <ul v-if="dailyStoreIssue.details?.length" class="daily-empty-details">
          <li v-for="detail in dailyStoreIssue.details" :key="detail">{{ detail }}</li>
        </ul>
        <button
          type="button"
          class="daily-empty-action"
          @click="activePanel = 'store-manager'"
        >
          選擇今日店家
        </button>
      </div>
    </div>

    <!-- ── 3-column body ── -->
    <div v-else class="body" :class="{ 'panel-mode': activePanel }">

      <!-- Center: menu + below-fold -->
      <main class="center-col">
    <section v-if="!activePanel" class="personal-order-status" aria-live="polite">
      <div><strong>{{ myPendingNeeds.length ? '你的餐點需要重新選擇' : ordersLoading ? '正在確認你的今日訂單…' : myTodayOrders.length ? '你今天已訂 ' + myTodayOrders.length + ' 份餐點' : '你今天尚未訂餐' }}</strong>
      <p v-if="myTodayOrders.length">{{ myTodayOrders.map(o => o.storeName + '・' + o.meal).join('、') }}</p>
      <p>{{ dailyStoresReady ? (dailyStoresConfigured ? '今日已開放店家，可選擇餐點' : '今日店家尚未準備完成') : '正在確認今日店家…' }}</p></div>
      <button type="button" @click="router.push('/dashboard')">查看我的訂單</button>
    </section>

        <StoreSidebar
          v-if="!activePanel"
          class="top-storebar"
          horizontal
          :stores="storesForSidebar"
          :active-id="activeStore?.id"
          @select="activeStoreId = $event"
          @add-store="activePanel = 'store-manager'"
        />

        <div v-if="activeStoreIsFree" class="free-store-banner" role="status">
          <span class="free-store-banner-icon" aria-hidden="true"><i class="fas fa-gift"></i></span>
          <span><strong>此店家今日免費</strong> — 點餐不會扣錢包，金額僅供紀錄</span>
        </div>

        <DishList
          :store="activeStore"
          :all-stores="allStores"
          :cart-counts="cartCounts"
          :search-query="debouncedSearchQuery"
          :user-dish-stats="userDishStats"
          @add="addToCart"
        />

        <LoadingState v-if="menuInitialLoading" title="正在載入今日菜單…" compact />

      </main>

      <!-- Right: cart or action panel -->
      <div class="cart-col" :class="{ 'mobile-open': mobileCartOpen, 'records-panel': activePanel === 'records' }"
        @touchstart.passive="onCartTouchStart"
        @touchend.passive="onCartTouchEnd"
      >
        <!-- 手機底部抽屜的拖曳把手：提示可下滑關閉（桌機隱藏） -->
        <div v-if="!activePanel" class="cart-drawer-handle" aria-hidden="true"></div>
        <button v-if="!activePanel" class="cart-close" type="button" aria-label="關閉購物車" @click="mobileCartOpen = false">關閉 ×</button>

        <CartPanel
          v-show="!activePanel"
          ref="cartPanel"
          :items="cartItems"
          :submitting="submitting"
          :selected-store="activeStore"
          :all-stores="allStores"
          :last-order="lastOrder"
          :last-order-loading="lastOrderLoading"
          :initial-owner="cartOwner"
          @remove="removeFromCart"
          @edit="editCartItem"
          @submit="submitOrder"
          @repeat-last="repeatLast"
          @update-items="updateItems"
          @current-name-change="cartOwnerName = $event"
          @current-owner-change="rememberCartOwner"
        />

        <!-- Records panel -->
        <div v-if="activePanel === 'records'" class="history-panel">
            <div class="history-scroll">
              <RecordTable
                :all-stores="allStores"
                toolbar-target="#records-toolbar-target"
                @show-toast="showToast"
                @copy-order="copyToCart"
              />
            </div>
        </div>

        <!-- Wallet panel -->
        <WalletPanel v-else-if="activePanel === 'wallet'" toolbar-target="#wallet-toolbar-target" />

        <!-- Store manager panel -->
        <StoreManagerPanel
          v-else-if="activePanel === 'store-manager'"
          :all-stores="allStores"
          :replacement-source="replacementSource"
          @show-toast="showToast"
          @close="closePanel"
        />

        <!-- Stats panel -->
        <StatsPanel
          v-else-if="activePanel === 'stats'"
          toolbar-target="#stats-toolbar-target"
          @show-toast="showToast"
        />
      </div>
    </div>

    <DishOptionsModal v-if="dishOptions" :context="dishOptions" @close="dishOptions = null" @save="saveDishOptions" />

    <!-- Mobile: cart backdrop -->
    <div v-if="mobileCartOpen" class="mobile-backdrop" @click="mobileCartOpen = false"></div>

    <!-- Mobile: cart FAB (only on order screen, not panel mode) -->
    <button
      v-if="!activePanel && !mobileCartOpen"
      type="button"
      class="cart-fab"
      :class="{ 'has-items': cartItems.length > 0 }"
      :aria-label="cartItems.length > 0 ? `查看購物車，尚未送出 ${cartPortionCount} 份，應付 ${mobileCartDue} 元` : '開啟購物車'"
      @click="mobileCartOpen = true"
    >
      <span class="fab-goo-echo" aria-hidden="true"></span>
      <i class="fas fa-bag-shopping fab-icon" aria-hidden="true"></i>
      <span class="fab-label">查看購物車{{ cartItems.length ? `・${cartPortionCount} 份・${formatMoney(mobileCartDue)}` : '' }}</span>
      <Transition name="fab-count" mode="out-in">
        <span v-if="cartItems.length > 0" :key="cartPortionCount" class="fab-count">{{ cartPortionCount }}</span>
      </Transition>
    </button>

  </div>
</template>

<style scoped>
.personal-order-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.personal-order-status p { margin-top: 4px; font-size: var(--text-label); overflow-wrap: anywhere; }
.personal-order-status button { flex-shrink: 0; padding: 10px; border-radius: 8px; }

.dining-alert { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 8px 20px; text-align: left; color: var(--ink); background: var(--bg-highlight); border-bottom: 1px solid var(--border); font-size: var(--text-label); line-height: 1.4; }
.dining-alert-summary, .dining-alert-action { display: inline-flex; align-items: center; gap: 8px; }
.dining-alert-summary { min-width: 0; }
.dining-alert-summary > i, .dining-alert-action { color: var(--accent); }
.dining-alert-action { flex-shrink: 0; white-space: nowrap; font-weight: 700; }
.dining-alert-action i { font-size: var(--text-micro); }
.dining-alert:hover { background: var(--bg-accent); }
.dining-alert:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (max-width: 600px) { .dining-alert { padding: 8px 12px; gap: 8px; } .dining-alert-summary > i { display: none; } }
/* ── Page reset ── */
.page {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.home-loading-state {
  flex: 1;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px var(--page-pad);
}

.home-loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
}

.boot-dots {
  margin-bottom: 6px;
}

.boot-spinner {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 4px solid var(--muted-line);
  border-top-color: var(--paprika);
  animation: boot-spin 0.8s linear infinite;
  margin-bottom: 6px;
}

.boot-loading-title {
  margin: 0;
  font-size: var(--text-body);
  font-weight: 900;
}

.boot-loading-subtitle {
  margin: 0;
  font-size: var(--text-label);
  line-height: 1.5;
}

@keyframes boot-spin {
  to { transform: rotate(360deg); }
}

.menu-inline-loading {
  margin: 0 40px 20px;
  padding: 12px 14px;
  border: 1px solid var(--muted-line);
  border-radius: var(--r-md);
  background: var(--cream);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-label);
  font-weight: 800;
}

.free-store-banner {
  margin: 12px 40px 0;
  padding: 10px 14px;
  border: 1.5px solid var(--success);
  border-radius: var(--r-md);
  background: var(--bg-success);
  color: var(--text-success);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-label);
  font-weight: 700;
}

.free-store-banner-icon {
  font-size: var(--text-body);
}

.inline-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--muted-line);
  border-top-color: var(--paprika);
  animation: boot-spin 0.8s linear infinite;
}

.panel-toolbar-target {
  width: 100%;
  min-width: 0;
}

.daily-empty-state {
  flex: 1;
  padding: 32px var(--page-pad);
  display: flex;
  align-items: center;
  justify-content: center;
}

.daily-empty-card {
  width: min(460px, 100%);
  padding: 32px 28px;
  border: 1.5px solid var(--muted-line);
  text-align: center;
}

.daily-empty-icon {
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--cream);
  font-size: var(--text-title);
  margin-bottom: 14px;
}

.daily-empty-card h2 {
  margin: 0 0 8px;
  color: var(--ink);
  font-size: var(--text-title);
  font-weight: 900;
}

.daily-empty-card p {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-body);
  line-height: 1.6;
}

.daily-empty-details {
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--cream);
  color: var(--ink);
  text-align: left;
  font-size: var(--text-label);
  font-weight: 700;
  line-height: 1.55;
  list-style-position: inside;
}

.daily-empty-details li + li { margin-top: 6px; }

.daily-empty-action {
  margin-top: 18px;
  padding: 11px 16px;
  border-radius: var(--r-md);
  background: var(--accent-solid);
  color: var(--text-on-accent);
  font-size: var(--text-label);
  font-weight: 800;
  transition: opacity 0.15s, transform 0.12s;
}
.daily-empty-action:hover { opacity: 0.88; }
.daily-empty-action:active { transform: scale(0.98); }

/* ── Search input (in TopHeader) ── */
.search-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
}
.search-input {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: 8px 36px 8px 15px;
  border: 1px solid var(--input-border);
  border-radius: 999px;
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--ink);
  background: var(--input-bg);
  outline: none;
  transition: all 0.15s;
}
.search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--input-focus-ring);
}
.search-input::placeholder { color: var(--text-muted); }

.search-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: var(--text-label);
  transition: background 0.15s, color 0.15s;
}
.search-clear:hover { background: var(--muted-line2); color: var(--ink); }

/* ── Body: 3 columns ── */
.body {
  display: flex;
  align-items: flex-start;
  flex: 1;
}

/* 注意：這裡不可設 overflow-x:hidden——會讓 center-col 變成 sticky 的捲動容器，
   造成 .top-storebar 被釘在容器內 60px 處、蓋住下方店家卡（橫向溢出由 .dish-area 自行處理）。 */
.center-col {
  flex: 1;
  min-width: 0;
  min-height: auto;
}

.top-storebar {
  position: static;
  margin-top: 0;
}

.cart-col {
  /* 平板段（769–1100px）另外收窄，見本檔最下方的 media query：
     332px 固定寬在 769px 時會吃掉 43% 的螢幕，菜單只剩 265px 內容寬，
     連兩欄卡片都排不下，整頁退成一排超寬卡。 */
  width: 332px;
  flex-shrink: 0;
  position: sticky;
  top: var(--header-height);
  height: calc(100dvh - var(--header-height));
  min-height: 0;
  overflow: hidden;
  overscroll-behavior-y: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
  display: flex;
  flex-direction: column;
}

/* 桌面點餐模式：右側購物車跨過頁首，形成完整的視窗高側欄。
   限定桌面寬度：此規則選擇器權重（.body:not(.panel-mode) .cart-col）高於手機
   媒體查詢內的 .cart-col.mobile-open，若不加 min-width 會滲進手機版，把底部
   抽屜的 z-index 壓到 41（低於遮罩 150），導致遮罩蓋住購物車、按鈕點不到。 */
@media (min-width: 769px) {
  .body:not(.panel-mode) .cart-col {
    top: 0;
    z-index: 41;
    height: 100dvh;
    margin-top: calc(-1 * var(--header-height));
  }
}

@supports not (height: 100dvh) {
  .cart-col { height: calc(100vh - var(--header-height)); }
}
@media (min-width: 769px) {
  @supports not (height: 100dvh) {
    .body:not(.panel-mode) .cart-col { height: 100vh; }
  }
}

/* 購物車以圓角卡片浮在頁面底色上（設計稿 1a 右欄） */
.cart-col > :deep(.cart) {
  background: var(--paper);
  overflow: hidden;
}

/* 拖曳把手僅在手機底部抽屜顯示 */
.cart-drawer-handle { display: none; }

/* ── Panel mode: hide menu, expand panel to full width ── */
.body.panel-mode .center-col {
  display: none;
}

.body.panel-mode .cart-col {
  width: 100%;
  border-left: none;
  overflow-y: auto;
  /* 面板（歷史/錢包/統計）根背景皆為 --cream，容器同色避免底部露出不同底色 */
}

.body.panel-mode .cart-col.records-panel {
  overflow-y: hidden;
}

.history-panel {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.history-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.history-scroll :deep(.record-body) {
  padding-bottom: 96px;
}

/* ── Cart FAB (mobile only) ── */
.cart-fab {
  display: none;
  position: fixed;
  /* --mobile-nav-height 已含 safe-area-inset-bottom，這裡不可再加一次 */
  bottom: calc(var(--mobile-nav-height) + 12px);
  right: 16px;
  width: 52px;
  height: 52px;
  padding: 0;
  background: var(--accent-solid);
  color: var(--text-on-accent);
  border-radius: 50%;
  align-items: center;
  justify-content: center;
  gap: 0;
  font-size: var(--text-title);
  z-index: 160;
  box-shadow: 0 4px 20px color-mix(in srgb, var(--selection) 45%, transparent);
  overflow: hidden;
  white-space: nowrap;
  transition:
    width 0.48s cubic-bezier(0.2, 0.9, 0.3, 1.16),
    border-radius 0.36s ease,
    padding 0.36s ease,
    gap 0.36s ease,
    transform 0.15s,
    opacity 0.15s;
}
.cart-fab:active { transform: scale(0.93); }

.cart-fab.has-items {
  width: auto; max-width: calc(100vw - 32px);
  padding: 0 11px 0 15px;
  border-radius: 26px;
  justify-content: flex-start;
  gap: 8px;
  animation: cart-fab-settle 0.58s cubic-bezier(0.2, 0.9, 0.3, 1.16);
}

.fab-icon {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  transition: transform 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.16);
}

.cart-fab.has-items .fab-icon {
  transform: scale(0.9);
}

.fab-label {
  position: relative;
  z-index: 2;
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateX(-9px);
  font-size: var(--text-label);
  font-weight: 800;
  line-height: 1;
  transition:
    max-width 0.38s ease,
    opacity 0.2s ease 0.1s,
    transform 0.38s cubic-bezier(0.2, 0.9, 0.3, 1.16);
}

.cart-fab.has-items .fab-label {
  max-width: 260px;
  opacity: 1;
  transform: translateX(0);
}

.fab-count {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ink);
  color: var(--cream);
  font-size: var(--text-micro);
  font-weight: 900;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* 膠囊延展時在前緣產生一顆短暫液滴，內容層保持清晰。 */
.fab-goo-echo {
  position: absolute;
  top: 10px;
  right: 13px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--selection) 82%, var(--ink));
  opacity: 0;
  transform: translateX(-52px) scale(0.15);
  pointer-events: none;
}

.cart-fab.has-items .fab-goo-echo {
  animation: cart-fab-droplet 0.52s ease-out both;
}

.fab-count-enter-active, .fab-count-leave-active {
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.14s ease;
}
.fab-count-enter-from, .fab-count-leave-to {
  opacity: 0;
  transform: scale(0.45);
}

@keyframes cart-fab-settle {
  0% { transform: scaleX(0.96) scaleY(1.04); }
  58% { transform: scaleX(1.025) scaleY(0.975); }
  100% { transform: scale(1); }
}

@keyframes cart-fab-droplet {
  0% { opacity: 0.9; transform: translateX(-52px) scale(0.15); }
  48% { opacity: 0.65; transform: translateX(-12px) scale(0.88); }
  100% { opacity: 0; transform: translateX(0) scale(1.12); }
}

.mobile-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: var(--overlay);
  z-index: 150;
}

/* ── Mobile ── */
@media (max-width: 768px) {
  .body {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
    flex-direction: column;
  }
  /* Cart hidden from flow; shown as bottom sheet when .mobile-open */
  .cart-col {
    display: none;
    position: fixed;
    top: auto;
    left: 0; right: 0;
    bottom: var(--mobile-nav-height);
    height: 75vh;
    margin-top: 0;
    width: 100%;
    padding: 0;
    border-left: none;
    border-top: 2px solid var(--muted-line);
    border-radius: 20px 20px 0 0;
    box-shadow: var(--shadow-modal);
    z-index: 155;
    overflow: hidden;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
    background: var(--paper);
  }
  .cart-col.mobile-open { display: flex; }
  .cart-col > :deep(.cart) {
    border: none;
    border-radius: 0;
    /* 讓購物車填滿把手下方剩餘空間，不撐破抽屜 */
    flex: 1;
    min-height: 0;
  }

  .cart-drawer-handle {
    display: block;
    flex-shrink: 0;
    width: 40px;
    height: 4px;
    margin: 8px auto 4px;
    border-radius: 999px;
    background: var(--muted-line);
  }

  /* Panel mode (records/stats/store-manager): full screen */
  .body.panel-mode .cart-col {
    display: flex;
    /* --mobile-nav-height 已含 safe-area-inset-bottom，這裡不可再加一次 */
    height: calc(100dvh - var(--mobile-nav-height));
    max-height: calc(100dvh - var(--mobile-nav-height));
    bottom: var(--mobile-nav-height);
    border-radius: 0;
    border-top: none;
    box-shadow: none;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-y: contain;
    touch-action: pan-y;
  }

  @supports not (height: 100dvh) {
    .body.panel-mode .cart-col {
      height: calc(100vh - var(--mobile-nav-height));
      max-height: calc(100vh - var(--mobile-nav-height));
    }
  }

  .cart-fab { display: flex; width: auto; padding: 0 16px; }
  .cart-fab .fab-label { max-width: 260px; opacity: 1; transform: none; white-space: nowrap; }
  .cart-fab .fab-count { display: none; }
  .mobile-backdrop { display: block; }

  /* Center col should fill remaining height */
  .center-col {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    min-height: auto;
  }
  .menu-inline-loading {
    margin: 0 10px 16px;
  }
  .free-store-banner {
    margin: 10px 10px 0;
  }
  .top-storebar {
    position: static;
    border-bottom: 1px solid var(--muted-line);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cart-fab, .cart-fab.has-items, .fab-icon, .fab-label, .fab-goo-echo, .fab-count-enter-active, .fab-count-leave-active {
    animation: none !important;
    transition: none !important;
  }
}

.page, .center-col, .top-storebar, .body.panel-mode .cart-col { background: var(--ink); }
.personal-order-status { padding: 24px 40px; background: var(--ink); color: var(--paper); border-bottom: 1px solid var(--line); }
.personal-order-status strong { font-family: var(--font-display); font-size: var(--text-title); }
.personal-order-status p { color: var(--ink-soft); }
.personal-order-status button { background: transparent; color: var(--paper); border: 1px solid var(--line); }
.cart-col { padding: 18px 18px 0 0; background: var(--ink); }
.cart-col > :deep(.cart) { border: 0; border-radius: 0; }
.home-loading-state { color: var(--paper); }
.boot-loading-title { color: var(--paper); }
.boot-loading-subtitle { color: var(--ink-soft); }
.daily-empty-card { background: var(--paper); border-radius: 8px; box-shadow: var(--shadow-panel); }
.daily-empty-icon { display: none; }
.cart-close { display: none; }
@media (min-width: 769px) {
 .body:not(.panel-mode) .cart-col { top: var(--header-height); height: calc(100dvh - var(--header-height)); margin-top: 0; z-index: 30; }
 .body.panel-mode .cart-col { padding: 0; }
}
@media (max-width: 768px) {
 .personal-order-status { padding: 20px 12px; align-items: flex-start; }
 .personal-order-status strong { font-size: var(--text-lead); }
 .center-col { padding-bottom: 80px; }
 .cart-col.mobile-open { top: 0; bottom: 0; height: 100dvh; border-radius: 0; z-index: 210; padding: calc(12px + env(safe-area-inset-top, 0px)) 0 env(safe-area-inset-bottom, 0px); background: var(--paper); animation: receipt-open .22s ease-out; }
 .cart-close { display: flex; align-self: flex-end; align-items: center; justify-content: center; min-height: 44px; min-width: 64px; margin-right: 12px; color: var(--ink); border: 1px solid var(--ink-faint); border-radius: 4px; }
 .cart-drawer-handle { display: none; }
 .cart-fab, .cart-fab.has-items { left: 12px; right: 12px; width: calc(100% - 24px); max-width: none; justify-content: center; border-radius: 4px; animation: none; gap: 10px; box-shadow: var(--shadow-panel); }
 .fab-goo-echo { display: none; }
}
@keyframes receipt-open { from { transform: translateY(100%); } to { transform: translateY(0); } }

/* 769–1100px：側欄 92 ＋ 購物車 332 之後，中間的菜單區只剩 345px，
   扣掉左右各 40px 內距只有 265px，排不下兩欄（兩欄需要 316px）。
   把購物車收到 300px、菜單內距收到 16px，兩欄就回來了。 */
@media (min-width: 768.02px) and (max-width: 1100px) {
  .body:not(.panel-mode) .cart-col { width: 300px; }
}
</style>
