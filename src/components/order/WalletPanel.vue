<script setup>
import LoadingState from '../ui/LoadingState.vue'
import StatusNotice from '../ui/StatusNotice.vue'
const rangeEndPicker = ref(null)

import { computed, onUnmounted, ref, toRef, watch } from 'vue'
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firestore'
import { useAuth } from '../../composables/useAuth'
import { useToast } from '../../composables/useToast'
import { LOW_WALLET_BALANCE } from '../../constants'
import { getTaipeiDateRangeBounds, getTaipeiMonthRange, formatMoney } from '../../utils/format'
import { periodBuckets } from '../../utils/periodBuckets'
import { mealTone } from '../../utils/mealPresentation'
import AppDatePicker from '../ui/AppDatePicker.vue'
import { useToolbarTeleport } from '../../composables/useToolbarTeleport'
import { mergeEditLogPairs, matchesLogTypeFilter, editGroupShortId, composeLogDescription, MERGED_EDIT_TYPE } from '../../utils/walletLogs'

const props = defineProps({
  toolbarTarget: { type: String, default: '' }
})
const desktopToolbar = useToolbarTeleport(toRef(props, 'toolbarTarget'))

const typeLabels = {
  top_up: '儲值',
  order_debit: '點餐扣款',
  cancel_refund: '取消退款',
  admin_adjustment: '管理員修正',
  free_debit: '取消免費扣回',
  free_refund: '免費訂單退款',
  free_order: '今日店家免費',
  order_edit: '訂單編輯調整',
  order_edit_refund: '訂單編輯退款',
  order_edit_debit: '訂單編輯扣款',
  cash_adjustment: '現金調整',
}
// 篩選下拉只列合併後的「訂單編輯調整」，隱藏原始退款/扣款兩個子類型。
const typeFilterOptions = { ...typeLabels }
delete typeFilterOptions.order_edit_refund
delete typeFilterOptions.order_edit_debit

const { userDisplayName, userUid } = useAuth()
const { showToast } = useToast()
const wallet = ref({ balance: 0 })
const logs = ref([])
const loading = ref(true)
const logsLoading = ref(false)
const logsError = ref('')
const walletError = ref('')
const pageLoading = computed(() => loading.value || logsLoading.value)
const expandedIds = ref([])
const exporting = ref(false)

const defaultFilters = () => ({
  ...getTaipeiMonthRange(),
  type: 'all',
})
const filters = ref(defaultFilters())
let stopWallet = null
let logsRequestSeq = 0

const typeOptions = computed(() => Object.entries(typeFilterOptions).map(([value, label]) => ({ value, label })))

// 顯示前先把訂單編輯的退款/扣款配對合併成一列淨額。
const mergedPeriodLogs = computed(() => mergeEditLogPairs(periodLogs.value))

const filteredLogs = computed(() =>
  mergedPeriodLogs.value.filter(log => matchesLogTypeFilter(log, filters.value.type))
)

const periodLogs = computed(() => {
  const { startMs, endMs } = getTaipeiDateRangeBounds(filters.value.from, filters.value.to)
  return logs.value.filter(log => {
    const ts = Number(log.timestamp) || 0
    if (ts && (ts < startMs || ts >= endMs)) return false
    return true
  })
})

const myLogs = computed(() => filteredLogs.value)

// 點餐扣款＝一筆訂單；訂單編輯調整＝在既有訂單上的加減，計入金額但不算新的一筆。
const orderSpendingTypes = new Set(['order_debit'])
const editAdjustTypes = new Set([MERGED_EDIT_TYPE, 'order_edit_debit'])
const orderIdsForLog = (log) => {
  const ids = Array.isArray(log.orderIds) && log.orderIds.length ? log.orderIds : [log.orderId]
  return ids.map(id => String(id || '').trim()).filter(Boolean)
}
const cancelledOrderIdSet = computed(() => {
  const ids = new Set()
  periodLogs.value
    .filter(log => ['cancel_refund', 'free_refund'].includes(log.type))
    .forEach(log => orderIdsForLog(log).forEach(id => ids.add(id)))
  return ids
})
const isCancelledOrderSpendingLog = (log) => {
  const ids = orderIdsForLog(log)
  return ids.length > 0 && ids.every(id => cancelledOrderIdSet.value.has(id))
}
// 消費「筆數」只算實際點餐扣款；編輯調整不另計為一筆。
const orderSpendingLogs = computed(() => mergedPeriodLogs.value.filter(log => (
  orderSpendingTypes.has(log.type)
  && Number(log.amount) < 0
  && !isCancelledOrderSpendingLog(log)
)))
// 消費「金額」以淨額計：點餐扣款＋編輯調整（可能加也可能減）。
const spendingContributionLogs = computed(() => mergedPeriodLogs.value.filter(log => (
  (orderSpendingTypes.has(log.type) || editAdjustTypes.has(log.type))
  && !isCancelledOrderSpendingLog(log)
)))
const periodTopUpLogs = computed(() => periodLogs.value.filter(log => (
  log.type === 'top_up'
  && Number(log.amount) !== 0
)))
const periodSpending = computed(() => spendingContributionLogs.value.reduce((sum, log) => sum - (Number(log.amount) || 0), 0))
const periodRefund = computed(() => periodLogs.value.reduce((sum, log) =>
  ['cancel_refund', 'free_refund', 'order_edit_refund'].includes(log.type) ? sum + Math.max(0, Number(log.amount) || 0) : sum, 0))
const periodTopUp = computed(() => periodTopUpLogs.value.reduce((sum, log) => sum + (Number(log.amount) || 0), 0))
const orderCount = computed(() => orderSpendingLogs.value.length)
const averageSpending = computed(() => orderCount.value ? Math.round(periodSpending.value / orderCount.value) : 0)

// ── 我的統計（設計稿：期間花費卡、平均每筆扣款較上期比較、近 6 週長條圖、最常點排行） ──
// 對任意 log 清單計算消費統計（合併編輯配對、排除已取消訂單），供上期比較與近 6 週使用。
function spendingStatsOf(logList) {
  const cancelledIds = new Set()
  logList
    .filter(log => ['cancel_refund', 'free_refund'].includes(log.type))
    .forEach(log => orderIdsForLog(log).forEach(id => cancelledIds.add(id)))
  const isCancelled = (log) => {
    const ids = orderIdsForLog(log)
    return ids.length > 0 && ids.every(id => cancelledIds.has(id))
  }
  const merged = mergeEditLogPairs(logList)
  const spendLogs = merged.filter(log => (
    (orderSpendingTypes.has(log.type) || editAdjustTypes.has(log.type)) && !isCancelled(log)
  ))
  const orderLogs = merged.filter(log => (
    orderSpendingTypes.has(log.type) && Number(log.amount) < 0 && !isCancelled(log)
  ))
  const spending = spendLogs.reduce((sum, log) => sum - (Number(log.amount) || 0), 0)
  return {
    spending,
    orderCount: orderLogs.length,
    average: orderLogs.length ? Math.round(spending / orderLogs.length) : 0,
    spendLogs,
    orderLogs,
  }
}

