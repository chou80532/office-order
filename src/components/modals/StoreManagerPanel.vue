<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import StatusNotice from '../ui/StatusNotice.vue'
import LoadingState from '../ui/LoadingState.vue'
import { useFirestore } from '../../composables/useFirestore'
import { useAuth } from '../../composables/useAuth'
import { getLocalDateKey } from '../../utils/format'
import { getCachedStorePopularity, loadStorePopularity } from '../../services/storePopularity'
import { buildStorePopularity, STORE_POPULARITY_GROUPS } from '../../utils/storePopularity'
import AppSelect from '../ui/AppSelect.vue'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import { cancelOrdersWithWalletRefundViaFunction } from '../../services/walletFunctions'
import { db } from '../../firestore'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import MenuPreviewModal from './MenuPreviewModal.vue'

const props = defineProps({
  allStores: { type: Array, default: () => [] },
  search: { type: String, default: '' },
  replacementSource: { type: String, default: '' }
})

const emit = defineEmits(['show-toast', 'close', 'update:search'])

const { dailyStores, dailyFreeStores, menuLoading, todayOrders, diningDay, diningLoading, diningError, dailyStoresReady, dailyStoresError, ordersLoading } = useFirestore()
const { userUid } = useAuth()
const selected = ref([])
const freeSelected = ref([])
const settingsBaseline = ref(null)
const saving = ref(false)
const storeSearch = ref(props.search)
const previewStore = ref(null)
const cachedPopularity = getCachedStorePopularity(userUid.value)
const popularityOrders = ref(cachedPopularity?.orders || [])
const popularityLoading = ref(!cachedPopularity)
const popularityError = ref(false)
const popularityNow = ref(cachedPopularity?.now || Date.now())
const classificationLoading = computed(() => popularityLoading.value || menuLoading.value)
let disposed = false
onUnmounted(() => { disposed = true })
onMounted(() => { if (!cachedPopularity) loadPopularity(); loadPresets() })

// 保留既有最近 14 天開店紀錄；合併寫入不會刪掉已儲存的 presets。
const PRESETS_DOC = 'storePresets'
const HISTORY_LIMIT = 14
const history = ref([])

async function loadPresets() {
  try {
    const snap = await getDoc(doc(db, 'settings', PRESETS_DOC))
    if (disposed || !snap.exists()) return
    const data = snap.data() || {}
    history.value = Array.isArray(data.history) ? data.history : []
  } catch { /* 讀不到就當作沒有組合，不影響設定店家本身 */ }
}

async function writePresets(next) {
  await setDoc(doc(db, 'settings', PRESETS_DOC), next, { merge: true })
}

// 套用設定成功後記一筆，供下次「沿用上次」使用。失敗不影響主流程。
async function recordHistory(stores, free) {
  try {
    const today = getLocalDateKey()
    const next = [{ date: today, stores: [...stores], free: [...free] },
                  ...history.value.filter(entry => entry?.date !== today)].slice(0, HISTORY_LIMIT)
    await writePresets({ history: next })
    history.value = next
  } catch { /* 歷史只是便利功能，寫失敗就算了 */ }
}

async function loadPopularity() {
  popularityLoading.value = true
  popularityError.value = false
  try {
    const { orders, now } = await loadStorePopularity(userUid.value)
    if (disposed) return
    popularityOrders.value = orders
    popularityNow.value = now
  } catch {
    if (!disposed) popularityError.value = true
  } finally {
    if (!disposed) popularityLoading.value = false
  }
}

const popularity = computed(() => buildStorePopularity(props.allStores, popularityOrders.value, popularityNow.value))
const NEW_BADGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function isNewStore(store) {
  const createdAtTs = Number(store?.createdAtTs)
  if (!Number.isFinite(createdAtTs) || createdAtTs <= 0) return false
  return (Date.now() - createdAtTs) <= NEW_BADGE_WINDOW_MS
}

// 只初始化一次；即使使用者清空勾選，也不可被即時快照重新勾回。
watch([dailyStoresReady, dailyStores, dailyFreeStores], () => {
  if (settingsBaseline.value || !dailyStoresReady.value || dailyStoresError.value) return
  settingsBaseline.value = { activeStores: [...dailyStores.value], freeStores: [...dailyFreeStores.value], serviceDate: getLocalDateKey() }
  selected.value = dailyStores.value.filter(name => name !== props.replacementSource)
  freeSelected.value = dailyFreeStores.value.filter(name => name !== props.replacementSource)
}, { immediate: true })

