<script setup>
import { ref, computed, nextTick, onUnmounted, watch, toRef } from 'vue'
import { formatMoney } from '../../utils/format'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../../firestore'
import { useAuth } from '../../composables/useAuth'
import { useFirestore } from '../../composables/useFirestore'
import { useToast } from '../../composables/useToast'
import { usePendingCart, createCartRestore } from '../../composables/usePendingCart'
import { cartPortions, cartOptionSummary, cartCustomNote, dishSpecification } from '../../utils/dishOptions'
import { LOW_WALLET_BALANCE, MAX_PRICE, MAX_MEAL_LENGTH, MAX_NOTE_LENGTH, UNDO_DURATION_MS } from '../../constants'

const props = defineProps({
  items: { type: Array, default: () => [] },
  submitting: { type: Boolean, default: false },
  selectedStore: { type: Object, default: null },
  allStores: { type: Array, default: () => [] },
  lastOrder: { type: Object, default: null },
  lastOrderLoading: { type: Boolean, default: false },
  initialOwner: { type: Object, default: null }
})

const emit = defineEmits(['remove', 'submit', 'repeat-last', 'update-items', 'current-name-change', 'current-owner-change', 'edit'])

const { userDisplayName, userUid, isAdmin } = useAuth()
const { membersWithUid, noteGroups, dailyFreeStores, requireMemberData, releaseMemberData, requireQuickNotes, releaseQuickNotes } = useFirestore()
const { showToast } = useToast()

const restoredOwner = props.initialOwner ? { ...props.initialOwner } : null
const isProxy = ref(Boolean(restoredOwner?.isProxy))
const proxyTarget = ref(restoredOwner?.isProxy
  ? (restoredOwner.isManual ? '__manual__' : String(restoredOwner.name || ''))
  : '')
const proxyManual = ref(restoredOwner?.isProxy && restoredOwner?.isManual
  ? String(restoredOwner.name || '')
  : '')

const proxyMembers = computed(() => membersWithUid.value)

const selectedProxyMember = computed(() => {
  if (!isProxy.value || proxyTarget.value === '__manual__') return null
  return proxyMembers.value.find(member => member.name === proxyTarget.value) || null
})

const currentOwner = computed(() => {
  if (!isProxy.value) {
    return {
      name: String(userDisplayName.value || '').trim(),
      uid: userUid.value || '',
      paymentMethod: 'wallet',
      isManual: false,
      isProxy: false,
      hasAccount: Boolean(userUid.value),
    }
  }

  if (proxyTarget.value === '__manual__') {
    return {
      name: proxyManual.value.trim(),
      uid: '',
      paymentMethod: 'cash',
      isManual: true,
      isProxy: true,
      hasAccount: false,
    }
  }

  const member = selectedProxyMember.value
  const initialMember = restoredOwner?.isProxy && !restoredOwner.isManual && restoredOwner.name === proxyTarget.value
    ? restoredOwner
    : null
  const ownerUid = member?.uid || initialMember?.uid || ''
  return {
    name: String(member?.name || proxyTarget.value || '').trim(),
    uid: ownerUid,
    paymentMethod: member ? (member.uid ? 'wallet' : 'cash') : (initialMember?.paymentMethod || 'cash'),
    isManual: false,
    isProxy: true,
    hasAccount: Boolean(ownerUid),
  }
})

const currentName = computed(() => currentOwner.value.name)

watch(currentOwner, (owner, previousOwner) => {
  if (previousOwner && owner.name && owner.name !== previousOwner.name && props.items.length) {
    showToast(`接下來為 ${owner.name} 點餐，已加入的餐點不變`)
  }
  emit('current-name-change', owner.name)
  emit('current-owner-change', { ...owner })
}, { immediate: true })

const ownerPayload = () => ({
  ownerName: currentOwner.value.name,
  ownerUid: currentOwner.value.uid,
  paymentMethod: currentOwner.value.paymentMethod,
})

const avatarInitial = computed(() => (currentName.value || '?')[0].toUpperCase())
const walletBalance = ref(null)
const walletLoading = ref(false)
let stopWallet = null
const canReadWallet = computed(() => isAdmin.value || currentOwner.value.uid === userUid.value)

watch([currentOwner, canReadWallet], ([owner, canRead]) => {
  stopWallet?.()
  stopWallet = null
  walletBalance.value = null
  walletLoading.value = false
  const ownerUid = String(owner?.uid || '').trim()
  if (owner?.paymentMethod !== 'wallet' || !ownerUid || !canRead) return

  walletLoading.value = true
  stopWallet = onSnapshot(doc(db, 'wallets', ownerUid), (snap) => {
    walletBalance.value = snap.exists() ? Number(snap.data().balance) || 0 : 0
    walletLoading.value = false
  }, () => {
    walletBalance.value = null
    walletLoading.value = false
  })
}, { immediate: true })

onUnmounted(() => {
  stopWallet?.()
})

const isWalletPayment = computed(() => currentOwner.value.paymentMethod === 'wallet')
const showLowBalance = computed(() =>
  currentName.value && isWalletPayment.value && walletBalance.value !== null && !walletLoading.value && walletBalance.value < LOW_WALLET_BALANCE
)

function cancelProxy() {
  isProxy.value = false
  proxyTarget.value = ''
  proxyManual.value = ''
  pendingProxyPicker = false
}

// 訂單送出成功後，代訂只套用到這一車；下一次點餐回到登入者本人。
function resetToSelf() {
  cancelProxy()
}

// 送出期間若切頁再回來，由共享草稿的重設同步新掛載的購物車。
watch(() => props.initialOwner, owner => {
  if (!owner) resetToSelf()
})

