<template>
  <div ref="panelRoot" class="store-panel ops-surface">
    <!-- 工具列：店家統計＋篩選排序＋新增店家（設計稿 3） -->
    <div class="panel-toolbar">
      <div class="toolbar-top">
        <div class="toolbar-stats">
          共 {{ groupedStores.length }} 間店家
          <span class="stats-dot" aria-hidden="true">・</span>
          今日開放 {{ openTodayCount }} 間
        </div>
        <div class="toolbar-top-actions">
          <button
            type="button"
            class="filter-toggle-btn"
            :class="{ active: filtersOpen }"
            :aria-expanded="filtersOpen"
            @click="filtersOpen = !filtersOpen"
          >
            <i class="fas fa-filter" aria-hidden="true"></i>
            篩選 / 排序
            <span v-if="activeFilterCount" class="filter-count-badge">{{ activeFilterCount }}</span>
            <i class="fas fa-chevron-down filter-chevron" :class="{ open: filtersOpen }" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-primary add-store-btn" @click="showQuickAdd = !showQuickAdd">
            <i class="fas fa-plus" aria-hidden="true"></i> 新增店家
          </button>
        </div>
      </div>
      <div v-show="filtersOpen" class="toolbar-controls">
        <select v-model="categoryFilter" class="toolbar-select" aria-label="分類篩選">
          <option value="all">全部分類</option>
          <option value="lunch">午餐</option>
          <option value="drink">飲料</option>
        </select>
        <select v-model="attentionFilter" class="toolbar-select" aria-label="待處理篩選">
          <option value="all">全部狀態</option>
          <option value="no-image">沒有圖片</option>
          <option value="failed">圖片載入失敗（已偵測）</option>
          <option value="no-menu">未設定智慧菜單</option>
        </select>
        <select v-model="sortState.key" class="toolbar-select" aria-label="排序方式" title="今日開放的店家固定排在最前面，其次才依此排序方式">
          <option value="menuUpdatedAt">最近更新</option>
          <option value="createdAt">最近加入</option>
          <option value="name">店家名稱</option>
          <option value="category">分類</option>
          <option value="images">圖片數</option>
        </select>
        <button
          type="button"
          class="sort-dir-btn"
          :title="sortState.direction === 'asc' ? '目前：由小到大' : '目前：由大到小'"
          :aria-label="sortState.direction === 'asc' ? '切換為由大到小' : '切換為由小到大'"
          @click="sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc'"
        >
          <i :class="['fas', sortState.direction === 'asc' ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short']" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <!-- Quick add -->
    <div v-show="showQuickAdd" class="quick-add-section">
      <div class="section-label">
        <i class="fas fa-plus-circle"></i>
        <span>快速新增店家</span>
      </div>
      <div class="quick-add-grid">
        <div class="form-item" style="flex:0.7;min-width:90px">
          <label>分類*</label>
          <select v-model="quickAddForm.category">
            <option value="lunch">午餐</option>
            <option value="drink">飲料</option>
          </select>
        </div>
        <div class="form-item" style="flex:1.2;min-width:130px">
          <label>店家名稱*</label>
          <input type="text" v-model="quickAddForm.name" placeholder="如：50嵐">
        </div>
        <div class="form-item" style="flex:1;min-width:120px">
          <label>電話</label>
          <input type="tel" v-model="quickAddForm.phone" @input="formatPhone('quickAddForm')" placeholder="如：04-1234567">
        </div>
        <div class="form-item" style="flex:1.5;min-width:150px">
          <label>地址</label>
          <input type="text" v-model="quickAddForm.address" placeholder="如：台中市...">
        </div>
        <div class="form-item" style="flex:1.3;min-width:160px">
          <label>菜單圖片（選填）</label>
          <div class="file-input-group">
            <div class="file-action-box">
              <button type="button" class="fab-btn" @click="promptQuickAddUrl" title="貼上網址"><i class="fas fa-link"></i></button>
              <button type="button" class="fab-btn" @click="$refs.quickAddFileInput.click()" title="上傳圖片"><i class="fas fa-upload"></i></button>
            </div>
            <input type="file" ref="quickAddFileInput" accept="image/*" @change="handleQuickAddFile" style="display:none">
            <div class="file-status">{{ quickAddFileStatus }}</div>
          </div>
        </div>
        <div class="form-item btn-item">
          <button class="btn btn-primary btn-add" @click="submitQuickAdd" :disabled="isQuickAdding">
            <span v-if="isQuickAdding" class="mini-spinner"></span>
            <template v-else><i class="fas fa-plus"></i></template>
            新增
          </button>
        </div>
      </div>
    </div>

    <!-- 店家卡片網格（設計稿 3） -->
    <StatusNotice v-if="groupedStores.length === 0" title="目前沒有任何店家資料" description="使用上方「新增店家」建立第一間店家。" />
    <StatusNotice v-else-if="filteredStores.length === 0" :title="`找不到符合「${props.searchQuery}」的店家`" description="請調整搜尋關鍵字或篩選條件。" />
    <div v-else class="store-grid">
      <article
        v-for="store in filteredStores"
        :key="store.name"
        :class="['store-card', { open: isStoreOpenToday(store.name) }]"
        data-store-row="true"
        :data-store-name="store.name"
      >
        <!-- 縮圖開啟菜單，店家資料與圖片操作集中在編輯視窗。 -->
          <span
            class="store-avatar"
            aria-hidden="true"
            :style="{ background: getAvatarColor(store.name) }"
          >{{ store.name.slice(0, 1) }}</span>

          <button
            type="button"
            class="row-thumb"
            :class="{ 'is-empty': !firstImage(store) }"
            :aria-label="`${store.name} 的菜單圖片，共 ${validImageCount(store)} 張`"
            :title="validImageCount(store) ? '檢視菜單' : '編輯店家'"
            @click="openSmartEditor(store, firstImage(store)?.id)"
          >
            <img v-if="firstImage(store)" :src="firstImage(store).url" @error="handleMenuImageError(firstImage(store), store)" alt="" width="40" height="40" loading="lazy" decoding="async">
            <span v-else class="row-thumb-add" aria-hidden="true">＋</span>
            <span v-if="validImageCount(store) > 1" class="row-thumb-count">{{ validImageCount(store) }}</span>
          </button>

          <div class="row-main">
            <div class="row-line1">
              <h3 class="card-name" :title="store.name">{{ store.name }}</h3>
              <span class="row-cell row-cell-mid">
                <span v-if="isStoreOpenToday(store.name)" class="today-flag">今日開放</span>
              </span>
              <span class="row-cell row-cell-end">
                <span :class="['cat-badge', store.category === 'lunch' ? 'badge-lunch' : 'badge-drink']">
                  {{ store.category === 'lunch' ? '午餐' : '飲料' }}
                </span>
              </span>
            </div>
            <div class="row-line2">
              <span class="meta-item meta-phone" :class="{ 'is-blank': !store.phone }">{{ store.phone || '未填電話' }}</span>
              <span class="row-cell row-cell-mid">
                <span class="meta-item meta-address" :class="{ 'is-blank': !store.address }" :title="store.address">{{ store.address || '未填地址' }}</span>
              </span>
              <span class="row-cell row-cell-end">
                <span class="meta-item meta-menu" :class="{ 'is-blank': !validImageCount(store) }">
                  {{ validImageCount(store) ? `菜單 ${formatDateShort(store.menuUpdatedAtTs)}` : '尚無菜單圖片' }}
                </span>
              </span>
            </div>
          </div>

          <div class="card-actions">
            <button
              type="button"
              class="open-toggle"
              role="switch"
              :aria-checked="isStoreOpenToday(store.name)"
              :aria-label="`${store.name} 今日開放點餐`"
              :disabled="togglingStoreName === store.name"
              :title="isStoreOpenToday(store.name) ? '今日開放中，點擊關閉' : '未開放，點擊開放今日點餐'"
              @click="toggleOpenToday(store)"
            >
              <span class="toggle-knob" aria-hidden="true"></span>
            </button>

            <button type="button" class="card-btn primary" @click="openSmartEditor(store)" title="編輯店家資料與智慧點餐">
              編輯店家
              <span v-if="store.menuItems?.length" class="menu-count-badge" :aria-label="`已設定 ${store.menuItems.length} 項餐點`">{{ store.menuItems.length }}</span>
            </button>

          </div>

      </article>
    </div>

    <input type="file" ref="extraImageFileInput" accept="image/*" @change="handleExtraImageUpload" style="display:none">

    <SmartMenuEditorModal
      v-if="editorStore"
      :store="editorStore"
      :initial-image-id="editorInitialImageId"
      :before-close="cancelEdit"
      :save-all="saveEdit"
      unified-editor
      @close="closeSmartEditor"
    >
      <template #header-actions="{ save, isSaving }">
            <div class="store-edit-actions">
              <button type="button" class="btn store-delete-btn" @click="deleteWholeStore(editorStore)"><i class="fas fa-trash-alt"></i> 刪除店家</button>
              <span class="store-action-divider" aria-hidden="true">｜</span>
              <button type="button" class="btn btn-secondary" :disabled="duplicatingStoreName === editorStore.name" @click="duplicateStore(editorStore)"><i class="fas fa-copy"></i> 複製店家</button>
              <button type="button" class="btn btn-primary" @click="save" :disabled="isSaving"><i class="fas fa-check" aria-hidden="true"></i> 儲存資料</button>
            </div>
      </template>
      <template #store-details>
          <div class="store-details-form">
            <div class="edit-field">
              <label>分類</label>
              <select v-model="editForm.category" class="edit-input">
                <option value="lunch">午餐</option>
                <option value="drink">飲料</option>
              </select>
            </div>
            <div class="edit-field">
              <label>店家名稱</label>
              <input type="text" v-model="editForm.name" class="edit-input">
            </div>
            <div class="edit-field">
              <label>電話</label>
              <input type="tel" v-model="editForm.phone" @input="formatPhone('editForm')" class="edit-input">
            </div>
            <div class="edit-field">
              <label>地址</label>
              <input type="text" v-model="editForm.address" class="edit-input">
            </div>
          </div>
      </template>
      <template #image-actions="{ image }">
        <span class="image-action-divider" aria-hidden="true"></span>
        <button type="button" class="image-toolbar-btn" :disabled="!image?.url" @click="copyImageUrl(image.url)" title="複製目前圖片網址" aria-label="複製目前圖片網址"><i class="fas fa-copy"></i></button>
        <button type="button" class="image-toolbar-btn" @click="addExtraImageUrl(editorStore)" title="貼上圖片網址" aria-label="貼上圖片網址"><i class="fas fa-link"></i></button>
        <button type="button" class="image-toolbar-btn" @click="triggerExtraImageUpload(editorStore)" title="上傳圖片" aria-label="上傳圖片"><i class="fas fa-upload"></i></button>
        <button v-if="image" type="button" class="image-toolbar-btn" @click="deleteSingleImage(image.id, editorStore)" title="刪除目前圖片" aria-label="刪除目前圖片"><i class="fas fa-trash-alt"></i></button>
      </template>
    </SmartMenuEditorModal>
  </div>
