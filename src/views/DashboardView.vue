<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useHomeActions } from '../composables/useHomeActions'
import { useFirestore } from '../composables/useFirestore'
import { useAuth } from '../composables/useAuth'
import { useToast } from '../composables/useToast'
import { usePendingCart } from '../composables/usePendingCart'
import { escapeCSV } from '../utils/csv'
import { isCashOrder, orderPaymentStatus } from '../utils/orderPayment'
import { formatTimeShort, getLocalDateKey } from '../utils/format'
import {
  cancelOrdersWithWalletRefundViaFunction,
  setOrderFreeStatusWithWalletAdjustmentViaFunction,
  updateOrderWithPaymentAdjustmentViaFunction,
} from '../services/walletFunctions'
import TopHeader from '../components/layout/TopHeader.vue'
import KpiRow from '../components/dashboard/KpiRow.vue'
import OrdersTable from '../components/dashboard/OrdersTable.vue'
import StoreSidebar from '../components/dashboard/StoreSidebar.vue'
import StoreFilterTabs from '../components/dashboard/StoreFilterTabs.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import DiningRecovery from '../components/dashboard/DiningRecovery.vue'
import { confirmDialog } from '../composables/useDialog'

const router = useRouter()
const diningRecovery = ref(null)
const { todayOrders, diningDay, diningLoading, diningError, members, membersReady, allStores, ordersLoading, requireMemberData, releaseMemberData } = useFirestore()
const pendingNeeds = computed(() => Object.values(diningDay.value.needs || {}).filter(n => n.status === 'pending'))
const diningPeople = computed(() => {
  const people = new Set(Object.values(diningDay.value.participants || {}).map(p => p.uid || p.name))
  todayOrders.value.forEach(o => people.add(o.ownerUid || o.walletOwnerUid || o.name))
  return people.size
})
const { showToast } = useToast()
const { pendingItem } = usePendingCart()

const pendingDeletionIds = ref(new Set())

function markOrdersPendingDeletion(orderIds) {
  pendingDeletionIds.value = new Set([...pendingDeletionIds.value, ...orderIds])
}

function unmarkOrdersPendingDeletion(orderIds) {
  const next = new Set(pendingDeletionIds.value)
  orderIds.forEach(id => next.delete(id))
  pendingDeletionIds.value = next
}

// 樂觀覆蓋層：免費切換與編輯儲存都要等雲端函式往返，先在本地即時反映（比照 ✕ 的樂觀刪除），
// 待 Firestore 快照回推真值、且真值已等於樂觀值時由 watcher 清除；函式失敗則立即還原。
const optimisticOverrides = ref(new Map())

function setOrderOverride(orderId, patch) {
  const next = new Map(optimisticOverrides.value)
  next.set(orderId, { ...(next.get(orderId) || {}), ...patch })
  optimisticOverrides.value = next
}

function clearOrderOverride(orderId) {
  if (!optimisticOverrides.value.has(orderId)) return
  const next = new Map(optimisticOverrides.value)
  next.delete(orderId)
  optimisticOverrides.value = next
}

const sameFieldValue = (a, b) => {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b)
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return String(a ?? '') === String(b ?? '')
}

watch(todayOrders, (orders) => {
  if (!optimisticOverrides.value.size) return
  const next = new Map(optimisticOverrides.value)
  let changed = false
  orders.forEach(order => {
    const patch = next.get(order.id)
    if (patch && Object.keys(patch).every(key => sameFieldValue(order[key], patch[key]))) {
      next.delete(order.id)
      changed = true
    }
  })
  if (changed) optimisticOverrides.value = next
})

onMounted(() => {
  requireMemberData()
})

onUnmounted(() => {
  releaseMemberData()
})

const visibleTodayOrders = computed(() =>
  todayOrders.value
    .filter(order => !pendingDeletionIds.value.has(order.id))
    .map(order => {
      const patch = optimisticOverrides.value.get(order.id)
      return patch ? { ...order, ...patch } : order
    })
)

