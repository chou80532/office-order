<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useScrollLock } from '../../composables/useScrollLock'

const props = defineProps({
  orders: { type: Array, default: () => [] },
  members: { type: Array, default: () => [] },
  membersReady: { type: Boolean, default: false }
})

const normalizeNote = (value = '') => value
  .split(/[、,，]/)
  .map(part => part.trim())
  .filter(Boolean)
  .join('、')

const storeNames = computed(() => [
  ...new Set(
    props.orders
      .map((order) => (order.storeName || order.store || '').trim())
      .filter(Boolean)
  )
])

// same：全數同店；multi：多家店；empty：尚無訂單
const summaryState = computed(() => {
  if (storeNames.value.length === 0) return 'empty'
  return storeNames.value.length === 1 ? 'same' : 'multi'
})

const singleStoreName = computed(() => storeNames.value.length === 1 ? storeNames.value[0] : '')

const storeSummary = computed(() => {
  if (summaryState.value === 'empty') {
    return { status: '尚無訂單', detail: '還沒有可判斷的店家資料。' }
  }
  if (summaryState.value === 'same') {
    return {
      status: '全部同店',
      detail: `${props.orders.length} 筆訂單皆為「${singleStoreName.value}」，可直接彙整下單。`
    }
  }
  return {
    status: '今天有多家店',
    detail: storeNames.value.join('、')
  }
})