</template>

<script setup>
import StatusNotice from "../ui/StatusNotice.vue"


import { formatDateShort as formatDate } from '../../utils/format'
import { ref, reactive, computed, defineAsyncComponent, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from 'vue'
import { useDebouncedRef } from '../../composables/useDebounce'

const props = defineProps({ searchQuery: { type: String, default: '' } })
defineEmits(['update:searchQuery'])
import { collection, addDoc, doc, writeBatch, getDocs, query, where, setDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject, getMetadata } from 'firebase/storage'
import { storage } from '../../firebaseStorage'
import { db } from '../../firestore'
import { useFirestore } from '../../composables/useFirestore'
import { useToast } from '../../composables/useToast'
import { confirmDialog, promptDialog } from '../../composables/useDialog'
import { useSettingsTab } from '../../composables/useSettingsTab'
import { getLocalDateKey } from '../../utils/format'
import { getAvatarColor } from '../../utils/avatar'
import { isMissingMenuImage } from '../../utils/menuImageHealth'
import { MAX_FILE_SIZE_BYTES } from '../../constants'

const SmartMenuEditorModal = defineAsyncComponent(() => import('./SmartMenuEditorModal.vue'))

const { rawMenuData, dailyStores, dailyFreeStores, requireFullMenuData, releaseFullMenuData } = useFirestore()
const { showToast } = useToast()
const { storePanelPosition } = useSettingsTab()
let fullMenuRequested = false

function syncFullMenuRequest(needed) {
  if (needed && !fullMenuRequested) {
    requireFullMenuData()
    fullMenuRequested = true
  } else if (!needed && fullMenuRequested) {
    releaseFullMenuData()
    fullMenuRequested = false
  }
}

const normalizeStoreName = (name) => String(name || '').trim()
const compareZh = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-TW')
const isMenuItem = (item) => item && typeof item.name === 'string' && item.name.trim()

const isQuickAdding = ref(false)
const duplicatingStoreName = ref(null)
const quickAddFileInput = ref(null)
const extraImageFileInput = ref(null)
const panelRoot = ref(null)
const shouldRestorePanelPosition = ref(true)

const quickAddForm = reactive({ category: 'lunch', name: '', phone: '', address: '', url: '' })
const quickAddFile = ref(null)
const quickAddFileStatus = ref('未選擇圖片')

const editingStoreName = ref(null)
const editForm = reactive({ category: '', name: '', phone: '', address: '' })
const categoryFilter = ref('all')
const attentionFilter = ref('all')
const showQuickAdd = ref(false)
// 篩選／排序列預設收合，避免與統計列一起佔用桌機工具列高度；有作用中的篩選時在按鈕上顯示徽章提醒。
const filtersOpen = ref(false)
const activeFilterCount = computed(() => (categoryFilter.value !== 'all' ? 1 : 0) + (attentionFilter.value !== 'all' ? 1 : 0))

// ── 今日開放開關（與 StoreManagerPanel 寫同一份 settings/daily） ──
const togglingStoreName = ref(null)
const isStoreOpenToday = (name) => (dailyStores.value || []).includes(name)
const openTodayCount = computed(() => groupedStores.value.filter(s => isStoreOpenToday(s.name)).length)

const toggleOpenToday = async (store) => {
  if (togglingStoreName.value) return
  togglingStoreName.value = store.name
  try {
    const current = new Set(dailyStores.value || [])
    const opening = !current.has(store.name)
    opening ? current.add(store.name) : current.delete(store.name)
    const nextActive = [...current]
    const nextFree = (dailyFreeStores.value || []).filter(name => nextActive.includes(name))
    const todayKey = getLocalDateKey()
    await setDoc(doc(db, 'settings', 'daily'), {
      activeStores: nextActive,
      freeStores: nextFree,
      date: todayKey,
      serviceDate: todayKey,
      updatedAt: serverTimestamp(),
    }, { merge: true })
    showToast(opening ? `已開放「${store.name}」今日點餐` : `已關閉「${store.name}」今日點餐`)
  } catch {
    showToast('更新今日開放狀態失敗', 'error')
  } finally {
    togglingStoreName.value = null
  }
}
// 店家列表：今日開放的店家固定置頂，同一層級內預設以最後異動時間由新到舊排列，方便管理近期更新的菜單。
const sortState = reactive({ key: 'menuUpdatedAt', direction: 'desc' })
const targetStoreForExtraImage = ref(null)

const editorStoreName = ref(null)
const editorDocumentId = ref(null)
const editorInitialImageId = ref(null)
const editorStore = computed(() => {
  if (!editorStoreName.value) return null
  return groupedStores.value.find(s => s.name === editorStoreName.value || s.docIds.includes(editorDocumentId.value)) || null
})

const searchRef = computed(() => props.searchQuery)
const debouncedSearch = useDebouncedRef(searchRef, 200)

const filteredStores = computed(() => {
  const q = debouncedSearch.value.trim().toLowerCase()
  const searched = q
    ? groupedStores.value.filter(s => s.name.toLowerCase().includes(q))
    : groupedStores.value
  const byCategory = categoryFilter.value === 'all'
    ? searched
    : searched.filter(s => s.category === categoryFilter.value)
  return byCategory.filter(store => {
    if (attentionFilter.value === 'no-image') return !validImageCount(store)
    if (attentionFilter.value === 'failed') return store.images.some(img => failedImageUrls.value.has(img.url))
    if (attentionFilter.value === 'no-menu') return !store.menuItems?.length
    return true
  }).sort(compareStoresByActiveSort)
})

const categoryRank = (category) => ({ lunch: 0, drink: 1 }[category] ?? 9)
const toMillis = (value) => {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : NaN
}
const firstValidMillis = (...values) => {
  for (const value of values) {
    const timestamp = toMillis(value)
    if (Number.isFinite(timestamp)) return timestamp
  }
  return NaN
}
const getSortValue = (store, key) => {
  if (key === 'category') return categoryRank(store.category)
  if (key === 'images') return store.images?.filter(img => img.url)?.length || 0
  if (key === 'createdAt') return Number(store.createdAtTs) || 0
  if (key === 'menuUpdatedAt') return Number(store.menuUpdatedAtTs) || 0
  return String(store[key] || '')
}
const compareStoresByActiveSort = (a, b) => {
  // 排序層級：今日開放 > 使用者選擇的排序（預設最近更新）。
  // 今日開放固定置頂，不受升冪／降冪切換影響，避免翻轉方向時把開放中的店家推到最下面。
  const openDiff = Number(isStoreOpenToday(b.name)) - Number(isStoreOpenToday(a.name))
  if (openDiff !== 0) return openDiff
  const key = sortState.key
  const dir = sortState.direction === 'asc' ? 1 : -1
  const av = getSortValue(a, key)
  const bv = getSortValue(b, key)
  const primary = typeof av === 'number' && typeof bv === 'number'
    ? av - bv
    : compareZh(av, bv)
  if (primary !== 0) return primary * dir
  return compareZh(a.name, b.name)
}
// 失效圖仍留在清單中（標示「失效」讓使用者能刪），但不計入「菜單圖片 N 張」。
const isBrokenImage = img => !img?.url || failedImageUrls.value.has(img.url)
const firstImage = store => visibleImages(store).find(img => !isBrokenImage(img)) || null


const visibleImages = store => (store.images || []).filter(img => img.url)
const validImageCount = store => visibleImages(store).filter(img => !isBrokenImage(img)).length

// 日期格式一律走 utils/format，本地版沒帶台北時區，跨日會跟帳務日界對不上
const formatDateShort = (timestamp) => {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || ts <= 0) return '-'
  return formatDate(ts)
}