const dashboardStoreFilter = ref('__all__')
const filteredTodayOrders = computed(() => {
  if (dashboardStoreFilter.value === '__all__') return visibleTodayOrders.value
  return visibleTodayOrders.value.filter(order =>
    (order.storeName || '未指定店家') === dashboardStoreFilter.value
  )
})

const hasOrders = computed(() => visibleTodayOrders.value.length > 0)

// 被選中的店家今天已經沒有訂單時（最後一筆被刪或取消），退回「全部」，
// 否則畫面會停在一個空的篩選上。原本這段守在 OrdersTable，篩選膠囊移出後改由此處負責。
watch(visibleTodayOrders, (orders) => {
  if (dashboardStoreFilter.value === '__all__') return
  const storeNames = new Set(orders.map(order => order.storeName || '未指定店家'))
  if (!storeNames.has(dashboardStoreFilter.value)) dashboardStoreFilter.value = '__all__'
})

const { isAdmin, userDisplayName } = useAuth()
// 今日訂單一律呈現全部訂單；個人視角由訂單列上的「你」標記辨識
const displayOrders = computed(() => visibleTodayOrders.value)

// 刪除是不可逆的（會連帶退款），而且那顆 × 就貼在「編輯」旁邊。
// 整批清空一直都有確認框，單筆反而沒有，這裡補齊。
async function confirmOrderDeletion(order) {
  return confirmDialog({
    title: '刪除這筆訂單？',
    message: `${order.name || '這位同事'}的「${order.meal || '訂單'}」`,
    detail: '刪除後會自動退款到錢包，無法復原。',
    variant: 'danger',
    confirmText: '刪除並退款',
  })
}

async function deleteOrder(order) {
  if (!isAdmin.value) { showToast('僅管理員可刪除', 'error'); return }
  if (order.paymentMethod === 'cash' && order.cashStatus === 'collected') { showToast('已收現金單不可刪除', 'error'); return }
  if (!await confirmOrderDeletion(order)) return
  const orderIds = [order.id]
  markOrdersPendingDeletion(orderIds)
  try {
    await cancelOrdersWithWalletRefundViaFunction({
      orderIds,
      actorName: userDisplayName.value,
      reason: '管理員刪除訂單退款',
    })
    showToast('已刪除並完成退款', 'success')
  } catch (err) {
    unmarkOrdersPendingDeletion(orderIds)
    showToast(err.message === 'CASH_PAYMENT_ALREADY_COLLECTED' ? '已收現金單不可刪除' : '刪除失敗，已恢復訂單', 'error')
  }
}

async function cancelOrder(order) {
  if (!await confirmOrderDeletion(order)) return
  const orderIds = [order.id]
  markOrdersPendingDeletion(orderIds)
  try {
    await cancelOrdersWithWalletRefundViaFunction({
      orderIds,
      actorName: userDisplayName.value,
      reason: '員工刪除訂單退款',
    })
    showToast('已刪除訂單並退款', 'success')
  } catch {
    unmarkOrdersPendingDeletion(orderIds)
    showToast('刪除失敗，已恢復訂單', 'error')
  }
}

function copyOrder(order) {
  pendingItem.value = order
  router.push('/')
}

async function toggleFreeOrder(order) {
  if (!isAdmin.value) { showToast('僅管理員可操作', 'error'); return }
  if (order.paymentMethod === 'cash' && order.cashStatus === 'collected') { showToast('已收現金單不可切換免費', 'error'); return }
  const target = !order.isFree
  setOrderOverride(order.id, { isFree: target })   // 樂觀：立即切換免費狀態
  try {
    await setOrderFreeStatusWithWalletAdjustmentViaFunction({
      orderId: order.id,
      isFree: target,
      actorName: userDisplayName.value,
    })
    showToast(target ? '已標記免費，不計入個人費用' : '已取消免費並恢復個人費用', 'success')
  } catch (err) {
    clearOrderOverride(order.id)   // 失敗還原
    const message = err.message === 'INSUFFICIENT_WALLET_BALANCE'
      ? '錢包餘額不足，無法取消免費'
      : err.message === 'CASH_PAYMENT_ALREADY_COLLECTED'
        ? '已收現金單不可切換免費'
        : '免費操作失敗'
    showToast(message, 'error')
  }
}

