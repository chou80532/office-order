<script setup>
import LoadingState from '../ui/LoadingState.vue'
import StatusNotice from "../ui/StatusNotice.vue"
import { ref, computed, watch, onMounted, toRef } from 'vue'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firestore'
import { getLocalDateKey, getTaipeiMonthBounds } from '../../utils'
import { aggregateOrderStats } from '../../utils/orderStats'
import { useFirestore } from '../../composables/useFirestore'
import { usePendingCart } from '../../composables/usePendingCart'
import { useHomeActions } from '../../composables/useHomeActions'
import AppDatePicker from '../ui/AppDatePicker.vue'
import { useToolbarTeleport } from '../../composables/useToolbarTeleport'

const props = defineProps({
  toolbarTarget: { type: String, default: '' },
})

const desktopToolbar = useToolbarTeleport(toRef(props, 'toolbarTarget'))

const emit = defineEmits(['show-toast', 'range-change'])

// ── Time range controls ───────────────────────
const selectedMonth = ref(getLocalDateKey().slice(0, 7))

// ── Stats data ────────────────────────────────
const isLoading = ref(false)
const loadError = ref('')
const { dailyStores, dailyStoresConfigured } = useFirestore()
const { activeStoreId } = usePendingCart()
const { closePanel } = useHomeActions()
const canOrder = name => dailyStoresConfigured.value && dailyStores.value.includes(name)
function browseStore(name) {
  if (!canOrder(name)) return
  activeStoreId.value = name
  closePanel()
}
const totalOrders = ref(0)
const topStores = ref([])
const topMeals = ref([])
const dailyTrend = ref([])
const activeRange = ref(null)
let statsRequestId = 0

function getSelectedMonthRange() {
  if (!selectedMonth.value) return null
  const { startMs, endMs } = getTaipeiMonthBounds(selectedMonth.value)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  return { startTime: startMs, endTime: endMs, monthKey: selectedMonth.value }
}

const statsStoreMax = computed(() => Math.max(...topStores.value.map(item => item.count), 1))
const statsMealMax = computed(() => Math.max(...topMeals.value.map(item => item.count), 1))
const trendMax = computed(() => Math.max(...dailyTrend.value.map(item => item.count), 1))
const activePeopleCount = ref(0)

onMounted(() => {
  fetchStatsBundle()
})

async function fetchStatsBundle() {
  const range = getSelectedMonthRange()
  if (!range) {
    loadError.value = '請選擇有效的月份'
    return
  }
  activeRange.value = range
  await fetchStats(range)
}

async function fetchStats(range = activeRange.value) {
  if (!range) return
  const requestId = ++statsRequestId
  isLoading.value = true
  loadError.value = ''
  activePeopleCount.value = 0
  totalOrders.value = 0
  topStores.value = []
  topMeals.value = []
  dailyTrend.value = []

  try {
    const q = query(
      collection(db, 'orders'),
      where('timestamp', '>=', range.startTime),
      where('timestamp', '<', range.endTime)
    )
    const snap = await getDocs(q)
    const { peopleMap, storeMap, mealMap, dayMap, orders } = aggregateOrderStats(snap.docs.map(d => d.data()))
    if (requestId !== statsRequestId) return
    activePeopleCount.value = Object.keys(peopleMap).length
    topStores.value = Object.values(storeMap)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-TW'))
      .slice(0, 5)
    topMeals.value = Object.values(mealMap)
      .map(row => ({ ...row, storeCount: row.stores.size }))
      .sort((a, b) => b.count - a.count || b.storeCount - a.storeCount || a.name.localeCompare(b.name, 'zh-TW'))
      .slice(0, 5)
    dailyTrend.value = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date))
    totalOrders.value = orders
  } catch (err) {
    console.error('[Stats] load failed', err)
    if (requestId === statsRequestId) loadError.value = '統計載入失敗，請稍後重試'
  } finally {
    if (requestId === statsRequestId) isLoading.value = false
  }
}

watch(selectedMonth, (v) => { if (v) fetchStatsBundle() })

const rangeLabel = computed(() => {
  if (!activeRange.value?.monthKey) return ''
  const [year, month] = activeRange.value.monthKey.split('-')
  return `${year}/${Number(month)}`
})

watch(rangeLabel, (v) => emit('range-change', v))

const pct = (value, max) => max ? Math.round(value / max * 100) : 0
// 排行條依名次遞減透明度（第一名最飽和）
const fillOpacity = (i) => Math.max(1 - i * 0.15, 0.4)

defineExpose({ rangeLabel })
</script>

