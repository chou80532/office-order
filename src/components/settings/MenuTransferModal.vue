<script setup>
import { computed, ref, useId } from 'vue'
import { collection, doc, writeBatch } from 'firebase/firestore'
import { db } from '../../firestore'
import { useFirestore } from '../../composables/useFirestore'
import { useToast } from '../../composables/useToast'
import { useModalA11y } from '../../composables/useModalA11y'
import { useScrollLock } from '../../composables/useScrollLock'
import { formatMoney, getAppCurrency, getLocalDateKey, toMinorUnits } from '../../utils/format'
import { buildMenuCsv, buildMenuJson, parseMenuFile } from '../../utils/menuTransfer'
import { MAX_FILE_SIZE_BYTES } from '../../constants'
import { t, translateError } from '../../i18n'

// 由父元件以 v-if 控制開關；stores 是 StoreManagementPanel 依店名合併後的資料。
const props = defineProps({ stores: { type: Array, default: () => [] } })
const emit = defineEmits(['close'])

const { systemSettings } = useFirestore()
const { showToast } = useToast()
const id = useId()
const dialog = ref(null)
const fileInput = ref(null)
useModalA11y(dialog, { onEscape: () => { if (!importing.value) emit('close') } })
useScrollLock(ref(true))

const MAX_SHOWN_ERRORS = 8
const BATCH_LIMIT = 400
const maxItemPrice = computed(() => systemSettings.value?.limits?.maxItemPrice || 10_000)
const priceExample = computed(() => formatMoney(toMinorUnits(getAppCurrency().decimals ? 12.5 : 110)))