// 按下「代訂」直接展開對象下拉，不必再點一次選單
const proxySelect = ref(null)
const proxyManualInput = ref(null)
let pendingProxyPicker = false

function openProxyPicker() {
  const el = proxySelect.value
  if (!el) return
  el.focus()
  // showPicker 需要使用者手勢；不支援或手勢逾時就維持 focus 即可
  try { el.showPicker?.() } catch { /* noop */ }
}

function startProxy() {
  isProxy.value = true
  pendingProxyPicker = true
}

// select 一掛上（點代訂後的 next tick）就自動展開；
// 若成員清單尚未就緒（例如剛登入就秒點代訂），先 focus、清單到了再展開，避免開出空選單
watch(proxySelect, (el) => {
  if (!el || !pendingProxyPicker) return
  if (proxyMembers.value.length) {
    pendingProxyPicker = false
    openProxyPicker()
  } else {
    el.focus()
  }
})

watch(proxyMembers, (list) => {
  if (pendingProxyPicker && list.length && proxySelect.value) {
    pendingProxyPicker = false
    openProxyPicker()
  }
})

// 選擇「手動輸入姓名」後，輸入欄位剛由 v-if 建立，下一個畫面更新週期直接把焦點交給它。
watch(proxyTarget, (target) => {
  if (target === '__manual__') {
    nextTick(() => proxyManualInput.value?.focus())
  }
})

const { manualDraft } = usePendingCart()
const manualMeal = toRef(manualDraft, 'meal')
const manualPrice = toRef(manualDraft, 'price')
const manualNote = toRef(manualDraft, 'note')
const showManualNoteOptions = ref(false)
const showManualSection = ref(false)
const manualNoteHasText = computed(() => manualNote.value.trim().length > 0)
const manualPriceError = computed(() => {
  const rawPrice = String(manualPrice.value ?? '').trim()
  if (!rawPrice) return '請輸入金額'

  const price = Number(rawPrice)
  if (!Number.isFinite(price) || Math.round(price) < 1) return '四捨五入後金額需至少 1 元'
  if (price > MAX_PRICE) return `金額不可超過 ${formatMoney(MAX_PRICE)}`
  return ''
})
const canAddManualItem = computed(() => manualMeal.value.trim().length > 0 && !manualPriceError.value)
const manualSectionHasDraft = computed(() =>
  manualMeal.value.trim().length > 0 ||
  manualPrice.value !== '' ||
  manualNote.value.trim().length > 0
)
function storeForCartItem(item) {
  const itemStoreName = String(item?.storeName || '').trim()
  if (!itemStoreName) return props.selectedStore
  return props.allStores.find(store => store.name === itemStoreName || store.id === itemStoreName) || props.selectedStore
}

const DRINK_GROUP_LABELS = new Set(['甜度', '冰量', '溫度'])

function isDrinkItem(item) {
  const store = item ? storeForCartItem(item) : props.selectedStore
  if (store?.category === 'drink') return true
  return /飲料|茶|咖啡|果汁|奶茶/.test(String(item?.category || ''))
}

function customizationGroupsFor(item = null) {
  const groups = Array.isArray(noteGroups.value) ? noteGroups.value : []
  if (isDrinkItem(item)) return groups
  return groups.filter(group => !DRINK_GROUP_LABELS.has(group.label))
}

const noteTokens = (noteText) => (noteText || '').split('、').map(note => note.trim()).filter(Boolean)
const isNoteSelected = (noteText, token) => noteTokens(noteText).includes(token)

function toggleNoteToken(noteText, token) {
  const parts = noteTokens(noteText)
  if (parts.includes(token)) return parts.filter(part => part !== token).join('、')
  return [...parts, token].join('、')
}

function toggleManualNote(token) {
  manualNote.value = toggleNoteToken(manualNote.value, token)
}

function toggleManualSection() {
  showManualSection.value = !showManualSection.value
}

function addManualItem() {
  if (!manualMeal.value.trim()) return
  if (manualPriceError.value) {
    showToast(manualPriceError.value, 'error')
    return
  }
  const price = Math.round(Number(manualPrice.value))
  emit('update-items', [...props.items, {
    _key: Date.now() + Math.random(),
    name: manualMeal.value.trim(),
    price,
    note: manualNote.value.trim(),
    who: currentName.value,
    ...ownerPayload(),
    storeName: props.selectedStore?.name || ''
  }])
  manualMeal.value = ''
  manualPrice.value = ''
  manualNote.value = ''
  showManualNoteOptions.value = false
  showManualSection.value = false
}

// 備註編輯視窗（手動新增／購物車列）是 modal，需支援 Esc 關閉並在開啟時把焦點移入對話框
const noteEditorRef = ref(null)
const noteEditorOpen = computed(() => showManualNoteOptions.value)

function closeNoteEditor() {
  showManualNoteOptions.value = false
}

function onNoteEditorKeydown(e) {
  if (e.key === 'Escape') closeNoteEditor()
}

watch(noteEditorOpen, (open) => {
  if (open) {
    document.addEventListener('keydown', onNoteEditorKeydown)
    // 聚焦對話框容器（非文字框）避免手機自動彈出鍵盤蓋住備註選項
    nextTick(() => noteEditorRef.value?.focus())
  } else {
    document.removeEventListener('keydown', onNoteEditorKeydown)
  }
})

let memberDataRequested = false
let quickNotesRequested = false

// 代訂已對全體開放：購物車掛載時就預載成員清單，點「代訂」的當下清單已就緒，
// 下拉能在同一手勢立即展開，不會出現 Firestore 回來後選單才自己彈開的斷裂感
requireMemberData()
memberDataRequested = true

