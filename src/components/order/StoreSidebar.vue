<script setup>
import { computed, ref, watch } from 'vue'
import MenuPreviewModal from '../modals/MenuPreviewModal.vue'

const props = defineProps({
  stores: { type: Array, default: () => [] },
  activeId: { type: String, default: null },
  horizontal: { type: Boolean, default: false }
})

const emit = defineEmits(['select', 'add-store'])
const previewStore = ref(null)

// 桌機版：電話鈕改成「按一下顯示號碼」（手機版仍是 tel: 直撥）
const revealedPhoneId = ref(null)

function togglePhone(store) {
  revealedPhoneId.value = revealedPhoneId.value === store.id ? null : store.id
}

// 換店家時把已展開的號碼收起來，避免留在畫面上
watch(() => props.activeId, () => { revealedPhoneId.value = null })

// 手機版下拉選單用：目前選中的店家（含動作鈕要用的電話/地址/菜單）
const activeStore = computed(() =>
  props.stores.find(store => store.id === props.activeId) || props.stores[0] || null
)

function hasMenuImages(store) {
  return (store?.images || []).some(image => image.url && image.url.trim() !== '')
}

function phoneHref(store) {
  return `tel:${String(store?.phone || '').replace(/\D/g, '')}`
}

function mapUrl(store) {
  const destination = store?.address || store?.name || ''
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}
</script>

<template>
  <div class="sidebar" :class="{ horizontal: props.horizontal }">
    <div class="sidebar-header">
      <span class="sidebar-title">今日店家</span>
      <span class="count-badge">{{ stores.length }}</span>
      <button class="add-btn" @click="emit('add-store')">
        <i class="fas fa-plus" aria-hidden="true"></i>
        <span>設定店家</span>
      </button>
    </div>

    <!-- 手機版：下拉選店＋目前店家的動作鈕（桌機隱藏） -->
    <div class="store-select-row">
      <select
        class="store-select"
        :value="activeStore?.id || ''"
        aria-label="選擇今日店家"
        @change="emit('select', $event.target.value)"
      >
        <option value="" disabled>選擇店家</option>
        <option v-for="store in stores" :key="`opt-${store.id}`" :value="store.id">
          {{ store.name }}{{ store.category === 'drink' ? '（飲料）' : '' }}{{ store.isFreeToday ? '・今日免費' : '' }}
        </option>
      </select>
      <div v-if="activeStore" class="store-actions select-store-actions">
        <button
          v-if="hasMenuImages(activeStore)"
          type="button"
          class="chip-action"
          title="看菜單"
          :aria-label="`查看 ${activeStore.name} 菜單`"
          @click="previewStore = activeStore"
        >
          <i class="fas fa-info" aria-hidden="true"></i>
        </button>
        <a
          v-if="activeStore.phone"
          class="chip-action"
          :href="phoneHref(activeStore)"
          :title="`撥打 ${activeStore.name}`"
          :aria-label="`撥打 ${activeStore.name}`"
        >
          <i class="fas fa-phone" aria-hidden="true"></i>
        </a>
        <a
          v-if="activeStore.address"
          class="chip-action"
          :href="mapUrl(activeStore)"
          target="_blank"
          rel="noopener noreferrer"
          :title="`導航到 ${activeStore.name}`"
          :aria-label="`導航到 ${activeStore.name}`"
        >
          <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
        </a>
      </div>
      <button
        type="button"
        class="chip-action select-setup-btn"
        title="設定今日開放店家"
        aria-label="設定今日開放店家"
        @click="emit('add-store')"
      >
        <i class="fas fa-sliders" aria-hidden="true"></i>
      </button>
    </div>

    <nav class="store-list">
      <div
        v-for="store in stores"
        :key="store.id"
        class="store-item"
        :class="{ active: store.id === activeId }"
        role="button"
        :aria-pressed="store.id === activeId"
        tabindex="0"
        @click="emit('select', store.id)"
        @keydown.enter.prevent="emit('select', store.id)"
        @keydown.space.prevent="emit('select', store.id)"
      >
        <span class="dot" aria-hidden="true"></span>
        <span class="sname">{{ store.name }}</span>
        <span class="stag" :class="store.category === 'drink' ? 'tag-drink' : 'tag-lunch'">
          {{ store.category === 'drink' ? '飲料' : '午餐' }}
        </span>
        <span v-if="store.isFreeToday" class="stag tag-free">免費</span>
        <div class="store-actions">
          <button
            v-if="hasMenuImages(store)"
            type="button"
            class="chip-action"
            title="看菜單"
            :aria-label="`查看 ${store.name} 菜單`"
            @click.stop="previewStore = store"
          >
            <i class="fas fa-info" aria-hidden="true"></i>
          </button>
          <!-- 電話/導航僅在選中的店家顯示：這些動作只對正在點的店家有意義 -->
          <template v-if="store.id === activeId">
            <button
              v-if="store.phone"
              type="button"
              class="chip-action"
              :class="{ 'is-on': revealedPhoneId === store.id }"
              :title="revealedPhoneId === store.id ? '隱藏電話' : `顯示 ${store.name} 電話`"
              :aria-label="revealedPhoneId === store.id ? `隱藏 ${store.name} 電話` : `顯示 ${store.name} 電話`"
              :aria-expanded="revealedPhoneId === store.id"
              @click.stop="togglePhone(store)"
            >
              <i class="fas fa-phone" aria-hidden="true"></i>
            </button>
            <span v-if="store.phone && revealedPhoneId === store.id" class="phone-text" @click.stop>
              {{ store.phone }}
            </span>
            <a
              v-if="store.address"
              class="chip-action"
              :href="mapUrl(store)"
              target="_blank"
              rel="noopener noreferrer"
              :title="`導航到 ${store.name}`"
              :aria-label="`導航到 ${store.name}`"
              @click.stop
            >
              <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
            </a>
          </template>
        </div>
      </div>
    </nav>

    <MenuPreviewModal v-if="previewStore" :store="previewStore" @close="previewStore = null" />
  </div>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px 12px;
  flex-shrink: 0;
}