// 平均每餐較上期（與所選區間等長、緊接其前的期間）比較
const averageComparison = computed(() => {
  if (!orderCount.value) return null
  const { startMs, endMs } = getTaipeiDateRangeBounds(filters.value.from, filters.value.to)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  const span = endMs - startMs
  const prevLogs = logs.value.filter(log => {
    const ts = Number(log.timestamp) || 0
    return ts >= startMs - span && ts < startMs
  })
  const prev = spendingStatsOf(prevLogs)
  if (!prev.orderCount || !prev.average) return null
  const pct = Math.round(Math.abs(averageSpending.value - prev.average) / prev.average * 100)
  if (!pct) return { saving: true, pct: 0, flat: true }
  return { saving: averageSpending.value < prev.average, pct, flat: false }
})

// 近 6 週花費：以今天（台北日界）為終點的 6 個 7 天區間，不受日期篩選影響
const weeklySpending = computed(() => {
  const { startMs, endMs } = getTaipeiDateRangeBounds(filters.value.from, filters.value.to)
  const weeks = periodBuckets(startMs, endMs)
  spendingStatsOf(periodLogs.value).spendLogs.forEach(log => {
    const ts = Number(log.timestamp) || 0
    const bucket = weeks.find(w => ts >= w.start && ts < w.end)
    if (bucket) bucket.amount -= Number(log.amount) || 0
  })
  const max = Math.max(...weeks.map(w => w.amount), 0)
  return weeks.map((week) => ({
    ...week,
    amount: Math.max(0, Math.round(week.amount)),
    label: new Date(week.start).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' }),
    heightPct: max > 0 ? Math.max(6, Math.round(week.amount / max * 100)) : 6,
    isPeak: max > 0 && week.amount === max,
  }))
})
const hasWeeklySpending = computed(() => weeklySpending.value.some(week => week.amount > 0))