// Preload once for the ordering screen; opening a dish never swaps default chips for saved chips.
requireQuickNotes()
quickNotesRequested = true

onUnmounted(() => {
  if (memberDataRequested) releaseMemberData()
  if (quickNotesRequested) releaseQuickNotes()
  document.removeEventListener('keydown', onNoteEditorKeydown)
})

const portionCount = computed(() => props.items.reduce((sum, item) => sum + cartPortions(item), 0))
const itemTitle = item => item.displayName || dishSpecification(item).name
const total = computed(() => props.items.reduce((s, i) => s + (Number(i.price) || 0), 0))
// 免費店家品項：保留原價供紀錄，但不列入扣款與應收。
const isFreeStoreItem = (item) => dailyFreeStores.value.includes(String(item?.storeName || '').trim())
const freeTotal = computed(() => props.items.reduce((sum, item) =>
  isFreeStoreItem(item) ? sum + (Number(item.price) || 0) : sum, 0))
const groupedItems = computed(() => {
  const groups = new Map()
  props.items.forEach((item, index) => {
    const name = item.ownerName || item.who || userDisplayName.value
    const payment = item.paymentMethod || 'wallet'
    const key = JSON.stringify([item.ownerUid || name, payment])
    if (!groups.has(key)) groups.set(key, { key, name, payment, total: 0, items: [] })
    const group = groups.get(key)
    group.items.push({ item, index })
    group.total += isFreeStoreItem(item) ? 0 : Number(item.price) || 0
  })
  return [...groups.values()]
})
const cashDueTotal = computed(() => Math.max(0, total.value - freeTotal.value))
const currentWalletCartTotal = computed(() => props.items.reduce((sum, item) => {
  const belongsToCurrentWallet = item.paymentMethod === 'wallet' && item.ownerUid === currentOwner.value.uid
  return belongsToCurrentWallet && !isFreeStoreItem(item) ? sum + (Number(item.price) || 0) : sum
}, 0))
const projectedWalletBalance = computed(() => walletBalance.value === null ? null : walletBalance.value - currentWalletCartTotal.value)
const isProjectedBalanceInsufficient = computed(() => isWalletPayment.value && props.items.length > 0 && projectedWalletBalance.value !== null && projectedWalletBalance.value < 0)
const canSubmit = computed(() =>
  props.items.length > 0 &&
  !props.submitting &&
  !!currentName.value &&
  !isProjectedBalanceInsufficient.value
)

function getItemSub(item) {
  return [cartOptionSummary(item), cartCustomNote(item)].filter(Boolean).join('・')
}

function clearAll() {
  if (!props.items.length) return
  const restore = createCartRestore(props.items)
  emit('update-items', [])
  showToast('已清空購物車', 'success', {
    duration: UNDO_DURATION_MS,
    undoLabel: '復原',
    undoFn: restore
  })
}

function submitCart() {
  if (!props.items.length || props.submitting || !currentName.value) return
  if (isProjectedBalanceInsufficient.value) {
    showToast('餘額不足，請聯繫總務儲值', 'error')
    return
  }
  emit('submit', currentName.value)
}

function triggerSubmit() {
  submitCart()
}

defineExpose({ currentName, currentOwner, ownerPayload, triggerSubmit, resetToSelf })
</script>

