<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { sortBySize } from '../../utils/sizeOrder'
import { formatMoney } from '../../utils/format'
import { useFirestore } from '../../composables/useFirestore'
import { lockBodyScroll, unlockBodyScroll } from '../../composables/useScrollLock'
import { isAddonMenuItem, menuItemKey } from '../../utils/menuCategories'
import { configuredCartItem, sizeLabel, dishSpecification } from '../../utils/dishOptions'
import {
  normalizeOptionGroups, initialOptionSelections, toggleOptionChoice,
  isOptionChosen, optionSelectionsComplete, missingRequiredOptionLabels,
} from '../../utils/dishOptionGroups'
import { MAX_NOTE_LENGTH, MAX_MEAL_LENGTH } from '../../constants'
import { DRINK_NOTE_ROLES, noteGroupRole } from '../../utils/defaultNoteGroups'
import { t } from '../../i18n'
import { normalizeDietaryTags } from '../../utils/dietaryTags'

const props = defineProps({ context: { type: Object, required: true } })
const emit = defineEmits(['close', 'save'])
const { systemSettings, noteGroups, requireQuickNotes, releaseQuickNotes } = useFirestore()
const maxItemPrice = computed(() => systemSettings?.value?.limits?.maxItemPrice || 10_000)
const dialog = ref(null)
const { dish, original, store, owner } = props.context
const variants = sortBySize(dish._variants || [dish], sizeLabel)
const exactIndex = original ? variants.findIndex(v => menuItemKey(v, original.storeName || props.context.storeName) === original._dishKey) : -1
const selectedIndex = ref(original ? (exactIndex >= 0 ? exactIndex : variants.findIndex(v => v.name === original.name && (v.category || '') === (original.category || ''))) : variants.length === 1 ? 0 : -1)
const selected = computed(() => variants[selectedIndex.value] || null)
const legacyQuantity = original && selected.value?.unit ? Number(String(original.note || '').split(selected.value.unit)[0]) : Number(String(original?.note || '').match(/^(?:(\d+)份|×(\d+))(?:、|$)/)?.slice(1).find(Boolean) || 1)
const quantity = ref(original?.quantity || (Number.isInteger(legacyQuantity) && legacyQuantity >= 1 && legacyQuantity <= 99 ? legacyQuantity : 1))
const addons = ref((original?.addons || []).map(a => ({ ...a })))

