<script setup>
import { ref, computed, watch, onScopeDispose } from 'vue'
import { formatMoney } from '../../utils/format'

const props = defineProps({
  orders: { type: Array, default: () => [] },
  diningPeople: { type: Number, default: null },
  pendingPeople: { type: Number, default: 0 },
  totalMembers: { type: Number, default: 0 }
})

// 現金且尚未收款、非免費 → 待結；其餘（錢包、已收現金、免費）→ 已結。
// 判斷方式比照 CashPaymentPanel 的待收邏輯，避免兩處語意分歧。
const isCashOrder = (o) =>
  o.paymentMethod === 'cash' || (!o.paymentMethod && !o.paid && !o.walletDebited)
const isPending = (o) =>
  !o.isFree && isCashOrder(o) && !o.cashPaymentId &&
  o.cashStatus !== 'collected' && o.cashStatus !== 'cancelled'

const billable = computed(() => props.orders.filter(o => !o.isFree))
const total = computed(() => billable.value.reduce((s, o) => s + (Number(o.price) || 0), 0))
const pendingTotal = computed(() =>
  props.orders.filter(isPending).reduce((s, o) => s + (Number(o.price) || 0), 0)
)
const uniquePeople = computed(() => props.diningPeople ?? new Set(props.orders.map(o => o.name).filter(Boolean)).size)
const isEmpty = computed(() => props.orders.length === 0)

function useCountUp(source, duration = 550) {
  const display = ref(0)
  let rafId = null
  watch(source, (to) => {
    if (rafId) cancelAnimationFrame(rafId)
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      display.value = to
      rafId = null
      return
    }
    const from = display.value
    const t0 = performance.now()
    function step(now) {
      const p = Math.min((now - t0) / duration, 1)
      const ease = 1 - (1 - p) ** 3
      display.value = Math.round(from + (to - from) * ease)
      if (p < 1) rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)
  }, { immediate: true })
  onScopeDispose(() => {
    if (rafId) cancelAnimationFrame(rafId)
  })
  return display
}

const ordersDisplay = useCountUp(computed(() => props.orders.length))
const totalDisplay = useCountUp(total)
const pendingDisplay = useCountUp(pendingTotal)
const peopleDisplay = useCountUp(uniquePeople)
const totalFormatted = computed(() => totalDisplay.value.toLocaleString())
const pendingFormatted = computed(() => pendingDisplay.value.toLocaleString())
</script>

<template>
  <div class="kpi-row summary-strip summary-four" :class="{ 'is-empty': isEmpty }">
    <div class="kpi summary-cell">
      <span class="kpi-icon is-accent" aria-hidden="true"><i class="fas fa-receipt"></i></span>
      <div class="kpi-body">
        <p class="kpi-label">今日訂單</p>
        <p class="kpi-num mono">{{ ordersDisplay }} <span class="kpi-unit">筆</span></p>
      </div>
    </div>
    <div class="kpi summary-cell">
      <span class="kpi-icon is-success" aria-hidden="true"><i class="fas fa-dollar-sign"></i></span>
      <div class="kpi-body">
        <p class="kpi-label">總金額</p>
        <p class="kpi-num mono">{{ formatMoney(totalFormatted) }}</p>
      </div>
    </div>
    <div class="kpi summary-cell">
      <span class="kpi-icon is-pending" aria-hidden="true"><i class="fas fa-hourglass-half"></i></span>
      <div class="kpi-body">
        <p class="kpi-label">待結金額</p>
        <p class="kpi-num kpi-num-highlight mono">{{ formatMoney(pendingFormatted) }}</p>
      </div>
    </div>
    <div class="kpi summary-cell">
      <span class="kpi-icon is-people" aria-hidden="true"><i class="fas fa-user-group"></i></span>
      <div class="kpi-body">
        <p class="kpi-label">今日用餐人數</p>
        <p class="kpi-num mono">{{ peopleDisplay }} <span class="kpi-unit">人</span></p>
        <p class="kpi-label">待重新點餐 {{ pendingPeople }} 人</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}

.kpi {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 16px 18px;
  box-shadow: var(--shadow-card);
  transition: opacity 0.2s;
}

.kpi-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.kpi-icon.is-accent    { background: var(--bg-accent);      color: var(--text-accent); }
.kpi-icon.is-success   { background: var(--bg-success);     color: var(--text-success); }
.kpi-icon.is-highlight { background: var(--bg-highlight);   color: var(--text-highlight); }
.kpi-icon.is-people    { background: var(--tag-dinner-bg);  color: var(--tag-dinner-text); }

.kpi-body { min-width: 0; }

.kpi-label {
  font-size: var(--text-label);
  margin-bottom: 4px;
}

.kpi-num {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi-num-highlight { color: var(--text-highlight); }

.kpi-unit {
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--text-muted);
}

/* 尚無訂單：整排轉灰、圖示退為中性底 */
.kpi-row.is-empty .kpi { opacity: 0.72; }
.kpi-row.is-empty .kpi-icon { background: var(--bg-inset); color: var(--text-muted); }
.kpi-row.is-empty .kpi-num, .kpi-row.is-empty .kpi-num-highlight { color: var(--text-muted); }

@media (max-width: 768px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px; }
  .kpi { padding: 12px; gap: 10px; }
  .kpi-icon { width: 38px; height: 38px; font-size: var(--text-lead); }
  .kpi-num { font-size: var(--text-title); }
}
</style>
