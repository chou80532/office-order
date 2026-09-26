<script setup>
import LoadingState from '../ui/LoadingState.vue'
import StatusNotice from "../ui/StatusNotice.vue"
const rangeEndPicker = ref(null)

import { computed, onMounted, onUnmounted, reactive, ref, watch, toRef } from 'vue'
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../firestore'
import { useAuth } from '../../composables/useAuth'
import { useToast } from '../../composables/useToast'
import { confirmDialog, promptDialog } from '../../composables/useDialog'
import AppDatePicker from '../ui/AppDatePicker.vue'
import { getLocalDateKey, getTaipeiDateRangeBounds, getTaipeiDayStartMs, formatMoney, formatDateCompact } from '../../utils/format'
import { getAvatarColor } from '../../utils/avatar'
import { useSettingsTab } from '../../composables/useSettingsTab'
import {
  cancelCashPaymentViaFunction,
  createMissingCashPaymentViaFunction,
  getCashPaymentAdminDataViaFunction,
  markCashPaymentCollectedViaFunction,
} from '../../services/cashFunctions'
import { useToolbarTeleport } from '../../composables/useToolbarTeleport'

const props = defineProps({
  toolbarTarget: { type: String, default: '' },
})

const desktopToolbar = useToolbarTeleport(toRef(props, 'toolbarTarget'), 1440)

const statusLabels = {
  all: '全部',
  pending: '待收',
  collected: '已收',
  cancelled: '已取消',
}

const logTypeLabels = {
  cash_order_created: '現金單建立',
  cash_collected: '現金已收',
  cash_cancelled: '現金取消',
  cash_adjustment: '現金修正',
}

const { userDisplayName } = useAuth()
const { showToast } = useToast()
const { activeTab } = useSettingsTab()

const payments = ref([])
const cashOrders = ref([])
const logs = ref([])
const loading = ref(true)
const cashOrdersLoading = ref(false)
const logsLoading = ref(false)
const exporting = ref(false)
const loadError = ref('')
const repairingOrderId = ref('')
let stopPayments = null
let cashOrdersRequestId = 0

const filters = reactive({
  from: getLocalDateKey(),
  to: getLocalDateKey(),
  status: 'all',
  keyword: '',
})

const normalizeStatus = (status) => String(status || 'pending').trim() || 'pending'
const normalizeList = (value) => Array.isArray(value) ? value : (value == null || value === '' ? [] : [value])
const paymentTimestamp = (payment) => Number(payment.createdTimestamp || payment.timestamp || payment.updatedTimestamp || 0)
const logTimestamp = (log) => Number(log.timestamp || log.createdTimestamp || 0)
const selectedDateBounds = computed(() => getTaipeiDateRangeBounds(filters.from, filters.to))

const paymentsInRange = computed(() => {
  const { startMs, endMs } = selectedDateBounds.value
  const keyword = filters.keyword.trim().toLowerCase()

  return payments.value.filter(payment => {
    const ts = paymentTimestamp(payment)
    if (ts && (ts < startMs || ts >= endMs)) return false
    if (keyword) {
      const haystack = [
        payment.ownerName,
        payment.orderedByName,
        ...normalizeList(payment.storeNames),
        ...normalizeList(payment.items).map(item => `${item?.meal || ''} ${item?.note || ''}`),
      ].join(' ').toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })
})

const filteredPayments = computed(() => paymentsInRange.value.filter(payment =>
  filters.status === 'all' || normalizeStatus(payment.status) === filters.status
))

function groupByOwner(records, { orphan = false } = {}) {
  const groups = new Map()
  records.forEach(record => {
    const ownerName = String(record.ownerName || record.name || '未命名').trim() || '未命名'
    const ownerUid = String(record.ownerUid || '').trim()
    const key = ownerUid ? `uid:${ownerUid}` : `name:${ownerName.toLocaleLowerCase('zh-TW')}`
    const amount = orphan ? Number(record.price) || 0 : paymentAmount(record)
    const current = groups.get(key) || { key, ownerName, records: [], totalAmount: 0 }
    current.records.push(record)
    current.totalAmount += amount
    groups.set(key, current)
  })

  return [...groups.values()].sort((a, b) =>
    a.ownerName.localeCompare(b.ownerName, 'zh-TW', { numeric: true })
  )
}

// 設計稿 5：改為扁平列表，待收在前、其餘依時間新到舊
const statusRank = (status) => ({ pending: 0, collected: 1, cancelled: 2 }[normalizeStatus(status)] ?? 3)
const flatPayments = computed(() => [...filteredPayments.value].sort((a, b) => {
  const rankDiff = statusRank(a.status) - statusRank(b.status)
  if (rankDiff) return rankDiff
  return paymentTimestamp(b) - paymentTimestamp(a)
}))

const pendingPayments = computed(() =>
  filteredPayments.value.filter(payment => normalizeStatus(payment.status) === 'pending' && payment.id)
)

// 今日已收現金（依台北日界，用收款時間計）
const todayCollectedAmount = computed(() => {
  const todayStart = getTaipeiDayStartMs()
  const todayEnd = todayStart + 24 * 60 * 60 * 1000
  return payments.value.reduce((sum, payment) => {
    if (normalizeStatus(payment.status) !== 'collected') return sum
    const ts = Number(payment.collectedTimestamp || payment.updatedTimestamp || 0)
    if (ts >= todayStart && ts < todayEnd) {
      return sum + (Number(payment.collectedAmount ?? payment.amount) || 0)
    }
    return sum
  }, 0)
})

const filteredLogs = computed(() => {
  const { startMs, endMs } = selectedDateBounds.value
  return logs.value.filter(log => {
    const ts = logTimestamp(log)
    return !ts || (ts >= startMs && ts < endMs)
  })
})

const orphanCashOrders = computed(() => {
  if (!['all', 'pending'].includes(filters.status)) return []
  const { startMs, endMs } = selectedDateBounds.value
  const keyword = filters.keyword.trim().toLowerCase()
  return cashOrders.value.filter(order => {
    const isCashOrder = order.paymentMethod === 'cash' || (!order.paymentMethod && !order.paid && !order.walletDebited)
    if (!isCashOrder || order.cashPaymentId || order.isFree || order.cashStatus === 'cancelled') return false
    const ts = Number(order.timestamp || order.createdTimestamp || 0)
    if (ts && (ts < startMs || ts >= endMs)) return false
    if (!keyword) return true
    return [order.ownerName, order.name, order.storeName, order.meal, order.note]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  })
})

const orphanGroups = computed(() => groupByOwner(orphanCashOrders.value, { orphan: true }))

const summary = computed(() => {
  const result = paymentsInRange.value.reduce((acc, payment) => {
    const amount = Number(payment.amount ?? payment.remainingAmount ?? 0) || 0
    const status = normalizeStatus(payment.status)
    if (status === 'pending') {
      acc.pendingCount += 1
      acc.pendingAmount += Number(payment.remainingAmount ?? amount) || 0
    }
    if (status === 'collected') {
      acc.collectedCount += 1
      acc.collectedAmount += Number(payment.collectedAmount ?? amount) || 0
    }
    if (status === 'cancelled') acc.cancelledCount += 1
    return acc
  }, { pendingCount: 0, pendingAmount: 0, collectedCount: 0, collectedAmount: 0, cancelledCount: 0 })

  orphanCashOrders.value.forEach(order => {
    result.pendingCount += 1
    result.pendingAmount += Number(order.price) || 0
  })
  return result
})

function paymentAmount(payment) {
  const status = normalizeStatus(payment.status)
  if (status === 'pending') return Number(payment.remainingAmount ?? payment.amount) || 0
  if (status === 'collected') return Number(payment.collectedAmount ?? payment.amount) || 0
  return Number(payment.amount ?? payment.remainingAmount) || 0
}

function formatDateTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-TW')
}