// 最常點：所選期間內點餐扣款品項出現次數前 3 名
const topDishes = computed(() => {
  const counts = new Map()
  orderSpendingLogs.value.forEach(log => {
    const items = Array.isArray(log.items) ? log.items : []
    items.forEach(item => {
      const meal = String(item.meal || '').trim()
      if (!meal) return
      const key = JSON.stringify([log.storeName || '', meal])
      const entry = counts.get(key) || { key, meal, count: 0, stores: new Map() }
      entry.count += 1
      const store = String(log.storeName || '').trim()
      if (store) entry.stores.set(store, (entry.stores.get(store) || 0) + 1)
      counts.set(key, entry)
    })
  })
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(entry => ({
      key: entry.key,
      meal: entry.meal,
      count: entry.count,
      store: [...entry.stores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '',
      color: mealTone(entry.meal),
    }))
})

const storeRanking = computed(() => {
  const totals = new Map()
  orderSpendingLogs.value.forEach(log => {
    const name = String(log.storeName || '').trim() || '其他店家'
    totals.set(name, (totals.get(name) || 0) + 1)
  })
  return [...totals.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .filter(entry => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
})
const maxStoreSpending = computed(() => storeRanking.value[0]?.amount || 1)

const periodLabel = computed(() => {
  if (!filters.value.from || !filters.value.to) return '所選期間'
  const format = value => value.replaceAll('-', '/')
  return `${format(filters.value.from)}－${format(filters.value.to)}`
})

const balance = computed(() => Number(wallet.value?.balance) || 0)
const isLowBalance = computed(() => balance.value < LOW_WALLET_BALANCE)

function resetFilters() {
  filters.value = defaultFilters()
}

function buildLogsQuery(uid) {
  // 只用單一欄位查詢，避免一般使用者因 Firestore composite index 尚未部署而卡在「同步延遲」。
  // 日期與分類改由前端過濾；單一 ownerUid 查詢可直接使用 Firestore 內建索引正常載入。
  return query(collection(db, 'wallet_logs'), where('ownerUid', '==', uid))
}

async function loadWalletLogs() {
  if (!userUid.value || !filters.value.from || !filters.value.to || logsLoading.value) return
  const requestId = ++logsRequestSeq
  logsLoading.value = true
  logsError.value = ''
  logs.value = []
  expandedIds.value = []

  try {
    const snap = await getDocs(buildLogsQuery(userUid.value))
    const nextLogs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
    if (requestId !== logsRequestSeq) return
    logs.value = nextLogs
  } catch (error) {
    if (requestId !== logsRequestSeq) return
    console.error('[WalletPanel] wallet logs query failed:', error)
    logsError.value = '交易紀錄暫時載入失敗，請稍後再試'
  } finally {
    if (requestId === logsRequestSeq) logsLoading.value = false
  }
}

function formatTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatAmount(amount) {
  const value = Number(amount) || 0
  return `${value > 0 ? '+' : ''}${value.toLocaleString()}`
}


// 只有「訂單編輯調整」需要展開明細看退款/扣款兩筆；其餘直接在說明欄呈現。
function hasDetail(log) {
  return log.type === MERGED_EDIT_TYPE && Array.isArray(log.pairLogs) && log.pairLogs.length > 0
}

// 說明欄文字：編輯列顯示「動作｜品項變化」，其餘顯示「動作｜店家｜品項」。
function logDescription(log) {
  if (log.type === MERGED_EDIT_TYPE) return String(log.reason || '').trim() || '訂單編輯調整'
  return composeLogDescription(log, typeLabels[log.type] || log.type)
}

function logReason(log) {
  const reasonText = String(log.reason || '').trim()
  // 合併後的編輯列：直接顯示「品項 → 品項」的變更說明。
  if (log.type === MERGED_EDIT_TYPE) {
    const prefix = '訂單編輯調整｜'
    return reasonText.startsWith(prefix) ? reasonText.slice(prefix.length) : (reasonText || '訂單編輯調整')
  }

  const countText = hasDetail(log) ? `${log.itemCount || log.items.length} 個品項` : ''
  if (!countText) return reasonText || '—'

  if (log.type === 'order_debit') {
    const prefix = log.storeName ? `點餐扣款｜${log.storeName}` : '點餐扣款'
    const proxyNote = reasonText.startsWith(prefix)
      ? reasonText.slice(prefix.length).replace(/^｜/, '')
      : reasonText
    return proxyNote ? `${countText}・${proxyNote}` : countText
  }

  return reasonText ? `${countText}・${reasonText}` : countText
}

function exportItemSummary(log) {
  if (!Array.isArray(log.items) || !log.items.length) return ''
  return log.items.map(item => {
    const meal = String(item.meal || '').trim() || '未命名品項'
    const note = String(item.note || '').trim()
    const price = Number(item.price) || 0
    return `${meal}${note ? `（${note}）` : ''} ${formatMoney(price)}`
  }).join('\n')
}

async function exportStatement() {
  if (exporting.value || !myLogs.value.length) return
  exporting.value = true
  try {
    // 匯出保留原始退款／扣款兩列（對帳可逐筆稽核），以「編輯群組」欄標示同一次編輯。
    const statementLogs = periodLogs.value
      .filter(log => matchesLogTypeFilter(log, filters.value.type))
      .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))
    const firstLog = statementLogs[0]
    const lastLog = statementLogs.at(-1)
    const credits = statementLogs.reduce((sum, log) => sum + Math.max(0, Number(log.amount) || 0), 0)
    const debits = statementLogs.reduce((sum, log) => sum + Math.abs(Math.min(0, Number(log.amount) || 0)), 0)
    const ownerName = String(userDisplayName.value || wallet.value?.ownerName || '個人').trim()
    const safeOwnerName = ownerName.replace(/[\\/:*?"<>|]/g, '_')
    const { downloadXlsx } = await import('../../utils/xlsxExport')

    await downloadXlsx({
      filename: `個人錢包對帳單_${safeOwnerName}_${filters.value.from}_${filters.value.to}.xlsx`,
      sheets: [{
        name: '個人錢包流水',
        title: `${ownerName}｜個人錢包對帳單`,
        subtitle: `${filters.value.from} 至 ${filters.value.to}｜類型：${filters.value.type === 'all' ? '全部分類' : (typeLabels[filters.value.type] || filters.value.type)}`,
        summary: [
          { label: '期初餘額', value: Number(firstLog.beforeBalance) || 0 },
          { label: '期間入帳', value: credits },
          { label: '期間支出', value: debits },
          { label: '期末餘額', value: Number(lastLog.afterBalance) || 0 },
        ],
        columns: [
          { header: '時間', key: 'timestamp', width: 21, numFmt: 'yyyy/mm/dd hh:mm:ss' },
          { header: '類型', key: 'type', width: 17 },
          { header: '編輯群組', key: 'editGroup', width: 12 },
          { header: '店家', key: 'storeName', width: 22 },
          { header: '品項明細', key: 'items', width: 42, wrapText: true },
          { header: '金額', key: 'amount', width: 14, numFmt: '#,##0;[Red]-#,##0;0' },
          { header: '變更前', key: 'beforeBalance', width: 14, numFmt: '#,##0' },
          { header: '變更後', key: 'afterBalance', width: 14, numFmt: '#,##0' },
          { header: '說明', key: 'reason', width: 38, wrapText: true },
          { header: '操作者', key: 'operatorName', width: 15 },
        ],
        rows: statementLogs.map(log => ({
          timestamp: Number(log.timestamp) ? new Date(Number(log.timestamp)) : '',
          type: typeLabels[log.type] || log.type || '',
          editGroup: editGroupShortId(log),
          storeName: log.storeName || '',
          items: exportItemSummary(log),
          amount: Number(log.amount) || 0,
          beforeBalance: Number(log.beforeBalance) || 0,
          afterBalance: Number(log.afterBalance) || 0,
          reason: logReason(log),
          operatorName: log.operatorName || '',
        })),
        signedAmountKey: 'amount',
      }],
    })
    showToast('個人錢包對帳單已匯出', 'success')
  } catch (error) {
    console.error('[WalletPanel] statement export failed:', error)
    showToast('對帳單匯出失敗，請稍後再試', 'error')
  } finally {
    exporting.value = false
  }
}

function toggleDetail(logId) {
  if (expandedIds.value.includes(logId)) {
    expandedIds.value = expandedIds.value.filter(id => id !== logId)
    return
  }
  expandedIds.value = [...expandedIds.value, logId]
}

watch([userDisplayName, userUid], ([name, uid]) => {
  stopWallet?.()
  stopWallet = null
  wallet.value = { balance: 0 }
  walletError.value = ''
  loading.value = Boolean(name && uid)

  if (!name || !uid) {
    logs.value = []
    logsLoading.value = false
    logsError.value = ''
    expandedIds.value = []
    loading.value = false
    return
  }

  stopWallet = onSnapshot(doc(db, 'wallets', uid), (snap) => {
    wallet.value = snap.exists() ? snap.data() : { ownerUid: uid, ownerName: name, balance: 0 }
    loading.value = false
  }, () => {
    walletError.value = '錢包餘額暫時載入失敗，請重新開啟此頁再試。'
    loading.value = false
  })
}, { immediate: true })

watch(userUid, () => {
  loadWalletLogs()
}, { immediate: true })

onUnmounted(() => {
  stopWallet?.()
})
</script>

<template>
  <section class="wallet-panel ops-surface" :aria-busy="pageLoading">
    <Teleport :to="toolbarTarget || 'body'" :disabled="!toolbarTarget || !desktopToolbar">
      <div class="wallet-filters period-controls" :class="{ 'teleported-toolbar': toolbarTarget && desktopToolbar }" aria-label="錢包統計期間">
        <div class="filter-field">
          <span>開始日期</span>
          <AppDatePicker v-model="filters.from" @change="rangeEndPicker?.openPicker()" :max="filters.to || undefined" aria-label="錢包開始日期" compact />
        </div>
        <span class="date-sep" aria-hidden="true">—</span>
        <div class="filter-field">
          <span>結束日期</span>
          <AppDatePicker ref="rangeEndPicker" v-model="filters.to" :min="filters.from || undefined" aria-label="錢包結束日期" compact />
        </div>
        <button type="button" class="toolbar-secondary-btn" @click="resetFilters">回到本月</button>
      </div>
    </Teleport>
    <p class="wallet-scope">我的錢包｜僅顯示你的錢包交易，不包含現金付款。取消與免費退款會反映於交易紀錄。</p>
    <LoadingState v-if="pageLoading" title="正在載入錢包…" description="正在取得餘額、餐費統計與交易紀錄，請稍候。" />
    <StatusNotice v-else-if="walletError || logsError" :title="walletError || logsError" alert>
      <button v-if="!walletError" type="button" class="toolbar-secondary-btn" @click="loadWalletLogs">重新載入</button>
    </StatusNotice>
    <template v-else>
    <div class="wallet-head">
      <div class="balance-hero summary-strip summary-success" :class="{ low: isLowBalance }">
        <div class="hero-balance">
          <div class="hero-top">
            <span class="hero-label">目前餘額</span>
            <i class="fas fa-wallet" aria-hidden="true"></i>
          </div>
          <div class="hero-amount">
            <span class="hero-currency">NT$</span>
            <span class="hero-value">{{ balance.toLocaleString() }}</span>
          </div>
          <div class="hero-owner">{{ userDisplayName || '我的錢包' }}</div>
        </div>

        <div class="hero-metrics" aria-label="錢包期間摘要">
          <div class="hero-metric">
            <span>期間錢包餐費</span>
            <strong>{{ formatMoney(periodSpending) }}</strong>
            <small>{{ orderCount }} 筆點餐扣款</small>
          </div>
          <div class="hero-metric"><span>期間退款入帳</span><strong>{{ formatMoney(periodRefund) }}</strong><small>含取消、免費與編輯退款</small></div>
          <div class="hero-metric">
            <span>區間儲值</span>
            <strong>{{ formatMoney(periodTopUp) }}</strong>
            <small>{{ periodTopUpLogs.length }} 筆儲值</small>
          </div>
        </div>
      </div>

    </div>

    <div v-if="isLowBalance" class="low-alert">
      錢包餘額低於 {{ formatMoney(LOW_WALLET_BALANCE) }}，請聯繫總務儲值。
    </div>

    <details class="spending-analysis" open>
      <summary>
        <h2 class="analysis-title">消費分析・趨勢與常點餐點</h2>
        <span class="average-stat">
            <span>平均每筆扣款</span>
            <strong>{{ formatMoney(averageSpending) }}</strong>
            <small v-if="averageComparison && !averageComparison.flat">
              較上期{{ averageComparison.saving ? '減少' : '增加' }} {{ averageComparison.pct }}%
            </small>
            <small v-else-if="averageComparison?.flat">與上期持平</small>
            <small v-else>上期無資料</small>
        </span>
      </summary>
    <!-- 期間花費趨勢／最常點／常訂店家 -->
    <div class="stats-grid">
      <section class="analytics-card weekly-card">
        <div class="analytics-head">
          <div>
            <h3 class="section-title">所選期間花費</h3>
            <span class="analytics-subtitle">{{ periodLabel }}</span>
          </div>
        </div>
        <div v-if="hasWeeklySpending" class="weekly-bars" role="img" aria-label="所選期間花費長條圖">
          <div
            v-for="week in weeklySpending"
            :key="week.start"
            class="weekly-col"
            :title="`${week.label}：${formatMoney(week.amount)}`"
          >
            <span class="weekly-amount" :class="{ peak: week.isPeak }">{{ formatMoney(week.amount) }}</span>
            <div class="weekly-track">
              <span class="weekly-bar" :class="{ peak: week.isPeak, zero: week.amount === 0 }" :style="{ height: `${week.heightPct}%` }"></span>
            </div>
            <span class="weekly-label" :class="{ peak: week.isPeak }">{{ week.label }}</span>
          </div>
        </div>
        <StatusNotice v-else title="所選期間還沒有消費紀錄" description="換一段日期區間，或先去點一餐。" />
      </section>

      <section class="analytics-card fav-card">
        <div class="analytics-head">
          <div>
            <h3 class="section-title">最常點</h3>
            <span class="analytics-subtitle">{{ periodLabel }}</span>
          </div>
        </div>
        <div v-if="topDishes.length" class="fav-list">
          <div v-for="(dish, index) in topDishes" :key="dish.key" class="fav-item">
            <span class="fav-rank" :class="`rank-${index + 1}`">{{ index + 1 }}</span>
            <span class="fav-avatar" :style="{ background: dish.color, color: dish.color === 'var(--gold)' ? 'var(--ink)' : 'var(--paper)' }">
              {{ dish.meal.slice(0, 1) }}
            </span>
            <div class="fav-main">
              <span class="fav-meal">{{ dish.meal }}</span>
              <span v-if="dish.store" class="fav-store">{{ dish.store }}</span>
            </div>
            <span class="fav-count">{{ dish.count }} 次</span>
          </div>
        </div>
        <StatusNotice v-else title="所選期間還沒有點餐紀錄" description="換一段日期區間看看。" />
      </section>

      <section class="analytics-card insights-card">
        <div class="analytics-head">
          <div>
            <h3 class="section-title">常訂店家</h3>
            <span class="analytics-subtitle">依點餐扣款次數・前 5 名</span>
          </div>
        </div>
        <div v-if="storeRanking.length" class="ranking-list">
          <div v-for="(store, index) in storeRanking" :key="store.name" class="ranking-item">
            <div class="ranking-label">
              <span><b>{{ index + 1 }}</b>{{ store.name }}</span>
              <strong>{{ store.amount }} 次</strong>
            </div>
            <div class="ranking-track">
              <span :style="{ width: `${Math.max(6, store.amount / maxStoreSpending * 100)}%` }"></span>
            </div>
          </div>
        </div>
        <StatusNotice v-else title="所選期間還沒有店家消費" description="換一段日期區間看看。" />
      </section>
    </div>

</details>

    <div class="log-card">
      <div class="log-head">
        <h2 class="section-title">交易紀錄</h2>
        <div class="log-status">
          <button
            type="button"
            class="export-statement-btn"
            :disabled="exporting || logsLoading || myLogs.length === 0"
            @click="exportStatement"
          >{{ exporting ? '匯出中…' : '匯出 XLSX' }}</button>
          <span v-if="logsError" class="sync-chip warning">同步延遲</span>
          <span v-else-if="logsLoading" class="sync-chip">同步中</span>
          <span v-else class="sync-chip done">已同步</span>
          <span class="log-count">{{ myLogs.length }} 筆</span>
        </div>
      </div>

      <div class="wallet-filters log-filters" aria-label="交易紀錄篩選">
        <div class="filter-field type-filter">
          <span>交易分類</span>
          <select v-model="filters.type">
            <option value="all">全部分類</option>
            <option v-for="option in typeOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <span class="filter-note">分類僅篩選下方交易紀錄</span>
      </div>

      <StatusNotice v-if="myLogs.length === 0" title="目前沒有符合條件的交易紀錄" description="可調整日期或分類，查看其他交易。" />
      <template v-else>
      <div class="log-table-wrap">
        <table class="log-table">
          <thead>
            <tr>
              <th class="nowrap">時間</th>
              <th>說明</th>
              <th class="right">金額</th>
              <th class="right">餘額</th>
              <th class="detail-col" aria-label="明細"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="log in myLogs" :key="log.id">
              <tr
                class="log-tr"
                :class="{ expandable: hasDetail(log), expanded: expandedIds.includes(log.id) }"
                @click="hasDetail(log) && toggleDetail(log.id)"
              >
                <td class="mono nowrap time-cell">{{ formatTime(log.timestamp) }}</td>
                <td class="reason-cell" :title="logDescription(log)">{{ logDescription(log) }}</td>
                <td class="right mono amount" :class="{ plus: Number(log.amount) > 0, minus: Number(log.amount) < 0 }">
                  {{ formatAmount(log.amount) }}
                </td>
                <td class="right mono after">{{ Number(log.afterBalance || 0).toLocaleString() }}</td>
                <td class="detail-col">
                  <button v-if="hasDetail(log)" type="button" class="detail-toggle">
                    {{ expandedIds.includes(log.id) ? '收合' : '明細' }}
                  </button>
                </td>
              </tr>

              <tr v-if="hasDetail(log) && expandedIds.includes(log.id)" class="detail-tr">
                <td :colspan="5">
                  <!-- 訂單編輯：顯示原始「退款＋重新扣款」兩筆，餘額鏈一目了然 -->
                  <div v-if="log.type === MERGED_EDIT_TYPE" class="detail-list">
                    <div v-for="pair in log.pairLogs" :key="pair.id" class="detail-item">
                      <div class="detail-main">
                        <span class="detail-meal">{{ typeLabels[pair.type] || pair.type }}</span>
                        <span v-if="pair.items && pair.items[0]" class="detail-note">{{ pair.items[0].meal }}<template v-if="pair.items[0].note">・{{ pair.items[0].note }}</template></span>
                      </div>
                      <span class="detail-price mono" :class="{ plus: Number(pair.amount) > 0, minus: Number(pair.amount) < 0 }">
                        {{ formatAmount(pair.amount) }}
                      </span>
                    </div>
                    <div class="detail-total">
                      <span>淨額</span>
                      <strong :class="{ plus: Number(log.amount) > 0, minus: Number(log.amount) < 0 }">{{ formatAmount(log.amount) }}</strong>
                    </div>
                  </div>

                  <div v-else class="detail-list">
                    <div v-for="(item, index) in log.items" :key="`${log.id}-${index}`" class="detail-item">
                      <div class="detail-main">
                        <span class="detail-meal">{{ item.meal }}</span>
                        <span v-if="item.note" class="detail-note">{{ item.note }}</span>
                      </div>
                      <span class="detail-price mono">{{ formatMoney(Number(item.price || 0)) }}</span>
                    </div>
                    <div class="detail-total">
                      <span>合計</span>
                      <strong>{{ formatMoney(Math.abs(Number(log.amount || 0))) }}</strong>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- 手機版交易紀錄資訊卡（比照歷史訂單 rc-card） -->
      <div class="log-cards">
        <template v-for="log in myLogs" :key="`lc-${log.id}`">
          <div
            class="lc-card"
            :class="{ expandable: hasDetail(log), expanded: expandedIds.includes(log.id) }"
            @click="hasDetail(log) && toggleDetail(log.id)"
          >
            <div class="lc-top">
              <span class="lc-desc">{{ logDescription(log) }}</span>
              <span class="lc-amount mono" :class="{ plus: Number(log.amount) > 0, minus: Number(log.amount) < 0 }">
                {{ formatAmount(log.amount) }}
              </span>
            </div>
            <div class="lc-foot">
              <span class="lc-time mono">{{ formatTime(log.timestamp) }}</span>
              <span class="lc-balance mono">餘額 {{ Number(log.afterBalance || 0).toLocaleString() }}</span>
              <button v-if="hasDetail(log)" type="button" class="lc-detail-toggle">
                {{ expandedIds.includes(log.id) ? '收合明細' : '明細' }}
              </button>
            </div>

            <template v-if="hasDetail(log) && expandedIds.includes(log.id)">
              <div v-if="log.type === MERGED_EDIT_TYPE" class="detail-list">
                <div v-for="pair in log.pairLogs" :key="pair.id" class="detail-item">
                  <div class="detail-main">
                    <span class="detail-meal">{{ typeLabels[pair.type] || pair.type }}</span>
                    <span v-if="pair.items && pair.items[0]" class="detail-note">{{ pair.items[0].meal }}<template v-if="pair.items[0].note">・{{ pair.items[0].note }}</template></span>
                  </div>
                  <span class="detail-price mono" :class="{ plus: Number(pair.amount) > 0, minus: Number(pair.amount) < 0 }">
                    {{ formatAmount(pair.amount) }}
                  </span>
                </div>
                <div class="detail-total">
                  <span>淨額</span>
                  <strong :class="{ plus: Number(log.amount) > 0, minus: Number(log.amount) < 0 }">{{ formatAmount(log.amount) }}</strong>
                </div>
              </div>

              <div v-else class="detail-list">
                <div v-for="(item, index) in log.items" :key="`lc-${log.id}-${index}`" class="detail-item">
                  <div class="detail-main">
                    <span class="detail-meal">{{ item.meal }}</span>
                    <span v-if="item.note" class="detail-note">{{ item.note }}</span>
                  </div>
                  <span class="detail-price mono">{{ formatMoney(Number(item.price || 0)) }}</span>
                </div>
                <div class="detail-total">
                  <span>合計</span>
                  <strong>{{ formatMoney(Math.abs(Number(log.amount || 0))) }}</strong>
                </div>
              </div>
            </template>
          </div>
        </template>
      </div>
      </template>
    </div>

    </template>
  </section>
</template>

<style scoped>
.wallet-panel {
  /* 面板模式的 .cart-col 是固定高的 column flexbox：不設 flex-shrink:0 會被壓成容器高，
     內容從面板盒子溢出，底部 padding 落在內容中間、交易紀錄永遠貼齊視窗底邊。 */
  flex-shrink: 0;
  min-height: 100%;
  padding: 24px 40px;
  touch-action: pan-y;
}

.wallet-head {
  display: block;
  align-items: stretch;
  margin-bottom: 16px;
}

/* ── 緊湊型錢包摘要：餘額與期間資訊共用一列 ── */
.balance-hero {
  display: grid;
  align-items: stretch;
}

.hero-balance {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero-label {
  font-size: var(--text-label);
  font-weight: 600;
  opacity: 0.9;
}

.hero-top i { font-size: var(--text-title); opacity: 0.9; }

.hero-amount {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  margin-top: 5px;
}

.hero-currency {
  font-weight: 800;
  font-size: var(--text-title);
  opacity: 0.85;
  line-height: 1.3;
}

.hero-value {
  font-weight: 800;
  line-height: 1;
}

.hero-owner {
  font-size: var(--text-label);
  opacity: 0.85;
  margin-top: 5px;
}

.hero-metrics {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.hero-metric {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
}

.hero-metric span, .hero-metric small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-metric span {
  font-size: var(--text-micro);
  opacity: 0.86;
}

.hero-metric strong {
  line-height: 1.2;
}

.hero-metric small {
  font-size: var(--text-micro);
  opacity: 0.82;
}

.low-alert {
  margin-bottom: 14px;
  padding: 11px 14px;
  border-radius: var(--r-md);
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  background: var(--bg-danger);
  color: var(--text-danger);
  font-size: var(--text-label);
  font-weight: 700;
}

.wallet-filters {
  min-width: 0;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) minmax(140px, 0.9fr) auto;
  align-content: center;
  align-items: end;
  gap: 10px;
}

.log-filters {
  margin: 0 16px 14px;
  border-color: var(--muted-line2);
  box-shadow: none;
}

.filter-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.filter-field span {
  color: var(--muted);
  font-size: var(--text-micro);
  font-weight: 700;
}

.filter-field select {
  min-width: 0;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--input-border);
  border-radius: var(--r-md);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 700;
  outline: none;
}

.filter-field select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--input-focus-ring); }

.filter-note {
  grid-column: 1 / -1;
  color: var(--muted);
  font-size: var(--text-micro);
  font-weight: 600;
}

.analytics-card {
  min-width: 0;
}

.analytics-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.analytics-head > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.analytics-subtitle {
  color: var(--muted);
}


.insights-card { padding-bottom: 14px; }

/* ── 近 6 週花費長條圖＋最常點（設計稿 2） ── */
.stats-grid {
  margin-bottom: 16px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.weekly-card, .fav-card { padding-bottom: 14px; }

.weekly-bars {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  align-items: end;
}

.weekly-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.weekly-amount {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  font-weight: 800;
}

.weekly-track {
  width: 100%;
  max-width: 56px;
  display: flex;
  align-items: flex-end;
}

.weekly-bar {
  display: block;
  width: 100%;
  transition: height 0.25s ease;
}

.weekly-label {
  color: var(--muted);
  font-size: var(--text-micro);
  font-weight: 700;
  white-space: nowrap;
}
.weekly-label.peak { font-weight: 800; }


.fav-list {
  padding: 0 12px;
  display: flex;
  flex-direction: column;
}

.fav-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.fav-rank {
  flex-shrink: 0;
  color: var(--rank-other);
  font-family: var(--font-display);
  font-weight: 800;
  text-align: center;
}

.fav-avatar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
}

.fav-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.fav-meal {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.fav-store {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fav-count {
  flex-shrink: 0;
  font-weight: 800;
}

.ranking-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
}

.ranking-label {
  display: flex;
  justify-content: space-between;
  color: var(--text-primary);
  font-weight: 800;
}

.ranking-label span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ranking-label b {
  margin-right: 7px;
  color: var(--muted);
  font-size: var(--text-micro);
}

.ranking-label strong { flex: 0 0 auto; }

.ranking-track {
  height: 7px;
  overflow: hidden;
  border-radius: 99px;
}

.ranking-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.log-card {
  /* 上限＝面板可視高（100vh − header）扣掉底部留白，捲到底時整張卡連留白剛好收進畫面，
     不會再出現表格貼齊視窗底邊、下方還藏一段死捲動區的狀況。 */
  margin-bottom: 0;
  max-height: calc(100vh - var(--header-height) - 60px);
  touch-action: pan-y;
  display: flex;
  flex-direction: column;
}

.log-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid var(--muted-line2);
}

.log-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.export-statement-btn {
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--mint);
  color: var(--text-on-success);
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
  transition: background 140ms ease, color 140ms ease, opacity 140ms ease;
}