const storeRows = () => [...(panelRoot.value?.querySelectorAll('[data-store-row="true"]') || [])]

const rememberPanelPosition = () => {
  const rows = storeRows()
  const row = rows.find(el => el.getBoundingClientRect().bottom > 80) || rows[0]
  if (!row) {
    storePanelPosition.value = { storeName: '', offset: 0, scrollY: window.scrollY || 0 }
    return
  }
  storePanelPosition.value = {
    storeName: row.dataset.storeName || '',
    offset: row.getBoundingClientRect().top,
    scrollY: window.scrollY || 0
  }
}

const restorePanelPosition = async () => {
  const saved = storePanelPosition.value
  if (!shouldRestorePanelPosition.value) return
  if (!saved.storeName && !saved.scrollY) {
    shouldRestorePanelPosition.value = false
    return
  }
  await nextTick()
  requestAnimationFrame(() => {
    const row = storeRows().find(el => el.dataset.storeName === saved.storeName)
    if (saved.storeName && !row) return
    if (!row) {
      window.scrollTo({ top: saved.scrollY || 0 })
      shouldRestorePanelPosition.value = false
      return
    }
    window.scrollTo({ top: (window.scrollY || 0) + row.getBoundingClientRect().top - saved.offset })
    shouldRestorePanelPosition.value = false
  })
}

const groupedStores = computed(() => {
  const storeMap = {}
  rawMenuData.value.forEach(d => {
    const storeName = normalizeStoreName(d.storeName)
    if (!storeName) return

    if (!storeMap[storeName]) {
      storeMap[storeName] = { name: storeName, phone: d.phone || '', address: d.address || '', category: d.category || 'lunch', images: [], docIds: [], menuItems: null, menuDocId: null, createdAtTs: null, menuUpdatedAtTs: null }
    }
    if (d.phone) storeMap[storeName].phone = d.phone
    if (d.address) storeMap[storeName].address = d.address
    if (d.category) storeMap[storeName].category = d.category
    const createdTs = firstValidMillis(d.createdAt, d.timestamp)
    if (Number.isFinite(createdTs)) {
      const knownCreatedTs = storeMap[storeName].createdAtTs
      storeMap[storeName].createdAtTs = knownCreatedTs == null ? createdTs : Math.min(knownCreatedTs, createdTs)
    }
    const updatedTs = firstValidMillis(d.menuUpdatedAt, d.updatedAt, d.timestamp)
    if (Number.isFinite(updatedTs)) {
      const knownUpdatedTs = storeMap[storeName].menuUpdatedAtTs
      storeMap[storeName].menuUpdatedAtTs = knownUpdatedTs == null ? updatedTs : Math.max(knownUpdatedTs, updatedTs)
    }
    if (d.menuItems && Array.isArray(d.menuItems) && d.menuItems.length > 0) {
      storeMap[storeName].menuItems = d.menuItems.filter(isMenuItem)
      storeMap[storeName].menuDocId = d.id
    }
    storeMap[storeName].images.push({ id: d.id, url: d.url, storagePath: d.storagePath || '' })
    storeMap[storeName].docIds.push(d.id)
  })
  return Object.values(storeMap).sort((a, b) => compareZh(a.name, b.name))
})

const formatPhone = (formType) => {
  const f = formType === 'quickAddForm' ? quickAddForm : editForm
  let v = f.phone.replace(/\D/g, '')
  if (v.startsWith('09')) v = v.length > 7 ? v.replace(/^(\d{4})(\d{3})(\d{0,3}).*/, '$1-$2-$3') : v.length > 4 ? v.replace(/^(\d{4})(\d{0,3})/, '$1-$2') : v
  else if (v.startsWith('0')) v = v.length > 6 ? v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, '$1-$2-$3') : v.length > 2 ? v.replace(/^(\d{2})(\d{0,4})/, '$1-$2') : v
  f.phone = v
}

const failedImageUrls = ref(new Set())
const uploadFileToStorage = async (file) => {
  const storagePath = `menu_images/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`
  const fileRef = storageRef(storage, storagePath)
  await uploadBytes(fileRef, file)
  return { url: await getDownloadURL(fileRef), storagePath }
}

const storageRefForImage = (image) => {
  if (image?.storagePath) return storageRef(storage, image.storagePath)
  if (String(image?.url || '').includes('firebasestorage.googleapis.com')) return storageRef(storage, image.url)
  return null
}