function itemSummary(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '—'
  return items
    .map(item => `${item.storeName || ''} ${item.meal || ''} ${Number(item.price || 0) ? `$${item.price}` : ''}${item.note ? `（${item.note}）` : ''}`.trim())
    .filter(Boolean)
    .join('；') || '—'
}


async function markCollected(payment) {
  if (!payment?.id) return
  const confirmed = await confirmDialog({
    title: '標記已收現金？',
    message: `確認已收到「${payment.ownerName || '未命名'}」現金 ${formatMoney(payment.remainingAmount ?? payment.amount)}？`,
    confirmText: '確認已收',
  })
  if (!confirmed) return
  try {
    await markCashPaymentCollectedViaFunction({
      cashPaymentId: payment.id,
      actorName: userDisplayName.value,
    })
    showToast('已標記現金收款', 'success')
  } catch (error) {
    showToast(error.message || '標記已收失敗', 'error')
  }
}

// 設計稿 5 標頭的「全部標記已收」：逐筆走同一個後端函式，保留每筆 Log
const bulkCollecting = ref(false)
async function markAllCollected() {
  const targets = pendingPayments.value
  if (!targets.length || bulkCollecting.value) return
  const total = targets.reduce((sum, payment) => sum + (Number(payment.remainingAmount ?? payment.amount) || 0), 0)
  const confirmed = await confirmDialog({
    title: '全部標記已收？',
    message: `將 ${targets.length} 筆待收現金（合計 ${formatMoney(total)}）全部標記為已收？`,
    detail: '每筆都會寫入後端收款 Log。',
    confirmText: '全部已收',
  })
  if (!confirmed) return
  bulkCollecting.value = true
  let done = 0
  let failed = 0
  for (const payment of targets) {
    try {
      await markCashPaymentCollectedViaFunction({ cashPaymentId: payment.id, actorName: userDisplayName.value })
      done += 1
    } catch {
      failed += 1
    }
  }
  bulkCollecting.value = false
  showToast(failed ? `已收 ${done} 筆，${failed} 筆失敗` : `已全部標記 ${done} 筆已收`, failed ? 'warning' : 'success')
}

function formatDateOnly(ts) {
  if (!ts) return '—'
  return formatDateCompact(ts)
}

function formatTimeOnly(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
}

async function cancelPayment(payment) {
  if (!payment?.id) return
  const reason = await promptDialog({
    title: '取消現金應收',
    message: `取消「${payment.ownerName || '未命名'}」現金應收的原因？`,
    defaultValue: '現金單取消',
    variant: 'danger',
    confirmText: '取消應收',
    cancelText: '返回',
  })
  if (!reason) return
  try {
    await cancelCashPaymentViaFunction({
      cashPaymentId: payment.id,
      actorName: userDisplayName.value,
      reason,
    })
    showToast('已取消現金應收', 'success')
  } catch (error) {
    showToast(error.message || '取消現金應收失敗', 'error')
  }
}