// ── 匯出 ────────────────────────────────────────────────────────────
function download(content, fileName, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportJson() {
  download(buildMenuJson(props.stores, { currency: getAppCurrency().code }), t('menuTransfer.fileNameJson', { date: getLocalDateKey() }), 'application/json')
  showToast(t('menuTransfer.exported', { count: props.stores.length }), 'success')
}

function exportCsv() {
  download(buildMenuCsv(props.stores), t('menuTransfer.fileNameCsv', { date: getLocalDateKey() }), 'text/csv;charset=utf-8')
  showToast(t('menuTransfer.exported', { count: props.stores.length }), 'success')
}

// ── 匯入 ────────────────────────────────────────────────────────────
const fileName = ref('')
const parsedStores = ref([])
const parseErrors = ref([])
const selectedNames = ref(new Set())
const existingMode = ref('replace')
const importing = ref(false)

const existingByName = computed(() => new Map(props.stores.map(store => [store.name, store])))
const isExisting = store => existingByName.value.has(store.name)
const selectedStores = computed(() => parsedStores.value.filter(store =>
  selectedNames.value.has(store.name) && (existingMode.value === 'replace' || !isExisting(store))))
const allSelected = computed(() => parsedStores.value.length > 0 && parsedStores.value.every(store => selectedNames.value.has(store.name)))

function toggleStore(name) {
  const next = new Set(selectedNames.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  selectedNames.value = next
}

function toggleAll() {
  selectedNames.value = allSelected.value ? new Set() : new Set(parsedStores.value.map(store => store.name))
}

async function onFileChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (file.size > MAX_FILE_SIZE_BYTES) { showToast(t('menuTransfer.fileTooLarge'), 'error'); return }
  let source
  try { source = await file.text() } catch { showToast(t('menuTransfer.readFailed'), 'error'); return }
  const result = parseMenuFile(source, { fileName: file.name, currency: getAppCurrency().code, maxPrice: maxItemPrice.value })
  fileName.value = file.name
  parseErrors.value = result.errors
  parsedStores.value = result.errors.length ? [] : result.stores
  selectedNames.value = new Set(parsedStores.value.map(store => store.name))
}

async function runImport() {
  if (importing.value || !selectedStores.value.length) return
  importing.value = true
  const now = Date.now()
  const operations = []
  let created = 0
  let updated = 0
  for (const store of selectedStores.value) {
    const existing = existingByName.value.get(store.name)
    if (existing) {
      const targetId = existing.menuDocId || existing.docIds[0]
      const details = {}
      if (!existing.phone && store.phone) details.phone = store.phone
      if (!existing.address && store.address) details.address = store.address
      operations.push(batch => batch.update(doc(db, 'menu_images', targetId), { menuItems: store.menuItems, menuUpdatedAt: now, ...details }))
      updated += 1
      continue
    }
    // 新店家：每張圖片一份文件（沒有圖片就建一份空白佔位），品項掛在第一份。
    const images = store.images.length ? store.images : ['']
    images.forEach((url, index) => {
      const data = {
        storeName: store.name,
        phone: store.phone,
        address: store.address,
        category: store.category,
        url,
        storagePath: '',
        timestamp: now,
        createdAt: now,
        menuUpdatedAt: now,
      }
      if (index === 0) data.menuItems = store.menuItems
      operations.push(batch => batch.set(doc(collection(db, 'menu_images')), data))
    })
    created += 1
  }
  try {
    for (let start = 0; start < operations.length; start += BATCH_LIMIT) {
      const batch = writeBatch(db)
      operations.slice(start, start + BATCH_LIMIT).forEach(apply => apply(batch))
      await batch.commit()
    }
    showToast(t('menuTransfer.imported', { created, updated }), 'success')
    parsedStores.value = []
    fileName.value = ''
  } catch (error) {
    showToast(t('menuTransfer.importFailed', { message: translateError(error) }), 'error')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="transfer-overlay" @click.self="!importing && emit('close')">
      <div ref="dialog" class="transfer-modal" role="dialog" aria-modal="true" :aria-labelledby="`${id}-title`" tabindex="-1">
        <div class="transfer-header">
          <span class="head-icon" aria-hidden="true"><i class="fas fa-file-export"></i></span>
          <div class="head-text">
            <h3 :id="`${id}-title`" class="transfer-title">{{ t('menuTransfer.title') }}</h3>
            <p class="transfer-sub">{{ t('menuTransfer.subtitle') }}</p>
          </div>
          <button type="button" class="transfer-close" :aria-label="t('common.close')" :disabled="importing" @click="emit('close')">×</button>
        </div>

        <div class="transfer-body">
          <section class="transfer-section">
            <h4>{{ t('menuTransfer.exportTitle') }}</h4>
            <p class="sys-hint">{{ t('menuTransfer.exportDesc', { count: stores.length }) }}</p>
            <div class="transfer-actions">
              <button type="button" class="btn btn-secondary" :disabled="!stores.length" @click="exportJson"><i class="fas fa-download" aria-hidden="true"></i> {{ t('menuTransfer.exportJson') }}</button>
              <button type="button" class="btn btn-secondary" :disabled="!stores.length" @click="exportCsv"><i class="fas fa-file-csv" aria-hidden="true"></i> {{ t('menuTransfer.exportCsv') }}</button>
            </div>
          </section>

          <section class="transfer-section">
            <h4>{{ t('menuTransfer.importTitle') }}</h4>
            <p class="sys-hint">{{ t('menuTransfer.importDesc', { example: priceExample }) }}</p>
            <div class="transfer-actions">
              <button type="button" class="btn btn-secondary" :disabled="importing" @click="fileInput?.click()"><i class="fas fa-upload" aria-hidden="true"></i> {{ t('menuTransfer.chooseFile') }}</button>
              <input ref="fileInput" type="file" accept=".json,.csv,application/json,text/csv" hidden @change="onFileChange">
            </div>

            <div v-if="parseErrors.length" class="transfer-errors" role="alert">
              <p>{{ t('menuTransfer.errorsTitle', { count: parseErrors.length }) }}</p>
              <ul>
                <li v-for="message in parseErrors.slice(0, MAX_SHOWN_ERRORS)" :key="message">{{ message }}</li>
              </ul>
              <p v-if="parseErrors.length > MAX_SHOWN_ERRORS">{{ t('menuTransfer.moreErrors', { count: parseErrors.length - MAX_SHOWN_ERRORS }) }}</p>
            </div>

            <template v-if="parsedStores.length">
              <div class="preview-head">
                <strong>{{ t('menuTransfer.previewTitle', { file: fileName }) }}</strong>
                <label class="preview-all"><input type="checkbox" :checked="allSelected" @change="toggleAll"> {{ t('menuTransfer.selectAll') }}</label>
              </div>
              <ul class="preview-list">
                <li v-for="store in parsedStores" :key="store.name" :class="{ muted: isExisting(store) && existingMode === 'skip' }">
                  <label>
                    <input type="checkbox" :checked="selectedNames.has(store.name)" :disabled="importing" @change="toggleStore(store.name)">
                    <span class="preview-name">{{ store.name }}</span>
                    <span :class="['preview-badge', isExisting(store) ? 'existing' : 'new']">{{ isExisting(store) ? t('menuTransfer.existingStore') : t('menuTransfer.newStore') }}</span>
                    <span class="preview-meta">{{ t('menuTransfer.itemCount', { count: store.menuItems.length }) }}<template v-if="store.images.length"> · {{ t('menuTransfer.imageCount', { count: store.images.length }) }}</template></span>
                  </label>
                </li>
              </ul>
              <fieldset v-if="parsedStores.some(isExisting)" class="existing-mode">
                <legend>{{ t('menuTransfer.existingMode') }}</legend>
                <label><input v-model="existingMode" type="radio" value="replace"> {{ t('menuTransfer.replaceMenu') }}</label>
                <label><input v-model="existingMode" type="radio" value="skip"> {{ t('menuTransfer.skipExisting') }}</label>
                <p class="sys-hint">{{ t('menuTransfer.existingHint') }}</p>
              </fieldset>
              <div class="transfer-actions end">
                <button type="button" class="btn btn-primary" :disabled="importing || !selectedStores.length" @click="runImport">
                  <span v-if="importing" class="mini-spinner"></span>
                  {{ importing ? t('menuTransfer.importing') : t('menuTransfer.importSelected', { count: selectedStores.length }) }}
                </button>
              </div>
            </template>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.transfer-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in srgb, var(--ink) 55%, transparent);
}
.transfer-modal {
  width: 100%;
  max-width: 560px;
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  border-radius: var(--r-xl);
  border-top: 3px solid var(--persimmon);
  background: var(--paper);
  box-shadow: var(--shadow-modal);
}
.transfer-modal:focus { outline: none; }
.transfer-header { display: flex; align-items: flex-start; gap: 12px; padding: 20px 20px 8px; }
.head-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--r-md);
  background: var(--bg-accent);
  color: var(--text-accent);
}
.head-text { flex: 1; min-width: 0; }
.transfer-title { margin: 0; font-family: var(--font-display); font-size: var(--text-lead); color: var(--ink); }
.transfer-sub { margin-top: 2px; font-size: var(--text-label); color: var(--muted); }
.transfer-close { padding: 0 4px; font-size: 22px; line-height: 1; color: var(--muted); background: none; }
.transfer-close:hover { color: var(--ink); }
.transfer-body { display: flex; flex-direction: column; gap: 14px; padding: 8px 20px 22px; }
.transfer-section { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 1px solid var(--border); border-radius: var(--r-lg); }
.transfer-section h4 { margin: 0; font-size: var(--text-body); color: var(--ink); }
.transfer-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.transfer-actions.end { justify-content: flex-end; }
.transfer-errors { padding: 10px 12px; border-radius: var(--r-md); background: var(--bg-danger, color-mix(in srgb, var(--brick) 10%, var(--paper))); color: var(--brick); font-size: var(--text-label); }
.transfer-errors ul { margin: 6px 0; padding-left: 18px; }
.preview-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: var(--text-label); }
.preview-all { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); white-space: nowrap; }
.preview-list { display: flex; flex-direction: column; gap: 4px; max-height: 240px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.preview-list li label { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--r-md); cursor: pointer; }
.preview-list li label:hover { background: var(--bg-2, var(--paper-2)); }
.preview-list li.muted { opacity: 0.55; }
.preview-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--ink); }
.preview-badge { padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.preview-badge.new { background: var(--bg-accent); color: var(--text-accent); }
.preview-badge.existing { background: color-mix(in srgb, var(--gold) 18%, transparent); color: var(--ink); }
.preview-meta { font-size: 12px; color: var(--muted); white-space: nowrap; }
.existing-mode { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 10px 12px; border: 1px dashed var(--border); border-radius: var(--r-md); font-size: var(--text-label); }
.existing-mode legend { padding: 0 4px; font-weight: 700; color: var(--ink); }
.existing-mode label { display: inline-flex; align-items: center; gap: 6px; }
@media (max-width: 520px) {
  .preview-meta { display: none; }
}
</style>