<template>
  <div class="stats-panel ops-surface">
    <section class="stats-section">
      <Teleport
        :to="toolbarTarget || 'body'"
        :disabled="!toolbarTarget || !desktopToolbar"
      >
      <div class="toolbar" :class="{ 'teleported-toolbar': desktopToolbar }">
        <div class="toolbar-right">
          <span class="ctrl-label"><i class="fas fa-calendar-days" aria-hidden="true"></i> 月份</span>
          <AppDatePicker v-model="selectedMonth" mode="month" aria-label="統計月份" class="stats-month-picker" />
          <span v-if="isLoading" class="inline-spin"></span>
        </div>
      </div>
      </Teleport>

      <LoadingState v-if="isLoading" title="計算中…" description="正在彙整所選月份的訂餐份數與排行。" />
      <StatusNotice v-else-if="loadError" :title="loadError" description="請稍後重試。" alert><button class="retry-btn" @click="fetchStatsBundle">重試</button></StatusNotice>
      <StatusNotice v-else-if="!activeRange" title="選擇月份後自動計算" description="從上方選取想查看的月份。" />
      <template v-else>
        <div class="content-wrap"><p class="public-intro">大家吃什麼？看看熱門選擇，今日開放的店家可直接前往點餐。</p>
          <div class="kpi-row summary-strip">
            <div class="kpi summary-cell">
              <span class="kpi-icon is-accent" aria-hidden="true"><i class="fas fa-receipt"></i></span>
              <div class="kpi-body">
                <p class="kpi-label">訂餐份數</p>
                <p class="kpi-num">{{ totalOrders }}<span class="kpi-unit">份</span></p>
              </div>
            </div>
            <div class="kpi summary-cell">
              <span class="kpi-icon is-highlight" aria-hidden="true"><i class="fas fa-user-group"></i></span>
              <div class="kpi-body">
                <p class="kpi-label">參與人數</p>
                <p class="kpi-num">{{ activePeopleCount }}<span class="kpi-unit">人</span></p>
              </div>
            </div>

          </div>

          <StatusNotice v-if="totalOrders === 0" title="此期間無訂單" description="換一個月份，或先到點餐頁下單。" />
          <template v-else>
            <div class="rank-grid">
              <div class="stat-card">
                <h3 class="stat-card-title"><i class="fas fa-store" aria-hidden="true"></i> 熱門店家</h3>
                <div class="rank-list">
                  <div v-for="(store, i) in topStores" :key="store.name" class="rank-item">
                    <div class="rank-head">
                      <span class="rank-num" :class="{ dim: i >= 3 }">{{ i + 1 }}</span>
                      <span class="rank-name">{{ store.name }}</span>
                      <span class="rank-count">{{ store.count }} 份</span>
                    </div>
                    <div class="meter"><div class="meter-fill" :style="{ width: pct(store.count, statsStoreMax) + '%', opacity: fillOpacity(i) }" /></div>
                  </div>
                </div>
              </div>

              <div class="stat-card">
                <h3 class="stat-card-title"><i class="fas fa-bowl-food" aria-hidden="true"></i> 熱門餐點</h3>
                <div class="rank-list">
                  <div v-for="(meal, i) in topMeals" :key="meal.name" class="rank-item">
                    <div class="rank-head">
                      <span class="rank-num" :class="{ dim: i >= 3 }">{{ i + 1 }}</span>
                      <span class="rank-name">{{ meal.name }}</span>
                      <span class="rank-count">{{ meal.count }} 份</span><button v-if="canOrder(meal.storeName)" class="browse-store" @click="browseStore(meal.storeName)">看菜單</button>
                    </div>
                    <div class="meter"><div class="meter-fill" :style="{ width: pct(meal.count, statsMealMax) + '%', opacity: fillOpacity(i) }" /></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="stat-card block-card">
              <h3 class="stat-card-title"><i class="fas fa-chart-column" aria-hidden="true"></i> 每日點餐趨勢</h3>
              <div class="trend-bars">
                <div v-for="day in dailyTrend" :key="day.date" class="trend-day">
                  <div class="trend-bar-wrap">
                    <span class="trend-count">{{ day.count }}</span>
                    <div class="trend-bar" :style="{ height: pct(day.count, trendMax) + '%' }"></div>
                  </div>
                  <span class="trend-label">{{ Number(day.date.slice(5, 7)) }}/{{ Number(day.date.slice(8, 10)) }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
        <p class="modal-note">份數、人數與排行包含免費餐點。排行依訂購份數，店家開放次數不同會影響名次。</p>
      </template>
    </section>

  </div>
</template>

<style scoped>
.stats-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.stats-section {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

/* ── Toolbar ── */
.toolbar {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 14px; flex-wrap: wrap;
  padding: 12px 40px;
  border-bottom: 1.5px solid var(--muted-line);
  flex-shrink: 0;
}

.toolbar.teleported-toolbar {
  width: 100%;
  padding: 0;
  border-bottom: 0;
  flex-wrap: nowrap;
}

.toolbar-right { display: flex; align-items: center; gap: 10px; }

.ctrl-label {
  font-size: var(--text-label); font-weight: 600; color: var(--muted);
  white-space: nowrap;
  display: flex; align-items: center; gap: 6px;
}

.stats-month-picker { min-width: 150px; }

.inline-spin {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

/* ── Content ── */
.content-wrap { padding: 22px 40px 8px; }

/* ── KPI cards ── */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}

.kpi {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 16px 18px;
  box-shadow: var(--shadow-card);
}

.kpi-icon {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.kpi-icon.is-accent    { background: var(--bg-accent);    color: var(--text-accent); }
.kpi-icon.is-success   { background: var(--bg-success);   color: var(--text-success); }
.kpi-icon.is-highlight { background: var(--bg-highlight); color: var(--text-highlight); }

.kpi-body { min-width: 0; }

.kpi-label {
  font-size: var(--text-label); color: var(--muted);
  margin-bottom: 4px;
  display: flex; align-items: center; gap: 7px;
}

.kpi-num {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.kpi-unit {
  font-size: var(--text-body); font-weight: 600; color: var(--text-muted);
  margin-left: 4px;
}

/* ── Stat cards ── */
.rank-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.stat-card-title {
  display: flex; align-items: center; gap: 8px;
  /* 從 <p> 改成 <h3>：壓掉 UA margin，字重給 600 —— 卡片標題原本是 400，
     跟卡片內文完全同權重，掃不出哪裡是標題。 */
  margin: 0 0 16px;
  font-weight: 600;
  font-size: var(--text-body); color: var(--text-primary);
  letter-spacing: 0.3px;
}
.stat-card-title i { font-size: var(--text-body); }

/* ── Rank list ── */
.rank-list { display: flex; flex-direction: column; gap: 15px; }

.rank-head {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 6px;
}

.rank-num {
  font-family: var(--font-display);
  font-weight: 800; font-size: var(--text-label);
  width: 16px; flex-shrink: 0; text-align: center;
}
.rank-num.dim { color: var(--text-muted); }

.rank-name {
  flex: 1; min-width: 0;
  font-size: var(--text-label); color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.rank-count {
  flex-shrink: 0;
  font-family: var(--font-display);
  font-weight: 700; font-size: var(--text-label);
}

.meter {
  height: 7px;
  border-radius: 20px;
  overflow: hidden;
}

.meter-fill {
  height: 100%; min-width: 6px;
  border-radius: 20px;
  transition: width 0.5s ease;
}

/* ── 統一的空/載入/錯誤狀態（比照點餐頁 placeholder） ── */
.stats-placeholder {
  flex: 1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 6px;
  padding: 60px 24px;
  text-align: center;
  color: var(--muted);
  font-size: var(--text-body); font-weight: 700;
}
.stats-placeholder.inline { flex: none; }
.stats-placeholder .sub {
  font-size: var(--text-label); font-weight: 500;
  margin-top: 2px; opacity: 0.8;
}

.stats-placeholder-icon {
  display: inline-flex;
  align-items: center; justify-content: center;
  width: 46px; height: 46px;
  margin-bottom: 6px;
  border-radius: 50%;
  background: var(--bg-inset);
  color: var(--muted);
  font-size: var(--text-lead);
}

/* ── 參與榜 person cards ── */
.person-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 14px;
}

.compact-grid {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.person-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 24px 20px 18px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  transition: box-shadow 0.2s, border-color 0.2s;
}
.person-card:hover { box-shadow: var(--shadow-soft); border-color: var(--border-strong); }

.public-person-card {
  padding: 22px 16px 16px;
  background: var(--bg-inset);
  border-color: var(--border);
}

.rank-badge {
  position: absolute; top: 12px; left: 14px;
  width: 22px; height: 22px; border-radius: var(--r-sm);
  font-size: var(--text-micro); font-weight: 800;
  font-family: var(--font-display);
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-inset); color: var(--muted);
}
.rank-1 { background: color-mix(in srgb, var(--rank-1) 14%, transparent); color: var(--rank-1); }
.rank-2 { background: color-mix(in srgb, var(--rank-2) 14%, transparent); color: var(--rank-2); }
.rank-3 { background: color-mix(in srgb, var(--rank-3) 14%, transparent); color: var(--rank-3); }

.card-avatar {
  width: 56px; height: 56px; border-radius: 50%;
  font-size: var(--text-title); font-weight: 800; color: var(--paper);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 4px;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ink) 12%, transparent);
}

.card-name { font-size: var(--text-body); font-weight: 800; color: var(--text-primary); text-align: center; }

.card-amount {
  font-size: var(--text-lead); font-weight: 800; color: var(--accent);
  font-family: var(--font-display); letter-spacing: -0.3px; text-align: center;
}

.payment-method { font-size: var(--text-micro); font-weight: 700; color: var(--muted); margin: -2px 0 2px; }

.bar-track { width: 100%; height: 5px; border-radius: 99px; overflow: hidden; margin-top: 4px; }
.bar-fill { height: 100%; border-radius: 99px; transition: width 0.5s ease; min-width: 5px; }

/* ── 每日趨勢 ── */
.trend-bars {
  display: flex; align-items: flex-end; gap: 10px;
  overflow-x: auto;
  padding: 4px 2px 2px;
}

.trend-day {
  flex: 1; min-width: 42px; max-width: 76px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}

.trend-bar-wrap {
  width: 100%; height: 140px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: flex-end;
  gap: 6px;
}

.trend-count {
  font-family: var(--font-display);
  font-size: var(--text-label); font-weight: 700; color: var(--muted);
}

.trend-bar {
  width: 100%; max-width: 52px;
  min-height: 6px;
  border-radius: 10px 10px 4px 4px;
  transition: height 0.5s ease;
}

.trend-label {
  font-size: var(--text-micro); font-weight: 600; color: var(--muted);
}

/* ── Loading dots ── */
.dots { display: flex; gap: 6px; margin-bottom: 4px; }
.dots span {
  width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
  animation: bounce 1.2s ease-in-out infinite;
}
.dots span:nth-child(2) { animation-delay: 0.15s; }
.dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1.2); opacity: 1; } }