watch(() => props.search, (val) => {
  if (val !== storeSearch.value) storeSearch.value = val
})

function updateStoreSearch(event) {
  storeSearch.value = event.target.value
  emit('update:search', storeSearch.value)
}

function clearSearch() {
  storeSearch.value = ''
  emit('update:search', '')
}

const filtered = computed(() => {
  const q = storeSearch.value.trim().toLowerCase()
  if (!q) return props.allStores
  return props.allStores.filter(s => s.name.toLowerCase().includes(q))
})

const categories = computed(() => classificationLoading.value ? [] : [
  { id: 'lunch', label: '🍱 午餐', stores: filtered.value.filter(s => s.category !== 'drink') },
  { id: 'drink', label: '🧋 飲料', stores: filtered.value.filter(s => s.category === 'drink') },
].filter(category => category.stores.length).map(category => ({
  ...category,
  groups: popularityError.value
    ? [{ id: 'unclassified', label: '', stores: category.stores }]
    : STORE_POPULARITY_GROUPS.map(group => ({
      ...group,
      stores: category.stores.filter(store => popularity.value.get(store.name)?.group === group.id)
        .sort((a, b) => popularity.value.get(b.name).count - popularity.value.get(a.name).count || a.name.localeCompare(b.name, 'zh-TW')),
    })).filter(group => group.stores.length),
})))

function toggle(name) {
  if (saving.value || !settingsBaseline.value) return
  const i = selected.value.indexOf(name)
  if (i > -1) {
    selected.value.splice(i, 1)
    const freeIndex = freeSelected.value.indexOf(name)
    if (freeIndex > -1) freeSelected.value.splice(freeIndex, 1)
  } else {
    selected.value.push(name)
  }
}

function toggleFree(name) {
  if (saving.value || !settingsBaseline.value) return
  const i = freeSelected.value.indexOf(name)
  i > -1 ? freeSelected.value.splice(i, 1) : freeSelected.value.push(name)
}

function isFreeSelected(name) {
  return freeSelected.value.includes(name)
}

function clearAll() {
  if (saving.value || !settingsBaseline.value) return
  selected.value = []
  freeSelected.value = []
}

function hasMenuImages(store) {
  return (store?.images || []).some(img => img.url && img.url.trim() !== '')
}

function openMenuPreview(store) {
  if (!hasMenuImages(store)) return
  previewStore.value = store
}

function closeMenuPreview() {
  previewStore.value = null
}

const replacementOpen = ref(false)
const replacementTargets = ref({})
const removedProtected = computed(() => {
  const protectedStores = new Set([...todayOrders.value.map(o => o.storeName), ...Object.values(diningDay.value.needs || {}).filter(n => n.status === 'pending').map(n => n.targetStore)])
  return dailyStores.value.filter(name => protectedStores.has(name) && !selected.value.includes(name))
})
async function save(confirmed = false) {
  if (saving.value) return
  if (!settingsBaseline.value || dailyStoresError.value || ordersLoading.value || diningLoading.value || diningError.value) {
    emit('show-toast', '尚未取得用餐名單，請稍後再試', 'error')
    return
  }
  if (removedProtected.value.length && confirmed !== true) {
    const added = selected.value.filter(name => !dailyStores.value.includes(name))
    replacementTargets.value = Object.fromEntries(removedProtected.value.map(name => [name, added.length === 1 ? added[0] : '']))
    replacementOpen.value = true
    return
  }
  if (removedProtected.value.some(name => !selected.value.includes(replacementTargets.value[name]))) {
    emit('show-toast', '請為每間移除的店家選擇接替店家；若未選新店，請先返回勾選', 'error')
    return
  }
  if (selected.value.some(name => diningDay.value.replacements?.[name])) {
    emit('show-toast', '今日已更換停用的店家不可重新開放', 'error')
    return
  }
  saving.value = true
  try {
    await cancelOrdersWithWalletRefundViaFunction({
      storeReplacements: removedProtected.value.map(source => ({ source, target: replacementTargets.value[source] })),
      dailyStoreSettings: {
        activeStores: [...selected.value],
        freeStores: selected.value.filter(name => freeSelected.value.includes(name)),
        expectedActiveStores: settingsBaseline.value.activeStores,
        expectedFreeStores: settingsBaseline.value.freeStores,
        serviceDate: settingsBaseline.value.serviceDate,
      },
      reason: '設定店家異動退款',
    })
    // Preset history is only a convenience. Start the write in the background so
    // a slow settings write cannot keep the store manager open after the update.
    void recordHistory(selected.value, selected.value.filter(name => freeSelected.value.includes(name)))
    emit('show-toast', '已更新今日店家')
    emit('close')
  } catch (error) { emit('show-toast', error.message === 'CASH_PAYMENT_ALREADY_COLLECTED' ? '含已收現金訂單，請先撤銷收款再換店' : `儲存失敗：${error.message}。請重新確認今日店家後再試`, 'error') } finally { saving.value = false }
}
</script>