.sidebar-title {
  font-size: var(--text-micro);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.2px;
}

.count-badge {
  font-size: var(--text-micro);
  font-weight: 800;
  border-radius: 4px;
  padding: 1px 6px;
}

/* 手機版下拉選店列（桌機隱藏） */
.store-select-row { display: none; }

.store-select {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border: 1.5px solid var(--input-border);
  border-radius: var(--r-md);
  background: var(--input-bg);
  color: var(--ink);
  font-size: var(--text-body);
  font-weight: 700;
  outline: none;
}
.store-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--input-focus-ring); }

.select-store-actions { flex-shrink: 0; gap: 4px; }
/* 用容器選擇器壓過後面的 .chip-action 基本樣式（26px 圓鈕），統一成 40px 方鈕 */
.store-select-row .chip-action {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: 1.5px solid var(--input-border);
  background: var(--input-bg);
  border-radius: var(--r-md);
  color: var(--text-secondary);
  font-size: var(--text-body);
}

.store-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 10px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--muted-line) transparent;
}

.store-item {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  width: 100%;
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s;
  cursor: pointer;
}

/* hover 只提一階，強調色（柿橘）保留給「已選取」，兩者才分得開 */
.store-item:hover { border-color: color-mix(in srgb, var(--paper) 32%, transparent); }
.store-item.active .sname { font-weight: 700; }

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-lunch { background: var(--tag-lunch-text); }
.dot-drink { background: var(--tag-drink-text); }