.retry-btn {
  padding: 8px 16px; border-radius: var(--r-sm);
  border: 1px solid var(--border-strong);
  font-size: var(--text-label); font-weight: 700; color: var(--text-primary); transition: all 0.15s;
}
.retry-btn:hover { background: var(--accent-solid); border-color: var(--accent); color: var(--text-on-accent); }

.modal-note {
  padding: 12px 40px 16px; font-size: var(--text-micro);
  flex-shrink: 0; margin-top: 8px;
}

/* 對齊全站主要斷點 768（原本是只用過這一次的 560）。
   561–768px 之間原本吃桌機排列：兩欄排行榜擠在 520px 的內容寬裡。 */
@media (max-width: 768px) {
  .toolbar {
    padding: 14px 16px 12px;
  }
  .toolbar-right { width: 100%; }
  .stats-month-picker { flex: 1; min-width: 0; }
  .content-wrap { padding: 16px 16px 4px; }
  .kpi-row {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 14px;
  }
  .kpi { padding: 13px 14px; }
  .kpi-num { font-size: var(--text-title); }
  .rank-grid { grid-template-columns: 1fr; gap: 12px; }
  .block-card { margin-top: 12px; }
  .stat-card { padding: 16px; }
  .compact-grid { grid-template-columns: 1fr 1fr; }
  .trend-bars { gap: 6px; padding-bottom: 4px; }
  .trend-day { min-width: 46px; }
  .modal-note { padding: 10px 16px 14px; }
}

