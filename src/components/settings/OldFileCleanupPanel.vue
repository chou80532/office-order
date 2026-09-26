<template>
  <div class="cleanup-panel ops-surface">
    <!-- 資料量總覽卡（設計稿 5 的用量卡；顯示真實訂單筆數與已查詢可清理筆數） -->
    <div class="usage-card">
      <div class="usage-left">
        <span class="usage-label">訂單資料量</span>
        <strong class="usage-value">
          <template v-if="isLoadingRange"><span class="mini-spinner"></span></template>
          <template v-else>{{ dataRange.total.toLocaleString() }} <small>筆</small></template>
        </strong>
        <span v-if="dataRange.total > 0" class="usage-range mono">{{ dataRange.earliest }} – {{ dataRange.latest }}</span>
      </div>
      <div class="usage-bar-wrap" aria-hidden="true">
        <div class="usage-bar">
          <span class="usage-seg cleanable" :style="{ width: `${cleanablePct}%` }"></span>
        </div>
        <div class="usage-legend">
          <span class="legend-item"><span class="legend-dot cleanable"></span>已查詢可清理 {{ cleanablePct }}%</span>
          <span class="legend-item"><span class="legend-dot rest"></span>其他資料</span>
        </div>
      </div>
      <div class="usage-release">
        <span class="usage-release-label">預計可清理</span>
        <strong class="usage-release-value">{{ selectedCleanableCount.toLocaleString() }} 筆</strong>
        <small class="usage-release-hint">先查詢或預覽才會計入</small>
      </div>
    </div>

    <p class="cleanup-section-label">可清理項目</p>

    <section class="cleanup-card history-cleanup">
      <div class="item-head">
        <span class="item-icon order" aria-hidden="true"><i class="fas fa-receipt"></i></span>
        <div class="item-title-wrap">
          <h3>歷史訂單清理</h3>
          <p>依日期查詢並刪除未連動帳務的舊訂單，適合清除早期歷史紀錄。</p>
        </div>
        <span class="item-size" :class="{ ready: queryResult?.length }">
          {{ queryResult?.length ? `${queryResult.length.toLocaleString()} 筆` : '未查詢' }}
        </span>
      </div>

      <div class="scope-note history-note">
        <i class="fas fa-circle-info"></i>
        <span>只刪除未連動現金或錢包的 <code>orders</code>；若含帳務，請使用下方完整清理。</span>
      </div>

    <!-- Date range picker -->
    <div class="date-range-row">
      <div class="date-field">
        <label>開始日期</label>
        <AppDatePicker v-model="startDate" @change="rangeEndPicker?.openPicker()" aria-label="歷史訂單清理開始日期" />
      </div>
      <div class="date-sep"><i class="fas fa-arrow-right"></i></div>
      <div class="date-field">
        <label>結束日期</label>
        <AppDatePicker ref="rangeEndPicker" v-model="endDate" aria-label="歷史訂單清理結束日期" />
      </div>
      <button class="btn btn-secondary query-btn" @click="queryOrders" :disabled="isQuerying || !startDate || !endDate">
        <span v-if="isQuerying" class="mini-spinner"></span>
        <template v-else><i class="fas fa-search"></i></template>
        查詢歷史訂單
      </button>
    </div>

    <!-- Query results -->
    <div v-if="queryResult !== null" class="result-section">
      <div v-if="queryResult.length === 0" class="no-data">
        <i class="fas fa-check-circle" style="color:var(--mint)"></i>
        <span>該日期區間內沒有任何訂單</span>
      </div>
      <template v-else>
        <div class="result-summary">
          <div class="summary-stat">
            <span class="stat-number">{{ queryResult.length }}</span>
            <span class="stat-label">筆訂單</span>
          </div>
          <div class="summary-stat">
            <span class="stat-number">{{ uniqueStores }}</span>
            <span class="stat-label">家店</span>
          </div>
          <div class="summary-stat">
            <span class="stat-number">{{ formatMoney(totalAmount) }}</span>
            <span class="stat-label">總金額</span>
          </div>
        </div>

        <div class="result-list">
          <div v-for="order in queryResult.slice(0, 50)" :key="order.id" class="order-row">
            <span class="order-date">{{ formatDate(order.timestamp) }}</span>
            <span class="order-store">{{ order.storeName || '未指定' }}</span>
            <span class="order-meal">{{ order.meal }}</span>
            <span class="order-price">{{ formatMoney(order.price || 0) }}</span>
          </div>
          <div v-if="queryResult.length > 50" class="more-hint">
            ...還有 {{ queryResult.length - 50 }} 筆未顯示
          </div>
        </div>

        <div class="delete-section">
          <div class="delete-warning">
            <i class="fas fa-exclamation-triangle"></i>
            <span>將嘗試刪除 <strong>{{ queryResult.length }}</strong> 筆未連動帳務的歷史訂單，此操作不可復原！</span>
          </div>
          <button class="btn btn-danger delete-btn" @click="deleteOrders" :disabled="isDeleting">
            <span v-if="isDeleting" class="mini-spinner"></span>
            <template v-else><i class="fas fa-trash-alt"></i></template>
            {{ isDeleting ? `刪除中 (${deleteProgress}/${queryResult.length})...` : `確認刪除 ${queryResult.length} 筆訂單` }}
          </button>
        </div>
      </template>
    </div>
    </section>

    <section class="cleanup-card linked-cleanup">
      <div class="item-head">
        <span class="item-icon linked" aria-hidden="true"><i class="fas fa-link-slash"></i></span>
        <div class="item-title-wrap">
          <h3>完整連動資料清理</h3>
          <p>刪除區間內的訂單及所有連動帳務，並反向校正錢包餘額。</p>
        </div>
        <span class="item-size" :class="{ ready: cleanupPreview?.documentCount }">
          {{ cleanupPreview?.documentCount ? `${cleanupPreview.documentCount.toLocaleString()} 筆` : '未預覽' }}
        </span>
      </div>

      <div class="scope-note linked-note">
        <i class="fas fa-shield-halved"></i>
        <span>包含現金應收、現金 Log、錢包 Log 與請求；不會刪除會員、店家或菜單。</span>
      </div>

      <div class="datetime-row">
        <div class="date-field grow">
          <label>開始時間</label>
          <AppDatePicker v-model="cleanupFrom" mode="datetime" :max="cleanupTo" aria-label="帳務連動清理開始時間" @change="cleanupPreview = null" />
        </div>
        <div class="date-sep"><i class="fas fa-arrow-right"></i></div>
        <div class="date-field grow">
          <label>結束時間</label>
          <AppDatePicker v-model="cleanupTo" mode="datetime" :min="cleanupFrom" aria-label="帳務連動清理結束時間" @change="cleanupPreview = null" />
        </div>
        <button class="btn btn-secondary" :disabled="isPreviewingCleanup || !cleanupFrom || !cleanupTo" @click="previewLinkedCleanup">
          <span v-if="isPreviewingCleanup" class="mini-spinner"></span>
          <template v-else><i class="fas fa-magnifying-glass"></i></template>
          預覽影響
        </button>
      </div>

      <div v-if="cleanupPreview" class="cleanup-preview">
        <div class="preview-grid">
          <div><strong>{{ cleanupPreview.counts.orders }}</strong><span>訂單</span></div>
          <div><strong>{{ cleanupPreview.counts.cashPayments }}</strong><span>現金應收</span></div>
          <div><strong>{{ cleanupPreview.counts.cashLogs }}</strong><span>現金 Log</span></div>
          <div><strong>{{ cleanupPreview.counts.walletLogs }}</strong><span>錢包 Log</span></div>
          <div><strong>{{ cleanupPreview.counts.walletRequests }}</strong><span>錢包請求</span></div>
        </div>

        <div v-if="cleanupPreview.walletAdjustments.length" class="wallet-corrections">
          <strong>錢包餘額校正</strong>
          <div v-for="wallet in cleanupPreview.walletAdjustments" :key="wallet.walletId" class="correction-row">
            <span>{{ wallet.ownerName || wallet.walletId }}（{{ wallet.logCount }} 筆）</span>
            <b :class="{ positive: wallet.balanceCorrection > 0 }">
              {{ wallet.balanceCorrection > 0 ? '+' : '' }}{{ formatMoney(wallet.balanceCorrection) }}
            </b>
          </div>
        </div>

        <div v-if="!cleanupPreview.canDelete" class="limit-warning">
          此區間需要 {{ cleanupPreview.writeCount }} 次寫入，超過單次上限 {{ cleanupPreview.maxWrites }}，請縮小時間區間。
        </div>
        <div v-else-if="cleanupPreview.documentCount === 0" class="no-matches">此區間沒有可清理的訂單或帳務資料。</div>
        <button
          v-else
          class="btn btn-danger linked-delete-btn"
          :disabled="isDeletingLinked"
          @click="deleteLinkedCleanup"
        >
          <span v-if="isDeletingLinked" class="mini-spinner"></span>
          <template v-else><i class="fas fa-trash-can"></i></template>
          {{ isDeletingLinked ? '正在刪除並校正帳務…' : `刪除 ${cleanupPreview.documentCount} 筆連動資料` }}
        </button>
      </div>
    </section>

  </div>