.sname {
  flex: 1;
  font-size: var(--text-label);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stag {
  font-size: var(--text-micro);
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.tag-lunch { color: var(--tag-lunch-text); background: var(--tag-lunch-bg); }
.tag-drink { color: var(--tag-drink-text); background: var(--tag-drink-bg); }
.tag-free { color: var(--text-success); background: var(--bg-success); }

.store-actions {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  margin-left: 2px;
}

/* Ghost 圖示鈕：平時無邊框、低調,hover/focus 才浮現圓底 */
.chip-action {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  font-size: var(--text-label);
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}

.chip-action:hover, .chip-action:focus-visible {
  background: color-mix(in srgb, var(--selection) 14%, transparent);
  color: var(--selection);
  outline: none;
}

/* 電話展開中：讓圖示鈕維持點亮狀態，看得出來是「已展開」 */
.chip-action.is-on {
  background: color-mix(in srgb, var(--selection) 14%, transparent);
  color: var(--selection);
}

/* 桌機版按下電話鈕後顯示的號碼；user-select 讓它可直接反白複製 */
.phone-text {
  font-size: var(--text-micro);
  font-weight: 700;
  letter-spacing: 0.3px;
  white-space: nowrap;
  padding: 0 4px 0 2px;
  cursor: text;
  user-select: all;
}

.store-item.active .chip-action { color: color-mix(in srgb, var(--text-on-accent) 85%, transparent); }
.store-item.active .chip-action.is-on {
  color: var(--text-on-accent);
  background: color-mix(in srgb, var(--paper) 20%, transparent);
}
.store-item.active .phone-text { color: var(--text-on-accent); }
.store-item.active .chip-action:hover, .store-item.active .chip-action:focus-visible {
  color: var(--text-on-accent);
  background: color-mix(in srgb, var(--paper) 20%, transparent);
}

/* 設定店家：置於「今日店家」標頭旁的小型動作鈕 */
.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 4px 11px;
  border: 1.5px dashed var(--muted-line);
  border-radius: 999px;
  font-size: var(--text-micro);
  font-weight: 800;
  white-space: nowrap;
  transition: all 0.15s;
}
.add-btn i { font-size: var(--text-micro); }

.add-btn:hover {
  border-color: var(--ink);
  color: var(--ink);
  background: var(--cream);
}

@media (min-width: 769px) {
  .sidebar.horizontal {
    height: auto;
    overflow: visible;
    border-bottom: 1px solid var(--muted-line);
    padding-bottom: 10px;
  }

  .sidebar.horizontal .sidebar-header {
    padding: 14px 40px 10px;
  }

  .sidebar.horizontal .store-list {
    flex: initial;
    flex-direction: row;
    gap: 8px;
    padding: 0 40px;
    overflow-x: auto;
    overflow-y: visible;
    scrollbar-width: none;
  }
  .sidebar.horizontal .store-list::-webkit-scrollbar { display: none; }

  .sidebar.horizontal .store-item {
    width: auto;
    min-width: 0;
    flex-shrink: 0;
  }
}

@media (max-width: 768px) {
  /* 手機版：單列＝下拉選店＋目前店家動作鈕＋設定店家圖示鈕 */
  .sidebar {
    flex-direction: column;
    height: auto;
    overflow: visible;
  }

  /* 「今日店家 N ＋ 設定店家」標頭列在手機收掉：數量下拉裡看得到，設定改圖示鈕 */
  .sidebar-header { display: none; }

  .store-list { display: none; }

  .store-select-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px;
  }

  .store-select-row .select-setup-btn {
    border-style: dashed;
    color: var(--muted);
  }
}

.sidebar.horizontal { border-bottom: 1px solid var(--line); padding-bottom: 18px; }
.sidebar-title, .count-badge, .add-btn { color: var(--ink-soft); }
.count-badge { background: var(--ink-3); }
.store-item, .sidebar.horizontal .store-item { background: var(--ink-2); border: 1px solid var(--line); border-radius: 6px; padding: 14px; min-height: 64px; }
.store-item.active { background: var(--ink-3); border-color: var(--line); box-shadow: none; }
.sname, .store-item.active .sname, .store-item:hover .sname { color: var(--paper); font-family: var(--font-display); }
.store-item .dot { background: var(--ink-soft); }
.store-item.active .dot { background: var(--jade); }
/* 深色店家列上，午餐／飲料／免費原本被統一壓成同一顆灰標籤，
   分類看不出來、「今日免費」在「要選哪一間」的當下也等於隱形。
   餐別維持安靜的灰（那是背景資訊），免費則保留顏色，因為它會影響選擇。 */
.store-item .stag, .store-item.active .stag { background: var(--ink); color: var(--ink-soft); border-radius: 3px; }
.store-item .stag.tag-free,
.store-item.active .stag.tag-free {
  background: var(--jade);
  color: var(--paper);
  font-weight: 800;
  letter-spacing: .02em;
}
.store-item .dot-lunch { background: var(--tag-lunch-text); }
.store-item .dot-drink { background: var(--tag-drink-text); }
.chip-action, .phone-text { color: var(--ink-soft); }
@media (max-width: 768px) {
 .sidebar-header { display: flex; padding: 14px 12px 10px; }
 .store-select-row { display: none; }
 .store-list { display: flex; flex-direction: row; overflow-x: auto; gap: 10px; padding: 0 12px 10px; }
 .store-item { flex: 0 0 auto; width: auto; max-width: 90vw; }
}
</style>

<style scoped>
.store-item.active, .sidebar.horizontal .store-item.active { border-color:var(--jade); box-shadow:inset 0 0 0 1px var(--jade); }
</style>