async function repairCashPayment(order) {
  if (!order?.id || repairingOrderId.value) return
  repairingOrderId.value = order.id
  try {
    await createMissingCashPaymentViaFunction({ orderId: order.id, actorName: userDisplayName.value })
    showToast('已補建現金應收', 'success')
  } catch (error) {
    showToast(error.message || '補建現金應收失敗', 'error')
  } finally {
    repairingOrderId.value = ''
  }
}

async function exportExcel() {
  if (exporting.value) return
  exporting.value = true
  try {
    const { downloadXlsx } = await import('../../utils/xlsxExport')
    const { startMs: fromTimestamp, endMs } = selectedDateBounds.value
    const toTimestamp = endMs - 1
    const exportData = await getCashPaymentAdminDataViaFunction({
      fromTimestamp,
      toTimestamp,
    })
    const exportLogs = exportData.logs.filter(log => {
      const ts = logTimestamp(log)
      return !ts || (ts >= fromTimestamp && ts <= toTimestamp)
    })
    const paymentRows = [
      ...filteredPayments.value.map(payment => ({
        timestamp: paymentTimestamp(payment) ? new Date(paymentTimestamp(payment)) : '',
        ownerName: payment.ownerName || '未命名',
        status: statusLabels[normalizeStatus(payment.status)] || normalizeStatus(payment.status),
        amount: paymentAmount(payment),
        orderedByName: payment.orderedByName || '',
        storeNames: normalizeList(payment.storeNames).join('、'),
        items: itemSummary(payment.items),
        cashPaymentId: payment.id || payment.cashPaymentId || '',
        orderIds: normalizeList(payment.orderIds).join(', '),
      })),
      ...orphanCashOrders.value.map(order => ({
        timestamp: Number(order.timestamp || order.createdTimestamp) ? new Date(Number(order.timestamp || order.createdTimestamp)) : '',
        ownerName: order.ownerName || order.name || '未命名',
        status: '未建應收',
        amount: Number(order.price) || 0,
        orderedByName: order.orderedByName || '',
        storeNames: order.storeName || '',
        items: itemSummary([{ meal: order.meal, price: order.price, note: order.note, storeName: order.storeName }]),
        cashPaymentId: '',
        orderIds: order.id || '',
      })),
    ]
    await downloadXlsx({
      filename: `現金收款_${filters.from}_${filters.to}.xlsx`,
      sheets: [
        {
          name: '現金應收',
          title: '現金應收報表',
          subtitle: `${filters.from} 至 ${filters.to}｜狀態：${statusLabels[filters.status]}${filters.keyword ? `｜關鍵字：${filters.keyword}` : ''}`,
          summary: [
            { label: '待收總額', value: summary.value.pendingAmount },
            { label: '待收筆數', value: summary.value.pendingCount },
            { label: '已收總額', value: summary.value.collectedAmount },
            { label: '已取消', value: summary.value.cancelledCount },
          ],
          columns: [
            { header: '時間', key: 'timestamp', width: 21, numFmt: 'yyyy/mm/dd hh:mm:ss' },
            { header: '對象', key: 'ownerName', width: 14 },
            { header: '狀態', key: 'status', width: 12 },
            { header: '金額', key: 'amount', width: 14, numFmt: '#,##0;[Red]-#,##0;0' },
            { header: '建立者', key: 'orderedByName', width: 14 },
            { header: '店家', key: 'storeNames', width: 24, wrapText: true },
            { header: '品項明細', key: 'items', width: 40, wrapText: true },
            { header: '現金應收 ID', key: 'cashPaymentId', width: 24 },
            { header: '關聯訂單', key: 'orderIds', width: 28, wrapText: true },
          ],
          rows: paymentRows,
        },
        {
          name: '現金流水',
          title: '現金流水 Log',
          subtitle: `${filters.from} 至 ${filters.to}`,
          columns: [
            { header: '時間', key: 'timestamp', width: 21, numFmt: 'yyyy/mm/dd hh:mm:ss' },
            { header: '對象', key: 'ownerName', width: 14 },
            { header: '類型', key: 'type', width: 16 },
            { header: '金額', key: 'amount', width: 14, numFmt: '#,##0;[Red]-#,##0;0' },
            { header: '操作人', key: 'operatorName', width: 14 },
            { header: '原因', key: 'reason', width: 40, wrapText: true },
            { header: '關聯訂單', key: 'orderIds', width: 28, wrapText: true },
          ],
          rows: exportLogs.map(log => ({
            timestamp: logTimestamp(log) ? new Date(logTimestamp(log)) : '',
            ownerName: log.ownerName || '未命名',
            type: logTypeLabels[log.type] || log.type,
            amount: Number(log.amount) || 0,
            operatorName: log.operatorName || '',
            reason: log.reason || '',
            orderIds: normalizeList(log.orderIds || log.orderId).join(', '),
          })),
          signedAmountKey: 'amount',
        },
      ],
    })
    showToast('現金收款 XLSX 已匯出', 'success')
  } catch (error) {
    console.error(error)
    showToast(`現金收款 XLSX 匯出失敗：${error?.message || '未知錯誤'}`, 'error')
  } finally {
    exporting.value = false
  }
}