// A render error marks the thumbnail as broken; it stays visible so it can be removed by hand.
// Delete the record only for a confirmed missing URL, never for offline/CORS/auth failures.
const checkedImageUrls = new Set()
const handleMenuImageError = async (image, store) => {
  failedImageUrls.value.add(image.url)
  if (navigator.onLine === false || checkedImageUrls.has(image.url)) return
  checkedImageUrls.add(image.url)
  try {
    const missing = await isMissingMenuImage({ objectRef: storageRefForImage(image), url: image.url, metadata: getMetadata, request: fetch })
    if (!missing) return
    await removeImageRecord(image.id, store)
    showToast('已刪除失效的菜單圖片，餐點資料已保留')
  } catch {
    // 刪不掉就維持顯示「失效」，由使用者自己按 × 刪除。
  }
}

const deleteStoredImages = async (images) => {
  const refs = []
  const seen = new Set()
  let failedCount = 0
  for (const image of images) {
    const key = image?.storagePath || image?.url || ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    try {
      if (image?.url) {
        const remainingRefs = await getDocs(query(collection(db, 'menu_images'), where('url', '==', image.url)))
        if (!remainingRefs.empty) continue
      }
      const ref = storageRefForImage(image)
      if (ref) refs.push(ref)
    } catch {
      failedCount += 1
    }
  }
  const results = await Promise.allSettled(refs.map(ref => deleteObject(ref)))
  return failedCount + results.filter(result => result.status === 'rejected' && result.reason?.code !== 'storage/object-not-found').length
}

const promptQuickAddUrl = async () => {
  const url = await promptDialog({
    title: '使用圖片網址',
    message: '請貼上圖片直連網址（不是網頁網址）。外站連結可能過期，長期使用建議改用「上傳圖片」。',
    placeholder: 'https://…',
  })
  if (url !== null) { quickAddForm.url = url.trim(); quickAddFile.value = null; if (quickAddFileInput.value) quickAddFileInput.value.value = ''; quickAddFileStatus.value = url.trim() ? '已輸入網址' : '未選擇圖片' }
}

const handleQuickAddFile = (event) => {
  if (event.target.files.length > 0) { quickAddFile.value = event.target.files[0]; quickAddForm.url = ''; quickAddFileStatus.value = quickAddFile.value.name }
  else { quickAddFile.value = null; quickAddFileStatus.value = '未選擇圖片' }
}

const submitQuickAdd = async () => {
  const name = quickAddForm.name.trim()
  if (!name) return showToast('請輸入店家名稱', 'error')
  if (groupedStores.value.some(s => s.name === name)) return showToast(`「${name}」已存在，請直接在列表下方新增圖片`, 'error')
  isQuickAdding.value = true

  const doAdd = async ({ url, storagePath = '' }) => {
    const now = Date.now()
    await addDoc(collection(db, 'menu_images'), { storeName: name, phone: quickAddForm.phone.trim(), address: quickAddForm.address.trim(), category: quickAddForm.category, url, storagePath, timestamp: now, createdAt: now, menuUpdatedAt: now })
    showToast('店家建立成功！')
    quickAddForm.name = ''; quickAddForm.phone = ''; quickAddForm.address = ''; quickAddForm.url = ''
    quickAddFile.value = null; quickAddFileStatus.value = '未選擇圖片'
    if (quickAddFileInput.value) quickAddFileInput.value.value = ''
  }

  if (quickAddFile.value) {
    if (quickAddFile.value.size > MAX_FILE_SIZE_BYTES) { isQuickAdding.value = false; return showToast('圖片超過 2MB', 'error') }
    showToast('圖片上傳中，請稍候...')
    let uploaded = null
    try {
      uploaded = await uploadFileToStorage(quickAddFile.value)
      await doAdd(uploaded)
    } catch (err) {
      if (uploaded) await deleteStoredImages([uploaded])
      showToast('上傳失敗: ' + err.message, 'error')
    } finally { isQuickAdding.value = false }
  } else {
    try { await doAdd({ url: quickAddForm.url }) }
    catch (err) { showToast('建立失敗: ' + err.message, 'error') }
    finally { isQuickAdding.value = false }
  }
}

const duplicateStore = async (store) => {
  if (duplicatingStoreName.value) return

  const suggestedName = `${store.name}－分店`
  const input = await promptDialog({
    title: '複製為新分店',
    message: '請輸入新分店名稱：',
    detail: '將複製基本資料、菜單圖片與智慧點餐品項；不會複製訂單、收款、錢包及統計紀錄。',
    defaultValue: suggestedName,
    confirmText: '複製',
  })
  if (input === null) return

  const newName = normalizeStoreName(input)
  if (!newName) return showToast('新分店名稱不能為空', 'error')
  if (newName === store.name) return showToast('新分店名稱必須與原店家不同', 'error')
  if (groupedStores.value.some(item => item.name === newName)) return showToast(`「${newName}」已存在，請使用其他名稱`, 'error')
  if (store.images.length > 450) return showToast('菜單圖片數量過多，請聯絡系統管理員協助複製', 'error')

  duplicatingStoreName.value = store.name
  try {
    const batch = writeBatch(db)
    const now = Date.now()
    const images = store.images.length > 0 ? store.images : [{ id: '', url: '' }]
    const menuTargetId = images.some(image => image.id === store.menuDocId)
      ? store.menuDocId
      : images[0].id

    images.forEach((image) => {
      const newDocRef = doc(collection(db, 'menu_images'))
      const data = {
        storeName: newName,
        phone: String(store.phone || '').trim(),
        address: String(store.address || '').trim(),
        category: store.category || 'lunch',
        url: String(image.url || '').trim(),
        timestamp: now,
        createdAt: now,
        menuUpdatedAt: now
      }
      if (image.id === menuTargetId && store.menuItems?.length > 0) {
        data.menuItems = store.menuItems
      }
      batch.set(newDocRef, data)
    })

    await batch.commit()
    showToast(`已複製為「${newName}」`)
  } catch (err) {
    showToast('複製失敗: ' + err.message, 'error')
  } finally {
    duplicatingStoreName.value = null
  }
}
// 記下開始編輯時的內容，用來判斷有沒有真的改過東西。
// 沒改就直接關掉，改過才問——每次取消都跳確認框只會被當成雜訊。
let editFormSnapshot = ''
const editFormFingerprint = () => JSON.stringify([editForm.category, editForm.name, editForm.phone, editForm.address])
const editIsDirty = () => editingStoreName.value !== null && editFormFingerprint() !== editFormSnapshot

const copyImageUrl = async (url) => {
  try { await navigator.clipboard.writeText(url); showToast('已複製菜單圖片網址') }
  catch { showToast('無法複製網址，請檢查瀏覽器權限', 'error') }
}

const startEdit = (store) => {
  editingStoreName.value = store.name
  Object.assign(editForm, { category: store.category, name: store.name, phone: store.phone, address: store.address })
  editFormSnapshot = editFormFingerprint()
}

const cancelEdit = async ({ force = false } = {}) => {
  if (!force && editIsDirty() && !await confirmDialog({
    title: '放棄這次編輯？',
    message: `「${editingStoreName.value}」的資料已經改過但還沒儲存。`,
    detail: '關掉之後改的內容就沒了。',
    variant: 'danger',
    confirmText: '放棄修改',
    cancelText: '繼續編輯',
  })) return false
  editingStoreName.value = null
  editFormSnapshot = ''
  return true
}

const saveEdit = async (menuItems = null) => {
  const store = editorStore.value
  const newName = editForm.name.trim()
  if (!newName) return (showToast('店家名稱不能為空', 'error'), false)
  if (newName !== store.name && groupedStores.value.some(item => item.name === newName)) return (showToast('店家名稱已存在', 'error'), false)
  try {
    const batch = writeBatch(db)
    const now = Date.now()
    store.docIds.forEach(id => batch.update(doc(db, 'menu_images', id), { storeName: newName, phone: editForm.phone.trim(), address: editForm.address.trim(), category: editForm.category, updatedAt: now }))
    if (menuItems !== null) batch.update(doc(db, 'menu_images', store.menuDocId || store.docIds[0]), { menuItems, menuUpdatedAt: now })
    await batch.commit()
    showToast('店家資料與菜單已儲存')
    editorStoreName.value = newName
    editingStoreName.value = newName
    editFormSnapshot = editFormFingerprint()
    return true
  } catch (err) { showToast('更新失敗: ' + err.message, 'error'); return false }
}

