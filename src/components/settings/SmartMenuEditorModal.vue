<template>
  <div v-if="store" class="sme-overlay" @click.self="attemptClose">
    <div ref="modalRoot" class="sme-modal" role="dialog" aria-modal="true">
      <!-- Header -->
      <div class="sme-header">
        <div class="sme-title">
          <i class="fas fa-utensils"></i>
          <span>{{ store.name }}</span>
          <span class="sme-sub">{{ unifiedEditor ? t('menuEditor.editStore') : t('menuEditor.editMenu') }}</span>
          <span v-if="savedCount > 0" class="sme-count">{{ t('menuEditor.savedCount', { count: savedCount }) }}</span>
        </div>
        <slot name="header-actions" :save="save" :is-saving="isSaving" />
        <button type="button" class="sme-close-btn" @click="attemptClose" :title="t('menuEditor.close')" :aria-label="t('menuEditor.close')"><i class="fas fa-times"></i></button>
      </div>

      <!-- Body -->
      <div class="sme-body">
        <!-- Left: Image -->
        <div class="sme-image-pane" :class="{ 'sme-image-empty': !currentImageUrl, 'sme-unified-pane': unifiedEditor, 'is-collapsed': imageCollapsed }">
          <slot name="store-details" />
          <!-- 手機版才顯示：菜單圖片可收合，讓下方品項編輯有空間；桌機左右並排不需要 -->
          <button
            type="button"
            class="sme-image-toggle"
            :aria-expanded="!imageCollapsed"
            aria-controls="sme-image-viewer"
            @click="imageCollapsed = !imageCollapsed"
          >
            <img v-if="currentImageUrl" :src="currentImageUrl" alt="" class="sme-image-toggle-thumb" decoding="async" @error="handleImageError">
            <i v-else class="fas fa-image sme-image-toggle-icon" aria-hidden="true"></i>
            <span class="sme-image-toggle-label">
              {{ t('menuEditor.menuImages') }}
              <small v-if="imagesWithUrl.length > 1">{{ t('menuEditor.imagePosition', { current: currentImageIndex + 1, total: imagesWithUrl.length }) }}</small>
              <small v-else-if="!imagesWithUrl.length">{{ t('menuEditor.notUploaded') }}</small>
            </span>
            <span class="sme-image-toggle-action">{{ imageCollapsed ? t('menuEditor.expand') : t('menuEditor.collapse') }}<i class="fas fa-chevron-down" aria-hidden="true"></i></span>
          </button>
          <div id="sme-image-viewer" class="sme-image-viewer">
          <!-- 工具列定位在圖片區內，才不會蓋到下面的縮圖列 -->
          <div class="sme-image-stage-wrap">
          <div
            class="sme-image-stage"
            :style="{ touchAction: pinchScale > 1 ? 'none' : 'pan-y' }"
            @wheel.prevent="handleWheelZoom"
            @mousedown="onMouseDown"
            @mousemove="onMouseMove"
            @mouseup="onMouseUp"
            @mouseleave="onMouseUp"
            @touchstart="onTouchStart"
            @touchmove="onTouchMove"
            @touchend="onTouchEnd"
          >
            <img
              v-if="currentImageUrl"
              :src="currentImageUrl"
              :style="imgStyle"
              class="sme-image"
              :class="{ loaded: !mainImageLoading }"
              loading="eager"
              decoding="async"
              fetchpriority="high"
              draggable="false"
              @load="handleMainImageLoad"
              @error="handleMainImageError"
            />
            <LoadingState v-if="currentImageUrl && mainImageLoading" class="sme-image-loading" :title="t('menuEditor.loadingMenu')" compact />
            <!-- 只有真的沒有圖片網址時才顯示空狀態；載入完成後不能落入這個分支 -->
            <div v-else-if="!currentImageUrl" class="sme-no-image">
              <i class="fas fa-image"></i>
              <span>{{ t('menuEditor.noImage') }}</span>
            </div>
          </div>

          <!-- Zoom toolbar -->
          <div
            v-if="currentImageUrl || $slots['image-actions']"
            class="sme-zoom-bar"
            :class="{ 'is-zoomed': pinchScale !== 1, 'has-actions': !!$slots['image-actions'] }"
          >
            <template v-if="currentImageUrl">
            <!-- 手機版用雙指縮放，縮放鈕只在桌機顯示；「還原」在手機版只有縮放過才出現 -->
            <button type="button" class="glass-btn sme-zoom-step" @click="zoomOut" :title="t('menuEditor.zoomOut')" :aria-label="t('menuEditor.zoomOut')"><i class="fas fa-search-minus"></i></button>
            <span class="sme-zoom-level sme-zoom-step">{{ Math.round(pinchScale * 100) }}%</span>
            <button type="button" class="glass-btn sme-zoom-step" @click="zoomIn" :title="t('menuEditor.zoomIn')" :aria-label="t('menuEditor.zoomIn')"><i class="fas fa-search-plus"></i></button>
            <div class="sme-divider sme-zoom-step"></div>
            <button type="button" class="glass-btn sme-zoom-reset" @click="resetZoom" :title="t('menuEditor.resetZoom')" :aria-label="t('menuEditor.resetZoom')"><i class="fas fa-expand"></i></button>
            </template>
            <slot name="image-actions" :image="imagesWithUrl[currentImageIndex] || null" />
          </div>
          </div>

          <!-- Image navigation (multi-image) -->
          <div v-if="imagesWithUrl.length > 1" class="sme-image-nav">
            <button type="button" class="sme-nav-btn" @click="prevImage" :title="t('menuEditor.previousImage')" :aria-label="t('menuEditor.previousImage')"><i class="fas fa-chevron-left"></i></button>
            <div class="sme-thumbs">
              <div
                v-for="(img, idx) in imagesWithUrl"
                :key="img.id"
                :class="['sme-thumb', { active: idx === currentImageIndex }]"
                @click="selectImage(idx)"
              >
                <img :src="img.url" :alt="t('menuEditor.imageAlt', { index: idx + 1 })" loading="lazy" decoding="async" @error="handleImageError">
              </div>
            </div>
            <button type="button" class="sme-nav-btn" @click="nextImage" :title="t('menuEditor.nextImage')" :aria-label="t('menuEditor.nextImage')"><i class="fas fa-chevron-right"></i></button>
          </div>
        </div>

        </div>

        <!-- Right: Editor -->
        <div ref="editorPane" class="sme-editor-pane">
          <p class="sme-hint">{{ t('menuEditor.hint', { action: unifiedEditor ? t('menuEditor.saveData') : t('menuEditor.saveItems') }) }}</p>
          <!-- Text input -->
          <details class="sme-section sme-import" :open="!store.menuItems?.length">
            <summary>{{ t('menuEditor.importSummary') }}</summary>
            <div class="sme-section-header">
              <span class="sme-label"><i class="fas fa-keyboard"></i> {{ t('menuEditor.quickInput') }}</span>
              <span class="sme-hint">{{ t('menuEditor.quickInputHint') }}</span>
            </div>
            <details id="sme-input-help" class="sme-help" :open="!store.menuItems?.length">
              <summary><i class="fas fa-circle-question" aria-hidden="true"></i> {{ t('menuEditor.help.summary') }}</summary>
              <div class="sme-help-body">
                <section class="sme-help-block">
                  <h4>{{ t('menuEditor.help.basicTitle') }}</h4>
                  <pre>{{ t('menuEditor.help.basicExample') }}</pre>
                  <p>{{ t('menuEditor.help.basicText') }}</p>
                </section>

                <section class="sme-help-block">
                  <p>{{ t('menuEditor.help.sharedAddons') }}</p>
                  <h4>{{ t('menuEditor.help.optionsTitle') }}</h4>
                  <pre>{{ t('menuEditor.help.optionsExample') }}</pre>
                  <p>{{ t('menuEditor.help.optionsText1') }}</p>
                  <p>{{ t('menuEditor.help.optionsText2') }}</p>
                  <p>{{ t('menuEditor.help.optionsText3', { small: formatMoney(toMinorUnits(10)), large: formatMoney(toMinorUnits(12)) }) }}</p>
                </section>

                <section class="sme-help-block">
                  <h4>{{ t('menuEditor.help.variantsTitle') }}</h4>
                  <pre>{{ t('menuEditor.help.variantsExample') }}</pre>
                  <p>{{ t('menuEditor.help.variantsText') }}</p>
                </section>

                <ul class="sme-help-notes">
                  <li>{{ t('menuEditor.help.note1') }}</li>
                  <li>{{ t('menuEditor.help.note2') }}</li>
                </ul>
              </div>
            </details>
            <textarea
              :aria-label="t('menuEditor.quickInputAria')"
              aria-describedby="sme-input-help"
              v-model="textInput"
              class="sme-textarea"
              :placeholder="t('menuEditor.placeholder')"
              rows="7"
              spellcheck="false"
            ></textarea>
            <div class="sme-text-actions">
              <button type="button" class="sme-btn sme-btn-secondary" @click="clearTextInput">
                <i class="fas fa-eraser"></i> {{ t('menuEditor.clear') }}
              </button>
              <button type="button" class="sme-btn sme-btn-secondary" :disabled="!parsedItems.length" :title="t('menuEditor.copyAsTextHint')" @click="copyAsText">
                <i class="fas fa-copy"></i> {{ t('menuEditor.copyAsText') }}
              </button>
              <button type="button" class="sme-btn sme-btn-primary" @click="parseText">
                <i class="fas fa-magic"></i> {{ t('menuEditor.parse') }}
              </button>
            </div>
          </details>

          <!-- Parsed preview table -->
          <div v-if="parsedItems.length > 0" class="sme-section">
            <div class="sme-section-header">
              <span class="sme-label"><i class="fas fa-table"></i> {{ t('menuEditor.previewTitle') }}</span>
              <button type="button" class="sme-btn-add-row" @click="addRow">
                <i class="fas fa-plus"></i> {{ t('menuEditor.addRow') }}
              </button>
            </div>
            <div class="sme-save-bar">
              <div class="sme-save-summary">
                {{ t('menuEditor.summary', { main: mainCount, addon: addonCount }) }}<template v-if="optionItemCount">{{ t('menuEditor.summaryOptions', { count: optionItemCount }) }}</template>
              </div>
              <button v-if="!unifiedEditor" type="button" class="sme-btn sme-btn-primary sme-btn-save" @click="save" :disabled="isSaving || hasErrors || (hasWarnings && !warningsAccepted)">
                <span v-if="isSaving" class="sme-spinner"></span>
                <template v-else><i class="fas fa-save"></i></template>
                {{ t('menuEditor.saveItems') }}
              </button>
            </div>
            <div v-if="issueCount" class="sme-validation" role="status">
              {{ t('menuEditor.issues', { count: issueCount }) }}
              <label v-if="hasWarnings && !hasErrors"><input type="checkbox" v-model="warningsAccepted">{{ t('menuEditor.acceptWarnings') }}</label>
            </div>
            <div class="sme-table-wrap">
              <table class="sme-table">
                <thead>
                  <tr>
                    <th class="sme-col-category">{{ t('menuEditor.colCategory') }}</th>
                    <th class="sme-col-name">{{ t('menuEditor.colName') }}</th>
                    <th class="sme-col-unit" :title="t('menuEditor.colUnitHint')">{{ t('menuEditor.colUnit') }}</th>
                    <th class="sme-col-price">{{ t('menuEditor.colPrice') }} ({{ getAppCurrency().symbol }})</th>
                    <th class="sme-col-actions" :title="t('menuEditor.colDelete')"></th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="(item, idx) in parsedItems" :key="item._editorId">
                  <tr :class="{ 'sme-row-issue': issues[idx].errors.length || issues[idx].warnings.length }">
                    <td>
                      <input
                        type="text"
                        v-model="item.category"
                        :aria-label="t('menuEditor.categoryAria', { name: item.name || t('menuEditor.item') })"
                        class="sme-input sme-category-input"
                        :placeholder="t('dish.category.other')"
                        maxlength="20"
                      >
                    </td>
                    <td><input type="text" v-model="item.name" class="sme-input" :aria-label="t('menuEditor.nameAria', { index: idx + 1 })" :placeholder="t('menuEditor.namePlaceholder')" maxlength="50" :aria-invalid="issues[idx].errors.length > 0">
                      <small v-for="message in [...issues[idx].errors, ...issues[idx].warnings]" :key="message" class="sme-field-issue">{{ message }}</small>
                    </td>
                    <td><input type="text" v-model="item.unit" class="sme-input sme-unit-input" :aria-label="t('menuEditor.unitAria', { name: item.name || t('menuEditor.item') })" :placeholder="t('menuEditor.unitPlaceholder')" maxlength="4"></td>
                    <td>
                      <div class="sme-price-cell">
                        <span v-if="isAddonMenuCategory(item.category)" class="sme-addon-plus">+</span>
                        <MoneyInput v-model="item.price" :currency="getAppCurrency().code" :show-symbol="false" input-class="sme-input sme-price-input" placeholder="0" :aria-label="t('menuEditor.priceAria', { name: item.name || t('menuEditor.item') })" />
                      </div>
                    </td>
                    <td class="sme-action-cell">
                      <div class="sme-row-tools">
                        <button
                          type="button"
                          class="sme-btn-opt-row"
                          :class="{ on: optionGroupCount(item) > 0, open: expandedOptionsFor === item._editorId }"
                          :aria-expanded="expandedOptionsFor === item._editorId"
                          :aria-label="optionGroupCount(item) ? t('menuEditor.optionsOpenAria', { name: item.name || t('menuEditor.thisItem'), count: optionGroupCount(item) }) : t('menuEditor.optionsAddAria', { name: item.name || t('menuEditor.thisItem') })"
                          :title="optionGroupCount(item) ? t('menuEditor.optionsCount', { count: optionGroupCount(item) }) : t('menuEditor.optionsAddHint')"
                          @click="toggleOptionsEditor(item)"
                        >
                          <i class="fas fa-sliders" aria-hidden="true"></i>
                          <span v-if="optionGroupCount(item)" class="sme-opt-count" aria-hidden="true">{{ optionGroupCount(item) }}</span>
                        </button>
                        <button type="button" class="sme-btn-del-row" @click="removeRow(idx)" :aria-label="t('menuEditor.deleteRowAria', { name: item.name || t('menuEditor.thisRow') })" :title="t('menuEditor.deleteRow')"><i class="fas fa-times"></i></button>
                      </div>
                    </td>
                  </tr>
                  <!-- 選項群組編輯：展開才顯示，避免每一列都變高 -->
                  <tr v-if="expandedOptionsFor === item._editorId" class="sme-options-row">
                    <td colspan="5">
                      <div class="sme-options">
                        <p class="sme-options-hint">
                          {{ t('menuEditor.optionsHint') }}
                          <span v-if="optionCombinations(item) > 1" class="sme-options-saved">
                            {{ t('menuEditor.optionsSaved', { count: optionCombinations(item) }) }}
                          </span>
                        </p>

                        <div v-for="(group, gIdx) in item.options" :key="gIdx" class="sme-opt-group">
                          <div class="sme-opt-head">
                            <input
                              type="text"
                              v-model="group.label"
                              class="sme-input sme-opt-label"
                              :maxlength="MAX_OPTION_LABEL_LENGTH"
                              :placeholder="t('menuEditor.groupPlaceholder')"
                              :aria-label="t('menuEditor.groupAria', { index: gIdx + 1 })"
                            >
                            <label class="sme-opt-flag"><input type="checkbox" v-model="group.required"> {{ t('menuEditor.required') }}</label>
                            <label class="sme-opt-flag"><input type="checkbox" v-model="group.multiple"> {{ t('menuEditor.multiple') }}</label>
                            <button type="button" class="sme-btn-del-row" :title="t('menuEditor.deleteGroup', { label: group.label || '' })" :aria-label="t('menuEditor.deleteGroup', { label: group.label || '' })" @click="removeOptionGroup(item, gIdx)"><i class="fas fa-times"></i></button>
                          </div>

                          <div class="sme-opt-choices">
                            <div v-for="(choice, cIdx) in group.choices" :key="cIdx" class="sme-opt-choice">
                              <input
                                type="text"
                                v-model="choice.name"
                                class="sme-input"
                                :maxlength="MAX_OPTION_NAME_LENGTH"
                                :placeholder="t('menuEditor.choicePlaceholder')"
                                :aria-label="t('menuEditor.choiceAria', { group: group.label || t('menuEditor.group'), index: cIdx + 1 })"
                              >
                              <span class="sme-opt-plus" aria-hidden="true">+</span>
                              <MoneyInput
                                v-model="choice.price"
                                :currency="getAppCurrency().code"
                                :show-symbol="false"
                                input-class="sme-input sme-opt-price"
                                placeholder="0"
                                :aria-label="t('menuEditor.choicePriceAria', { choice: choice.name || t('menuEditor.choice') })"
                              />
                              <button type="button" class="sme-btn-del-row" :title="t('menuEditor.deleteChoice')" :aria-label="t('menuEditor.deleteChoice')" @click="removeOptionChoice(group, cIdx)"><i class="fas fa-times"></i></button>
                            </div>
                          </div>

                          <div class="sme-opt-actions">
                            <button type="button" class="sme-btn sme-btn-secondary" @click="addOptionChoice(group)"><i class="fas fa-plus"></i> {{ t('menuEditor.addChoice') }}</button>
                            <button type="button" class="sme-btn sme-btn-secondary" :aria-expanded="optionPasteDrafts.has(group)" @click="openOptionPaste(group)"><i class="fas fa-paste"></i> {{ t('menuEditor.pasteChoices') }}</button>
                          </div>
                          <div v-if="optionPasteDrafts.has(group)" class="sme-opt-paste">
                            <label>
                              <span>{{ t('menuEditor.pasteHint') }}</span>
                              <textarea v-model="optionPasteDrafts.get(group).text" class="sme-input" rows="3" :placeholder="t('menuEditor.pastePlaceholder')" :aria-label="t('menuEditor.pasteAria', { group: group.label || t('menuEditor.thisGroup') })" @keydown.esc.stop="optionPasteDrafts.delete(group)"></textarea>
                            </label>
                            <div class="sme-opt-actions">
                              <button type="button" class="sme-btn sme-btn-secondary" @click="optionPasteDrafts.delete(group)">{{ t('common.cancel') }}</button>
                              <button type="button" class="sme-btn sme-btn-primary" :disabled="!optionPasteDrafts.get(group).text.trim()" @click="pasteOptionChoices(group)">{{ t('menuEditor.addChoices') }}</button>
                            </div>
                          </div>
                        </div>

                        <button type="button" class="sme-btn sme-btn-add-row" @click="addOptionGroup(item)">
                          <i class="fas fa-plus"></i> {{ t('menuEditor.addGroup') }}
                        </button>
                      </div>
                    </td>
                  </tr>
                  </template>
                </tbody>
              </table>
            </div>

          </div>

          <!-- Existing items chips -->
          <div v-else-if="store.menuItems && store.menuItems.length > 0" class="sme-section">
            <div class="sme-section-header">
              <span class="sme-label"><i class="fas fa-check-circle" style="color:var(--mint)"></i> {{ t('menuEditor.existingTitle') }}</span>
              <button type="button" class="sme-btn sme-btn-secondary sme-btn-edit-items" @click="loadExistingToEditor">
                <i class="fas fa-edit"></i> {{ t('menuEditor.editExisting') }}
              </button>
            </div>
            <input v-model="itemSearch" class="sme-input sme-search" type="search" :placeholder="t('menuEditor.searchPlaceholder')" :aria-label="t('menuEditor.searchPlaceholder')">
            <div v-for="group in existingGroups" :key="group.category" class="sme-item-group">
              <h3 class="sme-group-title">{{ menuCategoryLabel(group.category) }} <span>{{ t('menuEditor.itemCount', { count: group.items.length }) }}</span></h3>
              <div class="sme-chips">
              <span
                v-for="item in group.items"
                :key="item.name + item.type"
                :class="['sme-chip', typeFromItem(item) === 'addon' ? 'sme-chip-addon' : 'sme-chip-main']"
              >
                {{ item.name }}<span v-if="item.unit" class="sme-chip-unit">1{{ item.unit }}</span>
                <span class="sme-chip-price">{{ typeFromItem(item) === 'addon' ? '+' : '' }}{{ formatMoney(item.price) }}<span v-if="item.unit">/{{ item.unit }}</span></span>
              </span>
              </div>
            </div>
            <p v-if="!existingGroups.length" class="sme-hint">{{ t('menuEditor.noSearchResults') }}</p>
          </div>

          <!-- Empty state -->
          <div v-else class="sme-empty-hint">
            <i class="fas fa-info-circle"></i>
            <span>{{ t('menuEditor.emptyHint') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import LoadingState from '../ui/LoadingState.vue'
import { formatMoney, fromMinorUnits, getAppCurrency, toMinorUnits } from '../../utils/format'
import { t, translateError } from '../../i18n'
import MoneyInput from './system/MoneyInput.vue'
import { useFirestore } from '../../composables/useFirestore'
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { menuIssues } from '../../utils/menuEditor'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../../firestore'
import { useToast } from '../../composables/useToast'
import { useSmartMenuDraft } from '../../composables/useSmartMenuDraft'
import { useScrollLock } from '../../composables/useScrollLock'
import { ADDON_MENU_CATEGORY, UNCATEGORIZED_MENU_CATEGORY, isAddonMenuCategory, isAddonMenuItem, menuCategoryLabel, normalizeMenuCategory } from '../../utils/menuCategories'
import {
  MAX_OPTION_GROUPS, MAX_OPTION_CHOICES, MAX_OPTION_LABEL_LENGTH, MAX_OPTION_NAME_LENGTH,
  parseOptionGroupLine, looksLikeOptionGroupLine, serializeOptionGroups, stringifyOptionGroups,
} from '../../utils/dishOptionGroups'
import { useModalA11y } from '../../composables/useModalA11y'

const props = defineProps({
  store: { type: Object, default: null },
  initialImageId: { type: String, default: null },
  saveAll: { type: Function, default: null },
  beforeClose: { type: Function, default: null },
  unifiedEditor: { type: Boolean, default: false }
})
const emit = defineEmits(['close'])
const { showToast } = useToast()
const { getDraft, updateDraft, clearDraft } = useSmartMenuDraft()
const { systemSettings } = useFirestore()
// 價格一律以幣別最小單位存（新台幣為元、美元為分）；文字格式與輸入框用主單位。
const maxItemPrice = computed(() => systemSettings?.value?.limits?.maxItemPrice || 10_000)
const plainAmount = value => String(fromMinorUnits(value))
// 匯出成文字時，內部的「其他／加點」寫成目前語言的名稱，貼回來一樣認得。
const categoryText = category => (isAddonMenuCategory(category) || category === UNCATEGORIZED_MENU_CATEGORY ? menuCategoryLabel(category) : category)

const itemSearch = ref('')
const existingGroups = computed(() => {
  const groups = new Map()
  const query = itemSearch.value.trim().toLocaleLowerCase()
  for (const item of props.store?.menuItems || []) {
    const category = normalizeMenuCategory(item.category, defaultCategoryForType(item.type))
    if (query && ![item.name, category].join(' ').toLocaleLowerCase().includes(query)) continue
    if (!groups.has(category)) groups.set(category, { category, items: [] })
    groups.get(category).items.push(item)
  }
  return [...groups.values()]
})
const textInput = ref('')
const lastParsedText = ref('')
const editorPane = ref(null)
const parsedItems = ref([])
const isSaving = ref(false)
const warningsAccepted = ref(false)
const issues = computed(() => menuIssues(parsedItems.value, { maxPrice: maxItemPrice.value }))
const issueCount = computed(() => issues.value.filter(issue => issue.errors.length || issue.warnings.length).length)
const hasErrors = computed(() => issues.value.some(issue => issue.errors.length))
const hasWarnings = computed(() => issues.value.some(issue => issue.warnings.length))
watch(parsedItems, () => { warningsAccepted.value = false }, { deep: true })
const savedCount = ref(0)
let nextEditorItemId = 1

const typeFromCategory = (category) => isAddonMenuCategory(category) ? 'addon' : 'main'
const typeFromItem = (item) => isAddonMenuItem(item) ? 'addon' : 'main'
const defaultCategoryForType = (type) => type === 'addon' ? ADDON_MENU_CATEGORY : UNCATEGORIZED_MENU_CATEGORY
// ── 選項軸編輯 ─────────────────────────────────────────────────
// 一筆品項可以掛幾個軸（口味、肉類…），避免把組合窮舉成幾十筆品項。
const expandedOptionsFor = ref(null)
const toggleOptionsEditor = (item) => {
  expandedOptionsFor.value = expandedOptionsFor.value === item._editorId ? null : item._editorId
}
const optionGroupCount = (item) => (Array.isArray(item.options) ? item.options : []).length
// 幾個軸相乘＝這一筆取代掉多少筆窮舉出來的品項，讓使用者看得到省了多少
const optionCombinations = (item) => (Array.isArray(item.options) ? item.options : [])
  .filter(group => !group?.multiple && Array.isArray(group?.choices) && group.choices.length)
  .reduce((product, group) => product * group.choices.length, 1)

const ensureOptions = (item) => {
  if (!Array.isArray(item.options)) item.options = []
  return item.options
}
const addOptionGroup = (item) => {
  const groups = ensureOptions(item)
  if (groups.length >= MAX_OPTION_GROUPS) { showToast(t('menuEditor.tooManyGroups', { max: MAX_OPTION_GROUPS }), 'error'); return }
  groups.push({ label: '', required: true, multiple: false, choices: [{ name: '', price: 0 }] })
  expandedOptionsFor.value = item._editorId
}
const removeOptionGroup = (item, index) => {
  ensureOptions(item).splice(index, 1)
  if (!item.options.length) delete item.options
}
const addOptionChoice = (group) => {
  if (!Array.isArray(group.choices)) group.choices = []
  if (group.choices.length >= MAX_OPTION_CHOICES) { showToast(t('menuEditor.tooManyChoices', { max: MAX_OPTION_CHOICES }), 'error'); return }
  group.choices.push({ name: '', price: 0 })
}
const removeOptionChoice = (group, index) => { group.choices.splice(index, 1) }
// 貼上一整排選項：「原味/咖哩/墨西哥」或「另加肉類+20、加鳳梨類+15」
const optionPasteDrafts = ref(new Map())
const openOptionPaste = (group) => {
  if (!optionPasteDrafts.value.has(group)) optionPasteDrafts.value.set(group, { text: '' })
}
const pasteOptionChoices = (group) => {
  const text = optionPasteDrafts.value.get(group)?.text.trim().replace(/\r?\n/g, '/')
  if (!text) return
  const parsed = parseOptionGroupLine(`${group.label || t('menuEditor.choice')} ${text}`)
  if (!parsed?.choices?.length) { showToast(t('menuEditor.noChoicesParsed'), 'error'); return }
  const existing = new Set((group.choices || []).map(choice => String(choice?.name || '').trim()).filter(Boolean))
  group.choices = [
    ...(group.choices || []).filter(choice => String(choice?.name || '').trim()),
    ...parsed.choices.filter(choice => !existing.has(choice.name)),
  ].slice(0, MAX_OPTION_CHOICES)
  optionPasteDrafts.value.delete(group)
}

const createEditorItem = (item) => {
  const itemCategory = normalizeMenuCategory(item?.category, defaultCategoryForType(item?.type))
  const itemType = typeFromCategory(itemCategory)
  return {
    _editorId: nextEditorItemId++,
    unit: '',
    ...item,
    price: Math.round(Number(item?.price) || 0),
    type: itemType,
    category: itemCategory
  }
}

// 「複製成文字」：把目前編輯內容輸出成可貼回去的格式，含選項軸
const copyAsText = async () => {
  const lines = []
  let lastCategory = ''
  for (const item of parsedItems.value) {
    const category = normalizeMenuCategory(item.category, UNCATEGORIZED_MENU_CATEGORY)
    if (category !== lastCategory) { if (lines.length) lines.push(''); lines.push(`# ${categoryText(category)}`); lastCategory = category }
    const unit = String(item.unit || '').trim()
    const prefix = isAddonMenuCategory(category) ? '+' : ''
    lines.push(`${prefix}${String(item.name || '').trim()} ${plainAmount(item.price)}${unit ? `/${unit}` : ''}`.trim())
    lines.push(...stringifyOptionGroups(item.options))
  }
  const text = lines.join('\n')
  try {
    await navigator.clipboard.writeText(text)
    showToast(t('menuEditor.copied'))
  } catch {
    textInput.value = text
    showToast(t('menuEditor.copyFallback'))
  }
}

const optionItemCount = computed(() => parsedItems.value.filter(i => optionGroupCount(i) > 0).length)
const mainCount = computed(() => parsedItems.value.filter(i => typeFromCategory(i.category) === 'main').length)
const addonCount = computed(() => parsedItems.value.filter(i => typeFromCategory(i.category) === 'addon').length)
const isDirty = computed(() => textInput.value.trim() !== '' || parsedItems.value.length > 0)

const imagesWithUrl = computed(() => (props.store?.images || []).filter(img => img.url && img.url.trim() !== ''))
const draftKey = computed(() => props.store?.name || '')
const currentImageIndex = ref(0)
const currentImageUrl = computed(() => imagesWithUrl.value[currentImageIndex.value]?.url || '')
const mainImageLoading = ref(true)
// 手機版菜單圖片預設收合：展開時會吃掉半個螢幕，品項編輯才是主要工作。還沒有圖片時保持展開，上傳鈕才看得到。
const isNarrowViewport = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 900px)').matches
const imageCollapsed = ref(isNarrowViewport() && imagesWithUrl.value.length > 0)

const selectImage = (idx) => { currentImageIndex.value = idx; resetZoom() }
const prevImage = () => { if (imagesWithUrl.value.length < 2) return; currentImageIndex.value = (currentImageIndex.value - 1 + imagesWithUrl.value.length) % imagesWithUrl.value.length; resetZoom() }
const nextImage = () => { if (imagesWithUrl.value.length < 2) return; currentImageIndex.value = (currentImageIndex.value + 1) % imagesWithUrl.value.length; resetZoom() }

const pinchScale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const isDragging = ref(false)
let lastTouchDist = 0, lastTouchCenter = { x: 0, y: 0 }, isTouchPanning = false
let lastPanPos = { x: 0, y: 0 }, isMouseDragging = false, lastMousePos = { x: 0, y: 0 }

const imgStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${pinchScale.value})`,
  cursor: isDragging.value ? 'grabbing' : pinchScale.value > 1 ? 'grab' : 'default',
  transformOrigin: 'center center', maxWidth: '100%', maxHeight: '100%',
  transition: isTouchPanning ? 'none' : 'transform 0.15s ease',
  // 沒放大時讓單指上下滑照常捲動頁面（手機版整頁一起捲），放大後才接手拖曳
  willChange: 'transform', touchAction: pinchScale.value > 1 ? 'none' : 'pan-y', userSelect: 'none'
}))

const clampScale = (v) => Math.min(Math.max(v, 0.3), 5)
const zoomIn = () => { pinchScale.value = clampScale(pinchScale.value + 0.2) }
const zoomOut = () => { pinchScale.value = clampScale(pinchScale.value - 0.2) }
const resetZoom = () => { pinchScale.value = 1; translateX.value = 0; translateY.value = 0 }
const handleWheelZoom = (e) => { pinchScale.value = clampScale(pinchScale.value + (e.deltaY < 0 ? 0.15 : -0.15)) }

const getTouchDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
const getTouchCenter = (t1, t2) => ({ x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 })

const onTouchStart = (e) => {
  if (e.touches.length === 2 && e.cancelable) e.preventDefault()
  if (e.touches.length === 2) { isTouchPanning = true; lastTouchDist = getTouchDist(e.touches[0], e.touches[1]); lastTouchCenter = getTouchCenter(e.touches[0], e.touches[1]) }
  else if (e.touches.length === 1 && pinchScale.value > 1) { isTouchPanning = true; lastPanPos = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
}
const onTouchMove = (e) => {
  if (e.cancelable && (e.touches.length === 2 || pinchScale.value > 1)) e.preventDefault()
  if (e.touches.length === 2) {
    const newDist = getTouchDist(e.touches[0], e.touches[1])
    pinchScale.value = clampScale(pinchScale.value * (newDist / lastTouchDist)); lastTouchDist = newDist
    const newCenter = getTouchCenter(e.touches[0], e.touches[1])
    translateX.value += newCenter.x - lastTouchCenter.x; translateY.value += newCenter.y - lastTouchCenter.y; lastTouchCenter = newCenter
  } else if (e.touches.length === 1 && pinchScale.value > 1) {
    translateX.value += e.touches[0].clientX - lastPanPos.x; translateY.value += e.touches[0].clientY - lastPanPos.y
    lastPanPos = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
}
const onTouchEnd = (e) => {
  if (e.touches.length < 2) { isTouchPanning = false; if (pinchScale.value < 0.5) resetZoom(); if (pinchScale.value <= 1) { translateX.value = 0; translateY.value = 0 } }
}
const onMouseDown = (e) => { if (pinchScale.value <= 1) return; isDragging.value = true; isMouseDragging = true; lastMousePos = { x: e.clientX, y: e.clientY }; e.preventDefault() }
const onMouseMove = (e) => { if (!isMouseDragging) return; translateX.value += e.clientX - lastMousePos.x; translateY.value += e.clientY - lastMousePos.y; lastMousePos = { x: e.clientX, y: e.clientY } }
const onMouseUp = () => { isMouseDragging = false; setTimeout(() => { isDragging.value = false }, 0) }

const handleImageError = (e) => { e.target.onerror = null; e.target.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='200' height='200' fill='%231A1D25'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='14' fill='%237B8099'>${encodeURIComponent(t('menuEditor.imageBroken'))}</text></svg>` }
const handleMainImageError = (e) => {
  mainImageLoading.value = false
  handleImageError(e)
}
const handleMainImageLoad = () => {
  mainImageLoading.value = false
  if (imagesWithUrl.value.length < 2) return
  const nextIndex = (currentImageIndex.value + 1) % imagesWithUrl.value.length
  const nextUrl = imagesWithUrl.value[nextIndex]?.url
  if (!nextUrl) return
  const preload = new Image()
  preload.src = nextUrl
}