</template>

<script setup>
const rangeEndPicker = ref(null)

import { ref, reactive, computed, onMounted } from 'vue'
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore'
import { db } from '../../firestore'
import { useToast } from '../../composables/useToast'
import { confirmDialog, promptDialog } from '../../composables/useDialog'
import AppDatePicker from '../ui/AppDatePicker.vue'
import { getTaipeiDateTimeMs, getTaipeiDateTimeValue, getTaipeiDayStartMs, getTaipeiDateRangeBounds, formatMoney, formatDateShort } from '../../utils/format'
import {
  deleteUnlinkedOrdersViaFunction,
  deleteTimeRangeDataViaFunction,
  previewTimeRangeCleanupViaFunction,
} from '../../services/adminFunctions'

const { showToast } = useToast()

const startDate = ref('')
const endDate = ref('')
const isLoadingRange = ref(false)
const dataRange = reactive({ earliest: '', latest: '', total: 0 })

const loadDataRange = async () => {
  isLoadingRange.value = true
  try {
    const earliestSnap = await getDocs(query(collection(db, 'orders'), orderBy('timestamp', 'asc'), limit(1)))
    const latestSnap = await getDocs(query(collection(db, 'orders'), orderBy('timestamp', 'desc'), limit(1)))
    const allSnap = await getDocs(collection(db, 'orders'))
    if (!earliestSnap.empty && !latestSnap.empty) {
      const fmt = (ts) => formatDateShort(ts)
      dataRange.earliest = fmt(earliestSnap.docs[0].data().timestamp)
      dataRange.latest = fmt(latestSnap.docs[0].data().timestamp)
      dataRange.total = allSnap.size
    }
  } catch (e) {
    console.error('查詢資料區間失敗:', e)
    showToast('查詢資料區間失敗，下方的日期範圍可能不準', 'error')
  }
  finally { isLoadingRange.value = false }
}