<template>
  <div class="cart">
    <div class="cart-header">
      <i class="fas fa-bag-shopping cart-title-icon" aria-hidden="true"></i>
      <span class="cart-title">購物車</span><span v-if="items.length" class="draft-tag">未送出</span>
      <div class="header-right">
        <span class="cart-count-chip" v-if="items.length > 0">{{ items.length }} 項 · {{ portionCount }} 份</span>
        <button v-if="items.length > 0" class="clear-btn" @click="clearAll" title="清空購物車">清空</button>
      </div>
    </div>

    <!-- 代訂切換不加過場：原生下拉要在按下的同一手勢立即彈出，動畫只會讓錨點還在位移時開選單 -->
    <div class="who-section">
        <div v-if="!isProxy" key="own" class="who-row">
          <span class="avatar">{{ avatarInitial }}</span>
          <span class="who-name">{{ userDisplayName || '未命名使用者' }}</span>
          <span class="pay-chip" :class="isWalletPayment ? 'wallet' : 'cash'">
            <i :class="['fas', isWalletPayment ? 'fa-wallet' : 'fa-money-bill-wave']" aria-hidden="true"></i>
            {{ isWalletPayment ? '錢包' : '現金' }}
          </span>
          <button class="proxy-btn" @click="startProxy">代訂</button>
        </div>
        <div v-else key="proxy" class="proxy-row">
          <select aria-label="為誰點餐" ref="proxySelect" v-model="proxyTarget" class="proxy-select">
            <option value="" disabled>選擇代訂對象</option>
            <option v-for="m in proxyMembers" :key="m.name" :value="m.name">
              {{ m.name }}
            </option>
            <option value="__manual__">手動輸入姓名</option>
          </select>
          <input
            v-if="proxyTarget === '__manual__'"
            ref="proxyManualInput"
            v-model="proxyManual"
            class="proxy-input"
            placeholder="輸入姓名..."
            maxlength="20"
          />
          <div class="proxy-foot">
            <span v-if="currentName" class="pay-chip" :class="isWalletPayment ? 'wallet' : 'cash'">
              <i :class="['fas', isWalletPayment ? 'fa-wallet' : 'fa-money-bill-wave']" aria-hidden="true"></i>
              {{ isWalletPayment ? '錢包扣款' : '現金收款' }}
            </span>
            <button class="cancel-proxy" @click="cancelProxy">改為幫自己點餐</button>
          </div>
        </div>
    </div>

    <div class="owner-help">
      <details><summary>代訂說明</summary><p>切換對象只影響之後加入的餐點，已加入的餐點不變。每個人的付款方式與金額會分開列出。</p></details>
    </div>
    <div class="cart-body">
      <section v-for="group in groupedItems" :key="group.key" class="cart-person-group">
      <h3 v-if="groupedItems.length > 1 || group.name !== currentName" class="cart-person-heading">{{ group.name }}<small>{{ group.payment === 'cash' ? '現金應付' : '錢包扣款' }} · {{ formatMoney(group.total) }}</small></h3>
      <TransitionGroup name="ci" tag="div" class="cart-items">
        <div v-for="{ item, index: i } in group.items" :key="item._key" class="ci-wrap">
          <div class="ci-row">
            <button type="button" class="ci-edit" :disabled="submitting" :aria-label="`修改 ${item.name}，${getItemSub(item)}，${item.price} 元`" @click="emit('edit', i)">
            <span class="ci-info">
              <span class="ci-name">
                {{ itemTitle(item) }}
                <span v-if="isFreeStoreItem(item)" class="ci-free-tag">免費</span>
              </span>
              <span class="ci-spec" v-if="cartOptionSummary(item)">{{ cartOptionSummary(item) }}</span>
              <span class="ci-sub" v-if="cartCustomNote(item)">{{ cartCustomNote(item) }}</span>
            </span>
            <span class="ci-price" :class="{ free: isFreeStoreItem(item) }">{{ formatMoney(item.price) }}</span>
            </button>
            <button type="button" class="ci-remove" @click="emit('remove', i)" :aria-label="`移除 ${item.name}`" title="移除餐點">×</button>
          </div>

        </div>
      </TransitionGroup>
      </section>

      <div v-if="items.length === 0" class="cart-empty">
        <span class="cart-empty-icon" aria-hidden="true">
          <i class="fas fa-bag-shopping"></i>
        </span>
        <p class="cart-empty-title">購物車是空的</p>
        <p class="cart-empty-sub">{{ selectedStore ? '從菜單點選餐點加入' : '先從上方選擇店家' }}</p>

        <!-- 空購物車時最需要「重複上一筆」，放這裡當快速起手式 -->
        <!-- 只在確定有上一筆時才出現：沒有紀錄的店家不會先冒出來再消失 -->
        <Transition name="repeat-fade">
          <button
            v-if="lastOrder" class="repeat-btn"
            :disabled="lastOrderLoading"
            @click="emit('repeat-last', currentName)"
          >
            <span class="repeat-label">重複上一筆</span>
            <span class="repeat-hint">{{ lastOrder.storeName }}・{{ lastOrder.meal }} {{ formatMoney(lastOrder.price) }}</span>
          </button>
        </Transition>
      </div>
    <div v-if="selectedStore" class="manual-section">
      <button
        type="button"
        class="manual-toggle"
        :class="{ active: showManualSection || manualSectionHasDraft }"
        @click="toggleManualSection"
      >
        <div class="manual-toggle-copy">
          <span class="manual-label">手動新增餐點</span>
          <span class="manual-hint">
            {{ manualSectionHasDraft ? '草稿未送出' : '菜單沒有也可輸入' }}
          </span>
        </div>
        <i class="fas fa-chevron-down manual-toggle-icon" :class="{ open: showManualSection }"></i>
      </button>
      <Transition name="note-expand">
        <div v-if="showManualSection || manualSectionHasDraft" class="manual-fields">
          <div class="manual-row">
            <input v-model="manualMeal" class="m-input meal" placeholder="餐點名稱" :maxlength="MAX_MEAL_LENGTH" @keyup.enter="addManualItem" />
            <input v-model="manualPrice" class="m-input price mono" placeholder="$ 必填" type="number" inputmode="numeric" min="1" :max="MAX_PRICE" step="1" />
          </div>
          <p v-if="manualMeal.trim() && manualPriceError" class="manual-error">{{ manualPriceError }}</p>
          <div class="manual-row manual-actions-row">
            <button
              type="button"
              class="manual-note-toggle"
              :class="{ active: showManualNoteOptions || manualNoteHasText }"
              @click="showManualNoteOptions = !showManualNoteOptions"
            >
              <i class="fas fa-pen-to-square"></i>
              <span>{{ manualNoteHasText ? manualNote : '備註' }}</span>
            </button>
            <button class="manual-add" @click="addManualItem" :disabled="!canAddManualItem">新增</button>
          </div>

        </div>
      </Transition>
    </div>


    </div>


    <Transition name="popover">
      <div v-if="showManualNoteOptions" class="note-popover-layer">
        <button class="note-popover-backdrop" type="button" aria-label="關閉手動餐點備註" @click="showManualNoteOptions = false"></button>
        <div ref="noteEditorRef" tabindex="-1" class="note-editor" role="dialog" aria-modal="true" aria-label="編輯手動餐點備註">
          <div class="note-editor-header">
            <div>
              <span class="note-editor-title">編輯備註</span>
              <span class="note-editor-item">{{ manualMeal || '手動新增餐點' }}</span>
            </div>
            <button type="button" class="note-editor-close" aria-label="關閉" @click="showManualNoteOptions = false">×</button>
          </div>

          <div class="note-editor-content">
            <div v-for="group in customizationGroupsFor()" :key="group.label" class="note-group">
              <p class="note-group-label">{{ group.label }}</p>
              <div class="note-chips">
                <button
                  v-for="note in group.notes"
                  :key="note"
                  class="note-chip"
                  :class="{ selected: isNoteSelected(manualNote, note) }"
                  @click="toggleManualNote(note)"
                >{{ note }}</button>
              </div>
            </div>
            <label class="note-input-field">
              <span class="note-input-label"><i class="fas fa-keyboard"></i> 自行輸入備註</span>
              <input
                v-model="manualNote"
                class="note-input"
                placeholder="例如：餐具分開、醬料另外放…"
                :maxlength="MAX_NOTE_LENGTH"
                @keyup.enter="showManualNoteOptions = false"
              />
            </label>
          </div>
        </div>
      </div>
    </Transition>

    <div v-if="currentName || items.length" class="cart-footer">
      <div class="checkout-shell">
      <div
        v-if="currentName && isWalletPayment && !walletLoading && walletBalance !== null"
        class="wallet-summary"
        :class="{ insufficient: isProjectedBalanceInsufficient }"
      >
        <div class="wallet-compact">
          <span>{{ currentName }}・錢包</span>
          <span>{{ formatMoney(walletBalance) }} → <strong>{{ projectedWalletBalance.toLocaleString() }}</strong></span>
        </div>
        <p class="wallet-summary-note">送出後餘額<span v-if="groupedItems.length > 1">（僅計此人的錢包扣款）</span></p>
        <p v-if="freeTotal > 0" class="wallet-summary-note free-note">
          免費店家品項 {{ formatMoney(freeTotal) }} 不會扣錢包
        </p>
        <p v-if="isProjectedBalanceInsufficient" class="wallet-summary-note">
          餘額不足，本次還差 {{ formatMoney(Math.abs(projectedWalletBalance)) }}，請聯繫總務儲值
        </p>
        <p v-else-if="showLowBalance" class="wallet-summary-note balance-reminder">
          錢包餘額低於 {{ formatMoney(LOW_WALLET_BALANCE) }}，建議儲值
        </p>
      </div>
      <div v-else-if="currentName && isWalletPayment" class="wallet-summary">
        <div class="wallet-summary-row">
          <span>本次扣款</span>
          <strong>{{ formatMoney(currentWalletCartTotal) }}</strong>
        </div>
        <p class="wallet-summary-note">{{ walletLoading ? '正在讀取餘額…' : '送出時會確認錢包餘額，餘額不足不會扣款。' }}</p>
      </div>
      <div v-else-if="currentName && !isWalletPayment" class="wallet-summary cash-mode">
        <div class="wallet-summary-row">
          <span>付款方式</span>
          <strong>現金收款</strong>
        </div>
        <div class="wallet-summary-row">
          <span>目前對象應收</span>
          <strong>{{ formatMoney(groupedItems.filter(g => g.name === currentName && g.payment === 'cash').reduce((sum, g) => sum + g.total, 0)) }}</strong>
        </div>
        <p v-if="freeTotal > 0" class="wallet-summary-note free-note">
          免費店家品項 {{ formatMoney(freeTotal) }} 不列入應收
        </p>
        <p class="wallet-summary-note">送出後會建立現金應收，管理員可在「現金收款」標記已收。</p>
      </div>

      <div v-if="freeTotal > 0" class="total-row free-breakdown">
        <span class="total-label">餐點原價</span>
        <span class="total-value mono">{{ formatMoney(total) }}</span>
      </div>
      <div v-if="freeTotal > 0" class="total-row free-total-row">
        <span class="total-label">今日免費不收費</span>
        <span class="total-value mono">- {{ formatMoney(freeTotal) }}</span>
      </div>

      <div v-if="items.length" class="total-row">
        <span class="total-label">合計</span>
        <span class="total-value mono">{{ formatMoney(cashDueTotal) }}</span>
      </div>

      <button
        v-if="items.length"
        class="submit-btn"
        :disabled="!canSubmit"
        @click="submitCart"
      >
        <span v-if="submitting" class="submit-spinner" aria-hidden="true"></span>
        <template v-if="submitting">送出中…</template>
        <template v-else-if="items.length > 0">送出 {{ portionCount }} 份 · {{ formatMoney(cashDueTotal) }}</template>
        <template v-else>送出訂單</template>
      </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wallet-compact { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 8px; color: var(--text-secondary); font-size: var(--text-label); }