.export-statement-btn:hover:not(:disabled) { filter: brightness(0.94); }

.export-statement-btn:disabled {
  cursor: wait;
  opacity: 0.65;
}

.section-title {
  /* 原本是 <span>，改成真正的標題元素後要壓掉 UA 的 margin 與字級，
     不然整排區塊會被撐開、字也會變大。 */
  margin: 0;
  color: var(--text-primary);
  font-size: inherit;
  font-weight: inherit;
}

.log-count {
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--muted);
}

.sync-chip {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--muted-line2);
  color: var(--muted);
  font-size: var(--text-micro);
  font-weight: 800;
}

.sync-chip.done {
  background: var(--mint-soft);
  color: var(--mint);
}

.sync-chip.warning {
  background: var(--paprika-soft);
  color: var(--paprika);
}

.empty {
  padding: 28px;
  color: var(--muted);
  text-align: center;
  font-size: var(--text-label);
}

.error-message {
  color: var(--paprika);
  font-weight: 800;
}

.loading-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--muted-line);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: wallet-spin 0.8s linear infinite;
}

@keyframes wallet-spin {
  to { transform: rotate(360deg); }
}

/* 比照管理端儲值錢包流水：紀錄區有限高並自行捲動，避免整頁無止盡拉長。 */
.log-table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  border-top: 1px solid var(--muted-line2);
  max-height: none;
  overflow-x: auto;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-label);
  table-layout: fixed;
}