async function loadCashLogs() {
  if (!filters.from || !filters.to || logsLoading.value) return
  const { startMs, endMs } = selectedDateBounds.value
  logsLoading.value = true
  try {
    const snap = await getDocs(query(
      collection(db, 'cash_payment_logs'),
      where('timestamp', '>=', startMs),
      where('timestamp', '<', endMs),
      orderBy('timestamp', 'desc')
    ))
    logs.value = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    loadError.value = ''
  } catch (error) {
    console.error('[Firestore] cash logs query error:', error)
    showToast('讀取現金流水失敗，請稍後再試', 'error')
  } finally {
    logsLoading.value = false
  }
}

async function loadCashOrders() {
  if (!filters.from || !filters.to) return
  const requestId = ++cashOrdersRequestId
  const { startMs, endMs } = selectedDateBounds.value
  cashOrdersLoading.value = true
  try {
    const snap = await getDocs(query(
      collection(db, 'orders'),
      where('timestamp', '>=', startMs),
      where('timestamp', '<', endMs),
      orderBy('timestamp', 'desc')
    ))
    if (requestId !== cashOrdersRequestId) return
    cashOrders.value = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  } catch (error) {
    if (requestId !== cashOrdersRequestId) return
    console.error('[Firestore] cash orders query error:', error)
    showToast('讀取現金訂單失敗，請稍後再試', 'error')
  } finally {
    if (requestId === cashOrdersRequestId) cashOrdersLoading.value = false
  }
}

watch(() => [filters.from, filters.to], () => {
  loadCashOrders()
})

onMounted(() => {
  const handleSnapshotError = (error) => {
    console.error('[Firestore] cash admin snapshot error:', error)
    loadError.value = error?.message || '無法讀取現金帳務'
    loading.value = false
  }

  stopPayments = onSnapshot(
    query(collection(db, 'cash_payments'), orderBy('createdTimestamp', 'desc'), limit(500)),
    (snap) => {
      payments.value = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      loadError.value = ''
      loading.value = false
    },
    handleSnapshotError
  )

  loadCashLogs()
  loadCashOrders()
})

onUnmounted(() => {
  stopPayments?.()
})
</script>