.wallet-compact strong { color: var(--text-primary); }
.free-breakdown .total-value { font-size: var(--text-label); }
.ordering-context { padding: 10px 16px; color: var(--ink); background: var(--bg-highlight); font-weight: 700; font-size: var(--text-label); }
.ordering-context small { display: block; margin-top: 4px; color: var(--muted); font-weight: 400; }
.cart-person-heading { padding: 16px 16px 6px; font-size: var(--text-body); color: var(--ink); }
.cart-person-heading small { display: block; margin-top: 4px; color: var(--muted); font-size: var(--text-label); }

.cart {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.cart-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 18px 12px;
  flex-shrink: 0;
}

.cart-title-icon {
  color: var(--text-accent);
  font-size: var(--text-lead);
}

.cart-title {
  font-size: var(--text-lead);
  color: var(--ink);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.cart-count-chip {
  font-family: var(--font-display);
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--text-accent);
  background: var(--bg-accent);
  border-radius: 999px;
  padding: 2px 10px;
}

.clear-btn {
  font-size: var(--text-micro);
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-danger);
  transition: all 0.15s;
}
.clear-btn:hover { background: var(--paprika-soft); border-color: var(--bg-danger); }

.who-section {
  padding: 0 14px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--muted-line2);
}

/* 為誰點餐卡：以紫色系（tag-dinner token）呼應設計稿的代訂視覺 */
.who-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
}