.log-table th:first-child, .log-table td:first-child { width: 128px; }
.log-table th:nth-child(3), .log-table td:nth-child(3), .log-table th:nth-child(4), .log-table td:nth-child(4) { width: 96px; }
.log-table th:last-child, .log-table td:last-child { width: 64px; }

.log-table th, .log-table td {
  padding: 10px 12px;
  border-bottom: 1px dashed var(--muted-line2);
  text-align: left;
  vertical-align: middle;
}

.log-table tbody > tr:last-child > td {
  padding-bottom: 20px;
  border-bottom: 0;
}

.log-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--muted);
  font-size: var(--text-micro);
  font-weight: 900;
  letter-spacing: 1px;
  white-space: nowrap;
}

.log-table .right { text-align: right; }
.log-table .nowrap { white-space: nowrap; }
.log-table .time-cell, .log-table .after { color: var(--muted); }

.log-tr.expandable { cursor: pointer; }
.log-tr.expandable:hover td { background: color-mix(in srgb, var(--selection) 7%, var(--bg-card)); }
.log-tr.expanded td { background: color-mix(in srgb, var(--bg-inset) 62%, var(--bg-card)); }

.reason-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.amount {
  font-family: var(--font-display);
  font-weight: 800;
  color: var(--text-primary);
  white-space: nowrap;
}
/* 支出金額用中性色：橘色留給品牌／互動，收入綠色才會一眼跳出 */