<template>
  <div class="store-mgr-panel">
    <ConfirmDialog :open="replacementOpen" title="更換今日店家" message="原餐點將取消並退款，受影響人員保留為待重新點餐。" confirm-text="確認換店並套用" :loading="saving" autofocus="none" @confirm="save(true)" @cancel="replacementOpen = false">
      <div v-for="source in removedProtected" :key="source" class="replacement-row">
        <span>{{ source }} →</span>
        <AppSelect v-model="replacementTargets[source]" :disabled="saving" :label="`${source} 的接替店家`" placeholder="選擇接替店家" :options="selected.map(name => ({ value: name, label: name }))" />
      </div>
      <p>補點可從點餐頁送出，或在今日訂單重新點餐／代點。新餐點依今日免費設定計費。</p>
    </ConfirmDialog>
    <div class="panel-header">
      <span class="selected-count">已選 {{ selected.length }} 家</span>
      <div class="header-actions">
        <button class="action-btn" @click="clearAll" :disabled="saving || !selected.length">清除全選</button>
        <button class="action-btn" :disabled="saving" @click="emit('close')">取消</button>
        <button class="action-btn primary" @click="save" :disabled="saving || !settingsBaseline">
          {{ saving ? '儲存中…' : '套用設定' }}
        </button>
      </div>
    </div>

    <p v-if="replacementSource" class="replacement-hint" role="status">
      正在更換「{{ replacementSource }}」，已先取消勾選。請選擇接替店家，再按「套用設定」確認；確認前不會變更訂單。
    </p>
    <div class="store-search-bar">
      <label class="store-search-field app-search-shell" for="today-store-search">
        <span class="search-icon">⌕</span>
        <input
          id="today-store-search"
          :value="storeSearch"
          type="search"
          autocomplete="off"
          placeholder="搜尋店家名稱..."
          @input="updateStoreSearch"
          @keyup.escape="clearSearch"
        />
        <button
          v-if="storeSearch"
          class="search-clear app-search-clear"
          type="button"
          aria-label="清除搜尋"
          @click="clearSearch"
        >
          ×
        </button>
      </label>
      <span class="search-result-count">顯示 {{ filtered.length }} / {{ allStores.length }} 家</span>
    </div>

    <!-- Selected chips -->
    <div v-if="selected.length" class="selected-chips">
      <span v-for="name in selected" :key="name" class="chip" :class="{ 'chip-free': isFreeSelected(name) }">
        {{ name }}
        <button
          type="button"
          class="chip-free-toggle"
          :class="{ on: isFreeSelected(name) }"
          :title="isFreeSelected(name) ? '今日免費，點擊改回收費' : '設為今日免費'"
          :aria-pressed="isFreeSelected(name)"
          @click="toggleFree(name)"
        >免費</button>
        <button type="button" class="chip-remove" :aria-label="`移除 ${name}`" @click="toggle(name)">×</button>
      </span>
      <p v-if="freeSelected.length" class="free-hint">免費店家今天點餐不扣錢包、不列現金應收，金額僅供紀錄</p>
    </div>

    <div class="store-list">
      <LoadingState v-if="classificationLoading" compact title="正在準備店家分類…" />
      <p v-else-if="popularityError" class="popularity-status" role="status">
        暫時無法載入訂購分類，仍可選擇店家。
        <button type="button" class="action-btn" @click="loadPopularity">重試</button>
      </p>
      <p v-else class="popularity-status">依全體近 30 天訂購紀錄分類</p>
      <div v-for="category in categories" :key="category.id" class="category-section">
        <h3 class="cat-label">{{ category.label }}</h3>
        <section v-for="group in category.groups" :key="group.id" class="popularity-section" :class="group.id">
          <div v-if="group.label" class="popularity-heading">
            <h4>{{ group.label }}</h4>
            <span>{{ group.description }}</span>
            <span class="group-size">{{ group.stores.length }} 家</span>
          </div>
          <div class="store-grid">
            <div
              v-for="store in group.stores"
              :key="store.name"
              class="store-card"
              :class="{ active: selected.includes(store.name) }"
              role="button"
              tabindex="0"
              @click="toggle(store.name)"
              @keydown.enter.self.prevent="toggle(store.name)"
              @keydown.space.self.prevent="toggle(store.name)"
            >
              <span v-if="isNewStore(store)" class="store-new-badge">NEW</span>
              <span v-if="selected.includes(store.name)" class="store-check" aria-hidden="true">
                <i class="fas fa-check"></i>
              </span>
              <span class="store-card-name">{{ store.name }}</span>
              <div class="store-card-meta">
                <span class="store-card-count">{{ store.menuItems?.length || 0 }} 項</span>
                <button
                  v-if="hasMenuImages(store)"
                  type="button"
                  class="menu-preview-btn"
                  title="看菜單"
                  aria-label="看菜單"
                  @click.stop="openMenuPreview(store)"
                >
                  <i class="fas fa-info" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <StatusNotice v-if="!classificationLoading && !filtered.length" title="無符合的店家" description="調整搜尋關鍵字或分類篩選。" />
    </div>

    <MenuPreviewModal v-if="previewStore" :store="previewStore" @close="closeMenuPreview" />
  </div>
