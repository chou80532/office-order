<script setup>
import LoadingState from '../ui/LoadingState.vue'
import StatusNotice from '../ui/StatusNotice.vue'
import OrderRow from './OrderRow.vue'
import OrderRowHead from './OrderRowHead.vue'
const rangeEndPicker = ref(null)

import { ref, computed, onMounted, watch, toRef } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useToast } from '../../composables/useToast'
import { useOrderHistory } from '../../composables/useOrderHistory'
import { getTaipeiDayStartMs, formatMoney } from '../../utils/format'
import {
  escapeCSV,
  formatTimeShort,
  formatTimeSmart,
  getLocalDateKey,
  getTaipeiDateRangeBounds,
  getTaipeiMonthRange,
} from '../../utils'
import AppDatePicker from '../ui/AppDatePicker.vue'
import { useToolbarTeleport } from '../../composables/useToolbarTeleport'

const props = defineProps({
  allStores: { type: Array, default: () => [] },
  searchQuery: { type: String, default: null },
  showToolbar: { type: Boolean, default: true },
  toolbarTarget: { type: String, default: '' }
})

defineEmits(['show-toast', 'copy-order'])

const { userDisplayName } = useAuth()
const { showToast } = useToast()

const yesterday = new Date(getTaipeiDayStartMs() - 1)
const lastHistoryDate = getLocalDateKey(yesterday)
const defaultExportRange = getTaipeiMonthRange(yesterday)
const exportFrom = ref(defaultExportRange.from)
const exportTo = ref(lastHistoryDate)
const { orders, loading, error: loadError, ready, reload } = useOrderHistory(exportFrom, exportTo)
const csvExporting = ref(false)
const desktopToolbar = useToolbarTeleport(toRef(props, 'toolbarTarget'))

const orderTime = (order) => Number(order.timestamp ?? order.createdAt?.toMillis?.() ?? 0)
const inExportRange = (order) => {
  const time = orderTime(order)
  const { startMs, endMs } = getTaipeiDateRangeBounds(exportFrom.value, exportTo.value)
  return time >= startMs && time < endMs
}