.detail-col { width: 1%; white-space: nowrap; }
.detail-toggle {
  padding: 2px 8px;
  border-radius: var(--r-sm);
  background: var(--muted-line2);
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 800;
}

.detail-tr td { padding: 0; background: color-mix(in srgb, var(--bg-inset) 62%, var(--bg-card)); }

.detail-list {
  margin: 0 14px 12px;
  padding: 10px 11px;
  border-radius: var(--r-sm);
  background: var(--bg-card);
  border: 1px solid var(--muted-line2);
}

.detail-item, .detail-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.detail-item {
  padding: 6px 0;
  border-bottom: 1px dashed var(--muted-line2);
}
.detail-item:last-of-type { border-bottom: none; }

.detail-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-meal {
  color: var(--text-primary);
  font-size: var(--text-body);
  font-weight: 800;
}

.detail-note {
  color: var(--muted);
  font-size: var(--text-label);
}

.detail-price {
  flex-shrink: 0;
  color: var(--text-primary);
  font-size: var(--text-body);
  font-weight: 900;
}

.detail-total {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--muted-line2);
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 800;
}
.detail-total strong { color: var(--text-primary); }
.detail-total strong.plus { color: var(--text-success); }

/* ── 手機版交易紀錄資訊卡 ── */
.log-cards { display: none; }