onMounted(() => { loadDataRange() })

const queryResult = ref(null)
const isQuerying = ref(false)
const isDeleting = ref(false)
const deleteProgress = ref(0)
const cleanupFrom = ref('')
const cleanupTo = ref('')
const cleanupPreview = ref(null)
const isPreviewingCleanup = ref(false)
const isDeletingLinked = ref(false)
const LINKED_CLEANUP_CONFIRMATION = '刪除選取區間資料'

const now = new Date()
cleanupFrom.value = getTaipeiDateTimeValue(new Date(getTaipeiDayStartMs(now)))
cleanupTo.value = getTaipeiDateTimeValue(now)

const uniqueStores = computed(() => queryResult.value ? new Set(queryResult.value.map(o => o.storeName || '未指定')).size : 0)
const totalAmount = computed(() => queryResult.value ? queryResult.value.reduce((sum, o) => sum + (Number(o.price) || 0), 0) : 0)

// 用量卡：以「已查詢／預覽出的可刪筆數」對照訂單總量，數字皆為真實查詢結果
const selectedCleanableCount = computed(() =>
  (queryResult.value?.length || 0) + (cleanupPreview.value?.documentCount || 0)
)
const cleanablePct = computed(() => {
  if (!dataRange.total || !selectedCleanableCount.value) return 0
  return Math.min(100, Math.max(2, Math.round(selectedCleanableCount.value / dataRange.total * 100)))
})