</template>

<style scoped>
.replacement-hint { padding: 12px 16px; color: var(--accent); background: var(--bg-accent); border-radius: var(--r-md); font-size: var(--text-label); line-height: 1.6; }
.replacement-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }

/* 整個面板維持深色底（跟點餐頁的 .page/.top-storebar 同一套 var(--ink)），
   店家卡才能沿用點餐頁「深底＋紙票卡」的同一套視覺邏輯。 */
.store-mgr-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--ink);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* 跟歷史訂單／錢包／統計等其他全螢幕面板一致的左右邊界 */
  padding: 12px 40px;
  border-bottom: 1.5px solid var(--line);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.selected-count {
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--ink-soft);
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.action-btn {
  padding: 6px 14px;
  border-radius: var(--r-sm);
  border: 1.5px solid var(--line);
  background: var(--ink-2);
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--ink-soft);
  transition: all 0.15s;
}
.action-btn:hover:not(:disabled) { border-color: var(--paper); color: var(--paper); }
.action-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.action-btn.primary {
  background: var(--accent-solid);
  border-color: var(--selection);
  color: var(--text-on-accent);
}
.action-btn.primary:hover:not(:disabled) {
  background: var(--accent-solid);
  border-color: var(--selection);
  color: var(--text-on-accent);
  opacity: 0.85;
}
.action-btn.primary:disabled { opacity: 0.5; }

.store-search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 40px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.store-search-field {
  position: relative;
  display: flex;
  align-items: center;
  min-width: min(100%, 280px);
  flex: 1;
}

.search-icon {
  position: absolute;
  left: 12px;
  color: var(--ink-soft);
  font-size: var(--text-body);
  pointer-events: none;
}

.store-search-field input {
  width: 100%;
  height: 38px;
  padding: 0 38px 0 34px;
  border: 1.5px solid var(--line);
  border-radius: 999px;
  background: var(--ink-2);
  color: var(--paper);
  font-size: var(--text-label);
  font-weight: 700;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.store-search-field input::placeholder { color: var(--ink-soft); }
.store-search-field input:focus { border-color: transparent; box-shadow: none; }
.store-search-field:focus-within input { border-color: var(--accent); }

.search-clear {
  position: absolute;
  right: 5px;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--ink-soft);
  font-size: var(--text-lead);
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}

.search-clear:hover {
  background: color-mix(in srgb, var(--paper) 15%, transparent);
  color: var(--paper);
}

.search-result-count {
  color: var(--ink-soft);
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
}