// 刪除一張菜單圖的紀錄（手動刪除與失效自動清理共用）。
// 店家只剩這一份文件時補一份無圖佔位，避免整間店連同品項一起消失；
// 品項掛在被刪的文件上時先搬到其他文件再刪。
const removeImageRecord = async (imgId, store) => {
  const image = store.images.find(item => item.id === imgId)
  const batch = writeBatch(db)
  if (store.docIds.length <= 1) {
    const placeholderRef = doc(collection(db, 'menu_images'))
    const now = Date.now()
    batch.set(placeholderRef, {
      storeName: store.name,
      phone: store.phone || '',
      address: store.address || '',
      category: store.category || 'lunch',
      url: '',
      storagePath: '',
      menuItems: store.menuItems || [],
      timestamp: now,
      createdAt: store.createdAtTs || now,
      menuUpdatedAt: now,
    })
  } else if (store.menuDocId === imgId && store.menuItems?.length > 0) {
    const targetDocId = store.docIds.find(id => id !== imgId)
    if (targetDocId) batch.update(doc(db, 'menu_images', targetDocId), { menuItems: store.menuItems })
  }
  batch.delete(doc(db, 'menu_images', imgId))
  await batch.commit()
  if (image?.url) failedImageUrls.value.delete(image.url)
  return deleteStoredImages(image ? [image] : [])
}

const deleteSingleImage = async (imgId, store) => {
  const broken = isBrokenImage(store.images.find(item => item.id === imgId))
  const confirmed = await confirmDialog({
    title: broken ? '刪除這張失效圖片？' : '刪除這頁菜單？',
    message: broken
      ? `「${store.name}」這張菜單圖片的連結已失效，將刪除此紀錄（餐點資料保留）。`
      : `將刪除「${store.name}」的這一頁菜單圖片。`,
    variant: 'danger',
    confirmText: '刪除',
  })
  if (!confirmed) return
  try {
    const failedDeletes = await removeImageRecord(imgId, store)
    showToast(failedDeletes ? '菜單資料已刪除，但 Storage 圖片清理失敗' : '已刪除該頁菜單', failedDeletes ? 'warning' : 'success')
  } catch (err) { showToast('刪除失敗: ' + err.message, 'error') }
}

const deleteWholeStore = async (store) => {
  const confirmed = await confirmDialog({
    title: '永久刪除店家？',
    message: `確定要永久刪除「${store.name}」嗎？`,
    detail: '將刪除此店家的全部菜單圖片與品項設定，不可復原。',
    variant: 'danger',
    confirmText: '永久刪除',
  })
  if (!confirmed) return
  try {
    const batch = writeBatch(db)
    store.docIds.forEach(id => batch.delete(doc(db, 'menu_images', id)))
    await batch.commit()
    const failedDeletes = await deleteStoredImages(store.images)
    showToast(failedDeletes ? `已刪除 ${store.name}，但有 ${failedDeletes} 張 Storage 圖片清理失敗` : `已刪除 ${store.name}`, failedDeletes ? 'warning' : 'success')
    if (editorStoreName.value === store.name) closeSmartEditor()
  } catch (err) { showToast('刪除失敗: ' + err.message, 'error') }
}

const performAddExtraImage = async ({ url, storagePath = '' }, store) => {
  const batch = writeBatch(db)
  const newDocRef = doc(collection(db, 'menu_images'))
  const now = Date.now()
  const newDocData = { storeName: store.name, phone: store.phone, address: store.address, category: store.category, url, storagePath, timestamp: now, createdAt: store.createdAtTs || now, menuUpdatedAt: now }
  const emptyImages = store.images.filter(img => !img.url || img.url.trim() === '')
  const menuItemsOnEmpty = store.menuItems?.length > 0 && emptyImages.some(img => img.id === store.menuDocId)
  if (menuItemsOnEmpty) newDocData.menuItems = store.menuItems
  batch.set(newDocRef, newDocData)
  emptyImages.forEach(img => batch.delete(doc(db, 'menu_images', img.id)))
  await batch.commit()
  showToast('圖片新增成功！')
}

const addExtraImageUrl = async (store) => {
  const url = await promptDialog({
    title: '新增菜單圖片',
    message: `為「${store.name}」貼上圖片直連網址。外站連結可能過期，長期使用建議改用「上傳圖片」。`,
    placeholder: 'https://…',
    confirmText: '新增',
  })
  if (url && url.trim() !== '') {
    try { await performAddExtraImage({ url: url.trim() }, store) }
    catch (err) { showToast('新增失敗: ' + err.message, 'error') }
  }
}

const triggerExtraImageUpload = (store) => { targetStoreForExtraImage.value = store; if (extraImageFileInput.value) extraImageFileInput.value.click() }

const handleExtraImageUpload = async (event) => {
  if (event.target.files.length === 0 || !targetStoreForExtraImage.value) return
  const file = event.target.files[0]
  if (file.size > MAX_FILE_SIZE_BYTES) { event.target.value = ''; return showToast('圖片超過 2MB', 'error') }
  showToast('圖片上傳中，請稍候...')
  let uploaded = null
  try {
    uploaded = await uploadFileToStorage(file)
    await performAddExtraImage(uploaded, targetStoreForExtraImage.value)
  } catch (error) {
    if (uploaded) await deleteStoredImages([uploaded])
    showToast('上傳失敗: ' + error.message, 'error')
  }
  finally { event.target.value = ''; targetStoreForExtraImage.value = null }
}

// 原本會無聲丟掉編輯中的表單。改成走同一套 dirty 檢查：沒改就直接開，
// 改過就先問，使用者選「繼續編輯」的話智慧菜單不會開起來。
const openSmartEditor = async (store, imageId = null) => {
  if (!await cancelEdit()) return
  startEdit(store)
  editorDocumentId.value = store.docIds[0]
  editorStoreName.value = store.name
  editorInitialImageId.value = imageId
}
const closeSmartEditor = () => { editorStoreName.value = null; editorDocumentId.value = null; editorInitialImageId.value = null; editingStoreName.value = null; editFormSnapshot = '' }

onMounted(() => {
  syncFullMenuRequest(true)
  restorePanelPosition()
})
onActivated(() => {
  syncFullMenuRequest(true)
  shouldRestorePanelPosition.value = true
  restorePanelPosition()
})
onDeactivated(() => {
  rememberPanelPosition()
  syncFullMenuRequest(false)
})
onBeforeUnmount(() => {
  rememberPanelPosition()
  syncFullMenuRequest(false)
})
watch(filteredStores, restorePanelPosition, { flush: 'post' })
</script>
<style scoped>



/* .btn / .btn-primary / .btn-secondary / .btn-danger 等共用按鈕樣式已移至 src/assets/components.css */