const formatDate = (ts) => {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

const cleanupRange = () => ({
  from: getTaipeiDateTimeMs(cleanupFrom.value),
  to: getTaipeiDateTimeMs(cleanupTo.value),
})

const previewLinkedCleanup = async () => {
  const range = cleanupRange()
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from >= range.to) {
    showToast('開始時間必須早於結束時間', 'error')
    return
  }
  isPreviewingCleanup.value = true
  cleanupPreview.value = null
  try {
    cleanupPreview.value = await previewTimeRangeCleanupViaFunction(range)
  } catch (error) {
    showToast(error?.message || '無法預覽區間資料', 'error')
  } finally {
    isPreviewingCleanup.value = false
  }
}

const deleteLinkedCleanup = async () => {
  if (!cleanupPreview.value?.canDelete || cleanupPreview.value.documentCount === 0 || isDeletingLinked.value) return
  const confirmation = await promptDialog({
    title: '完整連動資料清理',
    message: `將永久刪除 ${cleanupPreview.value.documentCount} 筆資料並校正錢包餘額，此操作不可復原。`,
    detail: `請輸入「${LINKED_CLEANUP_CONFIRMATION}」以確認刪除。`,
    placeholder: LINKED_CLEANUP_CONFIRMATION,
    variant: 'danger',
    confirmText: '永久刪除',
  })
  if (confirmation === null) return
  if (confirmation.trim() !== LINKED_CLEANUP_CONFIRMATION) {
    showToast('確認文字不正確，已取消刪除', 'error')
    return
  }

  isDeletingLinked.value = true
  try {
    const result = await deleteTimeRangeDataViaFunction({
      ...cleanupRange(),
      confirmation: LINKED_CLEANUP_CONFIRMATION,
    })
    showToast(`已刪除 ${result.documentCount.toLocaleString()} 筆連動資料`, 'success')
    cleanupPreview.value = null
    await loadDataRange()
  } catch (error) {
    showToast(error?.message || '區間資料刪除失敗', 'error')
    await previewLinkedCleanup()
  } finally {
    isDeletingLinked.value = false
  }
}

const queryOrders = async () => {
  if (!startDate.value || !endDate.value) return
  const { startMs, endMs } = getTaipeiDateRangeBounds(startDate.value, endDate.value)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) { showToast('開始日期不能晚於結束日期', 'error'); return }
  isQuerying.value = true; queryResult.value = null
  try {
    const snap = await getDocs(query(collection(db, 'orders'), where('timestamp', '>=', startMs), where('timestamp', '<', endMs)))
    queryResult.value = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.timestamp - b.timestamp)
  } catch (err) { showToast('查詢失敗: ' + err.message, 'error') }
  finally { isQuerying.value = false }
}

const deleteOrders = async () => {
  if (!queryResult.value?.length) return
  const count = queryResult.value.length
  const confirmed = await confirmDialog({
    title: '刪除舊訂單？',
    message: `確定要刪除這 ${count} 筆訂單嗎？`,
    detail: '此操作不可復原。',
    variant: 'danger',
    confirmText: `刪除 ${count} 筆`,
  })
  if (!confirmed) return
  isDeleting.value = true; deleteProgress.value = 0
  try {
    const batchSize = 400
    for (let i = 0; i < queryResult.value.length; i += batchSize) {
      const chunk = queryResult.value.slice(i, i + batchSize)
      await deleteUnlinkedOrdersViaFunction(chunk.map(order => order.id))
      deleteProgress.value = Math.min(i + batchSize, queryResult.value.length)
    }
    showToast(`已成功刪除 ${count} 筆訂單`)
    queryResult.value = null; startDate.value = ''; endDate.value = ''
    await loadDataRange()
  } catch (err) {
    const message = err.message === 'FINANCIAL_ORDERS_REQUIRE_LINKED_CLEANUP'
      ? '此區間包含錢包或現金帳務，請改用下方「完整連動資料清理」。'
      : `刪除失敗: ${err.message}`
    showToast(message, 'error')
  }
  finally { isDeleting.value = false; deleteProgress.value = 0 }
}

</script>

<style scoped>
/* .btn / .btn-secondary / .btn-danger 等共用按鈕樣式已移至 src/assets/components.css */

.cleanup-panel { display:grid; gap:16px; }

/* ── 資料量總覽卡（設計稿 5） ── */
.usage-card {
  display:grid;
  grid-template-columns:auto minmax(0, 1fr) auto;
  align-items:center;
  gap:28px;
  padding:20px 24px;
  border:1px solid var(--border);
  border-radius:var(--r-lg);
  background:var(--bg-card);
  box-shadow:var(--shadow-card);
}