.selected-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 10px 40px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.chip {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 10px;
  background: var(--accent-solid); color: var(--text-on-accent);
  border-radius: var(--r-sm); font-size: var(--text-label); font-weight: 700;
}
/* 只給「×」用。原本寫成 .chip button 會一併命中「免費」切換鈕，
   把它撐成 14px 字＋7px 內距的大圓形，直接溢出膠囊底色。 */
.chip .chip-remove {
  font-size: var(--text-body);
  color: color-mix(in srgb, var(--paper) 60%, transparent);
  transition: color 0.15s;
  padding: 7px;
  margin: -7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.chip .chip-remove:hover { color: var(--paprika); }

.chip.chip-free { background: var(--jade); color: var(--paper); }

/* 免費切換鈕：原本邊框跟文字各自用 color-mix 疊透明度，兩層半透明疊在一起
   顏色會糊、字看不清楚。改成邊框跟文字一起用同一個 opacity 淡出／點亮，
   顏色本身維持全彩，字才會清楚；切換成「已免費」時改實色底＋深綠字，不透明。 */
.chip-free-toggle {
  font-size: var(--text-micro);
  font-weight: 800;
  padding: 2px 9px;
  border-radius: 999px;
  border: 1.5px solid currentColor;
  background: transparent;
  color: inherit;
  opacity: 0.75;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  white-space: nowrap;
}
.chip-free-toggle:hover { opacity: 1; }
.chip-free-toggle.on {
  background: var(--paper);
  border-color: var(--paper);
  color: var(--jade);
  opacity: 1;
}

.free-hint {
  flex-basis: 100%;
  margin: 2px 0 0;
  font-size: var(--text-micro);
  font-weight: 700;
  /* 深色底上直接用 --success（深綠）對比不足，改用深底專用的綠 */
  color: var(--jade-light);
}

.store-list { flex: 1; overflow-y: auto; padding: 12px 40px; }

.popularity-status { margin: 0 0 14px; color: var(--ink-soft); font-size: var(--text-label); }

/* 手機縮小左右邊界，跟歷史訂單／錢包／統計面板同一套斷點值 */
@media (max-width: 768px) {
  .panel-header, .store-search-bar, .preset-bar, .selected-chips, .store-list { padding-left: 16px; padding-right: 16px; }
  .store-grid { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 18px 12px; }
  .store-card { padding: 24px 12px 12px; }
}
.popularity-section { margin-bottom: 16px; }
.popularity-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin-bottom: 8px; }
.popularity-heading h4 { margin: 0; padding: 3px 8px; border-radius: 999px; background: var(--ink-3); color: var(--paper); font-size: var(--text-label); }
.popular .popularity-heading h4 { background: var(--selection-soft); color: var(--selection); }
.popularity-heading span { color: var(--ink-soft); font-size: var(--text-micro); }
.popularity-heading .group-size { margin-left: auto; }
.category-section { margin-bottom: 24px; }
.cat-label {
  font-size: var(--text-micro); font-weight: 700;
  text-transform: uppercase; letter-spacing: 1px;
  color: var(--ink-soft); margin-bottom: 8px;
}

/* 店家卡＝點餐頁餐點卡（order/DishList.vue .dish-card）的同一套紙票樣式：
   深色面板上放紙色卡、頂端留釘孔、底部撕票虛線，選取時邊框轉柿橘。
   兩個畫面都是「在深底上挑東西」，共用同一種卡片語彙才不會像兩套系統。 */
.store-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 22px 16px;
  padding-top: 10px;
}