.quick-add-section { background:var(--bg-card); padding:20px 24px; margin-bottom:20px; }
.section-label { display:flex; align-items:center; gap:8px; font-weight:800; color:var(--text-primary); font-size: var(--text-body); margin-bottom:16px; }
.section-label i { color:var(--accent); }
.quick-add-grid { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
.form-item label { display:block; font-size: var(--text-micro); font-weight:700; color:var(--muted); margin-bottom:6px; }
.form-item input, .form-item select, .edit-input { width:100%; padding:9px 12px; border:1px solid var(--input-border); border-radius:var(--r-md); font-size: var(--text-label); background:var(--input-bg); color:var(--text-primary); font-weight:600; transition:border-color 0.15s, box-shadow 0.15s; }
.form-item input:focus, .form-item select:focus, .edit-input:focus { border-color:var(--accent); box-shadow:0 0 0 3px var(--input-focus-ring); outline:none; }
.file-input-group { display:flex; gap:8px; align-items:center; }
.file-action-box { display:flex; flex-direction:column; border:1px solid var(--input-border); border-radius:var(--r-md); overflow:hidden; width:46px; height:46px; flex-shrink:0; background:var(--bg-inset); }
.fab-btn { flex:1; border:none; background:transparent; color:var(--muted); font-size: var(--text-label); cursor:pointer; transition:all 0.15s; display:flex; align-items:center; justify-content:center; }
.fab-btn:hover { background:var(--bg-accent); color:var(--text-accent); }
.fab-btn:first-child { border-bottom:1px solid var(--input-border); }
.file-status { font-size: var(--text-micro); font-weight:600; color:var(--muted); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.btn-item { display:flex; align-items:flex-end; }
.btn-add { height:44px; padding:0 20px; }

/* ── 工具列（設計稿 3） ── */
.panel-toolbar {
  display:flex; flex-direction:column; gap:10px;
  margin-bottom:16px;
}
.toolbar-top { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.toolbar-top-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.toolbar-stats { color:var(--muted); font-size:var(--text-label); font-weight:700; }
.stats-dot { margin:0 2px; }
.toolbar-controls { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.toolbar-select {
  padding:8px 10px; border:1px solid var(--input-border); border-radius:var(--r-md);
  background:var(--input-bg); color:var(--text-primary); font-size:var(--text-label); font-weight:700;
}
.toolbar-select:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--input-focus-ring); }
.sort-dir-btn {
  width:36px; height:36px; border:1px solid var(--input-border); border-radius:var(--r-md);
  background:var(--input-bg); color:var(--muted); display:inline-flex; align-items:center; justify-content:center;
  transition:all 0.15s;
}
.sort-dir-btn:hover { border-color:var(--accent); color:var(--text-accent); }
.add-store-btn { display:inline-flex; align-items:center; gap:6px; padding:9px 16px; border-radius:var(--r-md); }

/* 篩選／排序收合按鈕：預設收合，展開時下方帶出 .toolbar-controls */
.filter-toggle-btn {
  display:inline-flex; align-items:center; gap:7px;
  padding:8px 12px; border:1px solid var(--input-border); border-radius:var(--r-md);
  background:var(--input-bg); color:var(--text-secondary); font-size:var(--text-label); font-weight:700;
  transition:border-color 0.15s, color 0.15s, background 0.15s;
}
/* hover 只提一階，強調色（柿橘）保留給「已選取」，兩者才分得開 */
.filter-toggle-btn:hover { border-color:var(--border-strong); }
.filter-toggle-btn.active { border-color:var(--accent); color:var(--text-accent); background:var(--bg-accent); }
.filter-count-badge {
  display:inline-flex; align-items:center; justify-content:center;
  min-width:18px; height:18px; padding:0 5px; border-radius:999px;
  background:var(--accent-solid); color:var(--text-on-accent); font-size:var(--text-micro); font-weight:800;
}
.filter-chevron { font-size: var(--text-micro); transition:transform 0.15s; }
.filter-chevron.open { transform:rotate(180deg); }

/* 桌機：工具列固定於 TopHeader 下方，捲動長清單時仍可篩選/排序/新增 */
@media (min-width: 769px) {
  .panel-toolbar {
    position:sticky; top:var(--header-height); z-index:20;
    background:var(--bg-inset);
    padding:12px 0; margin-bottom:8px;
    border-bottom:1px solid var(--border);
  }
}

/* ── 店家清單：手機／平板為卡片網格，桌機（≥769px）為條列式 ── */
.store-grid {
  /* min(320px, 100%)：窄螢幕退成單欄不撐出橫向捲動 */
  grid-template-columns:repeat(auto-fill, minmax(min(320px, 100%), 1fr));
}

.grid-empty {
  padding:48px 24px; text-align:center; color:var(--muted); font-weight:700;
  border:1.5px dashed var(--border-strong); border-radius:var(--r-lg); background:var(--bg-card);
}

.store-card {
  min-width:0;
  display:flex; flex-direction:column; gap:12px;
  transition:border-color 0.15s, box-shadow 0.15s;
}
.store-card:hover { border-color:var(--border-strong); }
/* 開放中：淡色底＋左側 accent 色條，讓「今天哪幾間開了」在網格中一眼跳出 */
.store-card.open {
  border-color:var(--border-accent);
}
.store-card.editing { border-color:color-mix(in srgb, var(--highlight) 45%, transparent); }

.store-avatar { flex-shrink:0;
  font-family:var(--font-display); font-weight:800;
  display:inline-flex; align-items:center; justify-content:center;
}

.card-name {
  margin:0; max-width:100%;
  color:var(--text-primary); font-size:var(--text-lead); line-height:1.25;
  overflow:hidden; text-overflow:ellipsis;
}

.cat-badge { display:inline-block; border-radius:999px; font-size: var(--text-micro); }
.badge-lunch { background:var(--tag-lunch-bg); color:var(--tag-lunch-text); }
.badge-drink { background:var(--tag-drink-bg); color:var(--tag-drink-text); }

.open-label { font-size:var(--text-micro); font-weight:700; }
.open-toggle {
  position:relative; width:44px; height:24px; padding:0;
  border:none; border-radius:999px;
  background:var(--border-strong);
  transition:background 0.18s;
}
.open-toggle:disabled { opacity:0.6; cursor:wait; }
.toggle-knob {
  position:absolute; top:3px; left:3px;
  width:18px; height:18px; border-radius:50%; box-shadow:0 1px 3px color-mix(in srgb, var(--ink) 25%, transparent);
  transition:transform 0.18s;
}
.open-toggle[aria-checked="true"] .toggle-knob { transform:translateX(20px); }

.meta-item {
  min-width:0; display:flex; align-items:center; gap:7px;
  color:var(--text-secondary); font-size:var(--text-label); font-weight:600;
}
.meta-item i { color:var(--muted); font-size:var(--text-label); flex-shrink:0; }

.meta-address { max-width:100%; }


.images-label { font-size:var(--text-micro); font-weight:700; }
.images-updated { font-weight:600; }
.images-strip {
  display:flex; align-items:center; gap:6px;
  overflow-x:auto; overflow-y:hidden;
  scrollbar-width:thin;
  scrollbar-color: var(--border-strong) transparent;
}
.images-none { font-size:var(--text-micro); font-weight:600; }

/* 卡片動作列 */
.card-actions { margin-top:auto; display:flex; align-items:center; gap:8px; }
.card-btn {
  flex:1; min-width:0;
  display:inline-flex; align-items:center; justify-content:center; gap:7px;
  white-space:nowrap;
  transition:background 0.15s, color 0.15s;
}

/* 檢視菜單按鈕上的餐點數量徽章：底色取按鈕文字色的半透明，深淺主題都可讀 */
.menu-count-badge {
  min-width:20px;
  border-radius:999px;
  font-size:var(--text-micro); font-weight:800; line-height:1.5;
  text-align:center;
}




/* 卡片編輯模式 */
.card-edit-form { display:flex; flex-direction:column; gap:10px; }
.edit-field label { display:block; font-size:var(--text-micro); font-weight:700; color:var(--muted); margin-bottom:5px; }

.img-thumb { position:relative; overflow:hidden; border:1px solid var(--border-strong); background:var(--bg-inset); flex-shrink:0; transition:all 0.15s; }
.img-thumb:hover { border-color:var(--accent); }
.img-thumb img { width:100%; height:100%; object-fit:cover; cursor:zoom-in; transition:transform 0.3s; }
.img-invalid { width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-danger); font-size: var(--text-micro); font-weight:700; }
/* 連結失效的縮圖：紅色虛線框＋常駐刪除鈕，壞連結一眼看得到、一鍵刪得掉 */
.img-thumb.is-broken, .img-thumb.is-broken:hover { border:1px dashed var(--danger); background:var(--bg-danger); }
.img-thumb.is-broken .img-invalid { background: transparent; }
.del-img-btn { position:absolute; top:0; right:0; background:var(--paprika); color:var(--paper); border:none; width:16px; height:16px; display:flex; align-items:center; justify-content:center; font-size: var(--text-micro); cursor:pointer; opacity:0; transition:opacity 0.2s; }
.img-thumb:hover .del-img-btn, .img-thumb.is-broken .del-img-btn { opacity:1; }
/* 縮圖列尾端的新增磚：與縮圖等高，上「貼上網址」下「上傳」兩顆疊放 */
.img-add-box { display:flex; flex-direction:column; flex-shrink:0; overflow:hidden; }
.img-add-btn { flex:1; border:none; background:transparent; font-size:var(--text-micro); display:flex; align-items:center; justify-content:center; cursor:pointer; transition:background 0.15s, color 0.15s; }


/* 編輯模式在寬螢幕把表單橫向攤平占滿整列；檢視模式的列型由檔尾的覆寫區塊定義 */
@media (min-width: 1280px) {
  .card-edit-form { grid-column:1 / -1; flex-direction:row; flex-wrap:wrap; align-items:flex-end; gap:12px; }
  .card-edit-form .edit-field { flex:1 1 150px; min-width:130px; }
  .card-edit-form .card-actions { flex:0 0 auto; }
}

/* ═══ 列型：頭像｜縮圖｜兩行文字｜三個動作 ═══
   原本一列裝五欄、列高約 108px，中間欄只有兩行短字卻拿到最多空間，
   右邊五個同等重量的控制項擠成一排。改成兩行資訊，菜單圖片管理收進
   縮圖展開的抽屜，編輯／複製／刪除收進 ⋯ —— 設定時才用得到的東西
   不該讓每一列都付出高度。列高約 66px，一次看得到的店家數幾乎翻倍。 */
.store-grid { display: flex; flex-direction: column; gap: 0; background: var(--ink-2); border-block: 1px solid var(--line); }
.store-card,
.store-card.open,
.store-card:hover,
.store-card.open:hover {
  display: grid;
  /* 明確寫死頭像與縮圖的寬度。用 auto 的時候，首字是全形或半形、
     有沒有圖片都會讓那一欄差個幾 px，整份清單的文字起點就跟著抖。 */
  grid-template-columns: 30px 40px minmax(0, 1fr) auto;
  align-items: center;
  min-height: 66px;
  gap: 0 12px;
  background: transparent; box-shadow: none;
  border: 0; border-bottom: 1px solid var(--line); border-left: 3px solid transparent;
  border-radius: 0; padding: 12px 16px;
}
.store-card.open, .store-card.open:hover { border-left-color: var(--jade); }
.store-card:hover { background: var(--ink-3); }
.store-card.editing { background: var(--ink-3); display: flex; flex-direction: column; align-items: stretch; }
.store-card:last-child { border-bottom: 0; }
.panel-toolbar { background: var(--ink); }

/* 首字方塊：每間店固定一個顏色。原本被 !important 壓成同一顆灰，
   80 間店長得一模一樣，那 30px 等於只是佔位。 */
/* 原本是「把色票當文字色、底色只鋪 22%」，那是為淺底設計的寫法；
   這一列坐在 --ink-2 深底上，深色的字配深色的底等於看不見。
   改成跟成員名單、今日訂單一致：實色底＋米白字（色票本來就是照這個條件挑的）。 */
.store-avatar {
  width: 30px; height: 30px; flex-shrink: 0;
  color: var(--paper);
  border-radius: 5px;
  font-family: var(--font-display); font-weight: 600; font-size: var(--text-lead);
  display: inline-flex; align-items: center; justify-content: center;
}

/* 縮圖入口：點了展開圖片抽屜 */
.row-thumb {
  position: relative;
  width: 40px; height: 40px; flex-shrink: 0; padding: 0;
  border: 1px solid var(--line); border-radius: 4px;
  background: var(--ink-3); overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center;
  transition: border-color 0.15s;
}
.row-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.row-thumb:hover, .row-thumb.is-open { border-color: color-mix(in srgb, var(--paper) 40%, transparent); }
.row-thumb.is-empty { border-style: dashed; background: transparent; }
.row-thumb-add { color: var(--ink-soft); font-size: var(--text-lead); line-height: 1; }
.row-thumb-count {
  position: absolute; right: -1px; bottom: -1px;
  min-width: 16px; height: 15px; padding: 0 3px;
  border-radius: 3px 0 0 0;
  background: var(--ink); color: var(--paper);
  font-size: var(--text-micro); font-weight: 700; line-height: 15px; text-align: center;
}

/* 兩行共用同一組軌道：店名對電話、今日開放對地址、午餐對菜單日期。
   原本兩行都是 flex，文字有多長、badge 要不要顯示，後面的東西就跟著
   平移，每一列的斷點都不一樣，掃過去像沒對齊的抄寫稿。 */
.row-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.row-line1,
.row-line2 {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr) 116px;
  align-items: center;
  gap: 0 14px;
  min-width: 0;
}
.row-cell { min-width: 0; display: flex; align-items: center; }
.row-cell-end { justify-content: flex-end; }
.card-name {
  margin: 0; min-width: 0; max-width: 100%;
  font-family: var(--font-display); font-weight: 600; font-size: var(--text-body);
  color: var(--paper); line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 午餐／飲料原本被壓成店名下面一行灰字，跟其他 meta 分不出來 */
.cat-badge {
  display: inline-block; padding: 2px 9px; border-radius: 999px;
  font-size: var(--text-micro); font-weight: 700; flex-shrink: 0;
  background: color-mix(in srgb, var(--paper) 10%, transparent);
}
/* 改吃 .ops-surface 上的餐別 token，不再自己寫死 hex */
.badge-lunch { color: var(--tag-lunch-text); }
.badge-drink { color: var(--tag-drink-text); }
.today-flag {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
  font-size: var(--text-micro); font-weight: 700; color: var(--jade-light);
}
.today-flag::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--jade-light); }