async function exportCSV() {
  if (csvExporting.value || !ready.value) return
  csvExporting.value = true
  const headers = ['姓名', '店家', '品項', '備註', '金額', '免費', '時間']
  try {
    const csvOrders = [...orders.value].filter(inExportRange).sort((a, b) => orderTime(a) - orderTime(b))
    const rows = csvOrders.map(o => [
      o.name, o.storeName, o.meal, o.note || '',
      o.price, o.isFree ? '是' : '否', formatTimeSmart(orderTime(o) || Date.now())
    ])
    const totalAmount = csvOrders.reduce((sum, o) => o.isFree ? sum : sum + (Number(o.price) || 0), 0)
    const totalsRow = ['合計', '', `${csvOrders.length} 筆`, '', totalAmount, '', '']
    const csv = [headers, ...rows, totalsRow].map(r => r.map(escapeCSV).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const label = exportFrom.value === exportTo.value ? exportFrom.value : `${exportFrom.value}_${exportTo.value}`
    a.download = `歷史訂單_${label}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast('歷史訂單 CSV 已匯出', 'success')
  } catch (error) {
    console.error('[RecordTable] CSV export failed:', error)
    showToast('匯出歷史訂單失敗，請稍後再試', 'error')
  } finally {
    csvExporting.value = false
  }
}

// ── Search ────────────────────────────────────
const localQuery = ref('')
const effectiveQuery = computed(() => props.searchQuery !== null ? props.searchQuery : localQuery.value)

const filteredOrders = computed(() => {
  const q = effectiveQuery.value.trim().toLowerCase()
  const rangedOrders = orders.value.filter(inExportRange)
  if (!q) return rangedOrders
  return rangedOrders.filter(o =>
    (o.name || '').toLowerCase().includes(q) ||
    (o.meal || '').toLowerCase().includes(q) ||
    (o.storeName || '').toLowerCase().includes(q)
  )
})

// ── 區間 KPI（設計稿 3：團隊訂單／團隊花費／參與成員） ──
const rangeStats = computed(() => {
  const people = new Set()
  let spend = 0
  filteredOrders.value.forEach(order => {
    const name = String(order.name || '').trim()
    if (name) people.add(name)
    if (!order.isFree) spend += Number(order.price) || 0
  })
  return { count: filteredOrders.value.length, spend, people: people.size }
})

// ── Date grouping ─────────────────────────────
const todayStr = new Date(getTaipeiDateRangeBounds(getLocalDateKey(), getLocalDateKey()).startMs)
  .toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })
const isToday = (d) => d === todayStr

const collapsedDates = ref([])

const groupedOrders = computed(() => {
  const groups = {}

  filteredOrders.value.forEach(order => {
    const d = new Date(order.timestamp)
    const dateStr = d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })
    const dayName = d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' })
    // 用 en-US 取純數字，避免 zh-TW 帶出「15日」「7月」字尾
    const dayNum = d.toLocaleDateString('en-US', { timeZone: 'Asia/Taipei', day: 'numeric' })
    const monthLabel = d.toLocaleDateString('en-US', { timeZone: 'Asia/Taipei', month: 'numeric' })
    const storeName = order.storeName || '未指定店家'

    if (!groups[dateStr]) {
      groups[dateStr] = { dateStr, dayName, dayNum, monthLabel: `${monthLabel}月`, dateObj: d, total: 0, names: new Set(), storesMap: {} }
    }
    if (!groups[dateStr].storesMap[storeName]) groups[dateStr].storesMap[storeName] = { storeName, total: 0, items: [] }

    const price = Number(order.price) || 0
    if (!order.isFree) {
      groups[dateStr].total += price
      groups[dateStr].storesMap[storeName].total += price
    }
    const name = String(order.name || '').trim()
    if (name) groups[dateStr].names.add(name)
    groups[dateStr].storesMap[storeName].items.push({ ...order })
  })

  return Object.values(groups)
    .sort((a, b) => b.dateObj - a.dateObj)
    .map(g => ({
      ...g,
      participantCount: g.names.size,
      stores: Object.values(g.storesMap)
        .sort((a, b) => a.storeName.localeCompare(b.storeName, 'zh-TW'))
        .map(s => ({ ...s, items: s.items.sort((a, b) => b.timestamp - a.timestamp) }))
    }))
})

const dayTitle = (dateGroup) => dateGroup.stores
  .map(store => store.storeName)
  .filter(Boolean)
  .join('、')

const isSelf = (order) => String(order?.name || '').trim() === String(userDisplayName.value || '').trim()
const toggleGroup = (dateStr) => {
  const i = collapsedDates.value.indexOf(dateStr)
  i > -1 ? collapsedDates.value.splice(i, 1) : collapsedDates.value.push(dateStr)
}

onMounted(() => {
  const collapseOldDates = (groups) => {
    // 歷史訂單不含今天：讓最新一天保持展開，其餘收合
    const keepOpen = groups.find(g => isToday(g.dateStr)) || groups[0]
    groups.forEach(g => {
      if (g !== keepOpen && !collapsedDates.value.includes(g.dateStr)) collapsedDates.value.push(g.dateStr)
    })
  }
  if (groupedOrders.value.length) {
    collapseOldDates(groupedOrders.value)
  } else {
    const stop = watch(groupedOrders, (groups) => {
      if (!groups.length) return
      collapseOldDates(groups)
      stop()
    })
  }
})

const getStoreInfo = (name) => props.allStores.find(s => s.name === name) || {}

defineExpose({ filteredOrders })
</script>

<template>
  <div class="record-table">
    <Teleport
      v-if="showToolbar"
      :to="toolbarTarget || 'body'"
      :disabled="!toolbarTarget || !desktopToolbar"
    >
    <div class="table-header" :class="{ 'teleported-toolbar': toolbarTarget && desktopToolbar }">
      <div class="search-wrap app-search-shell">
        <svg class="search-icon" viewBox="0 0 16 16" fill="none">
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input
          v-model="localQuery"
          class="search-input"
          type="text"
          placeholder="搜尋姓名、餐點、店家…"
          autocomplete="off"
        />
        <button v-if="localQuery" class="search-clear app-search-clear" @click="localQuery = ''" title="清除">✕</button>
        <span v-if="localQuery" class="search-count">{{ filteredOrders.length }} 筆</span>
      </div>
      <div class="header-actions export-actions">
        <AppDatePicker v-model="exportFrom" @change="rangeEndPicker?.openPicker()" :max="exportTo || lastHistoryDate" aria-label="歷史訂單起始日期" compact />
        <span class="date-sep">—</span>
        <AppDatePicker ref="rangeEndPicker" v-model="exportTo" :min="exportFrom || undefined" :max="lastHistoryDate" aria-label="歷史訂單結束日期" compact />
        <button type="button" class="toolbar-secondary-btn" :disabled="loading" @click="reload">重新整理</button>
        <button type="button" class="action-btn export-csv-btn" :disabled="csvExporting || !ready" @click="exportCSV">
          {{ csvExporting ? '匯出中…' : '↓ 匯出 CSV' }}
        </button>
      </div>
    </div>
    </Teleport>

    <LoadingState v-if="loading" title="正在載入所選區間的全部訂單…" description="正在整理日期群組與餐點明細，請稍候。" />
    <StatusNotice v-else-if="loadError" alert :title="loadError" description="可能是連線中斷，重試一次通常就好。">
      <button type="button" class="action-btn" @click="reload">重試</button>
    </StatusNotice>
    <div v-else-if="ready" class="record-body">
      <!-- 區間 KPI 卡（設計稿 3） -->
      <div class="record-kpis summary-strip summary-three" aria-label="區間團隊統計">
        <div class="rk-card rk-orders summary-cell">
          <span class="rk-label">區間團隊訂單</span>
          <strong class="rk-value">{{ rangeStats.count.toLocaleString() }} <span class="rk-unit">筆</span></strong>
        </div>
        <div class="rk-card summary-cell">
          <span class="rk-label">區間團隊花費</span>
          <strong class="rk-value">{{ formatMoney(rangeStats.spend) }}</strong>
        </div>
        <div class="rk-card summary-cell">
          <span class="rk-label">參與成員</span>
          <strong class="rk-value">{{ rangeStats.people.toLocaleString() }} <span class="rk-unit">人</span></strong>
        </div>
      </div>

      <StatusNotice
        v-if="filteredOrders.length === 0"
        :title="effectiveQuery ? `沒有符合「${effectiveQuery}」的訂單` : '此區間沒有任何訂單'"
        :description="effectiveQuery ? '換個關鍵字，或清掉搜尋看整個區間。' : '換一段日期區間看看。'"
      />

      <!-- 日期卡（設計稿 3：日期徽章＋店家＋參與人數＋當日合計，可收合） -->
      <section
        v-for="dateGroup in groupedOrders"
        :key="dateGroup.dateStr"
        class="day-card"
        :class="{ collapsed: collapsedDates.includes(dateGroup.dateStr) }"
      >
        <button type="button" class="day-head" @click="toggleGroup(dateGroup.dateStr)">
          <span class="day-badge" :class="{ today: isToday(dateGroup.dateStr) }">
            <strong>{{ dateGroup.dayNum }}</strong>
            <small>{{ isToday(dateGroup.dateStr) ? '今日' : dateGroup.monthLabel }}</small>
          </span>
          <span class="day-store-icon" aria-hidden="true">
            <i :class="['fas', getStoreInfo(dateGroup.stores[0]?.storeName).category === 'drink' ? 'fa-mug-hot' : 'fa-bowl-food']"></i>
          </span>
          <span class="day-info">
            <span class="day-title">{{ dayTitle(dateGroup) }}</span>
            <small class="day-sub">{{ dateGroup.participantCount }} 人參與 ・ {{ dateGroup.dayName }}</small>
          </span>
          <span class="day-total">
            <small>當日合計</small>
            <strong class="mono">{{ formatMoney(dateGroup.total) }}</strong>
          </span>
          <span class="day-chevron" aria-hidden="true">
            <i class="fas fa-chevron-down"></i>
          </span>
        </button>

        <div v-show="!collapsedDates.includes(dateGroup.dateStr)" class="day-body order-rows">
          <OrderRowHead show-time />
          <template v-for="storeGroup in dateGroup.stores" :key="`${dateGroup.dateStr}-${storeGroup.storeName}`">
            <div v-if="dateGroup.stores.length > 1" class="store-subhead">
              <span class="store-subhead-name">{{ storeGroup.storeName }}</span>
              <a
                v-if="getStoreInfo(storeGroup.storeName).phone"
                :href="`tel:${getStoreInfo(storeGroup.storeName).phone.replace(/\D/g,'')}`"
                class="store-phone"
              >{{ getStoreInfo(storeGroup.storeName).phone }}</a>
              <!-- 金額欄跟下方明細列同寬、同樣靠右，兩者才會落在同一條基線上 -->
              <span class="store-subhead-count">{{ storeGroup.items.length }} 筆</span>
              <span class="store-subhead-total">{{ formatMoney(storeGroup.total) }}</span>
              <span class="store-subhead-actions" aria-hidden="true"></span>
            </div>

            <OrderRow
              v-for="item in storeGroup.items"
              :key="item.id"
              :order="item"
              :is-self="isSelf(item)"
              :time="formatTimeShort(item.timestamp)"
            >
              <template #actions>
                <button class="row-btn copy" @click="$emit('copy-order', item)" title="我也要！">+1</button>
              </template>
            </OrderRow>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.record-table {
  min-height: 100%;
}

.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 40px;
  border-bottom: 1.5px solid var(--muted-line);
  gap: 12px;
  flex-wrap: wrap;
}

.table-header.teleported-toolbar {
  width: 100%;
  padding: 0;
  border-bottom: 0;
  flex-wrap: nowrap;
}

.search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  max-width: 360px;
  background: var(--paper);
  border: 1.5px solid var(--muted-line);
  border-radius: 999px;
  padding: 0 14px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.search-wrap:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--input-focus-ring);
}

.search-icon {
  width: 13px; height: 13px;
  flex-shrink: 0;
  color: var(--muted);
}

.search-input {
  flex: 1; min-width: 0;
  border: none; background: transparent;
  padding: 8px 0;
  font-size: var(--text-label); font-weight: 500;
  color: var(--ink); outline: none;
}
.search-input::placeholder { color: var(--muted); font-weight: 400; }

.search-clear {
  flex-shrink: 0;
  width: 26px; height: 26px;
  border-radius: 50%;
  font-size: var(--text-micro); font-weight: 800;
  background: var(--muted-line); color: var(--muted);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s; line-height: 1;
}
.search-clear:hover { background: var(--selection-soft); color: var(--selection); }

.search-count {
  flex-shrink: 0;
  font-size: var(--text-micro); font-weight: 700;
  color: var(--paprika);
  background: var(--paprika-soft);
  padding: 2px 7px;
  border-radius: var(--r-sm);
  white-space: nowrap;
}

.header-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }

.action-btn {
  padding: 7px 15px;
  border-radius: var(--r-sm);
  font-size: var(--text-body);
  font-weight: 800;
  border: 1.5px solid transparent;
  transition: all 0.15s;
}
.action-btn.export-csv-btn {
  background: var(--mint);
  color: var(--text-on-success);
  white-space: nowrap;
}
.action-btn.export-csv-btn:disabled {
  cursor: wait;
  opacity: 0.65;
}

.record-body {
  padding: 18px 40px 32px;
  display: flex;
  flex-direction: column;
}

/* ── 區間 KPI 卡（設計稿 3） ── */
.record-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.rk-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.rk-orders {
  border: none;
  box-shadow: 0 16px 30px -18px color-mix(in srgb, var(--accent) 70%, transparent);
}

.rk-label {
  font-size: var(--text-label);
}

.rk-unit { font-size: var(--text-body); font-weight: 700; opacity: 0.75; }

/* ── 日期卡 ── */
.day-card {
  overflow: hidden;
}

.day-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  text-align: left;
  transition: background 0.15s;
}
.day-head:hover { background: color-mix(in srgb, var(--accent) 4%, var(--paper)); }

.day-badge {
  flex-shrink: 0;
  width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.1;
}
.day-badge strong {
  color: var(--text-accent);
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: 800;
}
.day-badge small { color: var(--muted); font-size: var(--text-micro); font-weight: 700; }
.day-badge.today small { color: var(--text-accent); }

.day-store-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 13px;
  background: var(--bg-accent);
  color: var(--text-accent);
  align-items: center;
  justify-content: center;
  font-size: var(--text-lead);
}

.day-info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.day-title {
  color: var(--ink);
  font-size: var(--text-lead);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.day-sub { color: var(--muted); font-size: var(--text-label); font-weight: 600; }

.day-total {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}
.day-total small { color: var(--text-accent); font-size: var(--text-micro); font-weight: 700; }
.day-total strong { color: var(--ink); font-size: var(--text-title); font-weight: 800; }

.day-chevron {
  flex-shrink: 0;
  color: var(--muted);
  font-size: var(--text-label);
  transition: transform 0.18s ease;
}
.day-card.collapsed .day-chevron { transform: rotate(-90deg); }

.day-body {
  border-top: 1px solid var(--muted-line2);
}

/* 多店家時的店家小標 */
.store-subhead {
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--muted-line2);
}
.store-subhead-name { color: var(--ink); font-size: var(--text-label); font-weight: 800; }
.store-phone { font-size: var(--text-label); color: var(--muted); text-decoration: none; }
.store-phone:hover { color: var(--ink); }
.store-subhead-count { margin-left: auto; color: var(--muted); font-size: var(--text-label); font-weight: 700; }
/* 跟明細列的 .or-money 同寬、同樣靠右對齊 */
.store-subhead-total {
  min-width: var(--or-col-money);
  text-align: right;
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
/* 跟明細列的 .or-actions 同寬的保留空間（這裡沒有按鈕，純粹用來對齊金額基線） */
.store-subhead-actions { min-width: var(--or-col-act); flex-shrink: 0; }


/* ── 手機版：列改兩行堆疊 ── */
@media (max-width: 768px) {
  .table-header { padding: 12px 16px; }
  .record-body { padding: 12px 12px 24px; gap: 10px; }
  .record-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .record-kpis .rk-card:first-child { grid-column: 1 / -1; }
  .rk-card { padding: 14px 16px; }
  .rk-value { font-size: var(--text-title); }

  .day-head { padding: 12px 14px; gap: 10px; }
  .day-store-icon { display: none; }
  .day-total strong { font-size: var(--text-lead); }
  /* 手機沒有明細列的操作欄可對齊，不必保留那段空白 */
  .store-subhead-actions { min-width: 0; }

}

.record-table { background: var(--ink); }
.day-card { border: 0; background: var(--paper); color: var(--ink); }
.day-card::before { content: ''; height: 9px; background: linear-gradient(45deg, var(--ink) 25%, transparent 25%), linear-gradient(-45deg, var(--ink) 25%, transparent 25%); background-size: 14px 14px; }
/* 分隔線與金額色已收斂到 components.css 的 .order-row */
.day-title { font-family: var(--font-display); }
.rk-orders { background: var(--paper); color: var(--ink); }
.rk-orders .rk-label { color: var(--ink-faint); }
.day-total strong, .rk-value { font-family: var(--font-sans); font-variant-numeric: tabular-nums; }

.record-body { gap: 24px; }
.table-header:not(.teleported-toolbar) .action-btn:not(.export-csv-btn) { color: var(--paper); border-color: var(--line); }
@media (max-width: 768px) {
  .header-actions { width: 100%; min-width: 0; flex-wrap: wrap; }
  .header-actions .date-sep { display: none; }
}
.day-card { border-radius: 4px; box-shadow: none; }
.day-card::before { display: none; }
.day-head { padding: 14px 16px; border: 0; border-bottom: 1px solid var(--ink-faint); }
.day-badge { background: transparent; border: 0; border-radius: 0; }
.day-store-icon { display: none; }
/* 左右邊界跟明細列共用 --or-pad-x，兩者的左邊界（店名 vs. 頭像）才會切齊 */
.store-subhead { background: transparent; padding: 12px var(--or-pad-x); }
:deep(.order-row), :deep(.order-row-head) { border-bottom-color: var(--paper-2); }

.day-title { font-weight: 600; }

.rk-orders .rk-value { color: var(--ink); }
</style>