<template>
  <div class="cash-admin ops-surface">
    <Teleport
      :to="toolbarTarget || 'body'"
      :disabled="!toolbarTarget || !desktopToolbar"
    >
    <section class="panel filter-panel" :class="{ 'teleported-toolbar': desktopToolbar }">
      <div class="report-head filter-head">
        <span class="filter-head-label"><i class="fas fa-filter" aria-hidden="true"></i> 篩選條件</span>
      </div>
      <div class="filters">
        <input v-model="filters.keyword" class="cash-search app-search-input" placeholder="搜尋姓名、店家、餐點..." maxlength="40" />
        <div class="cash-filter-actions">
          <AppDatePicker v-model="filters.from" @change="rangeEndPicker?.openPicker()" :max="filters.to" :compact="desktopToolbar" aria-label="現金紀錄開始日期" />
          <AppDatePicker ref="rangeEndPicker" v-model="filters.to" :min="filters.from" :compact="desktopToolbar" aria-label="現金紀錄結束日期" />
          <select v-model="filters.status">
            <option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option>
          </select>
          <button class="query-btn" :disabled="logsLoading" @click="loadCashLogs">
            {{ logsLoading ? '查詢中…' : '查詢' }}
          </button>
          <button class="export-btn" :disabled="exporting" @click="exportExcel">
            {{ exporting ? '匯出中…' : '匯出 XLSX' }}
          </button>
        </div>
      </div>
    </section>
    </Teleport>

    <!-- KPI 卡列（設計稿 5：待收現金橘金漸層／今日已收／待收筆數） -->
    <section class="summary-row summary-strip summary-three summary-success" aria-label="現金收款總覽">
      <div class="ckpi ckpi-pending summary-cell is-primary">
        <span class="ckpi-label"><i class="fas fa-hand-holding-dollar" aria-hidden="true"></i>待收現金</span>
        <strong class="ckpi-value summary-money">{{ formatMoney(summary.pendingAmount) }}</strong>
      </div>
      <div class="ckpi summary-cell">
        <span class="ckpi-label">今日已收</span>
        <strong class="ckpi-value ckpi-green">{{ formatMoney(todayCollectedAmount) }}</strong>
        <small class="ckpi-sub">區間已收 {{ formatMoney(summary.collectedAmount) }}</small>
      </div>
      <div class="ckpi summary-cell">
        <span class="ckpi-label">待收筆數</span>
        <strong class="ckpi-value summary-money">{{ summary.pendingCount }} <span class="ckpi-unit">筆</span></strong>
        <small class="ckpi-sub">已取消 {{ summary.cancelledCount }} 筆</small>
      </div>
    </section>

    <section class="panel">
      <div class="report-head">
        <div>
          <h2>現金應收列表</h2>
          <p>只有管理員可在此查看與操作。</p>
        </div>
        <div class="head-actions">
          <span class="count-chip">{{ filteredPayments.length + orphanCashOrders.length }} 筆</span>
          <button
            class="collect-all-btn"
            :disabled="bulkCollecting || pendingPayments.length === 0"
            @click="markAllCollected"
          >
            <i class="fas fa-check-double" aria-hidden="true"></i>
            {{ bulkCollecting ? '收款中…' : '全部標記已收' }}
          </button>
        </div>
      </div>

      <div v-if="loadError" class="error-banner">現金帳務讀取失敗：{{ loadError }}</div>
      <div v-if="orphanCashOrders.length" class="orphan-list">
        <div class="orphan-notice">偵測到 {{ orphanCashOrders.length }} 筆訂單尚未建立現金應收，請補建後再收款。</div>
        <details v-for="group in orphanGroups" :key="`orphan-${group.key}`" class="person-group orphan-group">
          <summary class="person-summary">
            <div class="person-identity">
              <span class="person-chevron"><i class="fa-solid fa-chevron-right"></i></span>
              <strong>{{ group.ownerName }}</strong>
              <span class="group-count">{{ group.records.length }} 筆未建應收</span>
            </div>
            <div class="group-total"><span>金額合計</span><strong>{{ formatMoney(group.totalAmount) }}</strong></div>
          </summary>
          <div class="person-orders">
            <article v-for="order in group.records" :key="order.id" class="payment-card orphan">
              <div class="payment-main">
                <div>
                  <div class="title-row">
                    <strong>{{ order.storeName || '未指定店家' }}</strong>
                    <span class="status-badge">未建應收</span>
                  </div>
                  <p class="meta">{{ formatDateTime(order.timestamp) }}</p>
                  <p class="items">{{ order.meal || '—' }}{{ order.note ? `（${order.note}）` : '' }}</p>
                </div>
                <div class="amount-box">
                  <span>應收</span>
                  <strong>{{ formatMoney(order.price) }}</strong>
                </div>
              </div>
              <div class="actions">
                <button class="repair-btn" :disabled="Boolean(repairingOrderId)" @click="repairCashPayment(order)">
                  {{ repairingOrderId === order.id ? '補建中…' : '補建現金應收' }}
                </button>
              </div>
            </article>
          </div>
        </details>
      </div>
      <LoadingState v-if="loading || cashOrdersLoading" title="正在載入現金應收…" description="正在整理所選期間的應收明細，請稍候。" />
      <StatusNotice v-else-if="filteredPayments.length === 0 && orphanCashOrders.length === 0" title="目前沒有符合條件的現金應收。" description="可調整日期或成員篩選，查看其他收款資料。" />
      <div v-else class="pay-table" role="table" aria-label="現金應收列表">
        <div class="pay-head-row" role="row">
          <span class="col-owner">成員・店家</span>
          <span class="col-items">餐點</span>
          <span class="col-amount">金額</span>
          <span class="col-action">收款</span>
        </div>
        <div
          v-for="payment in flatPayments"
          :key="payment.id"
          class="pay-row"
          role="row"
          :class="normalizeStatus(payment.status)"
        >
          <div class="col-owner">
            <span
              class="pay-avatar"
              aria-hidden="true"
              :style="{ background: getAvatarColor(payment.ownerName || '未命名') }"
            >{{ String(payment.ownerName || '未').slice(0, 1) }}</span>
            <div class="owner-main">
              <strong class="owner-name">{{ payment.ownerName || '未命名' }}</strong>
              <small class="owner-store">{{ (payment.storeNames || []).join('、') || '現金訂單' }}</small>
            </div>
          </div>
          <div class="col-items" :title="itemSummary(payment.items)">
            {{ itemSummary(payment.items) }}
            <small class="pay-meta">由 {{ payment.orderedByName || '—' }} 建立・{{ formatDateTime(paymentTimestamp(payment)) }}</small>
          </div>
          <div class="col-amount" :class="normalizeStatus(payment.status)">{{ formatMoney(paymentAmount(payment)) }}</div>
          <div class="col-action">
            <template v-if="normalizeStatus(payment.status) === 'pending'">
              <button class="collect-btn" @click="markCollected(payment)">
                <i class="fas fa-hand-holding-dollar" aria-hidden="true"></i> 標記已收
              </button>
              <button class="cancel-icon-btn" title="取消應收" aria-label="取消應收" @click="cancelPayment(payment)">
                <i class="fas fa-ban" aria-hidden="true"></i>
              </button>
            </template>
            <span v-else-if="normalizeStatus(payment.status) === 'collected'" class="done-chip">
              <i class="fas fa-check" aria-hidden="true"></i> 已收款
            </span>
            <span v-else class="cancel-chip">已取消</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 操作提示（設計稿 5） -->
    <div class="info-bar" role="note">
      <i class="fas fa-circle-info" aria-hidden="true"></i>
      <span>
        標記「已收」後，該筆會轉為已結，並計入今日已收現金；也可到
        <button type="button" class="info-link" @click="activeTab = 'wallet'">儲值錢包</button>
        將現金轉為儲值餘額。
      </span>
    </div>

    <section class="panel">
      <div class="report-head">
        <div>
          <h2>收款紀錄 <span class="head-range">{{ formatDateCompact(filters.from) }} – {{ formatDateCompact(filters.to) }}</span></h2>
          <p>建立、收款、取消都由後端寫入，不可竄改。</p>
        </div>
        <span class="count-chip">{{ filteredLogs.length }} 筆</span>
      </div>
      <LoadingState v-if="logsLoading" title="正在載入現金流水…" description="正在取得收款與取消紀錄，請稍候。" />
      <StatusNotice v-else-if="filteredLogs.length === 0" title="目前沒有現金流水。" description="此篩選區間尚無收款紀錄。" />
      <div v-else class="log-list">
        <div v-for="log in filteredLogs" :key="log.id" class="log-row">
          <div class="log-date">
            <strong class="mono">{{ formatDateOnly(logTimestamp(log)) }}</strong>
            <small class="mono">{{ formatTimeOnly(logTimestamp(log)) }}</small>
          </div>
          <div class="log-main">
            <strong class="log-owner">{{ log.ownerName || '未命名' }}</strong>
            <small class="log-desc">
              {{ log.reason || logTypeLabels[log.type] || log.type }}
              <span class="log-type-tag" :class="{ plus: Number(log.amount) > 0, minus: Number(log.amount) < 0 }">
                {{ logTypeLabels[log.type] || log.type }}
              </span>
            </small>
          </div>
          <div class="log-operator">經手：{{ log.operatorName || '—' }}</div>
          <div class="log-amount mono" :class="{ plus: Number(log.amount) > 0, minus: Number(log.amount) < 0 }">
            {{ Number(log.amount) > 0 ? '+' : (Number(log.amount) < 0 ? '-' : '') }}{{ formatMoney(Math.abs(Number(log.amount) || 0)) }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* --cash-* 色票定義在 tokens.css 的 :root（Teleport 到工具列的篩選面板也拿得到） */
.cash-admin {
  display: flex;
  flex-direction: column;
}

.filter-panel {
  position: relative;
  border-top: 3px solid var(--cash-color);
}

.filter-panel.teleported-toolbar {
  width: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.filter-panel.teleported-toolbar .filter-head {
  display: none;
}

.filter-panel.teleported-toolbar .filters {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
}

.filter-panel.teleported-toolbar .cash-filter-actions select {
  flex: 0 0 104px;
}

.filter-panel.teleported-toolbar .cash-search {
  margin-right: auto;
  min-width: 150px;
  max-width: 240px;
}

.report-head {
  border-bottom: 1px solid var(--muted-line2);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

/* 篩選列標頭：頁名已在 TopHeader，這裡只留「篩選條件」標示與動作 */
.filter-head { align-items: center; }
.filter-head-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-muted);
  font-size: var(--text-label);
  font-weight: 800;
  white-space: nowrap;
}
.filter-head-label i { color: var(--cash-color); }

h2 {
  margin: 0 0 5px;
  color: var(--text-primary);
  font-size: var(--text-lead);
  font-weight: 800;
}

p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-label);
}