.avatar {
  background: var(--jade);
  width: 30px;
  height: 30px;
  border-radius: 9px;
  font-family: var(--font-display);
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--paper);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.who-name {
  flex: 1;
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proxy-btn {
  font-size: var(--text-label);
  font-weight: 700;
  padding: 5px 11px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--tag-dinner-text) 25%, transparent);
  background: var(--paper);
  color: var(--tag-dinner-text);
  transition: all 0.15s;
  flex-shrink: 0;
}
.proxy-btn:hover { background: var(--tag-dinner-bg); filter: brightness(0.98); }

/* 付款方式標示：讓使用者送出前一眼確認錢包或現金 */
.pay-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--text-micro);
  font-weight: 800;
  white-space: nowrap;
  flex-shrink: 0;
}
.pay-chip i { font-size: var(--text-micro); }
.pay-chip.wallet { background: var(--bg-accent); color: var(--text-accent); }
.pay-chip.cash   { background: var(--bg-highlight); color: var(--text-highlight); }

.proxy-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.proxy-row { display: flex; flex-direction: column; gap: 6px; }

.proxy-select, .proxy-input {
  padding: 7px 10px;
  border-radius: var(--r-sm);
  border: 1.5px solid var(--muted-line);
  background: var(--cream);
  color: var(--ink);
  font-size: var(--text-label);
  font-weight: 600;
  outline: none;
  width: 100%;
}
.proxy-select:focus, .proxy-input:focus { border-color: var(--ink); }

.cancel-proxy {
  margin-left: auto;
  font-size: var(--text-micro);
  font-weight: 700;
  color: var(--paprika);
  transition: opacity 0.15s;
}
.cancel-proxy:hover { opacity: 0.7; }

.manual-section {
  padding: 10px 16px;
  border-bottom: 1px solid var(--muted-line2);
  flex-shrink: 0;
}

.manual-toggle {
  width: 100%;
  border-radius: var(--r-sm);
  color: var(--ink);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  transition: all 0.15s;
}
/* hover 只提一階，強調色（柿橘）保留給「已選取」，兩者才分得開 */
.manual-toggle:hover {
  border-color: var(--border-strong);
}
.manual-toggle.active {
  border-color: color-mix(in srgb, var(--selection) 55%, transparent);
  background: var(--selection-soft);
}

.manual-toggle-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.manual-label {
  font-weight: 800;
}

.manual-hint {
  font-size: var(--text-micro);
  font-weight: 600;
  color: var(--muted);
}

.manual-toggle-icon {
  flex-shrink: 0;
  font-size: var(--text-label);
  color: var(--muted);
  transition: transform 0.18s ease, color 0.15s ease;
}
.manual-toggle.active .manual-toggle-icon { color: var(--selection); }
.manual-toggle-icon.open { transform: rotate(180deg); }

.manual-fields {
  margin-top: 8px;
}

.manual-row { display: flex; gap: 6px; margin-bottom: 6px; }
.manual-row:last-child { margin-bottom: 0; }

.manual-error {
  margin: -1px 0 6px;
  color: var(--paprika);
  font-size: var(--text-micro);
  font-weight: 800;
}

/* 手動輸入四個欄位（名稱/金額/備註/新增）統一高度與圓角，對齊整齊 */
.m-input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border-radius: var(--r-md);
  border: 1.5px solid var(--muted-line);
  background: var(--cream);
  color: var(--ink);
  font-size: var(--text-label);
  outline: none;
  transition: border-color 0.15s;
}
.m-input:focus { border-color: var(--ink); }
.m-input.price { width: 84px; flex: none; text-align: center; }
.m-input.price::-webkit-inner-spin-button, .m-input.price::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.m-input.price[type=number] { -moz-appearance: textfield; appearance: textfield; }
.m-input::placeholder { color: var(--muted); }

.manual-actions-row { align-items: center; }

.manual-note-toggle {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border-radius: var(--r-md);
  border: 1.5px solid var(--muted-line);
  background: var(--cream);
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  transition: all 0.15s;
}
.manual-note-toggle span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.manual-note-toggle:hover {
  border-color: var(--border-strong);
}
.manual-note-toggle.active {
  border-color: var(--selection);
  color: var(--text-accent);
  /* --selection-soft 與 --cream 同色，開啟後看不出來，改疊一層柿橘 */
  background: color-mix(in srgb, var(--persimmon) 14%, var(--paper));
}

.manual-note-panel {
  margin-top: 8px;
  padding: 10px;
  border-radius: var(--r-sm);
  background: var(--cream);
  border: 1px solid var(--muted-line2);
}
.manual-note-panel .note-input { background: var(--paper); }

.manual-add {
  height: 38px;
  padding: 0 16px;
  border-radius: var(--r-md);
  background: var(--success);
  color: var(--text-on-success);
  font-size: var(--text-label);
  font-weight: 700;
  flex-shrink: 0;
  transition: opacity 0.15s;
}
.manual-add:disabled { opacity: 0.4; cursor: not-allowed; }
.manual-add:hover:not(:disabled) { opacity: 0.85; }

.cart-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--muted-line) transparent;
}

.cart-items { display: flex; flex-direction: column; }
.ci-wrap + .ci-wrap { border-top-color: var(--muted-line2); }

.ci-row {
  display: flex;
  align-items: stretch;
  padding-right: 10px;
}