.store-card {
  position: relative;
  display: flex; flex-direction: column; gap: 7px;
  min-height: 104px;
  padding: 24px 14px 14px;
  border: 1px solid var(--paper-2);
  border-radius: 10px;
  background: var(--paper);
  box-shadow: var(--shadow-card);
  text-align: left;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
/* 釘孔：與餐點卡同一顆 */
.store-card::before {
  content: '';
  position: absolute;
  top: -6px;
  left: calc(50% - 5.5px);
  width: 11px;
  height: 11px;
  background: var(--ink);
  border: 2px solid var(--paper-2);
  border-radius: 50%;
}
.store-card:hover { border-color: color-mix(in srgb, var(--ink-faint) 35%, var(--paper-2)); }
@media (hover: hover) and (pointer: fine) {
  .store-card:nth-child(odd):hover { transform: translateY(-3px) rotate(-2deg); box-shadow: var(--shadow-panel); }
  .store-card:nth-child(even):hover { transform: translateY(-3px) rotate(2deg); box-shadow: var(--shadow-panel); }
}
@media (prefers-reduced-motion: reduce) { .store-card:hover { transform: none !important; } }
.store-card:focus-visible {
  outline: 2px solid var(--selection);
  outline-offset: 2px;
}
.store-card.active, .store-card.active:hover { border-color: var(--persimmon); }

.store-card-name {
  font-family: var(--font-display);
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
  padding-right: 22px;
  min-height: 38px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 對應餐點卡的 .card-meta-row：撕票虛線＋左資訊右按鈕 */
.store-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1.5px dashed var(--ink-faint);
}

.store-card-count {
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--persimmon-dark);
  font-variant-numeric: tabular-nums;
}

.store-check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent-solid);
  color: var(--text-on-accent);
  font-size: var(--text-micro);
}

/* NEW 改成左上角標，跟餐點卡的「上次點過」同一個位置與形狀；
   -1px 貼齊外緣、圓角與卡片同為 10px，角落不會露出縫隙。 */
.store-new-badge {
  position: absolute;
  top: -1px;
  left: -1px;
  padding: 4px 8px 5px;
  border-radius: 10px 0 8px 0;
  background: var(--accent-solid);
  color: var(--text-on-accent);
  font-size: var(--text-micro);
  font-weight: 800;
  letter-spacing: 0.5px;
  line-height: 1;
  pointer-events: none;
}

/* 對應餐點卡的 .image-search-btn */
.menu-preview-btn {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--muted-line);
  background: var(--paper);
  color: var(--muted);
  font-size: var(--text-micro);
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}

.menu-preview-btn:hover, .menu-preview-btn:focus-visible {
  border-color: var(--selection);
  background: var(--selection-soft);
  color: var(--selection);
}

.menu-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
}

.menu-preview-modal {
  width: min(92vw, 920px);
  max-height: min(90vh, 860px);
  display: flex;
  flex-direction: column;
  border: 1.5px solid var(--muted-line);
  border-radius: var(--r-lg);
  background: var(--paper);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.menu-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--muted-line2);
}

.menu-preview-header div {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.menu-preview-header strong {
  color: var(--ink);
  font-size: var(--text-body);
}

.menu-preview-header span {
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 700;
}

.menu-preview-close {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  color: var(--muted);
  font-size: var(--text-title);
  line-height: 1;
}

.menu-preview-close:hover {
  background: var(--muted-line2);
  color: var(--ink);
}

.menu-preview-body {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: 14px;
  overflow: hidden;
  background: var(--image-viewer-bg);
  touch-action: none;
}

.menu-preview-image {
  display: block;
  max-width: 100%;
  max-height: 74vh;
  object-fit: contain;
  border-radius: var(--r-sm);
  transform-origin: center center;
}

.menu-preview-zoom-bar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--paper) 10%, transparent);
  border-radius: 999px;
  background: var(--image-control-bg);
  backdrop-filter: blur(8px);
  transform: translateX(-50%);
}

.menu-preview-glass-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--paper) 8%, transparent);
  color: var(--paper);
  font-size: var(--text-micro);
  transition: background 0.15s;
}

.menu-preview-glass-btn:hover, .menu-preview-glass-btn:focus-visible {
  background: color-mix(in srgb, var(--paper) 18%, transparent);
}

.menu-preview-zoom-level {
  min-width: 42px;
  color: var(--paper);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  font-weight: 700;
  text-align: center;
}

.menu-preview-divider {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: color-mix(in srgb, var(--paper) 15%, transparent);
}

.menu-nav-btn {
  position: absolute;
  top: 50%;
  z-index: 1;
  width: 40px;
  height: 56px;
  border-radius: 999px;
  background: var(--image-control-bg);
  color: var(--image-control-icon);
  font-size: var(--text-display);
  line-height: 1;
  transform: translateY(-50%);
}

.menu-nav-btn:hover { background: color-mix(in srgb, var(--ink) 90%, transparent); }
.menu-nav-btn.prev { left: 18px; }
.menu-nav-btn.next { right: 18px; }

</style>