.cash-chip {
  border-radius: 999px;
  padding: 6px 10px;
  font-size: var(--text-micro);
  font-weight: 900;
  white-space: nowrap;
}

.count-chip {
  border-radius: 999px;
  padding: 6px 10px;
  font-size: var(--text-micro);
  white-space: nowrap;
}

.cash-chip {
  background: var(--cash-soft);
  color: var(--cash-color);
}

.cash-chip i { margin-right: 4px; }

.head-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.export-btn {
  padding: 7px 13px;
  border-radius: 999px;
  background: var(--mint);
  color: var(--text-on-success);
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.export-btn:hover:not(:disabled) { filter: brightness(0.94); }

.export-btn:disabled {
  cursor: wait;
  opacity: 0.65;
}

.query-btn {
  padding: 9px 14px;
  border-radius: var(--r-md);
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.query-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bg-card);
}

.query-btn:disabled {
  cursor: wait;
  opacity: 0.65;
}

.count-chip {
  color: var(--text-muted);
}

.filters {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
}

.cash-search {
  flex: 1 1 280px;
  min-width: 180px;
  max-width: 360px;
  border-radius: 999px;
}

.cash-filter-actions {
  min-width: 0;
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.cash-filter-actions > :deep(.app-date-picker) {
  min-width: 128px;
}

.filters select, .filters input {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--input-border);
  border-radius: var(--r-md);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 700;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.filters input::placeholder { color: var(--text-muted); }

.filters select:focus, .filters input:focus {
  border-color: var(--cash-color);
  box-shadow: 0 0 0 3px var(--input-focus-ring);
}

/* ── KPI 卡列（設計稿 5） ── */
.summary-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.ckpi {
  min-width: 0;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ckpi-pending { border: none; }

.ckpi-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-label);
}
/* 這一格原本要畫成實色綠卡片，但 components.css 的
   `:root .summary-strip > .summary-cell { background: transparent }` 權重比
   scoped 樣式高，底色從來沒畫出來過；活下來的只有「文字改成米白」那兩條，
   米白字寫在米白紙上，整格看起來就是空白的。
   改成跟旁邊兩格同一張紙，主次交給淡色底與深色數字。 */
.summary-strip .ckpi-pending .ckpi-label.ckpi-label { color: var(--ink-faint); }
.summary-strip .ckpi-pending .ckpi-label i { color: var(--persimmon-dark); }

.ckpi-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 待收是「還沒收到的錢」，用柿紅點出來 */
.summary-strip .ckpi-pending .ckpi-value.summary-money { color: var(--persimmon-dark); font-weight: 700; }
.ckpi-green { color: var(--text-success); }
.ckpi-unit { font-size: var(--text-body); font-weight: 700; color: var(--text-muted); }

.ckpi-sub {
  color: var(--text-muted);
  font-size: var(--text-micro);
  font-weight: 600;
}

.orphan-list {
  padding: 14px 18px 0;
  display: grid;
  gap: 10px;
}

.person-group {
  overflow: hidden;
}

.person-group.orphan-group {
  border-color: color-mix(in srgb, var(--danger) 32%, var(--border-strong));
}

.person-summary {
  min-height: 68px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.person-summary::-webkit-details-marker { display: none; }
.person-summary:hover { background: var(--cash-soft); }

.person-identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-primary);
}

.person-identity > strong { font-size: var(--text-lead); }