.ci-edit {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 12px 8px 12px 16px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ci-edit:hover:not(:disabled) { background: var(--selection-soft); }
.ci-edit:focus-visible { outline: 2px solid var(--selection); outline-offset: -2px; }
.ci-edit:disabled { cursor: default; }

.ci-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ci-name {
  font-size: var(--text-body);
  color: var(--ink);
}

.ci-spec { font-size: var(--text-label); color: var(--text-secondary); font-weight: 600; overflow-wrap: anywhere; }
.ci-sub {
  overflow-wrap: anywhere;
  font-size: var(--text-label);
  color: var(--text-secondary);
  font-weight: 500;
}

.ci-price {
  font-size: var(--text-body);
  font-weight: 700;
  color: var(--ink);
  flex-shrink: 0;
  padding-top: 1px;
}

.ci-remove {
  font-size: var(--text-lead);
  color: var(--muted);
  flex-shrink: 0;
  line-height: 1;
  transition: color 0.15s;
  padding: 12px 6px;
  min-width: 32px;
  align-self: stretch;
}
.ci-remove:hover { color: var(--paprika); }

.note-editor {
  position: absolute;
  z-index: 2;
  left: 12px;
  right: 12px;
  top: 96px;
  max-height: calc(100% - 120px);
  display: flex;
  flex-direction: column;
  border: 2px solid color-mix(in srgb, var(--selection) 72%, var(--muted-line));
  border-radius: var(--r-lg);
  background: color-mix(in srgb, var(--selection) 8%, var(--paper));
  box-shadow:
    0 22px 64px color-mix(in srgb, var(--ink) 55.00000000000001%, transparent),
    0 0 0 4px color-mix(in srgb, var(--selection) 20%, transparent);
  overflow: hidden;
}
/* 容器僅為程式化聚焦（Esc/無障礙），不需視覺焦點框 */
.note-editor:focus { outline: none; }

.note-popover-layer {
  position: absolute;
  inset: 0;
  z-index: 40;
}

.note-popover-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: color-mix(in srgb, var(--ink) 68%, transparent);
  backdrop-filter: blur(2px);
  border: 0;
}

.note-editor-header {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--selection) 45%, var(--muted-line));
  background: color-mix(in srgb, var(--selection) 14%, var(--paper));
  flex-shrink: 0;
}

.note-editor-title, .note-editor-item { display: block; }
.note-editor-title { color: var(--ink); font-size: var(--text-body); font-weight: 800; }
.note-editor-item { color: var(--muted); font-size: var(--text-micro); margin-top: 2px; }
.note-editor-close {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--muted);
  font-size: var(--text-lead);
}
.note-editor-close:hover { background: var(--muted-line2); color: var(--ink); }

.note-editor-content {
  padding: 12px 14px 14px;
  background: color-mix(in srgb, var(--selection) 5%, var(--cream));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.note-group { margin-bottom: 8px; }

.note-group-label {
  font-size: var(--text-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--muted);
  margin-bottom: 5px;
}

.note-chips { display: flex; flex-wrap: wrap; gap: 5px; }

.note-chip {
  padding: 4px 9px;
  border-radius: var(--r-sm);
  font-size: var(--text-label);
  font-weight: 600;
  border: 1px solid var(--muted-line);
  color: var(--muted);
  transition: all 0.15s;
}
.note-chip:hover { border-color: var(--ink); color: var(--ink); }
.note-chip.selected {
  background: var(--accent-solid);
  border-color: var(--selection);
  color: var(--text-on-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--selection) 22%, transparent);
}

.addon-group {
  padding-bottom: 8px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--muted-line2);
}

.addon-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-color: var(--success);
  background: var(--mint-soft);
  color: var(--mint);
}
.addon-chip:hover { border-color: var(--mint); color: var(--mint); }
.addon-chip.selected {
  background: var(--accent-solid);
  border-color: var(--selection);
  color: var(--text-on-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--selection) 22%, transparent);
}

.addon-price {
  font-size: var(--text-micro);
  font-weight: 800;
}

.note-input {
  width: 100%;
  min-height: 48px;
  padding: 11px 13px;
  border-radius: var(--r-sm);
  border: 2px solid color-mix(in srgb, var(--selection) 48%, var(--muted-line));
  background: color-mix(in srgb, var(--selection) 5%, var(--paper));
  color: var(--ink);
  font-size: var(--text-body);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.note-input:focus {
  border-color: var(--selection);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--selection) 15%, transparent);
}
.note-input::placeholder { color: var(--muted); }

.note-input-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--muted-line);
}

.note-input-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink);
  font-size: var(--text-label);
  font-weight: 800;
}

.note-input-label i { color: var(--selection); }

.cart-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: var(--muted);
}

.cart-empty-icon {
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--cream);
  color: var(--muted);
  font-size: var(--text-lead);
  margin-bottom: 10px;
}

.cart-empty-title {
  font-size: var(--text-label);
  font-weight: 800;
  color: var(--text-secondary);
}

.cart-empty-sub {
  margin-top: 3px;
  font-size: var(--text-label);
  color: var(--muted);
}

.cart-footer {
  padding: 14px 16px;
  flex-shrink: 0;
}

.checkout-shell {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wallet-summary {
  color: var(--ink);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wallet-summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.wallet-summary-row span {
  font-size: var(--text-micro);
  font-weight: 800;
  color: var(--muted);
}

.wallet-summary-row strong {
  font-size: var(--text-label);
  font-weight: 900;
  color: var(--ink);
}

.wallet-summary-row.remain {
  padding-top: 6px;
  border-top: 1px dashed var(--muted-line);
}

.wallet-summary-row.remain strong {
  font-size: var(--text-body);
}

.wallet-summary.insufficient .wallet-summary-note {
  color: var(--paprika);
}

.wallet-summary-note {
  color: var(--muted);
  margin: 0;
  font-size: var(--text-label);
  font-weight: 500;
}

.total-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.total-label {
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--muted);
}

.total-value {
  font-size: var(--text-title);
  font-weight: 800;
  color: var(--text-accent);
}

.free-total-row .total-label, .free-total-row .total-value {
  font-size: var(--text-label);
  color: var(--success);
  font-weight: 800;
}

.ci-free-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--bg-success);
  border: 1px solid var(--success);
  color: var(--text-success);
  font-size: var(--text-micro);
  font-weight: 800;
  vertical-align: 1px;
  white-space: nowrap;
}