const serializeItems = () => parsedItems.value.map(({ _editorId, ...item }) => ({ ...item }))

const persistDraft = () => {
  if (!textInput.value.trim() && parsedItems.value.length === 0) {
    clearCurrentDraft()
    return
  }
  updateDraft(draftKey.value, {
    textInput: textInput.value,
    lastParsedText: lastParsedText.value,
    parsedItems: serializeItems(),
    currentImageIndex: currentImageIndex.value
  })
}

const clearCurrentDraft = () => {
  clearDraft(draftKey.value)
}

const restoreDraft = () => {
  const draft = getDraft(draftKey.value)
  if (!draft.textInput && (!draft.parsedItems || draft.parsedItems.length === 0)) {
    textInput.value = ''
    parsedItems.value = []
    savedCount.value = 0
    currentImageIndex.value = 0
    resetZoom()
    initImageIndex()
    return
  }
  textInput.value = draft.textInput || ''
  lastParsedText.value = draft.lastParsedText ?? textInput.value
  parsedItems.value = (draft.parsedItems || []).map(item => createEditorItem(item))
  savedCount.value = 0
  currentImageIndex.value = Math.min(Math.max(draft.currentImageIndex || 0, 0), Math.max(imagesWithUrl.value.length - 1, 0))
  resetZoom()
}