.person-chevron {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--cash-soft);
  color: var(--cash-color);
  font-size: var(--text-micro);
  transition: transform 0.18s ease;
}

.person-group[open] .person-chevron { transform: rotate(90deg); }

.group-count {
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--text-muted);
  font-size: var(--text-micro);
}

.group-total {
  min-width: 130px;
  text-align: right;
}

.group-total span {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-micro);
  font-weight: 800;
}

.group-total strong {
  color: var(--cash-color);
  font-family: var(--font-display);
  font-size: var(--text-lead);
  font-weight: 800;
}

.person-orders {
  border-top: 1px solid var(--muted-line2);
  display: grid;
  gap: 8px;
  background: var(--bg-card);
}

.orphan-notice, .error-banner {
  padding: 10px 12px;
  font-size: var(--text-label);
  font-weight: 800;
}

.orphan-notice {
  border: 1px solid color-mix(in srgb, var(--cash-color) 35%, var(--border-strong));
  border-radius: var(--r-sm);
  background: var(--cash-soft);
  color: var(--cash-color);
}

.error-banner {
  border-bottom: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border-strong));
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
}

.payment-card {
  position: relative;
  overflow: hidden;
}

.payment-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--cash-color);
}

.payment-card.collected::before { background: var(--success); }
.payment-card.cancelled::before { background: var(--text-muted); }
.payment-card.orphan::before { background: var(--danger); }
.payment-card.collected { opacity: 0.82; }
.payment-card.cancelled { opacity: 0.62; }

.payment-main {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--text-primary);
}

.status-badge {
  border-radius: 999px;
  padding: 3px 8px;
  background: var(--cash-soft);
  color: var(--cash-color);
  font-size: var(--text-micro);
  font-weight: 900;
}

.meta, .items {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: var(--text-label);
}

.amount-box {
  min-width: 130px;
  text-align: right;
}

.amount-box span {
  color: var(--text-muted);
  font-size: var(--text-micro);
  font-weight: 800;
}

.amount-box strong {
  display: block;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-lead);
  font-weight: 800;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.primary-btn, .ghost-btn, .repair-btn {
  padding: 9px 16px;
  border-radius: 999px;
  font-size: var(--text-label);
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s, color 0.15s, border-color 0.15s;
}

.primary-btn {
  border: 1px solid var(--accent);
  background: var(--accent-solid);
  color: var(--text-on-accent);
}
.primary-btn:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

.ghost-btn {
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-muted);
}
.ghost-btn:hover { border-color: var(--danger); color: var(--text-danger); }

.repair-btn {
  border: 1px solid var(--cash-color);
  background: var(--cash-color);
  color: var(--text-on-highlight);
}
.repair-btn:hover:not(:disabled) { opacity: 0.88; }

.repair-btn:disabled { cursor: wait; opacity: 0.65; }

/* ── 現金應收扁平列表（設計稿 5） ── */
.pay-table { display: flex; flex-direction: column; }

.pay-head-row, .pay-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.2fr) minmax(0, 1.6fr) 110px 170px;
  gap: 14px;
  align-items: center;
  padding: 12px 18px;
}

.pay-head-row {
  background: var(--bg-inset);
  color: var(--text-muted);
  font-size: var(--text-micro);
  font-weight: 700;
}
.pay-head-row .col-amount, .pay-head-row .col-action { text-align: right; }

.pay-row { border-bottom: 1px dashed var(--muted-line2); }
.pay-row:last-of-type { border-bottom: none; }
.pay-row.collected, .pay-row.cancelled { opacity: 0.72; }

.pay-row .col-owner {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.pay-avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 12px;
  color: var(--paper);
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--text-lead);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.owner-main { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.owner-name {
  color: var(--text-primary);
  font-size: var(--text-body);
  font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.owner-store {
  color: var(--text-muted);
  font-size: var(--text-label);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.pay-row .col-items {
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 600;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}
.pay-meta { color: var(--text-muted); font-size: var(--text-micro); font-weight: 600; }

.pay-row .col-amount {
  text-align: right;
  font-family: var(--font-display);
  font-size: var(--text-lead);
  font-weight: 800;
  white-space: nowrap;
}
.pay-row .col-amount.collected { color: var(--text-muted); }
.pay-row .col-amount.cancelled { color: var(--text-muted); text-decoration: line-through; }

.pay-row .col-action {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.collect-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px;
  border: none;
  border-radius: var(--r-md);
  background: var(--success);
  color: var(--text-on-success);
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
  transition: background 0.15s;
}
.collect-btn:hover { background: var(--success-hover); }

.cancel-icon-btn {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--r-md);
  background: var(--bg-inset);
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.cancel-icon-btn:hover { background: var(--bg-danger); color: var(--text-danger); }

.done-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
}

.cancel-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  font-size: var(--text-label);
  white-space: nowrap;
}
.cancel-chip { color: var(--text-muted); }

/* ── 操作提示列（設計稿 5） ── */
.info-bar {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  color: var(--text-secondary);
  font-size: var(--text-label);
  line-height: 1.55;
}
.info-bar > i { margin-top: 3px; color: var(--highlight); }
.info-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--text-accent);
  font: inherit;
  font-weight: 800;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.info-link:hover { color: var(--accent-hover); }

/* ── 收款紀錄列表（設計稿 5） ── */
.head-range { margin-left: 6px; color: var(--text-muted); font-size: var(--text-label); font-weight: 700; }