// ── 選項軸（口味、肉類…）──────────────────────────────────────
// 軸掛在「規格」上：同一道菜的大份小份可以有不同的軸，換規格時重建選擇，
// 但會把上一次選到的同名選項帶過去，換個份量不用整組重選。
const optionGroups = computed(() => normalizeOptionGroups(selected.value?.options).map(group => ({ ...group, choices: sortBySize(group.choices, choice => choice.name) })))
const optionSelections = ref(initialOptionSelections(optionGroups.value, original?.optionSelections))
watch(optionGroups, (groups) => {
  optionSelections.value = initialOptionSelections(groups, optionSelections.value)
})
const optionsDone = computed(() => optionSelectionsComplete(optionGroups.value, optionSelections.value))
const missingOptions = computed(() => missingRequiredOptionLabels(optionGroups.value, optionSelections.value))
const chosen = (group, choice) => isOptionChosen(optionSelections.value, group.label, choice.name)
// 只有一個「單選軸」在影響價格時，按鈕直接寫實際售價（跟「規格」一樣是 NT$ 100 / NT$ 120），
// 不要讓人自己把 +20 加回去。複選的加點天生就是 +X，大家都這樣讀，不列入判斷；
// 兩個以上的單選軸都有加價時才全部退回顯示加價金額，否則各按鈕的數字會互相矛盾。
const pricedSingleGroups = computed(() => optionGroups.value.filter(group => !group.multiple && group.choices.some(choice => choice.price > 0)))
const showsTotal = group => !group.multiple && pricedSingleGroups.value.length === 1 && pricedSingleGroups.value[0].label === group.label
const choiceTotal = choice => Number(selected.value?.price || 0) + Number(choice.price || 0)
function pickOption(group, choice) {
  optionSelections.value = toggleOptionChoice(optionSelections.value, group, choice)
}
const initialNote = original?.note || ''
const quantityPrefix = selected.value?.unit ? `${quantity.value}${selected.value.unit}` : quantity.value > 1 ? t('data.portions', { count: quantity.value }) : ''
const note = ref(original?.customNote ?? (quantityPrefix && initialNote.startsWith(quantityPrefix) ? initialNote.slice(quantityPrefix.length).replace(/^、/, '') : initialNote))
const drink = computed(() => store?.category === 'drink' || /飲料|飲品|茶|咖啡|果汁|drink|tea|coffee|juice/i.test(selected.value?.category || dish.category || ''))
const explicitTemperature = computed(() => selected.value ? dishSpecification(selected.value).temperature : '')
const isWarm = computed(() => /^(熱|溫|温)/.test(explicitTemperature.value) || (!explicitTemperature.value && note.value.split('、').some(token => /^(熱|溫|温)(的|飲)?$|^(hot|warm)$/i.test(token.trim()))))
// 群組依用途（甜度、冰量、溫度、份量、其他）判斷，中英文的預設群組名稱都適用。
const groupWithRole = role => (noteGroups.value || []).find(g => noteGroupRole(g.label) === role)
const groups = computed(() => (noteGroups.value || []).filter(g => {
  const role = noteGroupRole(g.label)
  if (drink.value && ['other', 'portion'].includes(role)) return false
  if (!drink.value && DRINK_NOTE_ROLES.has(role)) return false
  if (role === 'temperature' && explicitTemperature.value) return false
  if (role === 'ice' && isWarm.value) return false
  return true
}))
watch([explicitTemperature, isWarm, () => noteGroups.value], ([temperature, warm]) => {
  const excluded = (noteGroups.value || []).filter(g => (temperature && noteGroupRole(g.label) === 'temperature') || (warm && noteGroupRole(g.label) === 'ice')).flatMap(g => g.notes)
  note.value = note.value.split('、').filter(token => !excluded.includes(token.trim())).join('、')
}, { immediate: true })
const availableAddons = computed(() => (store?.menuItems || store?.items || []).filter(isAddonMenuItem))
const addonKey = a => `${a.name}::${a.price}::${a.unit || ''}`
const hasAddon = a => addons.value.some(value => addonKey(value) === addonKey(a))
function toggleAddon(addon) {
  addons.value = hasAddon(addon) ? addons.value.filter(a => addonKey(a) !== addonKey(addon)) : [...addons.value, { name: addon.name, price: Number(addon.price) || 0, unit: addon.unit || '', category: addon.category || '' }]
}
const tokens = computed(() => note.value.split('、').map(t => t.trim()).filter(Boolean))
function toggleNote(token, group) {
  let next = tokens.value.filter(t => t !== token)
  if (!tokens.value.includes(token)) {
    const role = noteGroupRole(group.label)
    // 甜度、冰量、溫度、份量各只能選一個；冰量與溫度互斥。
    if (['sugar', 'ice', 'temperature', 'portion'].includes(role)) next = next.filter(item => !group.notes.includes(item))
    if (role === 'ice') next = next.filter(item => !(groupWithRole('temperature')?.notes || []).includes(item))
    if (role === 'temperature') next = next.filter(item => !(groupWithRole('ice')?.notes || []).includes(item))
    next.push(token)
  }
  const value = next.join('、')
  if (value.length <= MAX_NOTE_LENGTH) note.value = value
}
const result = computed(() => selected.value ? configuredCartItem({ dish: selected.value, original, owner, storeName: props.context.storeName, addons: addons.value, note: note.value, quantity: quantity.value, optionSelections: optionSelections.value }) : null)
// 餐點名稱會帶上選到的口味與肉類，長度上限跟後端的 MAX_MEAL_LENGTH 對齊，
// 免得選完才在送出時被伺服器退回
const valid = computed(() => result.value && optionsDone.value && Number.isFinite(result.value.price) && Math.round(result.value.price) >= 1 && result.value.price <= maxItemPrice.value && result.value.name.length <= MAX_MEAL_LENGTH && result.value.note.length <= MAX_NOTE_LENGTH && (Number.isInteger(Number(quantity.value)) && quantity.value >= 1 && quantity.value <= 99))
const closing = ref(false)
let closeTimer
let pendingAction
let heldScrollLock = false
function finishClose() {
  if (!pendingAction) return
  clearTimeout(closeTimer)
  const action = pendingAction
  pendingAction = null
  emit(action.event, action.value)
}
function requestClose(event = 'close', value) {
  if (closing.value) return
  closing.value = true
  pendingAction = { event, value }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finishClose()
  else closeTimer = setTimeout(finishClose, 180)
}
function onAnimationEnd(event) {
  if (event.target === dialog.value && event.animationName.includes('dish-options-out')) finishClose()
}
function save() { if (valid.value) requestClose('save', result.value) }
let previousFocus
onMounted(() => {
  requireQuickNotes()
  previousFocus = document.activeElement
  lockBodyScroll()
  heldScrollLock = true
  dialog.value.showModal()
})
onUnmounted(() => {
  clearTimeout(closeTimer)
  pendingAction = null
  releaseQuickNotes()
  if (heldScrollLock) unlockBodyScroll()
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="dish-options" :class="{ closing }" aria-labelledby="dish-options-title" @animationend="onAnimationEnd" @cancel.prevent="requestClose()" @click="($event.target === dialog) && requestClose()">
      <form @submit.prevent="save">
        <header>
          <div><p>{{ context.storeName }} · {{ original ? t('dish.options.edit') : t('dish.options.choose') }}</p><div class="title-and-quantity"><h2 id="dish-options-title">{{ dish.name }}</h2>          <fieldset class="quantity-field" :aria-label="t('dish.options.quantity')"><legend v-if="selected?.unit">{{ t('dish.options.pricedQuantity') }}</legend>
            <div class="quantity-row">
              <span v-if="selected?.unit" class="unit-price">{{ formatMoney(selected.price) }}／{{ selected.unit }}</span>
              <div class="quantity-stepper">
                <button type="button" :aria-label="t('dish.options.decrease')" :disabled="quantity <= 1" @click="quantity = Math.max(1, (Number(quantity) || 1) - 1)">−</button>
                <input v-model.number="quantity" :aria-label="t('dish.options.quantity')" type="number" min="1" max="99" step="1" required />
                <button type="button" :aria-label="t('dish.options.increase')" :disabled="quantity >= 99" @click="quantity = Math.min(99, (Number(quantity) || 0) + 1)">＋</button>
              </div>
              <span>{{ selected?.unit || t('dish.options.portionUnit') }}</span>
            </div>
          </fieldset>
</div></div>
          <button type="button" class="close" autofocus :aria-label="t('dish.options.closeAria')" @click="requestClose()">×</button>
        </header>
        <div class="options-content">
          <div v-if="systemSettings.dietary?.enabled && selected" class="dietary-detail">
            <strong>{{ t('dietary.tags') }}: {{ normalizeDietaryTags(selected.tags).join(' · ') || t('dietary.unknown') }}</strong>
            <p>{{ t('dietary.hint') }}</p>
          </div>
          <fieldset v-if="variants.length > 1"><legend>{{ t('dish.options.variant') }} <small>{{ t('dish.options.requiredOne') }}</small></legend>
            <div class="option-chips"><button v-for="(variant, i) in variants" :key="menuItemKey(variant)" type="button" :aria-pressed="selectedIndex === i" :class="{ selected: selectedIndex === i }" @click="selectedIndex = i">{{ sizeLabel(variant) || variant.name }} <strong>{{ formatMoney(variant.price) }}{{ variant.unit ? `／${variant.unit}` : '' }}</strong></button></div>
          </fieldset>
          <!-- 選項軸：口味、肉類這類同一道菜要選的面向；必選軸沒選完不能送出 -->
          <fieldset v-for="group in optionGroups" :key="group.label">
            <legend>
              {{ group.label }}
              <small v-if="group.required && group.multiple">{{ t('dish.options.requiredMulti') }}</small>
              <small v-else-if="group.required" class="required">{{ t('dish.options.requiredOne') }}</small>
              <small v-else-if="group.multiple">{{ t('dish.options.multi') }}</small>
              <small v-else>{{ t('dish.options.optional') }}</small>
            </legend>
            <div class="option-chips">
              <button
                v-for="choice in group.choices"
                :key="choice.name"
                type="button"
                :aria-pressed="chosen(group, choice)"
                :class="{ selected: chosen(group, choice) }"
                @click="pickOption(group, choice)"
              >{{ choice.name }}<strong v-if="showsTotal(group)"> {{ formatMoney(choiceTotal(choice)) }}</strong><strong v-else-if="choice.price"> +{{ formatMoney(choice.price) }}</strong></button>
            </div>
          </fieldset>
          <fieldset v-if="availableAddons.length || addons.length"><legend>{{ t('dish.options.addons') }} <small>{{ selected?.unit ? t('dish.options.addonsPerItem') : t('dish.options.addonsPerPortion') }}</small></legend>
            <div class="option-chips"><button v-for="addon in [...availableAddons, ...addons.filter(a => !availableAddons.some(b => addonKey(a) === addonKey(b)))]" :key="addonKey(addon)" type="button" :aria-pressed="hasAddon(addon)" :class="{ selected: hasAddon(addon) }" @click="toggleAddon(addon)">{{ addon.name }} <strong>+{{ formatMoney(addon.price) }}</strong><small v-if="systemSettings.dietary?.enabled">{{ normalizeDietaryTags(addon.tags).join(' · ') || t('dietary.unknown') }}</small></button></div>
          </fieldset>
          <fieldset v-for="group in groups" :key="group.label"><legend>{{ group.label }} <small>{{ t('dish.options.optional') }}</small></legend>
            <div class="option-chips"><button v-for="token in group.notes" :key="token" type="button" :aria-pressed="tokens.includes(token)" :class="{ selected: tokens.includes(token) }" @click="toggleNote(token, group)">{{ token }}</button></div>
          </fieldset>
          <label class="free-note">{{ t('dish.options.otherNote') }}<textarea v-model="note" :maxlength="MAX_NOTE_LENGTH" rows="2" :placeholder="drink ? t('dish.options.drinkPlaceholder') : t('dish.options.mealPlaceholder')"></textarea></label>
          <p class="hint">{{ original ? t('dish.options.editHint') : t('dish.options.addHint') }}</p>
          <p v-if="result && !valid" role="alert">{{ t('dish.options.invalid') }}</p>
        </div>
        <footer><button type="button" @click="requestClose()">{{ t('dish.options.cancel') }}</button><button class="confirm" type="submit" :disabled="!valid || closing">{{ original ? t('dish.options.save') : t('dish.options.add') }}{{ !selected ? t('dish.options.pickVariant') : missingOptions.length ? t('dish.options.pickOptions', { labels: missingOptions.join(t('home.listSeparator')) }) : result ? t('dish.options.total', { amount: formatMoney(result.price) }) : '' }}</button></footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.dietary-detail { font-size: var(--text-label); color: var(--muted); }
.dietary-detail p { margin: 6px 0; }
.dish-options { outline: none; inset: 0; margin: auto; box-sizing: border-box; overflow: hidden; padding: 0; width: min(560px, calc(100vw - 24px)); max-height: 88dvh; border: 1px solid var(--border, var(--ink-3)); border-radius: 24px; background: var(--bg-card, var(--ink)); color: var(--text-primary, var(--paper)); box-shadow: 0 24px 80px var(--ink); }
.dish-options::backdrop { background: color-mix(in srgb, var(--ink) 42%, transparent); }
.dish-options[open], .dish-options[open]::backdrop { animation: dish-options-in 140ms ease-out both; }
.dish-options.closing, .dish-options.closing::backdrop { animation: dish-options-out 140ms ease-in both; }
.dish-options.closing form { pointer-events: none; }
@keyframes dish-options-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes dish-options-out { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .dish-options[open], .dish-options[open]::backdrop { animation: none; }
}
form { display: flex; flex-direction: column; max-height: 88dvh; }
header { flex-shrink: 0; display: flex; justify-content: space-between; gap: 12px; padding: 20px 24px; }
footer { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px; }
header { align-items: flex-start; }
header > div { flex: 1; min-width: 0; }
.title-and-quantity { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 16px; }
.title-and-quantity h2 { flex: 1 1 180px; overflow-wrap: anywhere; }
.title-and-quantity .quantity-field { margin: 0; flex: 0 0 auto; }
.title-and-quantity legend { font-size: var(--text-label); margin-bottom: 4px; }
header { border-bottom: 1px solid var(--border, var(--ink-3)); }
header p, .hint { color: var(--text-secondary, var(--ink-soft)); font-size: var(--text-label); }
header p { margin: 0 0 6px; } h2 { margin: 0; font-size: var(--text-title); }
.options-content { min-height: 0; padding: 20px 24px; overflow-y: auto; overscroll-behavior: contain; }
fieldset { padding: 0; border: 0; margin: 0 0 24px; } legend { font-weight: 700; margin-bottom: 12px; } small { font-weight: 400; color: var(--text-secondary, var(--ink-soft)); margin-left: 8px; } legend small.required { color: var(--text-accent, var(--persimmon-dark)); font-weight: 700; }
.quantity-row { display: flex; align-items: center; gap: 8px; }
.quantity-row .unit-price { flex: 1; color: var(--text-secondary); font-size: var(--text-label); }
.quantity-stepper { display: flex; align-items: center; gap: 4px; }
.quantity-stepper input { width: 50px; text-align: center; padding: 8px 0; appearance: textfield; }
.quantity-stepper input::-webkit-inner-spin-button { appearance: none; }
.quantity-stepper button { width: 40px; padding: 8px; }
.option-chips { display: flex; flex-wrap: wrap; gap: 8px; }
button, input, textarea { font: inherit; color: inherit; border: 1px solid var(--border, var(--ink-3)); border-radius: 12px; background: transparent; }
button { min-height: 44px; padding: 10px 14px; cursor: pointer; } button strong { margin-left: 8px; }
/* 選中態：金底配深墨字（對比約 6.7:1）。原本金底配朱紅字只有 1.8:1，選到反而看不清楚 */
button.selected { color: var(--ink); border-color: var(--gold-dark, var(--gold)); background: var(--gold); font-weight: 700; }
button.selected strong { color: var(--ink); }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent, var(--gold)); outline-offset: 3px; }
.close { flex: 0 0 32px; min-height: 32px; width: 32px; height: 32px; padding: 0; font-size: var(--text-title); border: 0; border-radius: 8px; } .free-note { display: grid; gap: 10px; font-weight: 700; }
textarea, input { padding: 12px; box-sizing: border-box; width: 100%; } textarea { resize: vertical; }
footer { border-top: 1px solid var(--border, var(--ink-3)); } .confirm { flex: 1; text-align: center; background: var(--accent, var(--gold)); color: var(--text-on-accent, var(--ink)); font-weight: 800; } button:disabled { opacity: .5; cursor: default; }
@media (max-width: 640px) {
  .dish-options { margin: auto auto 0; width: 100%; max-width: 100%; border-radius: 24px 24px 0 0; }
  header, footer { padding: 14px 16px; }
  .options-content { padding: 16px; }
  .close { flex-basis: 44px; width: 44px; height: 44px; }
  .quantity-stepper button { width: 44px; }
  .option-chips button { max-width: 100%; overflow-wrap: anywhere; text-align: left; }
  input, textarea { font-size: 16px; }
  footer { padding-bottom: max(16px, env(safe-area-inset-bottom)); }
}
</style>