// 編輯儲存：由 OrdersTable 完成驗證後上拋，父層先樂觀覆蓋新內容再送雲端函式。
async function saveOrderEdit({ id, meal, note, price }) {
  setOrderOverride(id, { meal, note, price })   // 樂觀：立即顯示新內容
  try {
    await updateOrderWithPaymentAdjustmentViaFunction({
      orderId: id,
      meal,
      note,
      price,
      actorName: userDisplayName.value,
    })
    showToast('已更新')
  } catch (err) {
    clearOrderOverride(id)   // 失敗還原
    const message = err.message === 'INSUFFICIENT_WALLET_BALANCE'
      ? '錢包餘額不足，無法改成較高金額'
      : err.message === 'CASH_PAYMENT_ALREADY_COLLECTED'
        ? '已收現金單不可調整金額'
        : err.message === 'MENU_ITEM_PRICE_MISMATCH'
          ? '餐點或價格已更新，請重新選擇'
          : '更新失敗'
    showToast(message, 'error')
  }
}

// ── 匯出今日訂單 CSV ──────────────────────────
const csvExporting = ref(false)

async function exportTodayCSV() {
  if (csvExporting.value || !hasOrders.value) return
  if (diningLoading.value || diningError.value) { showToast('尚未確認用餐名單，請稍後或重新整理再匯出', 'error'); return }
  if (pendingNeeds.value.length && !await confirmDialog({ title: '仍有人尚未重新點餐', message: `待補點：${[...new Set(pendingNeeds.value.map(n => n.name))].join('、')}`, detail: '本次 CSV 僅包含有效餐點，不代表所有用餐人員已點齊。', confirmText: '仍要匯出有效訂單' })) return
  csvExporting.value = true
  try {
    const headers = ['成員', '店家', '餐點', '備註', '金額', '付款', '狀態', '時間']
    const list = [...visibleTodayOrders.value].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    const rows = list.map(o => [
      o.name, o.storeName, o.meal, o.note || '', o.price,
      isCashOrder(o) ? '現金' : '錢包',
      orderPaymentStatus(o),
      formatTimeShort(o.timestamp || o.createdAt?.toMillis?.() || Date.now())
    ])
    const totalAmount = list.reduce((sum, o) => o.isFree ? sum : sum + (Number(o.price) || 0), 0)
    const totalsRow = ['合計', '', `${list.length} 筆`, '', totalAmount, '', '', '']
    const csv = [headers, ...rows, totalsRow].map(r => r.map(escapeCSV).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `今日訂單_${getLocalDateKey()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast('今日訂單 CSV 已匯出', 'success')
  } catch (error) {
    console.error('[Dashboard] CSV export failed:', error)
    showToast('匯出今日訂單失敗，請稍後再試', 'error')
  } finally {
    csvExporting.value = false
  }
}

const clearConfirmOpen = ref(false)
const clearConfirmLoading = ref(false)

// 開啟確認對話框前先做權限與資料檢查，通過才需要確認
function requestClearTodayOrders() {
  if (!isAdmin.value) { showToast('需要管理員權限', 'error'); return }
  if (!visibleTodayOrders.value.length) { showToast('今日沒有訂單'); return }
  if (visibleTodayOrders.value.some(order => order.paymentMethod === 'cash' && order.cashStatus === 'collected')) {
    showToast('今日含已收現金單，無法整批清空', 'error')
    return
  }
  clearConfirmOpen.value = true
}

async function clearTodayOrders() {
  if (!isAdmin.value) { showToast('需要管理員權限', 'error'); return }
  const toDelete = [...visibleTodayOrders.value]
  if (!toDelete.length) { showToast('今日沒有訂單'); clearConfirmOpen.value = false; return }
  if (toDelete.some(order => order.paymentMethod === 'cash' && order.cashStatus === 'collected')) {
    showToast('今日含已收現金單，無法整批清空', 'error')
    clearConfirmOpen.value = false
    return
  }
  clearConfirmLoading.value = true
  const orderIds = toDelete.map(order => order.id)
  markOrdersPendingDeletion(orderIds)
  try {
    await cancelOrdersWithWalletRefundViaFunction({
      orderIds,
      actorName: userDisplayName.value,
      reason: '管理員清空今日訂單退款',
    })
    showToast(`已清空今日 ${toDelete.length} 筆並完成退款`, 'success')
  } catch {
    unmarkOrdersPendingDeletion(orderIds)
    showToast('清空今日失敗，已恢復訂單', 'error')
  } finally {
    clearConfirmLoading.value = false
    clearConfirmOpen.value = false
  }
}

function goSelectStore() {
  useHomeActions().activePanel.value = 'store-manager'
  router.push('/')
}

const dateLabel = computed(() => new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' }))
</script>

<template>
  <div class="page">
    <TopHeader title="今日訂單">
      <template #actions>
        <span class="date-badge mono">{{ dateLabel }}</span>
        <button type="button" class="action-btn export-csv-btn" :disabled="!hasOrders || csvExporting" @click="exportTodayCSV">
          <i class="fas fa-download" aria-hidden="true"></i>
          {{ csvExporting ? '匯出中…' : '匯出 CSV' }}
        </button>
        <button v-if="isAdmin" type="button" class="action-btn danger" :disabled="!hasOrders" @click="requestClearTodayOrders">
          <i class="fas fa-trash-can" aria-hidden="true"></i>
          清空今日
        </button>
      </template>
    </TopHeader>

    <main class="main">
      <div class="content">
        <div class="grid">
          <div class="main-col">
            <KpiRow class="kpi-block" :orders="visibleTodayOrders" :dining-people="diningPeople" :pending-people="new Set(pendingNeeds.map(n => n.personKey)).size" :total-members="members.length" />
            <DiningRecovery ref="diningRecovery" />

            <!-- 手機專用位置：桌機的篩選膠囊留在訂單表工具列裡，與搜尋同一列 -->
            <StoreFilterTabs
              v-if="hasOrders"
              class="filter-block"
              :orders="displayOrders"
              :all-stores="allStores"
              v-model="dashboardStoreFilter"
            />

            <OrdersTable
              v-if="hasOrders || ordersLoading"
              class="orders-block"
              :orders="displayOrders"
              :all-stores="allStores"
              :loading="ordersLoading"
              v-model:store-filter="dashboardStoreFilter"
              @delete="deleteOrder"
              @cancel="cancelOrder"
              @toggle-free="toggleFreeOrder"
              @copy-order="copyOrder"
              @save-edit="saveOrderEdit"
              @replace-store="diningRecovery?.openStoreChange($event)"
            />

            <div v-else-if="!pendingNeeds.length" class="empty-state">
              <div class="empty-icon" aria-hidden="true"><i class="fas fa-utensils"></i></div>
              <h2>今天還沒有人下單</h2>
              <p>先選定今天的店家並開放點餐，訂單會即時顯示在這裡，系統也會自動幫你統整餐點。</p>
              <button type="button" class="empty-action" @click="goSelectStore">
                <i class="fas fa-store" aria-hidden="true"></i>
                選擇今日店家
              </button>
            </div>
          </div>

          <StoreSidebar class="sidebar-block" :orders="filteredTodayOrders" :members="members" :members-ready="membersReady" />
        </div>
      </div>
    </main>

    <ConfirmDialog
      :open="clearConfirmOpen"
      variant="danger"
      title="清空今日全部訂單？"
      :message="`將刪除今日 ${visibleTodayOrders.length} 筆訂單，錢包扣款會全數退回。`"
      detail="此操作會影響所有人的今日訂單，請再次確認。"
      confirm-text="確認清空"
      :loading="clearConfirmLoading"
      @confirm="clearTodayOrders"
      @cancel="clearConfirmOpen = false"
    />
  </div>
</template>

<style scoped>
.page { flex: 1; display: flex; flex-direction: column; }

.date-badge {
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--muted);
  background: var(--bg-inset);
  padding: 5px 12px;
  border-radius: 999px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 15px;
  border-radius: var(--r-md);
  border: 1px solid var(--input-border);
  background: var(--paper);
  color: var(--text-secondary);
  font-size: var(--text-label);
  font-weight: 700;
  transition: all 0.15s;
  white-space: nowrap;
}
.action-btn i { font-size: var(--text-body); }
.action-btn:hover:not(:disabled) { border-color: var(--border-accent); color: var(--ink); }
.action-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.action-btn.export-csv-btn {
  background: var(--mint);
  color: var(--text-on-success);
  border-color: transparent;
}
.action-btn.export-csv-btn:hover:not(:disabled) {
  background: var(--mint);
  border-color: transparent;
  color: var(--text-on-success);
  opacity: 0.86;
}
.action-btn.danger {
  color: var(--text-danger);
  background: var(--bg-danger);
  border-color: color-mix(in srgb, var(--danger) 30%, transparent);
}
.action-btn.danger:hover:not(:disabled) {
  color: var(--paper);
  background: var(--danger);
  border-color: var(--danger);
}

.main { padding: 20px 0 40px; }

.content {
  width: min(100%, var(--page-max));
  margin: 0 auto;
  padding: 0 var(--page-pad);
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 360px);
  gap: 16px;
  align-items: start;
}

.main-col { min-width: 0; }

/* 桌機由 OrdersTable 工具列內的那份負責顯示 */
.filter-block { display: none; }

/* ── 空狀態卡 ── */
.empty-state {
  border: 1px solid var(--border);
  padding: 64px 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.empty-icon {
  width: 96px;
  height: 96px;
  border-radius: 28px;
  background: linear-gradient(135deg, var(--bg-accent), var(--bg-highlight));
  align-items: center;
  justify-content: center;
  margin-bottom: 22px;
  font-size: var(--text-display);
  color: var(--text-accent);
}
.empty-state h2 {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: var(--text-title);
  color: var(--ink);
  margin-bottom: 8px;
}
.empty-state p {
  font-size: var(--text-body);
  color: var(--muted);
  line-height: 1.7;
  max-width: 360px;
  margin-bottom: 24px;
}
.empty-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--accent-solid);
  color: var(--text-on-accent);
  border-radius: var(--r-lg);
  padding: 12px 22px;
  font-weight: 800;
  font-size: var(--text-body);
  box-shadow: 0 12px 24px -12px color-mix(in srgb, var(--accent) 75%, transparent);
  transition: opacity 0.15s, transform 0.12s;
}
.empty-action:hover { opacity: 0.92; }
.empty-action:active { transform: scale(0.98); }

@media (max-width: 768px) {
  .grid { grid-template-columns: 1fr; }

  /* 手機改成 KPI → 店家篩選 → 店家統整 → 每個人的點餐紀錄：
     main-col 用 display:contents 讓 KPI/篩選/訂單表變成 grid 直接子項才能排序 */
  .main-col { display: contents; }
  .main-col > * { min-width: 0; }
  .main-col > .kpi-block { order: 1; margin-bottom: 0; }
  .main-col > .filter-block { display: flex; order: 2; }
  .grid > .sidebar-block { order: 3; margin-top: 0; }
  .main-col > .orders-block, .main-col > .empty-state { order: 4; }

  .date-badge { display: none; }
  .action-btn { font-size: var(--text-label); padding: 7px 11px; }
  .main { padding: 12px 0 40px; }
  .empty-state { padding: 48px 20px; }
}

.page { background: var(--ink); }
.empty-state { background: var(--paper); border-radius: 8px; }
.empty-icon { display: none; }
</style>