const groupedMeals = computed(() => {
  const storeMap = new Map()

  props.orders.forEach((order) => {
    const storeName = (order.storeName || order.store || '未分類店家').trim() || '未分類店家'
    const mealName = (order.meal || '').trim()
    if (!mealName) return

    if (!storeMap.has(storeName)) storeMap.set(storeName, new Map())

    const mealMap = storeMap.get(storeName)
    // 多份餐點以「N份、備註」存入訂單；電話彙整必須計份數，不能只數文件。
    const quantityMatch = String(order.note || '').match(/^([1-9]\d?)份(?:、|$)/)
    const portions = quantityMatch ? Number(quantityMatch[1]) : 1
    const note = normalizeNote(quantityMatch ? order.note.slice(quantityMatch[0].length) : order.note || '')

    if (!mealMap.has(mealName)) {
      mealMap.set(mealName, { key: mealName, name: mealName, count: 0, noteMap: new Map() })
    }

    const item = mealMap.get(mealName)
    item.count += portions
    if (note) item.noteMap.set(note, (item.noteMap.get(note) || 0) + portions)
  })

  return [...storeMap.entries()].map(([storeName, mealMap]) => ({
    storeName,
    items: [...mealMap.values()]
      .map(item => ({
        ...item,
        noteSummary: [...item.noteMap.entries()]
          .map(([note, count]) => `${count} 份${note}`)
          .join('、')
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-TW'))
      .map(item => ({
        ...item,
        countTone: item.count >= 5 ? 'large' : item.count >= 2 ? 'medium' : 'single'
      }))
  }))
})

const hasMeals = computed(() => groupedMeals.value.some(group => group.items.length))

// 店家電話複誦餐點時的臨時核對狀態：只存在這個彈窗生命週期，不寫入 Firestore。
const confirmingStoreName = ref('')
const confirmedMealKeys = ref(new Set())
const confirmationCloseButton = ref(null)
const confirmingGroup = computed(() =>
  groupedMeals.value.find(group => group.storeName === confirmingStoreName.value) || null
)
const confirmedMealCount = computed(() => {
  const currentKeys = new Set((confirmingGroup.value?.items || []).map(item => item.key))
  return [...confirmedMealKeys.value].filter(key => currentKeys.has(key)).length
})

function openMealConfirmation(group) {
  confirmingStoreName.value = group.storeName
  confirmedMealKeys.value = new Set()
  nextTick(() => confirmationCloseButton.value?.focus())
}

function closeMealConfirmation() {
  confirmingStoreName.value = ''
  confirmedMealKeys.value = new Set()
}

function toggleMealConfirmation(itemKey) {
  const next = new Set(confirmedMealKeys.value)
  if (next.has(itemKey)) next.delete(itemKey)
  else next.add(itemKey)
  confirmedMealKeys.value = next
}

// 這個浮層是 Teleport + v-if，開關由 confirmingStoreName 控制，
// 跟著掛載生命週期走的 useModalA11y 不適用，焦點處理寫在這裡。
const confirmDialogRoot = ref(null)
let previouslyFocused = null

const confirmFocusables = () => {
  const root = confirmDialogRoot.value
  if (!root) return []
  return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null || el.getClientRects().length > 0)
}

function onConfirmationKeydown(event) {
  if (event.key === 'Escape' && confirmingStoreName.value) { closeMealConfirmation(); return }
  if (event.key !== 'Tab' || !confirmingStoreName.value) return
  const items = confirmFocusables()
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (!confirmDialogRoot.value?.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault(); last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault(); first.focus()
  }
}

watch(confirmingStoreName, (storeName) => {
  if (storeName) {
    previouslyFocused = document.activeElement
    document.addEventListener('keydown', onConfirmationKeydown)
  } else {
    document.removeEventListener('keydown', onConfirmationKeydown)
    // 關掉之後焦點回到剛才點的那間店，而不是掉回 <body>
    if (previouslyFocused?.isConnected) previouslyFocused.focus()
    previouslyFocused = null
  }
})

watch(confirmingGroup, (group) => {
  if (confirmingStoreName.value && !group) closeMealConfirmation()
})

onUnmounted(() => document.removeEventListener('keydown', onConfirmationKeydown))
useScrollLock(computed(() => Boolean(confirmingStoreName.value)))

const missingMembers = computed(() => {
  if (!props.members.length) return []
  const orderedNames = new Set(
    props.orders.map((order) => (order.name || '').trim()).filter(Boolean)
  )
  return props.members.filter((name) => !orderedNames.has((name || '').trim()))
})

const allMissing = computed(() =>
  props.members.length > 0 && missingMembers.value.length === props.members.length
)
</script>

<template>
  <div class="sidebar">
    <!-- 同店判斷 -->
    <div class="summary-card" :class="`is-${summaryState}`">
      <p class="summary-label">今天是否全數同店</p>
      <p class="summary-main">
        <i v-if="summaryState === 'same'" class="fas fa-circle-check" aria-hidden="true"></i>
        {{ storeSummary.status }}
      </p>
      <p class="summary-detail">{{ storeSummary.detail }}</p>
    </div>

    <!-- 店家餐點統整 -->
    <div class="section">
      <div class="section-head">
        <i class="fas fa-clipboard-list section-icon" :class="{ muted: !hasMeals }" aria-hidden="true"></i>
        <h3 class="section-title">店家餐點統整</h3>
      </div>

      <template v-if="hasMeals">
        <div v-for="group in groupedMeals" :key="group.storeName" class="meal-group">
          <div class="group-head">
            <p class="group-store">{{ group.storeName }}</p>
            <button
              type="button"
              class="confirm-meals-btn"
              :aria-label="`逐項確認 ${group.storeName} 的餐點`"
              @click="openMealConfirmation(group)"
            >
              <i class="fas fa-list-check" aria-hidden="true"></i>
              逐項確認
            </button>
          </div>
          <div class="meal-list">
          <div v-for="item in group.items" :key="item.key" class="meal-row">
            <span class="meal-count" :class="`is-${item.countTone}`">{{ item.count }}</span>
              <div class="meal-content">
                <span class="meal-name">{{ item.name }}</span>
                <span v-if="item.noteSummary" class="meal-note">{{ item.noteSummary }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div v-else class="meal-empty">
        <i class="fas fa-clipboard" aria-hidden="true"></i>
        <p>今天還沒有可統整的餐點</p>
      </div>
    </div>

    <Teleport to="body">
      <Transition name="meal-confirm-modal">
        <div
          v-if="confirmingGroup"
          class="meal-confirm-overlay"
          @click.self="closeMealConfirmation"
        >
          <div
            ref="confirmDialogRoot"
            class="meal-confirm-dialog"
            role="dialog"
            aria-modal="true"
            :aria-label="`${confirmingGroup.storeName} 餐點逐項確認`"
          >
            <div class="meal-confirm-head">
              <div class="meal-confirm-title-wrap">
                <span class="meal-confirm-icon" aria-hidden="true"><i class="fas fa-list-check"></i></span>
                <div>
                  <h3>{{ confirmingGroup.storeName }}</h3>
                  <p>店家念到哪一項，就點一下劃掉</p>
                </div>
              </div>
              <button
                ref="confirmationCloseButton"
                type="button"
                class="meal-confirm-close"
                aria-label="關閉餐點確認視窗"
                @click="closeMealConfirmation"
              ><i class="fas fa-times" aria-hidden="true"></i></button>
            </div>

            <div class="meal-confirm-progress" role="status" aria-live="polite">
              <span>確認進度</span>
              <strong>{{ confirmedMealCount }} / {{ confirmingGroup.items.length }} 項</strong>
            </div>

            <div class="meal-confirm-list">
              <button
                v-for="item in confirmingGroup.items"
                :key="item.key"
                type="button"
                class="meal-confirm-row"
                :class="{ confirmed: confirmedMealKeys.has(item.key) }"
                :aria-pressed="confirmedMealKeys.has(item.key)"
                @click="toggleMealConfirmation(item.key)"
              >
                <span class="meal-count" :class="`is-${item.countTone}`">{{ item.count }}</span>
                <span class="meal-confirm-copy">
                  <span class="meal-confirm-name">{{ item.name }}</span>
                  <span v-if="item.noteSummary" class="meal-confirm-note">{{ item.noteSummary }}</span>
                </span>
                <span class="meal-confirm-check" aria-hidden="true">
                  <i :class="['fas', confirmedMealKeys.has(item.key) ? 'fa-check' : 'fa-minus']"></i>
                </span>
              </button>
            </div>

            <p class="meal-confirm-hint">
              <i class="fas fa-circle-info" aria-hidden="true"></i>
              可再點一次復原；關閉視窗後，本次確認會重置。
            </p>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 誰還沒下 -->
    <div class="section">
      <div class="section-head">
        <i class="fas fa-clock section-icon amber" aria-hidden="true"></i>
        <h3 class="section-title">誰還沒下</h3>
        <span v-if="missingMembers.length" class="miss-badge">
          {{ allMissing ? '全部 ' : '' }}{{ missingMembers.length }} 人
        </span>
      </div>

      <div v-if="!membersReady" class="no-data">成員名單載入中</div>
      <div v-else-if="!members.length" class="no-data">尚未設定成員名單</div>
      <div v-else-if="missingMembers.length" class="member-list">
        <span v-for="name in missingMembers" :key="name" class="member-chip">
          <span class="member-avatar" aria-hidden="true">{{ (name || '?')[0] }}</span>
          {{ name }}
        </span>
      </div>
      <div v-else class="all-done">
        <p class="summary-main same-text">
          <i class="fas fa-circle-check" aria-hidden="true"></i>全部都下了
        </p>
        <p class="summary-detail">今天的成員名單都已完成點餐。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* ── 同店判斷：左側色條標示狀態，不再疊一層卡在卡裡 ── */
.summary-card {
  border-left: 3px solid var(--border-strong);
  padding: 2px 0 2px 14px;
}
.summary-card.is-same { border-left-color: var(--success); }
.summary-card.is-multi { border-left-color: var(--accent); }
.summary-card.is-empty { border-left-color: var(--highlight); }

.summary-label {
  font-size: var(--text-micro);
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-bottom: 3px;
}
.summary-detail {
  margin-top: 4px;
  font-size: var(--text-label);
  line-height: 1.5;
  color: var(--muted);
  word-break: break-word;
}
.summary-main {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: var(--text-lead);
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 8px;
}
.summary-main i { font-size: var(--text-title); }

.is-same .summary-label { color: var(--text-success); }
.is-same .summary-main  { color: var(--text-success); }
.is-multi .summary-label { color: var(--text-accent); }
.is-multi .summary-main  { color: var(--text-accent); }
.is-empty .summary-label { color: var(--text-highlight); }
.is-empty .summary-main  { color: var(--text-highlight); }

/* ── 區塊標頭 ── */
.section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 11px;
}
.section-icon { font-size: var(--text-body); color: var(--text-accent); }
.section-icon.amber { color: var(--text-highlight); }
.section-icon.muted { color: var(--text-muted); }
.section-title { margin: 0; font-size: var(--text-body); font-weight: 800; color: var(--text-secondary); }
.miss-badge {
  margin-left: auto;
  font-size: var(--text-micro);
  font-weight: 700;
  color: var(--text-highlight);
  background: var(--bg-highlight);
  padding: 2px 9px;
  border-radius: 999px;
}

/* ── 餐點統整列 ── */
.meal-group + .meal-group { margin-top: 12px; }
.group-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 7px;
}
.group-store {
  flex: 1;
  min-width: 0;
  font-size: var(--text-body);
  font-weight: 800;
  color: var(--text-secondary);
  word-break: break-word;
}
.confirm-meals-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 9px;
  border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--border));
  border-radius: 999px;
  background: var(--bg-accent);
  color: var(--text-accent);
  font-size: var(--text-micro);
  font-weight: 800;
  transition: background 0.15s, border-color 0.15s, transform 0.12s;
}
.confirm-meals-btn:hover {
  background: color-mix(in srgb, var(--accent) 14%, var(--paper));
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}
.confirm-meals-btn:active { transform: scale(0.97); }
.confirm-meals-btn:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 2px; }

