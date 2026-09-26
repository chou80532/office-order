<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { formatMoney } from '../../utils/format'
import { groupDishOptions } from '../../utils/dishOptions'
import { normalizeOptionGroups } from '../../utils/dishOptionGroups'
import { UNCATEGORIZED_MENU_CATEGORY, compareMenuCategory, isAddonMenuItem, menuItemKey, normalizeMenuCategory } from '../../utils/menuCategories'

const props = defineProps({
  store: { type: Object, default: null },
  allStores: { type: Array, default: null },
  cartCounts: { type: Object, default: () => ({}) },
  searchQuery: { type: String, default: '' },
  userDishStats: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['add'])

const ALL_CATEGORY = '全部'
const itemName = (item) => String(item?.name || '').trim()
const isVisibleMainItem = (item) => itemName(item) && !isAddonMenuItem(item)
const itemCategory = (item) => normalizeMenuCategory(item?.category, UNCATEGORIZED_MENU_CATEGORY)
const dishKey = (item, storeName = '') => menuItemKey(item, storeName || props.store?.name || '')
// 有加價選項的品項，卡片上的價格只是起跳價
const hasPricedOptions = item => normalizeOptionGroups(item?.options).some(group => group.choices.some(choice => choice.price > 0))
const priceFromLabel = item => !!(item._variants || hasPricedOptions(item))
// 卡片上先講「點進去要選什麼」：有選項的品項跟一般品項長得一樣的話，
// 要點開才知道還有得選，掃視菜單時會漏掉。
const optionHint = (item) => {
  const labels = normalizeOptionGroups(item?.options).map(group => group.label)
  return labels.length ? `可選 ${labels.join('・')}` : ''
}
const cartCountFor = (item, storeName = '') => (item._variants || [item]).reduce((sum, variant) => sum + (props.cartCounts[dishKey(variant, storeName)] || 0), 0)
const dishSignalKey = (item, storeName = '') =>
  `${String(storeName || props.store?.name || '').trim()}::${itemName(item)}::${Number(item?.price) || 0}`
const userStatsFor = (item, storeName = '') => {
  const signals = (item._variants || [item]).map(v => props.userDishStats[dishSignalKey(v, storeName)]).filter(Boolean)
  return signals.find(stat => stat.isLast) || signals[0] || null
}

function uniqueCategoriesInMenuOrder(items) {
  const categories = []
  const seen = new Set()
  items.forEach(item => {
    const category = itemCategory(item)
    if (seen.has(category)) return
    seen.add(category)
    categories.push(category)
  })
  return categories
}

function groupItemsByCategory(items, categoryOrder = uniqueCategoriesInMenuOrder(items)) {
  const groupMap = new Map()
  items.forEach(item => {
    const category = itemCategory(item)
    if (!groupMap.has(category)) groupMap.set(category, [])
    groupMap.get(category).push(item)
  })

  const rankMap = new Map(categoryOrder.map((category, index) => [category, index]))
  return [...groupMap.entries()]
    .sort(([a], [b]) => {
      const rankA = rankMap.has(a) ? rankMap.get(a) : Number.MAX_SAFE_INTEGER
      const rankB = rankMap.has(b) ? rankMap.get(b) : Number.MAX_SAFE_INTEGER
      if (rankA !== rankB) return rankA - rankB
      return compareMenuCategory(a, b)
    })
    .map(([category, categoryItems]) => ({ category, items: categoryItems }))
}

// ── Single-store mode ──────────────────────────
const selectedCategory = ref(ALL_CATEGORY)
const categoryToolbar = ref(null)
const allMainItems = computed(() => groupDishOptions((props.store?.menuItems || []).filter(isVisibleMainItem)))
const hasItems = computed(() => allMainItems.value.length > 0)
const filteredMainItems = computed(() => {
  if (!props.searchQuery.trim()) return allMainItems.value
  const q = props.searchQuery.trim().toLowerCase()
  return allMainItems.value.filter(i => (i._variants || [i]).some(v => itemName(v).toLowerCase().includes(q)))
})

const categoryTabs = computed(() => {
  const visibleCategories = new Set(filteredMainItems.value.map(itemCategory))
  const categories = uniqueCategoriesInMenuOrder(allMainItems.value).filter(category => visibleCategories.has(category))
  return [ALL_CATEGORY, ...categories]
})

const categoryGroups = computed(() => {
  const visibleItems = selectedCategory.value === ALL_CATEGORY
    ? filteredMainItems.value
    : filteredMainItems.value.filter(item => itemCategory(item) === selectedCategory.value)
  return groupItemsByCategory(visibleItems, categoryTabs.value.filter(category => category !== ALL_CATEGORY))
})

// 手機分類為單列橫向捲動，點選較遠的分類時把它捲進可視範圍
function selectCategory(category, event) {
  const el = event.currentTarget
  selectedCategory.value = category
  nextTick(() => {
    categoryToolbar.value?.scrollIntoView({ block: 'start', behavior: 'instant' })
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' })
  })
}

watch([() => props.store?.name, () => props.searchQuery], () => {
  selectedCategory.value = ALL_CATEGORY
})

watch(categoryTabs, (tabs) => {
  if (!tabs.includes(selectedCategory.value)) selectedCategory.value = ALL_CATEGORY
})

// ── Global search mode ─────────────────────────
const isGlobalSearch = computed(() => !!props.searchQuery.trim() && !!props.allStores)

const globalResults = computed(() => {
  if (!isGlobalSearch.value) return []
  const q = props.searchQuery.trim().toLowerCase()
  return (props.allStores || [])
    .map(s => {
      const menuItems = s.items || s.menuItems || []
      const items = groupDishOptions(menuItems.filter(isVisibleMainItem)).filter(i => (i._variants || [i]).some(v => itemName(v).toLowerCase().includes(q)))
      return {
        name: s.name || s.id,
        groups: groupItemsByCategory(items, uniqueCategoriesInMenuOrder(menuItems.filter(isVisibleMainItem))),
        itemCount: items.length
      }
    })
    .filter(s => s.itemCount > 0)
})

function onCardClick(item, storeName = null) {
  emit('add', storeName ? { ...item, _storeName: storeName } : item)
}

function googleImageSearchUrl(item, storeName = '') {
  const storeQuery = String(storeName || props.store?.name || '').trim()
  const dishQuery = itemName(item)
  const query = [storeQuery, dishQuery].filter(Boolean).join(' ')
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`
}

function openDishImageSearch(item, storeName = '') {
  const queryUrl = googleImageSearchUrl(item, storeName)
  window.open(queryUrl, '_blank', 'noopener,noreferrer')
}

</script>

<template>
  <div class="dish-area">
    <!--
      數量徽章的液態輪廓只處理裝飾層；數字本身仍是清晰的 HTML。
      filter 跑在 SVG 圖形而不是文字上，避免 blur 影響可讀性。
    -->
    <svg class="dish-goo-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter id="dish-badge-goo" x="-45%" y="-45%" width="190%" height="190%" color-interpolation-filters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
            result="goo"
          />
        </filter>
      </defs>
    </svg>

    <!-- ── Global search results ── -->
    <template v-if="isGlobalSearch">
      <div v-if="globalResults.length === 0" class="placeholder">
        <span class="placeholder-icon" aria-hidden="true"><i class="fas fa-magnifying-glass"></i></span>
        <p>沒有找到「{{ searchQuery }}」的餐點</p>
        <p class="sub">換個關鍵字，或直接在購物車手動輸入餐點</p>
      </div>
      <div v-else class="global-results">
        <div v-for="storeGroup in globalResults" :key="storeGroup.name" class="store-group">
          <div class="store-group-label">
            <i class="fas fa-store store-group-icon"></i>
            {{ storeGroup.name }}
            <span class="store-group-count">{{ storeGroup.itemCount }} 項</span>
          </div>
          <section v-for="categoryGroup in storeGroup.groups" :key="`${storeGroup.name}-${categoryGroup.category}`" class="category-section is-compact">
            <div class="category-heading">
              <span>{{ categoryGroup.category }}</span>
              <span class="category-count">{{ categoryGroup.items.length }} 項</span>
            </div>
            <div class="card-grid">
              <div
                v-for="item in categoryGroup.items"
                :key="dishKey(item, storeGroup.name)"
                class="dish-card"
                :class="{ 'in-cart': cartCountFor(item, storeGroup.name) > 0, 'has-last-order': userStatsFor(item, storeGroup.name)?.isLast }"
                role="button"
                tabindex="0"
                :aria-label="`${item.name}，${formatMoney(item.price)}${priceFromLabel(item) ? ' 起' : ''}${optionHint(item) ? `，${optionHint(item)}` : priceFromLabel(item) ? '，選擇規格' : '，選擇備註與加料'}`"
                @click.stop="onCardClick(item, storeGroup.name)"
                @keydown.enter.prevent="onCardClick(item, storeGroup.name)"
                @keydown.space.prevent="onCardClick(item, storeGroup.name)"
              >
                <Transition name="badge-goo">
                  <span v-if="cartCountFor(item, storeGroup.name) > 0" class="card-badge-wrap">
                    <svg class="card-badge-liquid" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
                      <g filter="url(#dish-badge-goo)" fill="currentColor">
                        <circle class="badge-liquid-anchor" cx="44" cy="0" r="13" />
                        <circle class="badge-liquid-drop" cx="26" cy="18" r="10" />
                      </g>
                    </svg>
                    <span class="card-badge">{{ cartCountFor(item, storeGroup.name) }}</span>
                  </span>
                </Transition>
                <span v-if="userStatsFor(item, storeGroup.name)?.isLast" class="last-order-corner">上次點過</span>
                <span class="card-name">{{ item.name }}</span>
                <span v-if="optionHint(item)" class="card-options">{{ optionHint(item) }}</span>
                <div class="card-meta-row">
                  <span class="card-price">
                    {{ formatMoney(item.price) }}<span v-if="priceFromLabel(item)" class="card-unit"> 起</span><span v-if="item.unit" class="card-unit"> / {{ item.unit }}</span>
                  </span>
                  <button
                    type="button"
                    class="image-search-btn"
                    @keydown.enter.stop
                    @keydown.space.stop
                    title="查看餐點資訊"
                    aria-label="查看餐點資訊"
                    @click.stop="openDishImageSearch(item, storeGroup.name)"
                  >
                    <i class="fas fa-info"></i>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- ── Single-store view ── -->
    <template v-else>
      <div v-if="!store" class="placeholder">
        <span class="placeholder-icon" aria-hidden="true"><i class="fas fa-store"></i></span>
        <p>請先選擇店家</p>
        <p class="sub">從上方的今日店家清單挑一間開始點餐</p>
      </div>
      <template v-else>
        <div v-if="!hasItems" class="placeholder">
          <span class="placeholder-icon" aria-hidden="true"><i class="fas fa-utensils"></i></span>
          <p>此店家尚未設定菜單</p>
          <p class="sub">請在右側購物車手動輸入餐點</p>
        </div>
        <div v-else-if="categoryGroups.length === 0" class="placeholder">
          <span class="placeholder-icon" aria-hidden="true"><i class="fas fa-magnifying-glass"></i></span>
          <p>沒有找到「{{ searchQuery }}」的餐點</p>
          <p class="sub">換個關鍵字，或清除搜尋看完整菜單</p>
        </div>
        <div v-else class="categorized-menu">
          <div ref="categoryToolbar" class="category-toolbar">
          <span class="current-menu-store">{{ store.name }}</span>
          <div v-if="categoryTabs.length > 2" class="category-tabs" @click.stop>
            <button
              v-for="category in categoryTabs"
              :key="category"
              type="button"
              class="category-tab"
              :class="{ active: selectedCategory === category }"
              @click="selectCategory(category, $event)"
            >
              {{ category }}
            </button>
          </div>

          </div>
          <section v-for="categoryGroup in categoryGroups" :key="categoryGroup.category" class="category-section">
            <div class="category-heading">
              <span>{{ categoryGroup.category }}</span>
              <span class="category-count">{{ categoryGroup.items.length }} 項</span>
            </div>
            <div class="card-grid">
              <div
                v-for="item in categoryGroup.items"
                :key="dishKey(item)"
                class="dish-card"
                :class="{ 'in-cart': cartCountFor(item) > 0, 'has-last-order': userStatsFor(item)?.isLast }"
                role="button"
                tabindex="0"
                :aria-label="`${item.name}，${formatMoney(item.price)}${priceFromLabel(item) ? ' 起' : ''}${optionHint(item) ? `，${optionHint(item)}` : priceFromLabel(item) ? '，選擇規格' : '，選擇備註與加料'}`"
                @click.stop="onCardClick(item)"
                @keydown.enter.prevent="onCardClick(item)"
                @keydown.space.prevent="onCardClick(item)"
              >
                <Transition name="badge-goo">
                  <span v-if="cartCountFor(item) > 0" class="card-badge-wrap">
                    <svg class="card-badge-liquid" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
                      <g filter="url(#dish-badge-goo)" fill="currentColor">
                        <circle class="badge-liquid-anchor" cx="44" cy="0" r="13" />
                        <circle class="badge-liquid-drop" cx="26" cy="18" r="10" />
                      </g>
                    </svg>
                    <span class="card-badge">{{ cartCountFor(item) }}</span>
                  </span>
                </Transition>
                <span v-if="userStatsFor(item)?.isLast" class="last-order-corner">上次點過</span>
                <span class="card-name">{{ item.name }}</span>
                <span v-if="optionHint(item)" class="card-options">{{ optionHint(item) }}</span>
                <div class="card-meta-row">
                  <span class="card-price">
                    {{ formatMoney(item.price) }}<span v-if="priceFromLabel(item)" class="card-unit"> 起</span><span v-if="item.unit" class="card-unit"> / {{ item.unit }}</span>
                  </span>
                  <button
                    type="button"
                    class="image-search-btn"
                    @keydown.enter.stop
                    @keydown.space.stop
                    title="查看餐點資訊"
                    aria-label="查看餐點資訊"
                    @click.stop="openDishImageSearch(item)"
                  >
                    <i class="fas fa-info"></i>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </template>
    </template>

  </div>
</template>

<style scoped>
.dish-area {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-x: clip;
  padding: 12px 24px 20px;
}

.dish-goo-defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

.placeholder {
  padding: 48px 24px;
  text-align: center;
  color: var(--muted);
  font-size: var(--text-body);
  font-weight: 700;
}
.placeholder .sub { font-size: var(--text-label); font-weight: 500; margin-top: 6px; opacity: 0.8; }

.placeholder-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: var(--cream);
  color: var(--muted);
  font-size: var(--text-lead);
  margin-bottom: 12px;
}

.global-results,
.categorized-menu {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.store-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.store-group-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-label);
  font-weight: 800;
  color: var(--ink);
  padding-bottom: 8px;
  border-bottom: 1.5px solid var(--muted-line);
}

.store-group-icon {
  color: var(--paprika);
  font-size: var(--text-label);
}

.store-group-count,
.category-count {
  font-size: var(--text-micro);
  font-weight: 800;
  color: var(--muted);
  background: var(--cream);
  border: 1px solid var(--muted-line);
  border-radius: 999px;
  padding: 2px 8px;
}

.category-toolbar {
  position: sticky;
  top: var(--header-height, 60px);
  scroll-margin-top: var(--header-height, 60px);
  z-index: 11;
  background: var(--cream);
  margin: 0 -8px;
  padding: 10px 8px;
  border-bottom: 1px solid var(--border);
}
.current-menu-store { display: block; color: var(--text-secondary); font-size: var(--text-micro); margin-bottom: 8px; font-weight: 700; }
.category-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
  padding-bottom: 2px;
}

.category-tab {
  flex: 0 0 auto;
  padding: 7px 15px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--paper);
  color: var(--text-secondary);
  font-size: var(--text-label);
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s, color 0.15s, box-shadow 0.15s;
}
/* hover 只提一階，強調色（柿橘）保留給「已選取」，兩者才分得開 */
.category-tab:hover { border-color: color-mix(in srgb, var(--paper) 32%, transparent); color: var(--paper); }
.category-tab.active { background: var(--accent-solid); border-color: var(--accent); color: var(--text-on-accent); font-weight: 700; }

.category-section {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 10px;
}
.category-section.is-compact { gap: 8px; }

.category-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink);
  font-size: var(--text-body);
  font-weight: 900;
}
.category-heading::before {
  content: '';
  width: 6px;
  height: 18px;
  border-radius: 999px;
  background: var(--accent);
}

.card-grid {
  display: grid;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.dish-card {
  position: relative;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 24px 16px 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
  display: flex;
  flex-direction: column;
  gap: 7px;
  height: 112px;
}
.dish-card:hover {
  border-color: var(--border-accent);
  box-shadow: 0 14px 26px -16px color-mix(in srgb, var(--persimmon-dark) 40%, transparent);
}
.dish-card.in-cart {
  border-color: var(--accent);
  background: var(--selection-soft);
}
.dish-card.qty-active {
  border-color: var(--selection);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--selection) 18%, transparent);
  transform: translateY(-1px);
  cursor: default;
  height: auto;
  min-height: 112px;
}

.image-search-btn {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  border: 1px solid var(--muted-line);
  border-radius: 50%;
  background: var(--paper);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-micro);
  cursor: pointer;
  transition: all 0.12s;
}

.image-search-btn:hover {
  border-color: var(--selection);
  background: var(--selection-soft);
  color: var(--selection);

}

.image-search-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--selection) 55%, transparent);
  outline-offset: 2px;
}

.card-badge-wrap {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  width: 44px;
  height: 44px;
  color: var(--selection);
  pointer-events: none;
}

.card-badge-liquid {
  position: absolute;
  inset: 0;
  width: 44px;
  height: 44px;
  overflow: visible;
}

.badge-liquid-anchor,
.badge-liquid-drop {
  transform-box: fill-box;
  transform-origin: center;
}

.badge-liquid-anchor {
  opacity: 0;
  transform: scale(0);
}

.card-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent-solid);
  color: var(--text-on-accent);
  font-size: var(--text-micro);
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-name {
  font-size: var(--text-body);
  font-weight: 700;
  color: var(--ink);
  line-height: 1.3;
  padding-right: 24px;
  min-height: 2.6em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-price {
  font-family: var(--font-display);
  font-size: var(--text-lead);
  font-weight: 800;
  color: var(--text-accent);
}
.card-unit { font-weight: 500; font-size: var(--text-micro); font-family: var(--font-sans); color: var(--muted); }
.dish-card.in-cart .card-price { color: var(--text-accent); }

.card-meta-row {
  min-width: 0;
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.last-order-corner {
  position: absolute;
  top: 0;
  left: 0;
  padding: 5px 9px 6px;
  border-radius: 0 0 var(--r-sm) 0;
  background: var(--highlight);
  color: var(--text-on-highlight);
  font-size: var(--text-micro);
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
}

/* Qty picker expand transition */
.qty-expand-enter-active {
  transition: opacity 0.2s ease, max-height 0.26s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.qty-expand-leave-active {
  transition: opacity 0.15s ease, max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.qty-expand-enter-from, .qty-expand-leave-to { opacity: 0; max-height: 0; }
.qty-expand-enter-to, .qty-expand-leave-from { max-height: 120px; }

/*
 * 數量徽章像液滴從卡片右上角分離，取消時再融回去。
 * 液態 silhouette 與清晰數字分層，動畫只在狀態改變時執行。
 */
.badge-goo-enter-active {
  transition: opacity 0.46s ease;
}
.badge-goo-leave-active {
  transition: opacity 0.3s ease;
}
.badge-goo-enter-from,
.badge-goo-leave-to {
  opacity: 0;
}
.badge-goo-enter-active .badge-liquid-anchor {
  animation: badge-anchor-release 0.46s ease-out both;
}
.badge-goo-enter-active .badge-liquid-drop {
  animation: badge-drop-release 0.46s cubic-bezier(0.2, 0.9, 0.3, 1.18) both;
}
.badge-goo-enter-active .card-badge {
  animation: badge-number-release 0.46s cubic-bezier(0.2, 0.9, 0.3, 1.18) both;
}
.badge-goo-leave-active .badge-liquid-anchor {
  animation: badge-anchor-merge 0.3s ease-in both;
}
.badge-goo-leave-active .badge-liquid-drop,
.badge-goo-leave-active .card-badge {
  animation: badge-drop-merge 0.3s ease-in both;
}

@keyframes badge-anchor-release {
  0%, 38% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.25); }
}
@keyframes badge-drop-release {
  0% { transform: translate(14px, -14px) scale(0.5); }
  62% { transform: translate(-1px, 1px) scale(1.12); }
  100% { transform: translate(0, 0) scale(1); }
}
@keyframes badge-number-release {
  0%, 24% { opacity: 0; transform: translate(10px, -10px) scale(0.55); }
  100% { opacity: 1; transform: translate(0, 0) scale(1); }
}
@keyframes badge-anchor-merge {
  0% { opacity: 0; transform: scale(0.25); }
  45%, 100% { opacity: 1; transform: scale(1); }
}
@keyframes badge-drop-merge {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(14px, -14px) scale(0.42); }
}

/* Qty picker */
.qty-picker {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1.5px solid var(--danger);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.qty-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.qty-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  border: 1.5px solid var(--muted-line);
  background: var(--paper);
  font-size: var(--text-body);
  font-weight: 700;
  color: var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s;
  flex-shrink: 0;
}
.qty-btn:hover { background: var(--accent-solid); color: var(--text-on-accent); border-color: var(--selection); }

.qty-input {
  width: 44px;
  padding: 4px 6px;
  border: 1.5px solid var(--muted-line);
  border-radius: var(--r-sm);
  background: var(--paper);
  font-size: var(--text-body);
  font-weight: 800;
  color: var(--ink);
  caret-color: var(--paprika);
  text-align: center;
  font-family: var(--font-mono);
  outline: none;
}

.qty-input:focus {
  border-color: var(--selection);
  background: var(--cream);
}
/* Hide number input arrows */
.qty-input::-webkit-inner-spin-button,
.qty-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.qty-input[type=number] { -moz-appearance: textfield; }

.qty-unit-label {
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--muted);
  flex-shrink: 0;
}

.qty-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.qty-total {
  font-size: var(--text-label);
  font-weight: 800;
  color: var(--text-accent);
  font-family: var(--font-mono);
  flex-shrink: 0;
}

.qty-confirm {
  flex: 1;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  background: var(--accent-solid);
  color: var(--text-on-accent);
  font-size: var(--text-label);
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.12s;
  border: none;
  white-space: nowrap;
}
.qty-confirm:hover { opacity: 0.85; }

@media (max-width: 640px) {
  .dish-area {
    padding: 12px 10px;
  }

  .global-results,
  .categorized-menu {
    gap: 16px;
  }

  /* 分類多時不換行佔空間，改單列橫向捲動 */
  .category-tabs {
    margin: 0 -10px;
    padding: 0 10px 8px;
    background: var(--cream);
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .category-tabs::-webkit-scrollbar { display: none; }
  .category-tab { white-space: nowrap; }

  .card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .dish-card {
    padding: 22px 12px 10px;
    gap: 6px;
    height: 108px;
  }

  .dish-card.qty-active { min-height: 108px; }

  .card-name {
    font-size: var(--text-body);
    line-height: 1.28;
    padding-right: 18px;
  }

  /* 手機上價錢是決策關鍵資訊，維持大而清楚 */
  .card-price {
    font-size: var(--text-lead);
  }

  .card-badge {
    top: 6px;
    right: 6px;
    width: 18px;
    height: 18px;
    font-size: var(--text-micro);
  }
}

@media (prefers-reduced-motion: reduce) {
  .badge-goo-enter-active,
  .badge-goo-leave-active,
  .badge-goo-enter-active .badge-liquid-anchor,
  .badge-goo-enter-active .badge-liquid-drop,
  .badge-goo-enter-active .card-badge,
  .badge-goo-leave-active .badge-liquid-anchor,
  .badge-goo-leave-active .badge-liquid-drop,
  .badge-goo-leave-active .card-badge {
    animation: none !important;
    transition: none !important;
  }
}


/* Menu board presentation */

.dish-area { padding: 12px 40px 32px; overflow-x: clip; }
.category-toolbar { background: var(--ink); border-color: var(--line); }
.current-menu-store { color: var(--ink-soft); }
.category-heading, .store-group-label { color: var(--paper); font-family: var(--font-display); font-weight: 600; }
.category-count, .store-group-count { background: var(--ink-2); color: var(--ink-soft); border-color: var(--line); font-family: var(--font-sans); }
.category-tab { background: var(--ink-2); color: var(--ink-soft); border-color: var(--line); }
.card-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 22px 16px; padding-top: 10px; }
.dish-card, .dish-card.in-cart { overflow: visible; background: var(--paper); border: 1px solid var(--paper-2); border-radius: 10px; padding: 24px 14px 14px; height: auto; min-height: 126px; box-shadow: var(--shadow-card); transition: transform .15s ease, box-shadow .15s ease; }
/* 已加入購物車除了邊框，底色也淡淡疊一層，掃視時比較容易找到 */
.dish-card.in-cart { background: color-mix(in srgb, var(--persimmon) 7%, var(--paper)); }
.dish-card.in-cart, .dish-card.in-cart:hover { border-color: var(--persimmon); }
/* 未加入購物車時不要用橘框當 hover 回饋（容易被誤認成「已選取」）：
   紙卡 hover 已有傾斜＋陰影，邊框只做一階很淡的加深就夠。 */
.dish-card:hover { border-color: color-mix(in srgb, var(--ink-faint) 35%, var(--paper-2)); }
.dish-card::before { content: ''; position: absolute; top: -6px; left: calc(50% - 5.5px); width: 11px; height: 11px; background: var(--ink); border: 2px solid var(--paper-2); border-radius: 50%; }
.card-name { font-family: var(--font-display); font-size: var(--text-body); font-weight: 600; min-height: 38px; }
.card-meta-row { border-top: 1.5px dashed var(--ink-faint); padding-top: 8px; margin-top: auto; }
/* 「可選 口味・肉類」：一行淡字，超出就截斷，不讓它把卡片撐高 */
.card-options { display: block; margin-top: -2px; color: var(--ink-mute); font-size: var(--text-micro); font-weight: 500; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-price { color: var(--persimmon-dark); font-family: var(--font-sans); font-variant-numeric: tabular-nums; font-size: var(--text-body); }
/* 角標貼齊卡片外緣（-1px 蓋掉邊框），圓角與卡片同為 10px，
   左上角才不會露出卡片底色＋邊框線形成的縫隙。 */
.last-order-corner { top: -1px; left: -1px; background: var(--jade); border-radius: 10px 0 8px 0; padding: 4px 8px 5px; font-size: var(--text-micro); }
.card-badge-liquid { display: none; }
.placeholder { margin-top: 20px; background: var(--paper); border-radius: 8px; color: var(--ink); }
.placeholder-icon { display: none; }
@media (hover: hover) and (pointer: fine) {
 .dish-card:nth-child(odd):hover { transform: translateY(-3px) rotate(-2deg); box-shadow: var(--shadow-panel); }
 .dish-card:nth-child(even):hover { transform: translateY(-3px) rotate(2deg); box-shadow: var(--shadow-panel); }
}
@media (max-width: 768px) {
 .dish-area { padding: 12px 12px 24px; }
 .card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; }
 .category-tabs { background: var(--ink); }
 .dish-card { padding: 24px 12px 12px; }
}
@media (prefers-reduced-motion: reduce) { .dish-card:hover { transform: none !important; } }


/* .dish-area 的內距統一收在這裡。
   注意上面「Menu board presentation」那段的 `.dish-area { padding: 12px 40px 32px }`
   沒有包在任何 media query 裡，而且排在 @media (max-width: 640px) 之後，
   所以手機版寫的 12px 10px 一直被它蓋掉 —— 400px 的螢幕被吃掉 80px 當內距。
   這三條放在檔案最後，順序上贏得過它。 */
@media (max-width: 640px) {
  .dish-area { padding-inline: 10px; padding-bottom: 20px; }
}

/* 769–1100px：配合 HomeView 把購物車收到 300px，左右內距從 40px 收到 16px，
   中間才排得下兩欄卡片（兩欄需要 316px 內容寬）。 */
@media (min-width: 768.02px) and (max-width: 1100px) {
  .dish-area { padding-inline: 16px; }
}
</style>