.ci-price.free {
  color: var(--success);
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
}

.wallet-summary-note.free-note {
  color: var(--text-success);
}

.submit-btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px;
  color: var(--text-on-accent);
  font-size: var(--text-body);
  font-weight: 800;
  transition: background 0.15s, transform 0.12s, opacity 0.15s;
}
.submit-btn:hover:not(:disabled) { background: var(--accent-hover); }
.submit-btn:active:not(:disabled) { transform: scale(0.98); }
.submit-btn:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }

.submit-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--paper) 40%, transparent);
  border-top-color: var(--paper);
  animation: cart-submit-spin 0.7s linear infinite;
}

@keyframes cart-submit-spin {
  to { transform: rotate(360deg); }
}

/* 空購物車內的「重複上一筆」快速起手式 */
.repeat-btn {
  margin: 16px auto 0;
  max-width: 100%;
  padding: 8px 14px;
  border-radius: var(--r-sm);
  border: 1px solid var(--muted-line);
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 600;
  text-align: left;
  transition: all 0.15s;
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}
.repeat-btn:hover:not(:disabled) { border-color: var(--ink); color: var(--ink); }
.repeat-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.repeat-label { flex-shrink: 0; }

.repeat-hint {
  font-size: var(--text-micro);
  font-weight: 500;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.repeat-btn:hover:not(:disabled) .repeat-hint { color: var(--text-secondary); }

/* 出現／消失都走淡入淡出，避免切換店家時的硬跳 */
.repeat-fade-enter-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.repeat-fade-leave-active { transition: opacity 0.12s ease; }
.repeat-fade-enter-from { opacity: 0; transform: translateY(-4px); }
.repeat-fade-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .repeat-fade-enter-active, .repeat-fade-leave-active { transition: none; }
}

.ci-enter-active { transition: all 0.18s; }
.ci-leave-active { transition: all 0.15s; }
.ci-enter-from { opacity: 0; transform: translateX(-6px); }
.ci-leave-to { opacity: 0; }

.note-expand-enter-active, .note-expand-leave-active {
  transition: opacity 0.22s ease, max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.note-expand-enter-from, .note-expand-leave-to { opacity: 0; max-height: 0; }
.note-expand-enter-to, .note-expand-leave-from { max-height: 350px; }

.popover-enter-active, .popover-leave-active { transition: opacity 0.16s ease; }
.popover-enter-active .note-editor, .popover-leave-active .note-editor { transition: transform 0.18s ease, opacity 0.16s ease; }
.popover-enter-from, .popover-leave-to { opacity: 0; }
.popover-enter-from .note-editor, .popover-leave-to .note-editor { opacity: 0; transform: translateY(-8px) scale(0.98); }

.cart { background: var(--paper); color: var(--ink); border-radius: 0; }
.cart::before { content: ''; display: block; flex: 0 0 10px; background: linear-gradient(45deg, var(--ink) 25%, transparent 25%), linear-gradient(-45deg, var(--ink) 25%, transparent 25%); background-size: 14px 14px; }
.cart-title, .ci-name { font-family: var(--font-display); font-weight: 600; }
.ci-wrap, .ci-wrap + .ci-wrap { border-top: 1px dashed var(--ink-faint); }
.who-row { background: var(--paper-2); border: 0; border-radius: 4px; }
.cart-footer { border-top: 2px solid var(--ink); }
.submit-btn { border-radius: 4px; background: var(--accent-solid); box-shadow: none; letter-spacing: .08em; }
.cart-empty-icon { display: none; }
.cart-empty-title { font-family: var(--font-display); }
.ci-price, .total-value, .wallet-summary-row strong { font-family: var(--font-sans); font-variant-numeric: tabular-nums; }

.draft-tag { color: var(--muted); background: var(--bg-inset); border-radius: 6px; padding: 3px 6px; font-size: var(--text-micro); white-space: nowrap; }
.owner-help { padding: 0 16px 10px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; color: var(--muted); font-size: var(--text-label); }
.owner-help details { max-width: 100%; }
.owner-help summary { cursor: pointer; padding: 4px 0; }
.owner-help p { padding: 8px 0; line-height: 1.6; }
.cart-body .manual-section { padding: 10px 4px; border: 0; }
.manual-toggle { background: transparent; border: 0; padding: 8px; }
.manual-label { font-size: var(--text-label); color: var(--muted); }
.manual-hint { display: none; }
.checkout-shell { border: 0; border-radius: 0; overflow: visible; background: transparent; padding: 0; box-shadow: none; }
.wallet-summary { border: 1px solid var(--border); border-radius: 12px; background: var(--bg-inset); padding: 12px; box-shadow: none; }
/* 餘額不足／偏低原本底色與正常狀態同為 --bg-inset，等於沒有警示 */
.wallet-summary.low { background: var(--bg-warning); border-color: var(--warning); padding: 10px; border-radius: 8px; }
.wallet-summary.insufficient { background: var(--bg-highlight); border-color: var(--danger); padding: 10px; border-radius: 8px; }
.wallet-summary.insufficient .remain strong { color: var(--text-danger); }
.wallet-summary .balance-reminder { color: var(--muted); font-weight: 400; }
.cart-empty { padding: 28px 10px 18px; }
</style>