.usage-left { display:flex; flex-direction:column; gap:2px; }
.usage-label { color:var(--muted); font-size:var(--text-label); font-weight:700; }
.usage-value { color:var(--text-primary); font-family:var(--font-display); font-size:var(--text-display); font-weight:800; line-height:1.15; }
.usage-value small { color:var(--muted); font-size:var(--text-label); font-weight:700; }
.usage-range { color:var(--muted); font-size:var(--text-micro); font-weight:600; }

.usage-bar-wrap { min-width:0; display:flex; flex-direction:column; gap:8px; }
.usage-bar {
  height:12px;
  border-radius:999px;
  background:var(--bg-inset);
  overflow:hidden;
  display:flex;
}
.usage-seg.cleanable {
  display:block;
  height:100%;
  border-radius:999px;
  transition:width 0.3s ease;
}
.usage-legend { display:flex; flex-wrap:wrap; gap:6px 16px; }
.legend-item { display:inline-flex; align-items:center; gap:6px; color:var(--muted); font-size:var(--text-micro); font-weight:700; }
.legend-dot { width:10px; height:10px; border-radius:3px; }
.legend-dot.rest { background:var(--bg-inset); border:1px solid var(--border-strong); }

.usage-release {
  display:flex;
  flex-direction:column;
  align-items:flex-end;
  gap:2px;
  padding-left:24px;
  border-left:1px solid var(--border);
}
.usage-release-label { color:var(--muted); font-size:var(--text-label); font-weight:700; }
.usage-release-value { color:var(--text-success); font-family:var(--font-display); font-size:var(--text-title); font-weight:800; }
.usage-release-hint { color:var(--text-muted); font-size:var(--text-micro); font-weight:600; }

.cleanup-section-label { margin:4px 2px 0; color:var(--text-primary); font-size:var(--text-body); font-weight:900; }

/* ── 清理項目卡（設計稿 5：圖示＋標題＋meta＋右側筆數） ── */

.item-head { display:flex; align-items:center; gap:14px; }
.item-icon { flex-shrink:0;
  display:grid; place-items:center;
  font-size:var(--text-lead);
}
.item-icon.order { background:var(--bg-accent); color:var(--text-accent); }
.item-icon.linked { background:var(--bg-danger); color:var(--text-danger); }
.item-title-wrap { min-width:0; flex:1; }
.item-head h3 { margin:0 0 3px; color:var(--text-primary); font-size:var(--text-lead); }
.item-head p { margin:0; color:var(--muted); font-size:var(--text-label); font-weight:600; }
.item-size {
  flex-shrink:0;
  color:var(--muted);
  font-family:var(--font-display);
  font-size:var(--text-body);
  font-weight:800;
  white-space:nowrap;
}
.item-size.ready { color:var(--text-accent); }

.scope-note { display:flex; align-items:flex-start; gap:8px; margin:16px 0 18px; padding:10px 12px; border-radius:var(--r-md); font-size: var(--text-micro); font-weight:650; line-height:1.55; }
.scope-note i { margin-top:2px; flex-shrink:0; }
.scope-note code { padding:1px 5px; border-radius:4px; background:var(--bg-page); font-family:var(--font-mono); }
.history-note { background:var(--bg-page); color:var(--text-secondary); }
.linked-note { background:var(--paprika-soft); color:var(--paprika); }

.date-range-row { display:flex; align-items:flex-end; gap:12px; margin-bottom:24px; flex-wrap:wrap; }
.date-field { display:flex; flex-direction:column; gap:5px; }
.date-field label { font-size: var(--text-micro); font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.8px; }
.date-sep { display:flex; align-items:center; color:var(--muted); padding-bottom:2px; }
.query-btn { margin:0; padding:10px 20px; white-space:nowrap; }

.result-section { margin-top:8px; }
.result-summary { display:flex; margin-bottom:18px; flex-wrap:wrap; }
.summary-stat { display:flex; flex-direction:column; align-items:center; padding:14px 20px; min-width:90px; }
.stat-number { font-size: var(--text-title); font-weight:800; color:var(--text-primary); font-family:var(--font-display); }
.stat-label { font-size: var(--text-micro); font-weight:700; color:var(--muted); margin-top:2px; }