.lc-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lc-card.expandable { cursor: pointer; }
.lc-card.expanded { border-color: var(--muted-line); }

.lc-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.lc-desc {
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 700;
  line-height: 1.35;
}

.lc-amount {
  flex-shrink: 0;
  color: var(--text-primary);
  font-size: var(--text-body);
  font-weight: 900;
  white-space: nowrap;
}

.lc-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  border-top: 1px dashed var(--muted-line2);
  font-size: var(--text-label);
}

.lc-time { color: var(--muted); }
.lc-balance {
  margin-left: auto;
  color: var(--muted);
  font-weight: 700;
}

.lc-detail-toggle {
  flex-shrink: 0;
  border-radius: 999px;
  color: var(--muted);
  font-size: var(--text-micro);
  font-weight: 800;
}

.lc-card .detail-list {
  margin: 0;
  background: color-mix(in srgb, var(--bg-inset) 62%, var(--bg-card));
}

@media (max-width: 768px) {
  .wallet-panel {
    /* --mobile-nav-height 已含 safe-area-inset-bottom，這裡不可再加一次 */
    min-height: calc(100dvh - var(--mobile-nav-height));
    padding: 18px 16px calc(88px + env(safe-area-inset-bottom, 0px));
  }
  /* 手機版改用資訊卡清單自行限高，桌機的視窗高上限不適用 */
  .log-card { max-height: none; }
  .balance-hero { grid-template-columns: 1fr; gap: 12px; padding: 16px; }
  .hero-balance { padding: 0 2px; }
  .hero-value { font-size: var(--text-hero); }
  .hero-metrics { gap: 7px; }
  .hero-metric { padding: 10px; }
  .hero-metric strong { font-size: var(--text-body); }
  .log-table-wrap { display: none; }
  .log-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    max-height: min(50vh, 520px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .log-cards::after { content: ''; flex: 0 0 12px; }
  .wallet-filters { grid-template-columns: 1fr; }
  .filter-note { text-align: left; }
  .stats-grid { grid-template-columns: 1fr; gap: 12px; }
  .weekly-bars { gap: 8px; padding: 0 12px; }
  .weekly-track { height: 96px; }
  .log-head { align-items: flex-start; }
  .log-status { flex-wrap: wrap; justify-content: flex-end; }
}

@media (min-width: 769px) and (max-width: 1100px) {
  .balance-hero { grid-template-columns: minmax(190px, 0.65fr) minmax(0, 1.35fr); }
  .wallet-filters { grid-template-columns: repeat(3, minmax(0, 1fr)) auto; }
  .filter-note { display: none; }
  .stats-grid { grid-template-columns: 1fr; }
}

.wallet-panel { background: var(--ink); }
.balance-hero { border-radius: 6px; border-top: 3px solid var(--persimmon); }
.balance-hero.low { color: var(--text-primary); border-radius: 6px; box-shadow: var(--shadow-card); border-top: 3px solid var(--persimmon); }
.hero-metric strong { font-family: var(--font-sans); font-variant-numeric: tabular-nums; }
.hero-value, .hero-currency { font-family: var(--font-display); font-weight: 700; font-variant-numeric: tabular-nums; }
.detail-total strong.minus { color: var(--persimmon-dark); }
.detail-item { border-bottom-style: dashed; }

.wallet-panel { color: var(--paper); }
.balance-hero { background: var(--paper); color: var(--ink); gap: 0; box-shadow: none; }
/* 餘額偏低原本底色與文字色都跟正常狀態相同，等於沒有提示 */
.balance-hero.low { background: var(--bg-warning); border-top-color: var(--warning); }
.balance-hero.low .hero-amount { color: var(--text-danger); }
.hero-amount { color: var(--jade); }
.hero-balance { padding-right: 24px; }
.hero-metrics { gap: 0; }
.hero-metric { border: 0; border-radius: 0; background: transparent; padding: 8px 16px; }
.hero-metrics .hero-metric { border-left: 1px solid var(--summary-divider); }
.hero-metric span, .hero-metric small { font-weight: 400; }
 .hero-metric strong { font-weight: 600; }
.spending-analysis > .hero-metric { display: flex; flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: 8px 16px; padding: 8px 0; }
.spending-analysis > .hero-metric strong { color: var(--gold); }
.analytics-card, .log-card { background: transparent; border: 0; border-radius: 0; box-shadow: none; overflow: visible; }
.analytics-head, .log-head { padding-inline: 0; }
.section-title { font-family: var(--font-display); font-weight: 600; }
.stats-grid { gap: 28px; }
.weekly-bars, .fav-list, .ranking-list { padding-inline: 0; }
.fav-list { gap: 0; border-block: 1px solid var(--line); }
.fav-item { background: transparent; border: 0; border-radius: 0; box-shadow: none; border-bottom: 1px solid var(--line); }
.fav-avatar { border-radius: 4px; }
.fav-count { background: transparent; border: 0; }
.fav-rank.rank-1, .fav-rank.rank-2, .fav-rank.rank-3, .weekly-amount.peak, .weekly-label.peak { color: var(--gold); }
.weekly-bar, .ranking-track span { background: var(--gold); }
/* 花費最高的那一週要跟其他週分得出來 */
.weekly-bar.peak { background: var(--persimmon); }
.ranking-track { background: var(--ink-3); }
.log-filters { background: transparent; padding: 12px 0; margin-inline: 0; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; }
.log-table-wrap { background: var(--ink-2); border-radius: 0; }
.log-table th { background: var(--ink-3); }
.log-table td { border-bottom-style: solid; }
.amount.plus, .amount.minus, .detail-price.plus, .detail-price.minus, .lc-amount.plus, .lc-amount.minus { color: var(--paper); }
.amount.plus::before, .lc-amount.plus::before { content: '+'; color: var(--jade); display: none; }
.log-cards { background: var(--ink-2); }
.lc-card { background: transparent; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; box-shadow: none; padding: 14px; }
.lc-foot { border: 0; padding-top: 0; }
.lc-detail-toggle { background: transparent; padding: 4px 0; }
@media (max-width: 768px) {
 .balance-hero { padding: 18px; }
 .hero-balance { padding: 0 0 16px; }
 .hero-metrics { border-top: 1px solid var(--summary-divider); padding-top: 12px; }
 .hero-metrics .hero-metric { padding: 4px 10px; }
 .hero-metrics .hero-metric:first-child { border-left: 0; padding-left: 0; }
 .hero-metric strong { font-size: var(--text-lead); }
 .hero-metric small { white-space: normal; line-height: 1.6; }
 .log-cards { gap: 0; }
}

.wallet-filters.period-controls { display: flex; flex-wrap: wrap; gap: 14px 22px; padding: 0; margin-bottom: 14px; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.period-controls .filter-field { width: 190px; flex: 0 1 190px; }
.period-controls:not(.teleported-toolbar) :deep(.app-date-picker) { width: 100%; }
.period-controls .toolbar-secondary-btn { align-self: flex-end; }
.period-controls:not(.teleported-toolbar) :deep(.date-trigger) { background: var(--ink-2); color: var(--paper); border-color: var(--line); }
.period-controls .date-sep { display: none; }

/* 移到 TopHeader 的版本：跟歷史訂單／統計頁的 teleport toolbar 一樣單行排列，
   不需要「開始日期／結束日期」文字標籤（picker 的 aria-label 已提供）。 */
.period-controls.teleported-toolbar {
  width: 100%;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: nowrap;
  gap: 8px;
  margin-bottom: 0;
}
.period-controls.teleported-toolbar .filter-field {
  flex-direction: row;
  align-items: center;
  width: auto;
  flex: 0 0 auto;
}
.period-controls.teleported-toolbar .filter-field > span { display: none; }
.period-controls.teleported-toolbar .date-sep { display: inline; color: var(--muted); }
.period-controls.teleported-toolbar .toolbar-secondary-btn { align-self: center; }

.wallet-scope { color: var(--muted); font-size: var(--text-label); margin-bottom: 16px; line-height: 1.6; }
.balance-hero { grid-template-columns: minmax(170px, .7fr) minmax(0, 2.3fr); padding: 22px 26px; }
.hero-value { font-size: var(--text-hero); }
.hero-metric strong { font-size: var(--text-title); }
.hero-top i { display: none; }
.spending-analysis { margin-top: 32px; margin-bottom: 36px; border: 0; padding-top: 0; }
.spending-analysis > summary { display: flex; align-items: baseline; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap; cursor: pointer; padding: 0 0 12px; border-bottom: 1px solid var(--line); font-weight: 600; color: var(--paper); list-style: none; }
.spending-analysis > summary::-webkit-details-marker { display: none; }
.analysis-title { margin: 0; display: inline; font-family: var(--font-display); font-size: var(--text-lead); font-weight: inherit; }
.analysis-title::before { content: '▸'; display: inline-block; margin-right: 7px; font-family: var(--font-sans); }
.spending-analysis[open] .analysis-title::before { content: '▾'; }
.average-stat { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 6px; color: var(--ink-soft); font-size: var(--text-label); font-weight: 400; }
.average-stat strong { color: var(--gold); font-size: var(--text-lead); font-weight: 600; }
.average-stat small { font-size: var(--text-micro); }
.spending-analysis .stats-grid { grid-template-columns: 1.1fr 1fr 1fr; gap: 32px; margin-top: 20px; }
.analytics-head { padding: 0; min-height: 48px; margin-bottom: 12px; }
.section-title { font-size: var(--text-body); }
.analytics-subtitle { font-size: var(--text-micro); font-weight: 400; }
.weekly-bars { margin-top: 0; gap: 12px; padding: 0; }
.weekly-track { height: 110px; background: transparent; }
.weekly-bar, .weekly-bar.peak { border-radius: 4px 4px 2px 2px; box-shadow: none; }
.weekly-bar.zero { height: 3px !important; min-height: 3px; background: var(--ink-3); }
.fav-list { margin-top: 0; background: transparent; border: 0; }
.fav-item { padding: 10px 0; }
.fav-item:last-child { border-bottom: 1px solid var(--line); }
.fav-avatar { width: 30px; height: 30px; font-size: var(--text-body); }
.fav-rank { width: 12px; font-size: var(--text-micro); }
.fav-meal { font-size: var(--text-body); font-weight: 600; white-space: normal; overflow-wrap: anywhere; }
.fav-store { font-size: var(--text-micro); font-weight: 400; }
.fav-count { color: var(--gold); font-size: var(--text-label); white-space: nowrap; }
.ranking-list { padding: 0; gap: 0; }
.ranking-item { padding: 12px 0; border-bottom: 1px solid var(--line); }
.ranking-label { gap: 12px; font-size: var(--text-body); }
.ranking-label span { white-space: normal; overflow-wrap: anywhere; }
.ranking-label strong { color: var(--gold); font-size: var(--text-label); }
.ranking-track { display: none; }
@media (max-width: 1000px) {
  .spending-analysis .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .weekly-card { grid-column: 1 / -1; }
}
@media (max-width: 768px) {
  .period-controls .filter-field { flex: 1 1 130px; width: auto; }
  .balance-hero { grid-template-columns: minmax(0, 1fr); padding: 18px; }
  .hero-metric strong { font-size: var(--text-lead); }
  .spending-analysis .stats-grid { grid-template-columns: minmax(0, 1fr); gap: 28px; }
  .weekly-card { grid-column: auto; }
}
</style>