/* 同 SettingsView：深底面板要自己宣告一組深底文字色，
   否則吃到的是為紙卡調的 --ink-mute（在 --ink 上只有 3.09）。 */
.stats-panel {
  background: var(--ink);
  --text-primary: var(--paper);
  --text-secondary: var(--ink-soft);
  --text-muted: var(--ink-soft);
  --muted: var(--ink-soft);
}
.stat-card-title { font-family: var(--font-display); }
.kpi-num { font-family: var(--font-sans); font-variant-numeric: tabular-nums; }

.stats-panel { color: var(--paper); }
.public-intro { font-weight: 400; }
.modal-note { color: var(--ink-soft); font-weight: 400; }
.stat-card { background: transparent; border: 0; border-radius: 0; box-shadow: none; padding: 0; }
.stat-card-title { padding-bottom: 14px; border-bottom: 1px solid var(--line); font-weight: 600; }
.stat-card-title i { color: var(--ink-soft); }
.rank-grid { gap: 32px; }
.rank-item { padding-block: 10px; }
/* .rank-num.dim 原本也被拉回同一個金色，第 4 名之後的淡化就消失了 */
.rank-num, .rank-count { color: var(--gold); }
.rank-name { font-weight: 500; }
.meter-fill, .bar-fill, .trend-bar { background: var(--gold); }
.meter, .bar-track { background: var(--ink-3); }
.block-card { margin-top: 28px; }
.kpi-label { font-weight: 400; }

.public-intro { color: var(--muted); margin-bottom: 16px; line-height: 1.6; }
.browse-store { padding: 8px 10px; border: 0; border-radius: 8px; background: var(--bg-accent); color: var(--text-accent); font-weight: 700; white-space: nowrap; }
/* rank-head 保持單行不換行（rank-name 原本就有 ellipsis 截斷），
   否則某一列因為按鈕換行變高，會讓熱門店家／熱門餐點兩欄的前五名對不齊。 */
</style>