.result-list { overflow-y:auto; max-height:280px; margin-bottom:18px; background:var(--bg-card); }
.order-row { display:flex; align-items:center; gap:12px; padding:9px 16px; border-bottom:1px solid var(--border); font-size: var(--text-label); }
.order-row:last-child { border-bottom:none; }
.order-date { font-family:var(--font-mono); font-weight:600; color:var(--muted); min-width:80px; }
.order-store { font-weight:700; min-width:80px; }
.order-meal { flex:1; font-weight:600; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.order-price { font-family:var(--font-mono); font-weight:800; color:var(--text-primary); }
.more-hint { text-align:center; padding:10px; color:var(--muted); font-size: var(--text-label); font-weight:600; }

.delete-section { margin-top:12px; }
.delete-warning { display:flex; align-items:center; gap:10px; padding:12px 16px; background:var(--bg-danger); border:1px solid color-mix(in srgb, var(--danger) 35%, transparent); border-radius:var(--r-md); margin-bottom:12px; font-size: var(--text-label); font-weight:600; color:var(--text-danger); }
.delete-warning i { flex-shrink:0; }
.delete-btn { margin:0; padding:12px 28px; font-size: var(--text-body); }

.no-data { text-align:center; padding:40px; color:var(--muted); display:flex; flex-direction:column; align-items:center; gap:10px; font-size: var(--text-display); }
.no-data span { font-size: var(--text-label); font-weight:700; }

.datetime-row { display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; }
.date-field.grow { flex:1; min-width:210px; }
.cleanup-preview { margin-top:18px; padding-top:18px; border-top:1px dashed var(--muted-line); }
.preview-grid { display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); }
.preview-grid > div { padding:12px 8px; display:flex; flex-direction:column; align-items:center; }
.preview-grid strong { color:var(--text-primary); font-family:var(--font-display); font-weight:800; font-size: var(--text-lead); }
.preview-grid span { margin-top:3px; color:var(--muted); font-size: var(--text-micro); font-weight:700; }
.wallet-corrections { margin-top:12px; padding:12px 14px; background:var(--bg-inset); }
.wallet-corrections > strong { display:block; margin-bottom:7px; color:var(--muted); font-size: var(--text-micro); letter-spacing:.5px; }
.correction-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:5px 0; color:var(--text-primary); font-size: var(--text-label); }
.correction-row b { color:var(--paprika); font-family:var(--font-mono); }
.correction-row b.positive { color:var(--mint); }
.limit-warning, .no-matches { margin-top:12px; padding:11px 13px; border-radius:var(--r-md); font-size: var(--text-label); font-weight:700; }
.limit-warning { background:var(--paprika-soft); color:var(--paprika); }
.no-matches { background:var(--mint-soft); color:var(--mint); }
.linked-delete-btn { width:100%; justify-content:center; margin-top:14px; padding:12px 20px; }

@media (max-width: 700px) {
  .preview-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }
  .cleanup-card { padding:16px; }
  .usage-card { grid-template-columns:1fr; gap:14px; padding:16px; }
  .usage-release { align-items:flex-start; padding-left:0; border-left:none; padding-top:12px; border-top:1px solid var(--border); }
  .item-head { flex-wrap:wrap; }
  .date-sep { display:none; }
  .date-field, .date-field.grow { width:100%; min-width:0; }
  .date-range-row .btn, .datetime-row .btn { width:100%; justify-content:center; }
}


.cleanup-panel { background: var(--ink); color: var(--paper); }
.cleanup-card { padding: 24px 0; background: transparent; border: 0; border-top: 1px solid var(--line); border-radius: 0; box-shadow: none; }
.item-icon { width: 36px; height: 36px; border-radius: 4px; }
.item-head h3 { font-weight: 600; }
.result-summary, .preview-grid { gap: 0; background: var(--ink-2); border-block: 1px solid var(--line); }
.summary-stat, .preview-grid > div { flex: 1; background: transparent; border: 0; border-radius: 0; box-shadow: none; }
.summary-stat + .summary-stat, .preview-grid > div + div { border-left: 1px solid var(--line); }
.result-list, .wallet-corrections { border: 0; border-block: 1px solid var(--line); border-radius: 0; }
.order-store { color: var(--paper); }
.usage-seg.cleanable, .legend-dot.cleanable { background: var(--gold); }
</style>