const clearTextInput = () => {
  textInput.value = ''
  parsedItems.value = []
  savedCount.value = 0
  clearCurrentDraft()
}

const parseText = () => {
  const lines = (textInput.value || '').split('\n')
  const result = []
  let currentCategory = UNCATEGORIZED_MENU_CATEGORY

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || /^[-=\s*#＝]{2,}$/.test(line)) continue

    // 上一行已經建立了品項，而且這行是選項軸 → 掛到那個品項上。
    // 判斷條件有兩個，成立一個就算：有縮排，或行內帶著 `*` `!` `+加價` 這些記號。
    // 只靠縮排不夠，因為從聊天視窗或別的編輯器貼過來時，前導空白常常整排被吃掉。
    const indented = /^[ \t\u3000]/.test(rawLine)
    if (result.length && (indented || looksLikeOptionGroupLine(line))) {
      const group = parseOptionGroupLine(line)
      if (group) {
        const target = result[result.length - 1]
        if (!Array.isArray(target.options)) target.options = []
        if (target.options.length < MAX_OPTION_GROUPS) target.options.push(group)
        continue
      }
    }

    const categoryMatch = line.match(/^(?:#|＃|\[(.+)\]|【(.+)】)\s*(.*)$/)
    if (line.startsWith('#') || line.startsWith('＃') || categoryMatch?.[1] || categoryMatch?.[2]) {
      const categoryName = categoryMatch?.[1] || categoryMatch?.[2] || line.replace(/^[#＃]+/, '')
      currentCategory = normalizeMenuCategory(categoryName, UNCATEGORIZED_MENU_CATEGORY)
      continue
    }

    let isAddon = false, cleanLine = line
    if (line.startsWith('+') || line.startsWith('＋')) { isAddon = true; cleanLine = line.slice(1).trim() }
    const itemCategory = isAddon ? ADDON_MENU_CATEGORY : currentCategory
    const priceUnitMatch = cleanLine.match(/(\d+(?:\.\d+)?)\s*[/／]\s*([^\d\s/／]+)\s*$/)
    const priceMatch = priceUnitMatch || cleanLine.match(/(\d+(?:\.\d+)?)\s*$/)
    if (!priceMatch) {
      const name = cleanLine.slice(0, 50).trim()
      if (name) result.push(createEditorItem({ category: itemCategory, name, price: 0, unit: '' }))
      continue
    }
    // 文字裡的價格是主單位（美元 12.5、新台幣 110），存成最小單位；超過上限的交給檢查標出來。
    const price = toMinorUnits(parseFloat(priceMatch[1]))
    let rest = cleanLine.slice(0, cleanLine.lastIndexOf(priceMatch[0])).trim(), unit = ''
    if (priceUnitMatch) {
      unit = priceUnitMatch[2].slice(0, 4)
    } else {
      const unitMatch = rest.match(/\s+(\d+)([^\d\s]+)\s*$/)
      if (unitMatch) { unit = unitMatch[2].slice(0, 4); rest = rest.slice(0, rest.length - unitMatch[0].length).trim() }
    }
    const name = rest.slice(0, 50)
    if (!name) continue
    const item = createEditorItem({ category: itemCategory, name, price, unit: '' })
    if (unit) { item.unit = unit; item.defaultQty = 1 }
    result.push(item)
  }
  if (result.length === 0) { showToast(t('menuEditor.nothingParsed'), 'error'); return }
  parsedItems.value = result
  lastParsedText.value = textInput.value
}

const addRow = () => { parsedItems.value.unshift(createEditorItem({ category: UNCATEGORIZED_MENU_CATEGORY, name: '', price: 0, unit: '' })) }
const removeRow = (idx) => { parsedItems.value.splice(idx, 1) }

const loadExistingToEditor = () => {
  if (!props.store.menuItems?.length) return
  parsedItems.value = props.store.menuItems.map(item => createEditorItem({
    type: item.type,
    category: normalizeMenuCategory(item.category, defaultCategoryForType(item.type)),
    name: item.name,
    price: item.price,
    unit: item.unit || '',
    defaultQty: item.unit ? 1 : null,
    options: serializeOptionGroups(item.options)
  }))

  // 上面的表格與下面的文字框要是同一份內容，選項軸也得寫回文字框，
  // 不然使用者改完文字重新解析一次，剛存好的選項就整批消失。
  let lastCategory = ''
  const lines = []
  for (const item of props.store.menuItems) {
    const category = normalizeMenuCategory(item.category, defaultCategoryForType(item.type))
    if (category !== lastCategory) { lines.push(`# ${categoryText(category)}`); lastCategory = category }
    const prefix = typeFromCategory(category) === 'addon' ? '+' : ''
    const pricePart = item.unit ? `${plainAmount(item.price)}/${item.unit}` : plainAmount(item.price)
    lines.push(`${prefix}${item.name} ${pricePart}`)
    lines.push(...stringifyOptionGroups(item.options))
  }
  textInput.value = lines.join('\n')
  lastParsedText.value = textInput.value
  // 桌機是編輯區自己捲；手機版整頁一起捲，改成把編輯區捲到畫面頂端
  nextTick(() => {
    if (isNarrowViewport()) editorPane.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else editorPane.value?.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

const save = async () => {
  if (isSaving.value) return
  if (textInput.value.trim() && textInput.value !== lastParsedText.value) parseText()
  if (!isDirty.value && props.saveAll) {
    isSaving.value = true
    try { await props.saveAll(null) } finally { isSaving.value = false }
    return
  }
  if (hasErrors.value) return showToast(t('menuEditor.fixErrors'), 'error')
  if (hasWarnings.value && !warningsAccepted.value) return showToast(t('menuEditor.confirmWarnings'), 'error')
  if (parsedItems.value.length === 0) { showToast(t('menuEditor.nothingToSave'), 'error'); return }
  const cleaned = parsedItems.value.filter(item => item.name && String(item.name).trim()).map(item => {
    const category = normalizeMenuCategory(item.category, defaultCategoryForType(item.type))
    const itemType = typeFromCategory(category)
    const clean = {
      type: itemType,
      category,
      name: String(item.name).trim().slice(0, 50),
      price: Math.max(0, Math.min(maxItemPrice.value, Math.round(Number(item.price) || 0)))
    }
    const unit = String(item.unit || '').trim().slice(0, 4)
    if (unit) { clean.unit = unit; clean.defaultQty = 1 }
    const options = serializeOptionGroups(item.options)
    if (options.length) clean.options = options
    return clean
  })
  if (cleaned.length === 0) { showToast(t('menuEditor.allNamesEmpty'), 'error'); return }
  isSaving.value = true
  try {
    const targetDocId = props.store.menuDocId || props.store.docIds[0]
    if (props.saveAll) {
      if (!await props.saveAll(cleaned)) return
    } else {
      await updateDoc(doc(db, 'menu_images', targetDocId), { menuItems: cleaned, menuUpdatedAt: Date.now() })
      showToast(t('menuEditor.saved', { store: props.store.name, count: cleaned.length }))
    }
    parsedItems.value = []; textInput.value = ''; savedCount.value = cleaned.length; clearCurrentDraft()
  } catch (err) { showToast(t('menuEditor.saveFailed', { message: translateError(err) }), 'error') } finally { isSaving.value = false }
}

const finishClose = async () => {
  if (props.beforeClose && !await props.beforeClose()) return
  emit('close')
}

const attemptClose = () => {
  if (isSaving.value) return
  if (isDirty.value) {
    showToast(t('menuEditor.unsaved'), 'error', {
      duration: 6000,
      undoLabel: t('menuEditor.forceClose'),
      undoFn: async () => { if (props.beforeClose && !await props.beforeClose()) return; clearCurrentDraft(); emit('close') }
    })
    return
  }
  finishClose()
}

const onKeydown = (e) => {
  if (e.target.closest?.('[role="dialog"]') !== modalRoot.value) return
  if (e.key === 'Escape') attemptClose()
  else if (e.key === 'ArrowLeft' && imagesWithUrl.value.length > 1 && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') prevImage()
  else if (e.key === 'ArrowRight' && imagesWithUrl.value.length > 1 && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') nextImage()
}

const initImageIndex = () => {
  if (!props.initialImageId) return
  const idx = imagesWithUrl.value.findIndex(img => img.id === props.initialImageId)
  if (idx >= 0) currentImageIndex.value = idx
}

watch(draftKey, (name, previous) => {
  if (props.unifiedEditor && previous && name !== previous) {
    persistDraft()
    clearDraft(previous)
  } else restoreDraft()
}, { immediate: true })

watch([textInput, parsedItems, currentImageIndex], persistDraft, { deep: true })
watch(imagesWithUrl, (images) => { currentImageIndex.value = Math.min(currentImageIndex.value, Math.max(0, images.length - 1)) })
watch(currentImageUrl, () => { mainImageLoading.value = true }, { immediate: true })

// 這個 modal 只要掛載就代表開啟，所以直接鎖住；useScrollLock 會在卸載時解鎖。
useScrollLock(ref(true))
// Escape 原本就有，這裡補上 Tab 不會跑出浮層、關閉後焦點回到「檢視菜單」那顆按鈕。
// autofocus 關掉：一進來就把焦點丟到第一顆按鈕會蓋掉使用者原本要看的內容。
const modalRoot = ref(null)
useModalA11y(modalRoot, { autofocus: false, ignoreOtherDialogs: true })

onMounted(() => { document.addEventListener('keydown', onKeydown) })
onUnmounted(() => { document.removeEventListener('keydown', onKeydown) })
</script>

<style scoped>
/* 格式說明改成收合：熟了之後它只是佔位置，但新店家第一次建菜單需要 */
.sme-help { margin-bottom:12px; border:1px solid var(--paper-2); border-radius:var(--r-md); background:var(--paper-2); color:var(--ink); overflow:hidden; }
.sme-help > summary {
  display:flex; align-items:center; gap:8px;
  padding:10px 14px; cursor:pointer; list-style:none;
  font-size:var(--text-label); font-weight:700; color:var(--persimmon-dark);
}
.sme-help > summary::-webkit-details-marker { display:none; }
.sme-help > summary::after { content:'▾'; margin-left:auto; color:var(--ink-mute); font-size:var(--text-body); transition:transform .15s; }
.sme-help[open] > summary::after { transform:rotate(180deg); }
.sme-help > summary:hover { background:var(--paper-2); }
.sme-help > summary:focus-visible { outline:2px solid var(--persimmon); outline-offset:-2px; }

.sme-help-body { padding:0 14px 14px; display:flex; flex-direction:column; gap:12px; font-size:var(--text-label); line-height:1.65; }
.sme-help-block { display:flex; flex-direction:column; gap:6px; }
.sme-help-block h4 { margin:0; font-size:var(--text-label); font-weight:800; color:var(--ink); }
.sme-help-block p { margin:0; font-size:var(--text-micro); line-height:1.75; color:color-mix(in srgb, var(--ink) 75%, var(--paper-2)); }
.sme-help-block p b { color:var(--ink); }
.sme-help code { font-family:var(--font-mono); font-size:0.95em; font-weight:700; color:var(--persimmon-dark); }
.sme-help pre {
  margin:0; padding:9px 11px; border-radius:var(--r-sm);
  background:var(--paper); border:1px solid var(--paper-2);
  white-space:pre-wrap; overflow-wrap:anywhere;
  font-family:var(--font-mono); font-size:var(--text-micro); line-height:1.8; color:var(--ink);
}

.sme-help-notes { margin:0; padding:10px 0 0; border-top:1px solid var(--paper-2); list-style:none; display:flex; flex-direction:column; gap:5px; }
.sme-help-notes li { position:relative; padding-left:15px; font-size:var(--text-micro); line-height:1.7; color:color-mix(in srgb, var(--ink) 75%, var(--paper-2)); }
.sme-help-notes li::before { content:'・'; position:absolute; left:0; }
.sme-help-notes b { color:var(--ink); }

.sme-validation { padding:12px; margin-bottom:12px; background:var(--bg-highlight); color:var(--ink); border:1px solid var(--border); border-radius:var(--r-md); }
.sme-validation label { display:block; margin-top:8px; }
.sme-field-issue { display:block; color:var(--text-danger); font-size:var(--text-micro); margin-top:4px; }
.sme-row-issue td { border-bottom-color:var(--accent); }

.sme-import { margin-top:16px; border:1px solid var(--border); border-radius:var(--r-md); padding:12px; }
.sme-import > summary { cursor:pointer; color:var(--ink); font-weight:700; }
.sme-import[open] > summary { margin-bottom:14px; }
.sme-search { margin-bottom:14px; }
.sme-item-group { margin-bottom:18px; }
.sme-group-title { display:flex; gap:8px; margin:0 0 8px; color:var(--ink); font-size:var(--text-label); }
.sme-group-title span { color:var(--muted); font-weight:500; }

.sme-overlay {
  position: fixed; inset: 0;
  background: var(--overlay); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  z-index: var(--z-modal); display: flex; align-items: center; justify-content: center; padding: 24px;
  animation: sme-fade 0.18s ease;
}
@keyframes sme-fade { from { opacity:0 } to { opacity:1 } }

.sme-modal {
  width: 100%; max-width: 1400px; height: 90vh; max-height: 900px;
  background: var(--paper); border-radius: var(--r-xl);
  box-shadow: var(--shadow-modal); display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid var(--border);
  /* 這個視窗本身是淺色紙本底（上一行 background:var(--paper)），但開啟它的
     店家管理頁整個包在 .ops-surface（深色工作區）裡，語意 token 會被改成深色版本、
     沿著 DOM 往下繼承進來，讓「已設定品項」徽章等變成深底淺字、跟淺色底衝突。
     這裡把用到的語意 token 還原成淺色版預設值（跟 tokens.css :root 一致）。 */
  --bg-inset: var(--paper-2);
  --border: var(--paper-2);
  --border-strong: var(--ink-faint);
  --muted: var(--ink-faint);
  --muted-line: var(--ink-faint);
  --muted-line2: var(--paper-2);
  --input-bg: var(--paper);
  --input-border: var(--ink-faint);
  --bg-accent: var(--paper-2);
  --text-accent: var(--persimmon-dark);
  --bg-success: var(--paper-2);
  --text-success: var(--jade);
  --bg-danger: var(--paper-2);
  --text-danger: var(--persimmon-dark);
  --bg-highlight: var(--paper-2);
}

.sme-header { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-bottom:1px solid var(--border); background:var(--cream); flex-shrink:0; }
.sme-title { display:flex; align-items:center; gap:10px; font-weight:800; font-size: var(--text-body); color:var(--ink); flex-wrap:wrap; }
.sme-title > i { color:var(--accent); }
.sme-sub { font-size: var(--text-micro); color:var(--muted); font-weight:600; padding:3px 10px; background:var(--bg-inset); border-radius:999px; }
.sme-count { font-size: var(--text-micro); color:var(--text-success); font-weight:700; padding:3px 10px; background:var(--bg-success); border:1px solid color-mix(in srgb, var(--success) 30%, transparent); border-radius:999px; }
.sme-close-btn { width:34px; height:34px; border-radius:50%; background:var(--bg-inset); border:1px solid var(--border-strong); color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size: var(--text-label); transition:all 0.15s; flex-shrink:0; }
.sme-close-btn:hover { background:var(--bg-danger); color:var(--text-danger); border-color:var(--danger); }

.sme-body { flex:1; display:flex; overflow:hidden; min-height:0; }

.sme-image-pane { flex:0 0 46%; display:flex; flex-direction:column; background:var(--image-viewer-bg); min-width:0; position:relative; border-right:1.5px solid var(--muted-line); }
.sme-image-stage { flex:1; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; min-height:0; }
.sme-image { display:block; opacity:0; }
.sme-image.loaded { opacity:1; }
.sme-image-loading { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:color-mix(in srgb, var(--paper) 70%, transparent); font-size: var(--text-micro); font-weight:700; pointer-events:none; }
.sme-image-spinner { width:28px; height:28px; border:3px solid color-mix(in srgb, var(--paper) 18%, transparent); border-top-color:var(--paper); border-radius:50%; animation:sme-image-spin 0.8s linear infinite; }
@keyframes sme-image-spin { to { transform:rotate(360deg); } }
.sme-no-image { display:flex; flex-direction:column; align-items:center; gap:12px; color:color-mix(in srgb, var(--paper) 30%, transparent); font-size: var(--text-label); font-weight:600; }
.sme-no-image i { font-size: var(--text-display); opacity:0.4; }

.sme-zoom-bar { position:absolute; bottom:12px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:6px; padding:6px 10px; background:var(--image-control-bg); backdrop-filter:blur(8px); border-radius:999px; border:1px solid color-mix(in srgb, var(--paper) 10%, transparent); z-index:2; }
.glass-btn { width:30px; height:30px; border-radius:50%; background:color-mix(in srgb, var(--paper) 8%, transparent); border:none; color:var(--image-control-icon); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size: var(--text-micro); transition:all 0.15s; }
.glass-btn:hover { background:color-mix(in srgb, var(--paper) 18%, transparent); }
.sme-zoom-level { color:var(--paper); font-size: var(--text-micro); font-weight:700; min-width:42px; text-align:center; font-family:var(--font-mono); }
.sme-divider { width:1px; height:18px; background:color-mix(in srgb, var(--paper) 15%, transparent); margin:0 2px; }

.sme-image-nav { display:flex; align-items:center; gap:8px; padding:10px 12px; background:color-mix(in srgb, var(--ink) 40%, transparent); border-top:1px solid color-mix(in srgb, var(--paper) 6%, transparent); flex-shrink:0; }
.sme-nav-btn { width:30px; height:30px; border-radius:var(--r-sm); background:color-mix(in srgb, var(--paper) 8%, transparent); border:1px solid color-mix(in srgb, var(--paper) 10%, transparent); color:var(--paper); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size: var(--text-micro); flex-shrink:0; transition:all 0.15s; }
.sme-nav-btn:hover { background:color-mix(in srgb, var(--paper) 18%, transparent); }
.sme-thumbs { display:flex; gap:6px; overflow-x:auto; flex:1; padding:2px; scrollbar-width:thin; }
.sme-thumb { width:52px; height:52px; border-radius:var(--r-sm); overflow:hidden; border:2px solid transparent; cursor:pointer; flex-shrink:0; transition:all 0.15s; background:var(--cream); }
.sme-thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.sme-thumb:hover { border-color:color-mix(in srgb, var(--paper) 30%, transparent); }
.sme-thumb.active { border-color:var(--selection); box-shadow:0 0 0 2px color-mix(in srgb, var(--selection) 35%, transparent); }

.sme-editor-pane { flex:1; overflow-y:auto; padding:18px 20px; background:var(--paper); min-width:0; }
.sme-editor-pane::-webkit-scrollbar { width:8px; }
.sme-editor-pane::-webkit-scrollbar-thumb { background:var(--muted-line); border-radius:4px; }

.sme-section { margin-bottom:18px; }
.sme-section:last-child { margin-bottom:0; }
.sme-section-header { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; flex-wrap:wrap; }
.sme-label { display:flex; align-items:center; gap:6px; font-size: var(--text-label); font-weight:800; color:var(--ink); }
.sme-label i { color:var(--accent); }
.sme-hint { font-size: var(--text-micro); color:var(--muted); font-weight:500; }

.sme-textarea { width:100%; padding:12px 14px; border:1px solid var(--input-border); border-radius:var(--r-md); background:var(--input-bg); color:var(--ink); font-size: var(--text-label); font-family:var(--font-mono); font-weight:500; line-height:1.7; resize:vertical; transition:border-color 0.15s, box-shadow 0.15s; box-sizing:border-box; }
.sme-textarea:focus { border-color:var(--accent); box-shadow:0 0 0 3px var(--input-focus-ring); outline:none; }

.sme-text-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:10px; }
.sme-btn { padding:8px 18px; font-size: var(--text-label); font-weight:700; border-radius:999px; border:none; cursor:pointer; display:inline-flex; align-items:center; gap:6px; transition:all 0.15s; }
.sme-btn-primary { background:var(--accent); color:var(--text-on-accent); }
.sme-btn-primary:hover:not(:disabled) { background:var(--accent-hover); }
.sme-btn-primary:disabled { opacity:0.6; cursor:not-allowed; }
.sme-btn-secondary { background:var(--bg-inset); color:var(--muted); border:1px solid var(--border-strong); }
.sme-btn-secondary:hover { color:var(--ink); border-color:var(--accent); }
.sme-btn-edit-items { padding:7px 12px; font-size: var(--text-micro); flex-shrink:0; }

.sme-btn-add-row { display:inline-flex; align-items:center; gap:5px; background:var(--bg-success); color:var(--text-success); border:1px solid color-mix(in srgb, var(--success) 30%, transparent); padding:6px 13px; font-size: var(--text-micro); font-weight:700; border-radius:999px; cursor:pointer; transition:all 0.15s; }
.sme-btn-add-row:hover { background:var(--success); color:var(--text-on-success); }

.sme-table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:var(--r-md); margin-bottom:12px; }
.sme-table { min-width:520px; width:100%; border-collapse:collapse; table-layout:fixed; }
.sme-col-category { width:24%; }
.sme-col-name { width:auto; }
.sme-col-unit { width:14%; }
.sme-col-price { width:16%; }
.sme-col-actions { width:78px; }
.sme-table th { padding:9px 10px; background:var(--bg-inset); font-size: var(--text-micro); font-weight:700; color:var(--muted); border-bottom:1px solid var(--border); text-align:left; }
.sme-table td { padding:6px 8px; border-bottom:1px solid var(--border); background:var(--paper); vertical-align:middle; }
.sme-table th.sme-col-actions,
.sme-action-cell { padding-left:4px; padding-right:4px; text-align:center; }
.sme-table tbody tr:last-child td { border-bottom:none; }
.sme-table tbody tr:hover td { background:var(--cream); }

.sme-input { width:100%; padding:6px 10px; border:1px solid var(--input-border); border-radius:var(--r-sm); background:var(--input-bg); color:var(--ink); font-size: var(--text-label); font-weight:600; transition:border-color 0.15s, box-shadow 0.15s; box-sizing:border-box; }
.sme-input:focus { border-color:var(--accent); box-shadow:0 0 0 2px var(--input-focus-ring); outline:none; }
.sme-category-input { min-width:0; }
.sme-unit-input { text-align:center; }
.sme-price-input { font-family:var(--font-mono) !important; font-weight:700 !important; }
.sme-price-input::-webkit-outer-spin-button,
.sme-price-input::-webkit-inner-spin-button,
.sme-opt-price::-webkit-outer-spin-button,
.sme-opt-price::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
.sme-price-input[type="number"],
.sme-opt-price[type="number"] { appearance:textfield; -moz-appearance:textfield; }
.sme-price-cell { display:flex; align-items:center; gap:5px; }
.sme-addon-plus { font-weight:900; color:var(--mint); font-size: var(--text-body); flex-shrink:0; }

/* ── 選項群組編輯 ───────────────────────────────────────────── */
.sme-options-row > td { padding:0 !important; background:var(--paper-2); }
.sme-options { display:flex; flex-direction:column; gap:10px; padding:12px 14px; border-left:3px solid var(--persimmon); }
.sme-options-hint { margin:0; color:color-mix(in srgb, var(--ink) 75%, var(--paper-2)); font-size:var(--text-micro); line-height:1.7; }
.sme-options-hint b { color:var(--ink); }
.sme-options-saved { display:inline-block; margin-left:6px; padding:1px 8px; border-radius:999px; background:var(--paper-2); color:var(--jade); font-weight:700; }

.sme-opt-group { border:1px dashed var(--ink-faint); border-radius:7px; padding:9px 10px; display:flex; flex-direction:column; gap:8px; background:var(--paper); }
.sme-opt-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.sme-opt-label { flex:1 1 150px; min-width:120px; font-weight:700; }
.sme-opt-flag { display:inline-flex; align-items:center; gap:5px; color:var(--ink-mute); font-size:var(--text-micro); font-weight:700; white-space:nowrap; cursor:pointer; }
.sme-opt-flag input { accent-color:var(--persimmon); }

.sme-opt-choices { display:grid; grid-template-columns:repeat(auto-fill, minmax(215px, 1fr)); gap:6px; }
.sme-opt-choice { display:flex; align-items:center; gap:4px; }
.sme-opt-choice > .sme-input:first-child { flex:1 1 auto; min-width:0; }
.sme-opt-plus { color:var(--ink-mute); font-weight:800; font-size:var(--text-micro); }
.sme-opt-price { width:62px; flex:0 0 62px; text-align:right; }
.sme-opt-actions { display:flex; gap:6px; flex-wrap:wrap; }
.sme-opt-paste { display:flex; flex-direction:column; gap:8px; padding:10px; border:1px solid var(--input-border); border-radius:7px; }
.sme-opt-paste label { display:flex; flex-direction:column; gap:6px; color:var(--ink-mute); font-size:var(--text-micro); }
.sme-opt-paste textarea { resize:vertical; min-height:80px; }

@media (max-width: 640px) {
  .sme-opt-choices { grid-template-columns:1fr; }
}
.sme-btn-del-row { width:26px; height:26px; border-radius:50%; background:transparent; border:1.5px solid var(--ink-faint); color:var(--ink-mute); font-size: var(--text-micro); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.15s; margin:0 auto; flex-shrink:0; }
.sme-btn-del-row:hover { background:var(--paprika); color:var(--paper); border-color:transparent; }

/* 每列右側兩顆同尺寸圓鈕並排；margin:0 auto 在 flex 裡會把它們推開，這裡歸零 */
.sme-row-tools { display:flex; align-items:center; justify-content:center; gap:6px; }
.sme-row-tools > .sme-btn-del-row { margin:0; }

.sme-btn-opt-row {
  position:relative; flex-shrink:0;
  width:26px; height:26px; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  border:1.5px solid var(--ink-faint); background:transparent; color:var(--ink-mute);
  font-size:var(--text-micro); cursor:pointer;
  transition:background .15s, color .15s, border-color .15s;
}
.sme-btn-opt-row:hover { border-color:var(--persimmon); color:var(--persimmon-dark); }
.sme-btn-opt-row.on { border-color:var(--persimmon); color:var(--persimmon-dark); }
.sme-btn-opt-row.open { background:var(--persimmon-dark); border-color:var(--persimmon-dark); color:var(--paper); }
/* 群組數放右上角，按鈕本身維持跟刪除鈕一樣的圓形，欄位才不會被撐開 */
.sme-opt-count {
  position:absolute; top:-5px; right:-5px;
  min-width:15px; height:15px; padding:0 4px;
  border-radius:999px; background:var(--persimmon-dark); color:var(--paper);
  font-size:var(--text-micro); font-weight:800; line-height:15px; text-align:center;
}
.sme-btn-opt-row.open .sme-opt-count { background:var(--paper); color:var(--persimmon-dark); }

.sme-save-bar { position:sticky; top:0; z-index:3; margin-bottom:12px; box-shadow:var(--shadow-card); display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:var(--paper-2); border:1px solid var(--paper-line); border-radius:var(--r-md); gap:10px; flex-wrap:wrap; }
.sme-save-summary { font-size: var(--text-label); font-weight:700; color:var(--ink-mute); }
.sme-save-summary strong { color:var(--ink); font-family:var(--font-display); font-weight:800; }
.sme-btn-save { padding:9px 22px; font-size: var(--text-label); }
.sme-spinner { display:inline-block; width:14px; height:14px; border:2px solid color-mix(in srgb, currentColor 30%, transparent); border-radius:50%; border-top-color:currentColor; animation:sme-spin 0.8s linear infinite; }
@keyframes sme-spin { to { transform:rotate(360deg) } }

.sme-chips { display:flex; flex-wrap:wrap; gap:6px; }
.sme-chip { display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:999px; font-size: var(--text-micro); font-weight:700; }
.sme-chip-main { background:var(--bg-accent); color:var(--text-accent); border:1px solid var(--border-accent); }
.sme-chip-addon { background:var(--bg-success); color:var(--text-success); border:1px solid color-mix(in srgb, var(--success) 30%, transparent); }
.sme-chip-unit { display:inline-block; margin-left:2px; padding:1px 7px; border-radius:999px; background:var(--bg-success); color:var(--text-success); font-size: var(--text-micro); font-weight:800; }
.sme-chip-price { font-family:var(--font-mono); font-weight:800; opacity:0.8; }

/* 空狀態瘦身：單行文字＋小 icon，不另外加虛線框／底色 */
.sme-empty-hint { display:flex; align-items:center; justify-content:center; gap:8px; padding:10px 4px; font-size: var(--text-label); color:var(--muted); font-weight:600; text-align:center; }
.sme-empty-hint i { color:var(--accent); flex-shrink:0; }

@media (max-width: 900px) {
  .sme-overlay { padding:0; }
  .sme-modal { height:100dvh; max-height:100dvh; border-radius:0; }
  .sme-image-empty .sme-no-image { flex-direction:row; font-size:var(--text-micro); }
  .sme-editor-pane { padding:14px 14px 20px; }
}
@media (max-width: 640px) {
  .sme-header { padding:10px 12px; gap:8px; }
  .sme-title { min-width:0; overflow-wrap:anywhere; gap:6px; }
  .sme-editor-pane { padding-bottom:max(20px, env(safe-area-inset-bottom)); }
  .sme-input, .sme-textarea { font-size:16px; min-height:44px; }
  .sme-btn, .sme-btn-add-row { min-height:44px; }
  .sme-close-btn, .sme-btn-del-row, .glass-btn, .sme-nav-btn { width:44px; height:44px; }
  .sme-table { min-width:0; }
  .sme-table thead { display:none; }
  .sme-table tbody { display:block; }
  .sme-table tr { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr) 100px; padding:8px; border-bottom:1px solid var(--border-strong); }
  .sme-table td { display:block; padding:4px; border:0; }
  .sme-table td::before { display:block; color:var(--ink); font-size:var(--text-label); margin-bottom:4px; }
  .sme-table td:nth-child(1) { grid-column:1 / 3; }
  .sme-table td:nth-child(1)::before { content:'分類'; }
  .sme-table td:nth-child(2) { grid-column:1 / -1; grid-row:2; }
  .sme-table td:nth-child(2)::before { content:'餐點名稱'; }
  .sme-table td:nth-child(3) { grid-column:1; grid-row:3; }
  .sme-table td:nth-child(3)::before { content:'單位（一般品項留空）'; }
  .sme-table td:nth-child(4) { grid-column:2 / -1; grid-row:3; }
  .sme-table td:nth-child(4)::before { content:'單價'; }
  .sme-table td:nth-child(5) { grid-column:3; grid-row:1; align-self:end; }
  .sme-btn-opt-row { width:44px; height:44px; font-size:var(--text-label); }
  .sme-opt-count { top:-2px; right:-2px; }
  /* 選項編輯那一列是單一 td，不能套用上面的三欄 grid */
  .sme-table tr.sme-options-row { display:block; padding:0; }
  .sme-table tr.sme-options-row > td { padding:0 !important; }
  .sme-options { padding:10px; }
}
</style>

<style scoped>
.sme-image-viewer { flex:1; display:flex; flex-direction:column; min-height:0; position:relative; }
.sme-image-stage-wrap { flex:1; display:flex; flex-direction:column; min-height:0; position:relative; }
.sme-image-toggle { display:none; }
</style>

<style scoped>
.sme-header { flex-wrap:wrap; }
.sme-title { min-width:0; }
</style>

<style scoped>
.sme-zoom-bar { max-width:calc(100% - 16px); gap:3px; padding:6px; }
.sme-zoom-level { flex-shrink:0; }
.sme-zoom-bar .glass-btn { flex-shrink:0; }
</style>

<style scoped>
/* 手機版：上下堆疊時整個視窗只有一條捲軸，菜單圖片可收合。
   原本圖片區固定高度、品項編輯區另外捲動，編輯區被擠到只剩幾公分；
   縮放工具列又浮在圖片和縮圖列上面，把縮圖擋住。 */
@media (max-width: 900px) {
  .sme-body { flex-direction:column; overflow-y:auto; overscroll-behavior:contain; }
  .sme-image-pane { flex:none; height:auto; background:var(--paper); border-right:none; border-bottom:1.5px solid var(--muted-line); }
  .sme-editor-pane { flex:none; overflow:visible; }

  .sme-image-toggle {
    display:flex; align-items:center; gap:10px;
    width:calc(100% - 28px); min-height:52px; margin:0 14px 12px; padding:8px 12px; box-sizing:border-box;
    border:1px solid var(--muted-line); border-radius:var(--r-md); background:var(--paper-2);
    color:var(--ink); font:inherit; font-size:var(--text-label); font-weight:700; text-align:left; cursor:pointer;
  }
  .sme-image-pane > .sme-image-toggle:first-child { margin-top:12px; }
  .sme-image-toggle:focus-visible { outline:2px solid var(--persimmon); outline-offset:2px; }
  .sme-image-toggle-thumb { width:36px; height:36px; flex-shrink:0; object-fit:cover; border-radius:var(--r-sm); background:var(--cream); }
  .sme-image-toggle-icon { width:36px; flex-shrink:0; text-align:center; color:var(--ink-mute); font-size:var(--text-body); }
  .sme-image-toggle-label { flex:1; min-width:0; display:flex; flex-direction:column; }
  .sme-image-toggle-label small { color:var(--ink-mute); font-size:var(--text-micro); font-weight:600; }
  .sme-image-toggle-action { display:inline-flex; align-items:center; gap:6px; flex-shrink:0; color:var(--persimmon-dark); font-size:var(--text-micro); }
  .sme-image-toggle-action i { transition:transform .15s; }
  .sme-image-toggle[aria-expanded="true"] .sme-image-toggle-action i { transform:rotate(180deg); }

  .sme-image-pane.is-collapsed .sme-image-viewer { display:none; }
  .sme-image-viewer, .sme-image-stage-wrap { flex:none; }
  .sme-image-viewer { background:var(--image-viewer-bg); }
  .sme-image-stage { flex:none; height:min(60dvh, 520px); }
  .sme-image-empty .sme-image-stage { height:56px; }

  /* 工具列改成圖片下方的一整列，不再浮在圖片／縮圖上 */
  .sme-zoom-bar {
    position:static; transform:none; width:100%; max-width:none; box-sizing:border-box;
    justify-content:center; flex-wrap:wrap; gap:4px; padding:6px 8px;
    border:0; border-top:1px solid color-mix(in srgb, var(--paper) 10%, transparent); border-radius:0;
    background:transparent; backdrop-filter:none;
  }
  .sme-zoom-step { display:none; }
  .sme-zoom-bar:not(.is-zoomed) .sme-zoom-reset,
  .sme-zoom-bar:not(.is-zoomed) :slotted(.image-action-divider) { display:none; }
  /* 沒縮放、也沒有圖片操作鈕時整列是空的，直接收起來 */
  .sme-zoom-bar:not(.is-zoomed):not(.has-actions) { display:none; }
}
</style>