.log-list { display: flex; flex-direction: column; }

.log-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto 110px;
  gap: 14px;
  align-items: center;
  padding: 12px 18px;
  border-bottom: 1px dashed var(--muted-line2);
}
.log-row:last-of-type { border-bottom: none; }

.log-date { display: flex; flex-direction: column; gap: 1px; }
.log-date strong { color: var(--text-primary); font-size: var(--text-label); font-weight: 800; }
.log-date small { color: var(--text-muted); font-size: var(--text-micro); }

.log-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.log-owner { color: var(--text-primary); font-size: var(--text-body); font-weight: 700; }
.log-desc {
  color: var(--text-muted);
  font-size: var(--text-label);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.log-type-tag {
  margin-left: 6px;
  padding: 1px 7px;
  color: var(--cash-color);
  font-size: var(--text-micro);
  font-weight: 800;
  white-space: nowrap;
}
.log-type-tag.plus { background: color-mix(in srgb, var(--success) 13%, transparent); color: var(--text-success); }
.log-type-tag.minus { background: color-mix(in srgb, var(--danger) 13%, transparent); color: var(--text-danger); }

.log-operator { color: var(--text-muted); font-size: var(--text-label); font-weight: 600; white-space: nowrap; }

.log-amount {
  text-align: right;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-body);
  font-weight: 800;
  white-space: nowrap;
}

/* 全部標記已收（綠色主按鈕） */
.collect-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border: none;
  border-radius: var(--r-md);
  background: var(--success);
  color: var(--text-on-success);
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
  transition: background 0.15s, opacity 0.15s;
}
.collect-all-btn:hover:not(:disabled) { background: var(--success-hover); }
.collect-all-btn:disabled { cursor: not-allowed; opacity: 0.55; }

.empty {
  padding: 30px;
  text-align: center;
  color: var(--text-muted);
}

.panel > .empty { background: var(--bg-page); }

@media (max-width: 900px) {
  .summary-row { grid-template-columns: 1fr; gap: 10px; }
  .filters { align-items: stretch; flex-direction: column; }
  .cash-search { width: 100%; max-width: none; flex-basis: auto; }
  .cash-filter-actions { width: 100%; margin-left: 0; flex-wrap: wrap; justify-content: flex-start; }
  .cash-filter-actions > :deep(.app-date-picker), .cash-filter-actions select { flex: 1 1 180px; }

  /* 收款表改資訊卡式堆疊，避免橫向捲動 */
  .pay-head-row { display: none; }
  .pay-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'owner amount'
      'items items'
      'action action';
    row-gap: 8px;
  }
  .pay-row .col-owner { grid-area: owner; }
  .pay-row .col-items { grid-area: items; }
  .pay-row .col-amount { grid-area: amount; }
  .pay-row .col-action { grid-area: action; justify-content: stretch; }
  .pay-row .col-action .collect-btn { flex: 1; justify-content: center; }

  .log-row {
    grid-template-columns: 64px minmax(0, 1fr) 96px;
    grid-template-areas:
      'date main amount'
      'date operator amount';
    row-gap: 2px;
  }
  .log-date { grid-area: date; }
  .log-main { grid-area: main; }
  .log-operator { grid-area: operator; }
  .log-amount { grid-area: amount; }
}

@media (max-width: 600px) {
  .filters { grid-template-columns: 1fr; }

  .report-head { flex-direction: column; }
  .head-actions { width: 100%; }
  .head-actions .collect-all-btn { flex: 1; justify-content: center; }
  .person-summary { align-items: flex-start; }
  .person-identity { flex-wrap: wrap; }
  .group-total { min-width: 100px; }
  .payment-main { display: grid; }
  .amount-box { text-align: left; }
  .actions { justify-content: stretch; }
  .actions button { flex: 1; }
}

.cash-admin { gap: 28px; }
.panel { background: transparent; border: 0; border-radius: 0; box-shadow: none; overflow: visible; }
.report-head { padding: 0 0 16px; border: 0; }
.report-head h2 { font-weight: 600; }
.report-head p { font-weight: 400; }
.pay-table, .log-list { background: var(--ink-2); border-block: 1px solid var(--line); }
.pay-row, .log-row { border-bottom-style: solid; padding-block: 14px; }
.person-group, .person-group.orphan-group { border: 0; border-radius: 0; box-shadow: none; border-bottom: 1px solid var(--line); background: var(--ink-2); }
.payment-card { border: 0; border-radius: 0; box-shadow: none; background: transparent; padding: 12px 0; border-top: 1px solid var(--line); }
.payment-card::before { display: none; }
.person-orders { padding: 0 16px; }
.info-bar { background: transparent; border: 0; border-left: 2px solid var(--line); border-radius: 0; padding-block: 4px; }
.done-chip { background: var(--jade); color: var(--paper); border-radius: 4px; }
.cancel-chip, .count-chip, .group-count { background: transparent; border: 0; font-weight: 400; }
.filter-panel { margin: 0; }
.filter-panel.teleported-toolbar { --input-bg: var(--paper); --input-border: var(--ink-faint); --text-primary: var(--ink); --text-secondary: var(--ink-faint); --text-muted: var(--ink-faint); --bg-inset: var(--paper-2); --bg-card: var(--paper); color: var(--ink); }
.log-type-tag { border: 0; border-radius: 0; background: transparent; }
.log-amount.plus, .log-amount.minus, .pay-row .col-amount { color: var(--paper); }
</style>