/* ── 店家電話複誦逐項確認（Teleport） ── */
.meal-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow-y: auto;
  background: var(--overlay);
  backdrop-filter: blur(6px);
}
.meal-confirm-dialog {
  width: min(100%, 520px);
  max-height: min(760px, calc(100dvh - 40px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  background: var(--paper);
  box-shadow: var(--shadow-modal);
}
.meal-confirm-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 17px 18px;
  border-bottom: 1px solid var(--border);
}
.meal-confirm-title-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 11px;
}
.meal-confirm-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--bg-accent);
  color: var(--text-accent);
}
.meal-confirm-title-wrap h3 {
  font-family: var(--font-display);
  font-size: var(--text-lead);
  font-weight: 800;
  color: var(--ink);
  word-break: break-word;
}
.meal-confirm-title-wrap p {
  margin-top: 2px;
  font-size: var(--text-label);
  color: var(--muted);
}
.meal-confirm-close {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: var(--r-sm);
  background: var(--bg-inset);
  color: var(--muted);
}
.meal-confirm-close:hover { background: var(--border); color: var(--ink); }
.meal-confirm-progress {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  background: var(--bg-inset);
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 700;
}
.meal-confirm-progress strong { color: var(--ink); font-weight: 800; }
.meal-confirm-list {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 18px;
}
.meal-confirm-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 13px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--bg-inset);
  text-align: left;
  transition: opacity 0.15s, background 0.15s, border-color 0.15s, transform 0.12s;
}
.meal-confirm-row:hover { border-color: var(--border-strong); }
.meal-confirm-row:active { transform: scale(0.99); }
.meal-confirm-row:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 1px; }
.meal-confirm-row.confirmed { opacity: 0.48; background: var(--paper); }
.meal-confirm-row.confirmed .meal-confirm-copy { text-decoration: line-through; }
.meal-confirm-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.meal-confirm-name {
  color: var(--ink);
  font-size: var(--text-lead);
  font-weight: 750;
  line-height: 1.35;
}
.meal-confirm-note {
  color: var(--muted);
  font-size: var(--text-body);
  line-height: 1.45;
  word-break: break-word;
}
.meal-confirm-check {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  color: var(--muted);
}
.confirmed .meal-confirm-check {
  border-color: var(--success);
  background: var(--success);
  color: var(--text-on-accent);
}
.meal-confirm-hint {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 11px 18px 14px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: var(--text-label);
  line-height: 1.5;
}
.meal-confirm-hint i { margin-top: 3px; color: var(--text-accent); }
.meal-confirm-modal-enter-active, .meal-confirm-modal-leave-active { transition: opacity 0.18s ease; }
.meal-confirm-modal-enter-from, .meal-confirm-modal-leave-to { opacity: 0; }
.meal-confirm-modal-enter-active .meal-confirm-dialog { animation: mealConfirmIn 0.24s cubic-bezier(0.34, 1.3, 0.64, 1); }
.meal-confirm-modal-leave-active .meal-confirm-dialog { animation: mealConfirmOut 0.15s ease; }
@keyframes mealConfirmIn {
  from { transform: scale(0.95) translateY(8px); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}
@keyframes mealConfirmOut {
  from { transform: scale(1); opacity: 1; }
  to { transform: scale(0.97); opacity: 0; }
}
.meal-list { display: flex; flex-direction: column; }
.meal-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 0;
  border-top: 1px solid var(--border);
}
.meal-list .meal-row:first-child { border-top: 0; }
.meal-count {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-weight: 800;
  font-size: var(--text-body);
}
.meal-count.is-single { background: var(--bg-accent); color: var(--text-accent); }
.meal-count.is-medium { background: var(--bg-highlight); color: var(--text-highlight); }
.meal-count.is-large { background: var(--bg-danger); color: var(--text-danger); }
.meal-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.meal-name {
  font-size: var(--text-lead);
  font-weight: 750;
  line-height: 1.35;
  color: var(--ink);
}
.meal-note {
  font-size: var(--text-body);
  line-height: 1.45;
  color: var(--muted);
  word-break: break-word;
}

.meal-empty {
  padding: 18px 0 4px;
  text-align: center;
  color: var(--muted);
}
.meal-empty i { font-size: var(--text-title); color: var(--border-strong); margin-bottom: 8px; }
.meal-empty p { font-size: var(--text-label); line-height: 1.6; }

/* ── 誰還沒下 ── */
.member-list { display: flex; flex-wrap: wrap; gap: 7px; }
.member-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--bg-inset);
  border: 1px solid var(--border);
  padding: 5px 10px 5px 6px;
  border-radius: 999px;
}
.member-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--border-strong);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-micro);
  font-weight: 700;
  font-family: var(--font-display);
}

.all-done .summary-main.same-text { color: var(--text-success); font-size: var(--text-lead); }
.all-done .summary-detail { margin-top: 6px; }

.no-data {
  font-size: var(--text-label);
  color: var(--muted);
  text-align: center;
  padding: 18px 0;
}

@media (max-width: 768px) {
  .sidebar { margin-top: -4px; }
  .meal-confirm-overlay { align-items: flex-end; padding: 12px; }
  .meal-confirm-dialog { max-height: calc(100dvh - 24px); }
}
</style>
