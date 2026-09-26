<script setup>
import LoadingState from '../ui/LoadingState.vue'
import StatusNotice from '../ui/StatusNotice.vue'
import { formatMoney } from '../../utils/format'
import OrderRow from '../order/OrderRow.vue'
import OrderRowHead from '../order/OrderRowHead.vue'
import { ref, reactive, computed } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useToast } from '../../composables/useToast'
import { confirmDialog } from '../../composables/useDialog'
import { isAddonMenuItem } from '../../utils/menuCategories'
import StoreFilterTabs from './StoreFilterTabs.vue'

const props = defineProps({
  orders:      { type: Array,   default: () => [] },
  allStores:   { type: Array,   default: () => [] },
  loading:     { type: Boolean, default: false },
  storeFilter: { type: String,  default: '__all__' }
})

const emit = defineEmits(['delete', 'cancel', 'toggle-free', 'copy-order', 'save-edit', 'update:store-filter', 'replace-store'])

const { isAdmin, userUid } = useAuth()
const { showToast } = useToast()

const compareZh = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-TW')
const categoryLabels = { lunch: '午餐', drink: '飲料' }
const storeMetaMap = computed(() => {
  const map = new Map()
  props.allStores.forEach(store => { if (store?.name) map.set(store.name, store) })
  return map
})
const storeCategoryLabel = (storeName) => categoryLabels[storeMetaMap.value.get(storeName)?.category] || '未分類'
const phoneHref = phone => `tel:${String(phone || '').replace(/\D/g, '')}`
const mapHref = (address, storeName) => {
  const destination = String(address || storeName || '').trim()
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`
}

const isOwnOrder = (o) => o.uid === userUid.value

// ── 店家分頁 + 搜尋 ───────────────────────────
const searchQuery = ref('')

const orderStoreName = (order) => order.storeName || '未指定店家'

const searchedOrders = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  return props.orders.filter(o => {
    if (props.storeFilter !== '__all__' && orderStoreName(o) !== props.storeFilter) return false
    if (!keyword) return true
    return [o.name, o.storeName, o.meal, o.note].filter(Boolean).join(' ').toLowerCase().includes(keyword)
  })
})

const isOrderOwnerOrOperator = (order) => order.uid === userUid.value || order.orderedByUid === userUid.value
const isCollectedCashOrder = (order) => order.paymentMethod === 'cash' && order.cashStatus === 'collected'
const canModify = (order) => isAdmin.value || isOrderOwnerOrOperator(order)
const canCancel = (order) => !isAdmin.value && isOrderOwnerOrOperator(order) && !isCollectedCashOrder(order)
// 管理員同時滿足兩個條件時，原本會渲染兩顆外觀完全一樣的 ×，一顆走 cancel、
// 一顆走 delete。合併成一顆，並由這裡決定該送哪個事件：自己的單走 cancel
// （一般會員須為本人或代訂人），管理員走管理員刪除。
const canDelete = (order) => canCancel(order) || (isAdmin.value && !isCollectedCashOrder(order))
const deleteEvent = (order) => (canCancel(order) ? 'cancel' : 'delete')

const sortedStoreEntries = computed(() => {
  const groups = new Map()
  searchedOrders.value.forEach(order => {
    const name = order.storeName || '未指定店家'
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(order)
  })
  return [...groups.entries()]
    .map(([name, rows]) => {
      const total = rows.reduce((sum, order) => order.isFree ? sum : sum + (Number(order.price) || 0), 0)
      const category = storeMetaMap.value.get(name)?.category || 'other'
      return {
        name,
        category,
        categoryLabel: storeCategoryLabel(name),
        phone: storeMetaMap.value.get(name)?.phone || '',
        address: storeMetaMap.value.get(name)?.address || '',
        rows: [...rows].sort((a, b) => (b.timestamp ?? b.createdAt?.toMillis?.() ?? 0) - (a.timestamp ?? a.createdAt?.toMillis?.() ?? 0)),
        count: rows.length,
        total
      }
    })
    .sort((a, b) => {
      const catOrder = { lunch: 0, drink: 1, other: 2 }
      const byCategory = (catOrder[a.category] ?? 99) - (catOrder[b.category] ?? 99)
      if (byCategory !== 0) return byCategory
      return compareZh(a.name, b.name)
    })
})

// ── Inline editing ────────────────────────────
const editingId = ref(null)
const editForm  = reactive({ meal: '', note: '', price: 0 })

const editMenuItems = computed(() => {
  if (!editingId.value) return []
  const order = props.orders.find(o => o.id === editingId.value)
  if (!order) return []
  return (props.allStores.find(s => s.name === order.storeName)?.menuItems || [])
    .filter(i => !isAddonMenuItem(i))
})

// 記下開始編輯時的內容：沒改過就直接關，改過才問。
let editSnapshot = ''
const editFingerprint = () => JSON.stringify([editForm.meal, editForm.note, editForm.price])

function startEdit(order) {
  editingId.value = order.id
  Object.assign(editForm, { meal: order.meal, note: order.note || '', price: Number(order.price) || 0 })
  editSnapshot = editFingerprint()
}

async function cancelEdit() {
  if (editingId.value && editFingerprint() !== editSnapshot && !await confirmDialog({
    title: '放棄這次修改？',
    message: '餐點內容已經改過但還沒儲存。',
    variant: 'danger',
    confirmText: '放棄修改',
    cancelText: '繼續編輯',
  })) return
  editingId.value = null
  editSnapshot = ''
}
function onSelectMeal(e) {
  const selected = editMenuItems.value.find(i => i.name === e.target.value)
  if (!selected) return
  editForm.meal = selected.name
  editForm.price = Number(selected.price) || 0
}
function saveEdit(id) {
  if (!editForm.meal.trim()) return
  const price = Math.round(Number(editForm.price) || 0)
  if (price <= 0) { showToast('金額需大於 0', 'error'); return }
  emit('save-edit', { id, meal: editForm.meal.trim(), note: editForm.note.trim(), price })
  editingId.value = null
  editSnapshot = ''
}

function clearSearch() { searchQuery.value = '' }
</script>

<template>
  <div class="orders-table">
    <h2 class="sr-only">今日訂單</h2>
    <!-- 店家分頁 + 搜尋 -->
    <div class="table-toolbar">
      <!-- 手機版改由 DashboardView 掛在 KPI 卡片下方，這裡隱藏 -->
      <StoreFilterTabs
        class="toolbar-filter"
        :orders="orders"
        :all-stores="allStores"
        :model-value="storeFilter"
        @update:model-value="emit('update:store-filter', $event)"
      />
      <div class="search-box app-search-shell">
        <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
        <input v-model="searchQuery" type="text" placeholder="搜尋成員或餐點…" aria-label="搜尋成員或餐點" />
        <button v-if="searchQuery" type="button" class="search-clear app-search-clear" aria-label="清除搜尋" @click="clearSearch">
          <i class="fas fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- 明細列與歷史訂單共用 OrderRow／OrderRowHead；
         一份版面同時服務桌機與手機（窄螢幕由 components.css 折成兩行），
         不再維護桌機表格與手機卡片兩套 markup。 -->
    <div class="table-card order-rows">
      <OrderRowHead v-if="searchedOrders.length" />

      <LoadingState v-if="loading && orders.length === 0" title="正在載入今日訂單…" paper />

      <StatusNotice
        v-else-if="searchedOrders.length === 0"
        :title="orders.length === 0 ? '目前沒有訂單' : '沒有符合條件的訂單'"
        :description="orders.length === 0 ? '有人下單之後會即時出現在這裡。' : '試著清掉搜尋字或換一個店家分頁。'"
      />

      <template v-for="group in sortedStoreEntries" :key="group.name">
        <div class="store-group">
          <div class="store-group-main">
            <span class="store-category-badge">{{ group.categoryLabel }}</span>
            <span class="store-group-name">{{ group.name }}</span>
            <span v-if="group.phone || group.address" class="store-contact">
              <a v-if="group.phone" class="store-phone" :href="phoneHref(group.phone)">
                <i class="fas fa-phone" aria-hidden="true"></i>
                <span>{{ group.phone }}</span>
              </a>
              <a
                v-if="group.address"
                class="store-map"
                :href="mapHref(group.address, group.name)"
                target="_blank"
                rel="noopener noreferrer"
                :title="`在 Google 地圖開啟：${group.address}`"
                :aria-label="`在 Google 地圖開啟 ${group.name} 的地址：${group.address}`"
              >
                <i class="fas fa-location-dot" aria-hidden="true"></i>
              </a>
            </span>
          </div>
          <div class="store-group-meta">
            <span class="store-group-count">{{ group.count }} 筆</span>
            <span class="store-group-total">{{ formatMoney(group.total) }}</span>
            <!-- 固定寬度＝與下方每一列的操作欄同寬，讓「$金額」跟「換店」都跟明細列同一條基線，不再隨是否登入而歪掉 -->
            <span class="store-group-actions">
              <template v-if="userUid">
                <span class="store-group-divider" aria-hidden="true"></span>
                <button type="button" class="replace-store-btn" @click="emit('replace-store', group.name)"><i class="fas fa-right-left" aria-hidden="true"></i> 換店</button>
              </template>
            </span>
          </div>
        </div>

        <OrderRow
          v-for="order in group.rows"
          :key="order.id"
          :order="order"
          :is-self="isOwnOrder(order)"
          :editing="editingId === order.id"
        >
          <template #edit-meal>
            <div class="edit-stack">
              <select v-if="editMenuItems.length" class="edit-select" :value="editForm.meal" @change="onSelectMeal">
                <option v-for="mi in editMenuItems" :key="mi.name" :value="mi.name">
                  {{ mi.name }}（{{ formatMoney(mi.price) }}）
                </option>
              </select>
              <input v-else-if="isAdmin" v-model="editForm.meal" class="edit-input" placeholder="品項" />
              <span v-else class="edit-readonly">{{ editForm.meal }}</span>
              <input v-model="editForm.note" class="edit-input" placeholder="備註" />
            </div>
          </template>

          <template #edit-money>
            <input v-if="isAdmin" v-model="editForm.price" type="number" class="edit-input price-edit" aria-label="金額" />
            <span v-else>{{ formatMoney(editForm.price) }}</span>
          </template>

          <template #actions>
            <template v-if="editingId === order.id">
              <button class="row-btn save" @click="saveEdit(order.id)" aria-label="儲存">✓</button>
              <button class="row-btn cancel" @click="cancelEdit" aria-label="取消">✕</button>
            </template>
            <template v-else>
              <button class="row-btn copy" @click="emit('copy-order', order)" title="我也要！">+1</button>
              <button
                v-if="isAdmin && !isCollectedCashOrder(order)"
                class="row-btn free"
                :class="{ active: order.isFree }"
                @click="emit('toggle-free', order)"
                :title="order.isFree ? '取消免費並恢復個人費用' : '標記免費，不計入個人費用'"
              >免費</button>
              <button v-if="canModify(order)" class="row-btn edit" @click="startEdit(order)" title="編輯">
                <i class="fas fa-pen" aria-hidden="true"></i><span class="edit-label">編輯</span>
              </button>
              <button
                v-if="canDelete(order)"
                class="del-btn"
                @click="emit(deleteEvent(order), order)"
                :title="`刪除 ${order.name || ''} 的 ${order.meal || '訂單'}`"
                :aria-label="`刪除 ${order.name || ''} 的訂單`"
              >×</button>
            </template>
          </template>
        </OrderRow>
      </template>
    </div>
  </div>
</template>

<style scoped>
.replace-store-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 100px;
  padding: 5px 8px;
  border-radius: var(--r-sm);
  color: var(--muted);
  background: transparent;
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
  transition: color 0.15s, background 0.15s;
}
.replace-store-btn:hover { color: var(--accent); background: var(--bg-accent); }
.replace-store-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* ── Toolbar: 店家分頁 + 搜尋 ── */
.table-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.search-box {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 999px;
  padding: 8px 13px;
  width: 230px;
  max-width: 100%;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.search-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--input-focus-ring);
}
.search-box > i { font-size: var(--text-label); color: var(--text-muted); }
.search-box input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--text-label);
  color: var(--ink);
}
.search-box input::placeholder { color: var(--text-muted); }
.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--text-muted);
  font-size: var(--text-label);
}
.search-clear:hover { background: var(--border); color: var(--ink); }

/* ── 明細列容器 ── */
/* 今日訂單一列最多可能同時出現 +1／免費／編輯／刪除四顆按鈕，components.css 的
   預設 --or-col-act(44px) 只夠放歷史訂單的單顆 +1。固定成夠寬的欄位，標題列、
   店家小標與明細列才會共用同一條金額基線，不會因為按鈕數量不同而讓「金額」跳動。 */
.table-card.order-rows { --or-col-act: 220px; }

/* 店家分組小標：與歷史訂單的 .store-subhead 同一個角色 */
.store-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px var(--or-pad-x);
  border-bottom: 1px solid var(--border-strong);
}
.store-group .store-group-meta { margin-left: auto; }
.store-group-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.store-category-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-success);
  color: var(--text-success);
  font-size: var(--text-micro);
  font-weight: 900;
  white-space: nowrap;
}
.store-group-name {
  color: var(--ink);
  font-size: var(--text-lead);
  font-weight: 900;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.store-contact {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 4px;
}
.store-phone {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  text-decoration: none;
  transition: color 0.15s, background 0.15s, border-color 0.15s, transform 0.15s;
}
.store-map {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  transition: color 0.15s, background 0.15s, border-color 0.15s, transform 0.15s;
}
.store-phone {
  gap: 6px;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--paper);
  font-size: var(--text-label);
  font-weight: 800;
  white-space: nowrap;
}
.store-phone i { color: var(--text-success); font-size: var(--text-micro); }
.store-map {
  width: 28px;
  height: 28px;
  border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--border));
  border-radius: 50%;
  background: var(--bg-accent);
  color: var(--text-accent);
  font-size: var(--text-body);
}
.store-phone:hover { color: var(--ink); border-color: var(--border-strong); }
.store-map:hover { color: var(--text-on-accent); background: var(--accent-solid); border-color: var(--accent);  }
.store-phone:focus-visible, .store-map:focus-visible { outline: 3px solid var(--input-focus-ring); outline-offset: 2px; }
.store-group-meta {
  display: flex;
  align-items: center;
  /* 跟明細列 .order-row 的欄距一致，「$金額」與「操作」兩欄的間距才會對上 */
  gap: var(--or-gap);
  color: var(--muted);
  font-size: var(--text-body);
  font-weight: 800;
  white-space: nowrap;
}
.store-group-count { font: inherit; }
/* 跟明細列的 .or-money 同寬、同樣靠右對齊，金額才會落在同一條基線上 */
.store-group-total {
  min-width: var(--or-col-money);
  text-align: right;
  font: inherit;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
/* 跟明細列的 .or-actions 同寬：無論這列有沒有「換店」按鈕，都保留同樣寬度，
   金額欄才不會因為登入狀態不同而左右飄移 */
.store-group-actions {
  min-width: var(--or-col-act);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.store-group-divider { width: 1px; height: 20px; flex-shrink: 0; background: var(--border-strong); }

td {
  padding: 15px 22px;
  vertical-align: middle;
  color: var(--ink);
}
/* ── 操作按鈕（透過 OrderRow 的 actions slot 傳入）──
   .row-btn 與 .row-btn.copy 兩張表共用，定義在 components.css；
   這裡只放今日訂單獨有的幾種變體。 */
.row-btn.free { background: var(--bg-success); color: var(--text-success); }
.row-btn.free:hover, .row-btn.free.active { background: var(--mint); color: var(--text-on-success); }
.row-btn.edit {
  background: var(--input-bg);
  color: var(--text-secondary);
  border: 1.5px solid var(--input-border);
}
.row-btn.edit:hover { background: var(--bg-accent); color: var(--ink); border-color: var(--border-strong); }
.row-btn.save   { background: var(--mint); color: var(--text-on-success); }
.row-btn.cancel { background: var(--border); color: var(--muted); }
.del-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  color: var(--paprika);
  background: transparent;
  font-size: var(--text-title);
  font-weight: 900;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.del-btn:hover { background: var(--paprika); color: var(--paper); border-color: var(--paprika); }

/* Inline edit */
.edit-stack { display: flex; flex-direction: column; gap: 4px; }
.edit-input, .edit-select {
  width: 100%; padding: 7px 9px;
  border: 1.5px solid var(--accent);
  border-radius: var(--r-sm);
  font-size: var(--text-body); font-weight: 700;
  color: var(--ink); background: var(--paper);
  outline: none;
}
.edit-select { cursor: pointer; }
.price-edit { width: 100%; text-align: center; }
/* 編輯中金額欄要放得下輸入框，改寫共用欄寬變數即可 */
:deep(.order-row.is-editing) { --or-col-money: 104px; }
.edit-readonly { display: inline-flex; min-height: 34px; align-items: center; font-weight: 800; }


@media (max-width: 768px) {
  /* 篩選膠囊改掛在 DashboardView 的 KPI 卡片下方 */
  .toolbar-filter { display: none; }
  .search-box { margin-left: 0; width: 100%; }
  .store-group { padding: 12px 14px; }
  /* 桌機的固定欄寬是為了跟明細列對齊金額基線；窄螢幕沒有那麼多欄要對，
     改回讓「換店」貼右、不吃滿整欄寬度，避免手機版留白過多 */
  .store-group .store-group-meta { width: 100%; justify-content: flex-start; }
  .store-group-actions { min-width: 0; margin-left: auto; }
  .store-group-divider { display: none; }
  .replace-store-btn { min-width: 0; }
  /* 窄螢幕只留圖示，四顆鈕才排得下 */
  .edit-label { display: none; }
  .empty { padding: 28px 12px; }
}

.table-card { border: 0; box-shadow: none; }
.store-group { border-color: var(--line); }

.table-card { background: var(--paper); border-radius: 6px; overflow: hidden; }
.store-group { background: var(--paper-2); color: var(--ink); border: 0; border-top: 1px solid var(--ink-faint); }
.store-group .store-group-name, .store-group .store-group-summary { color: var(--ink); }
/* 分隔線改吃 components.css 的虛線，此處只調深淺 */
:deep(.order-row), :deep(.order-row-head) { border-bottom-color: var(--paper-2); }
</style>