.row-line2 { color: var(--ink-soft); font-size: var(--text-label); }
.row-line2 .meta-item {
  display: block; min-width: 0; max-width: 100%;
  color: inherit; font-size: inherit; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.row-line2 .meta-menu { text-align: right; font-variant-numeric: tabular-nums; }
/* 沒填的欄位留在原位淡掉，不要整個消失把後面的東西往前拉 */
.row-line2 .is-blank { opacity: 0.5; }

/* 右側三個控制項也各給一條軌道，切換鈕與 ⋯ 才會上下對齊；
   「檢視菜單」的品項數 badge 會讓按鈕寬度每列不同，所以給它最小寬度。 */
.card-actions {
  display: grid; grid-template-columns: 44px minmax(112px, auto) 30px;
  align-items: center; gap: 10px; flex-shrink: 0; margin: 0;
}
.card-actions .card-btn.primary { justify-content: center; }

.card-btn {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 14px; border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: var(--ink-soft);
  font-size: var(--text-label); font-weight: 500; white-space: nowrap;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.card-btn:hover { background: color-mix(in srgb, var(--paper) 9%, transparent); color: var(--paper); }
.card-btn.primary {
  background: color-mix(in srgb, var(--paper) 8%, transparent);
  color: var(--paper); border-color: var(--line); font-weight: 600;
}
.card-btn.primary:hover {
  background: color-mix(in srgb, var(--paper) 16%, transparent);
  border-color: color-mix(in srgb, var(--paper) 34%, transparent);
}
.menu-count-badge { background: transparent; color: var(--ink-soft); padding: 0; min-width: 0; font-weight: 500; }

/* 更多操作：刪除不該跟日常動作並排，收進這裡降低誤點 */
.row-more { position: relative; flex-shrink: 0; }
.more-btn {
  width: 30px; height: 30px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--ink-soft); font-size: var(--text-body);
  transition: background 0.15s, color 0.15s;
}
.more-btn:hover, .more-btn.is-open { background: color-mix(in srgb, var(--paper) 12%, transparent); color: var(--paper); }
.more-menu {
  position: absolute; top: calc(100% + 6px); right: 0;
  z-index: var(--z-popover);
  min-width: 168px; padding: 5px;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--ink-3);
  box-shadow: var(--shadow-modal);
  display: flex; flex-direction: column; gap: 1px;
}
.more-menu button {
  display: flex; align-items: center; gap: 9px;
  padding: 9px 11px; border-radius: 5px;
  background: transparent; color: var(--paper);
  font-size: var(--text-label); font-weight: 500; text-align: left; white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.more-menu button i { width: 14px; text-align: center; color: var(--ink-soft); }
.more-menu button:hover:not(:disabled) { background: color-mix(in srgb, var(--paper) 10%, transparent); }
.more-menu button:disabled { opacity: 0.45; cursor: not-allowed; }
.more-menu button.danger, .more-menu button.danger i { color: var(--persimmon-light); }
.more-menu button.danger:hover, .more-menu button.danger:hover i { background: color-mix(in srgb, var(--persimmon) 26%, transparent); color: var(--paper); }
.more-sep { height: 1px; margin: 4px 6px; background: var(--line); }

/* 菜單圖片抽屜：預設收起 */
.image-tray {
  grid-column: 1 / -1;
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px;
  margin-top: 12px; padding: 12px;
  border: 1px dashed var(--line); border-radius: 6px;
  background: color-mix(in srgb, var(--ink) 55%, transparent);
}
.images-label { color: var(--ink-soft); font-size: var(--text-micro); font-weight: 700; }
.images-count { color: var(--paper); }
.images-updated { color: var(--ink-soft); font-weight: 500; }
.images-none { color: var(--ink-soft); font-size: var(--text-micro); font-weight: 600; }
.images-strip { display: flex; align-items: center; gap: 8px; overflow-x: auto; height: auto; padding-bottom: 2px; }
.img-thumb { width: 44px; height: 44px; border-radius: 3px; border: 1px solid var(--line); }
.img-thumb.is-broken, .img-thumb.is-broken:hover { border: 1px dashed var(--danger); background: var(--bg-danger); }
.img-thumb.is-broken .img-invalid { background: transparent; }
.img-add-box {
  display: flex; flex-direction: column; width: 34px; height: 44px; flex-shrink: 0;
  border: 1px dashed color-mix(in srgb, var(--paper) 22%, transparent);
  border-radius: 3px; background: transparent; overflow: hidden;
}
.img-add-btn { flex: 1; display: flex; align-items: center; justify-content: center; background: transparent; color: var(--ink-soft); font-size: var(--text-micro); }
.img-add-btn:first-child { border-bottom: 1px dashed color-mix(in srgb, var(--paper) 22%, transparent); }
.img-add-btn:hover { background: color-mix(in srgb, var(--paper) 10%, transparent); color: var(--paper); }

.open-toggle[aria-checked="true"] { background: var(--jade); }
.toggle-knob { background: var(--paper); }
.quick-add-section { border: 0; border-radius: 4px; box-shadow: none; }
.store-card.editing .card-edit-form { width: 100%; }

@media (max-width: 1100px) {
  .store-card, .store-card.open, .store-card:hover, .store-card.open:hover { gap: 0 10px; padding: 12px; }
  .row-line1, .row-line2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 104px; gap: 0 10px; }
  .row-line2 { font-size: var(--text-micro); }
  .card-actions { grid-template-columns: 44px minmax(96px, auto) 30px; }
  .card-btn.primary { padding: 7px 11px; }
}
@media (max-width: 820px) {
  .store-card, .store-card.open, .store-card:hover, .store-card.open:hover {
    grid-template-columns: 30px 40px minmax(0, 1fr);
    row-gap: 10px;
  }
  .card-actions { grid-column: 1 / -1; justify-self: end; }
  /* 這個寬度放不下三欄，地址先收起來；剩下的左右兩端仍然各自成一條線 */
  .row-line1, .row-line2 { grid-template-columns: minmax(0, 1fr) auto auto; gap: 0 10px; }
  .row-line2 .row-cell-mid { display: none; }
}
</style>

<style scoped>
.edit-images { width:100%; }
.store-edit-actions { display:flex; justify-content:flex-end; gap:10px; width:100%; margin-top:12px; }
.edit-images .img-add-btn { color:var(--ink); }
.edit-images h3 { margin: 8px 0; font-size:var(--text-label); }
.edit-image-hint { color:var(--muted); font-size:var(--text-micro); margin-bottom:12px; }
.img-copy-btn { position:absolute; bottom:0; left:0; border:0; border-radius:4px; background:var(--input-bg); color:var(--text-primary); cursor:pointer; }
</style>

<style scoped>
.store-details-form { display:grid; grid-template-columns:100px minmax(0,1fr) minmax(120px, .8fr); gap:8px 10px; padding:12px 16px; background:var(--paper); color:var(--ink); }
.store-details-form .edit-field:nth-child(4) { grid-column:1 / -1; }
.store-details-form .edit-input { padding:6px 8px; font-size:13px; color:var(--ink); background:var(--paper-2); border-color:var(--muted-line); }
.store-details-form .edit-field label { margin-bottom:3px; font-size:12px; }
.store-details-form .edit-images { grid-column:1 / -1; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.store-details-form .edit-images h3 { font-size:12px; margin:0; }
.store-details-form .edit-image-hint { font-size:11px; margin:0; order:3; width:100%; }
.store-details-form .img-thumb { width:32px; height:32px; }
.store-details-form .images-strip { flex:1; }
.store-details-form .store-edit-actions { grid-column:1 / -1; margin:0; justify-content:flex-start; flex-wrap:wrap; }
.store-details-form .btn { padding:6px 10px; font-size:12px; min-height:32px; }
.store-details-form .btn-secondary { color:var(--ink); background:var(--paper-2); border:1px solid var(--muted-line); }
.store-details-form .img-copy-btn { color:var(--ink); background:var(--paper); }
.store-details-form .store-delete-btn { margin-left:auto; color:var(--text-danger); border:1px solid var(--border-strong); }
@media (max-width:600px) { .store-details-form { grid-template-columns:80px minmax(0,1fr); } .store-details-form .edit-field:nth-child(3) { grid-column:1 / -1; } }
</style>

<style scoped>
.store-edit-actions { width:auto; margin:0 14px 0 auto; flex-wrap:wrap; align-items:center; }
.store-action-divider { color:var(--muted); }
.store-edit-actions .btn { padding:7px 12px; font-size:13px; }
.store-edit-actions .btn-secondary { color:var(--ink); background:var(--paper-2); border:1px solid var(--muted-line); }
.store-edit-actions .store-delete-btn { color:var(--persimmon-dark); border:1px solid var(--muted-line); }
@media(max-width:600px) { .store-edit-actions { margin:4px 0; gap:6px; } }
</style>

<style scoped>
.image-toolbar-btn { width:32px; height:32px; flex-shrink:0; border:0; border-radius:50%; background:transparent; color:var(--paper); display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
.image-toolbar-btn:hover { background:rgb(255 255 255 / 15%); }
.image-toolbar-btn:disabled { opacity:.35; cursor:default; }
.image-action-divider { height:20px; border-left:1px solid rgb(255 255 255 / 20%); margin:0 3px; }
@media(max-width:768px) { .image-toolbar-btn { width:36px; height:36px; } }
</style>
