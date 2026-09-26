<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { formatDateShort as formatDate } from '../../utils/format'

const props = defineProps({
  modelValue: { type: String, default: '' },
  min: { type: String, default: '' },
  max: { type: String, default: '' },
  mode: { type: String, default: 'date' },
  ariaLabel: { type: String, default: '選擇日期' },
  placeholder: { type: String, default: '選擇日期' },
  compact: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'change'])
const root = ref(null)
const trigger = ref(null)
const popover = ref(null)
const open = ref(false)
const viewDate = ref(new Date())
const draftDate = ref('')
const draftHour = ref('00')
const draftMinute = ref('00')
const popoverStyle = ref({ left: '12px', top: '12px' })

const isDateTime = computed(() => props.mode === 'datetime')
const isMonth = computed(() => props.mode === 'month')
const weekdays = ['日', '一', '二', '三', '四', '五', '六']
const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))

function localIso(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function validDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function syncDraft() {
  const value = String(props.modelValue || '')
  if (isMonth.value) {
    const match = value.match(/^(\d{4})-(\d{2})$/)
    const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date()
    viewDate.value = new Date(date.getFullYear(), date.getMonth(), 1)
    draftDate.value = match ? value : localIso(date).slice(0, 7)
    return
  }
  const date = validDate(value) || new Date()
  viewDate.value = new Date(date.getFullYear(), date.getMonth(), 1)
  draftDate.value = value.slice(0, 10) || localIso(date)
  const time = value.match(/T(\d{2}):(\d{2})/)
  draftHour.value = time?.[1] || '00'
  draftMinute.value = time?.[2] || '00'
}

const monthLabel = computed(() => viewDate.value.toLocaleDateString('zh-TW', {
  year: 'numeric',
  month: 'long',
}))

const calendarDays = computed(() => {
  const year = viewDate.value.getFullYear()
  const month = viewDate.value.getMonth()
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    const value = localIso(date)
    const minDate = props.min?.slice(0, 10)
    const maxDate = props.max?.slice(0, 10)
    return {
      value,
      day: date.getDate(),
      outside: date.getMonth() !== month,
      today: value === localIso(new Date()),
      selected: value === draftDate.value,
      disabled: Boolean((minDate && value < minDate) || (maxDate && value > maxDate)),
    }
  })
})

const calendarMonths = computed(() => {
  const year = viewDate.value.getFullYear()
  const minMonth = props.min?.slice(0, 7)
  const maxMonth = props.max?.slice(0, 7)
  return Array.from({ length: 12 }, (_, index) => {
    const value = `${year}-${String(index + 1).padStart(2, '0')}`
    return {
      value,
      label: `${index + 1}月`,
      selected: value === draftDate.value,
      current: value === localIso(new Date()).slice(0, 7),
      disabled: Boolean((minMonth && value < minMonth) || (maxMonth && value > maxMonth)),
    }
  })
})

const displayValue = computed(() => {
  if (isMonth.value) {
    const match = String(props.modelValue || '').match(/^(\d{4})-(\d{2})$/)
    return match ? `${match[1]}年${Number(match[2])}月` : props.placeholder
  }
  const date = validDate(props.modelValue)
  if (!date) return props.placeholder
  const dateText = formatDate(date)
  if (!isDateTime.value) return dateText
  const time = String(props.modelValue).match(/T(\d{2}):(\d{2})/)
  return `${dateText} ${time ? `${time[1]}:${time[2]}` : '00:00'}`
})

function updatePosition() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.min(320, window.innerWidth - 24)
  const estimatedHeight = isMonth.value ? 245 : (isDateTime.value ? 410 : 350)
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.left))
  const placeAbove = window.innerHeight - rect.bottom < estimatedHeight && rect.top > estimatedHeight
  const top = placeAbove
    ? Math.max(12, rect.top - estimatedHeight - 8)
    : Math.min(window.innerHeight - estimatedHeight - 12, rect.bottom + 8)
  popoverStyle.value = { left: `${left}px`, top: `${Math.max(12, top)}px`, width: `${width}px` }
}

async function toggle() {
  if (props.disabled) return
  if (open.value) {
    close()
    return
  }
  syncDraft()
  open.value = true
  await nextTick()
  updatePosition()
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
}

async function openPicker() {
  await nextTick()
  if (!open.value) await toggle()
  await nextTick()
  popover.value?.querySelector('.day-button:not(:disabled), .month-button:not(:disabled)')?.focus()
}

defineExpose({ openPicker })

function close() {
  open.value = false
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
}

function shiftMonth(offset) {
  viewDate.value = new Date(viewDate.value.getFullYear(), viewDate.value.getMonth() + offset, 1)
}

function shiftYear(offset) {
  viewDate.value = new Date(viewDate.value.getFullYear() + offset, viewDate.value.getMonth(), 1)
}

function commit(value) {
  emit('update:modelValue', value)
  emit('change', value)
}

function selectDay(day) {
  if (day.disabled) return
  draftDate.value = day.value
  if (!isDateTime.value) {
    commit(day.value)
    close()
  }
}

function selectMonth(month) {
  if (month.disabled) return
  draftDate.value = month.value
  commit(month.value)
  close()
}

function confirmDateTime() {
  if (!draftDate.value) return
  let value = `${draftDate.value}T${draftHour.value}:${draftMinute.value}`
  if (props.min && value < props.min) value = props.min.slice(0, 16)
  if (props.max && value > props.max) value = props.max.slice(0, 16)
  commit(value)
  close()
}

function selectToday() {
  const value = localIso(new Date())
  if (isMonth.value) {
    const monthValue = value.slice(0, 7)
    const minMonth = props.min?.slice(0, 7)
    const maxMonth = props.max?.slice(0, 7)
    if ((minMonth && monthValue < minMonth) || (maxMonth && monthValue > maxMonth)) return
    commit(monthValue)
    close()
    return
  }
  const minDate = props.min?.slice(0, 10)
  const maxDate = props.max?.slice(0, 10)
  if ((minDate && value < minDate) || (maxDate && value > maxDate)) return
  draftDate.value = value
  viewDate.value = new Date()
  if (!isDateTime.value) {
    commit(value)
    close()
  }
}

function handleDocumentPointer(event) {
  if (!open.value) return
  if (root.value?.contains(event.target) || popover.value?.contains(event.target)) return
  close()
}

function handleKeydown(event) {
  if (event.key === 'Escape' && open.value) {
    close()
    trigger.value?.focus()
  }
}

watch(() => props.modelValue, () => {
  if (!open.value) syncDraft()
})

document.addEventListener('pointerdown', handleDocumentPointer)
document.addEventListener('keydown', handleKeydown)

onBeforeUnmount(() => {
  close()
  document.removeEventListener('pointerdown', handleDocumentPointer)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div ref="root" class="app-date-picker" :class="{ compact, disabled }">
    <button
      ref="trigger"
      type="button"
      class="date-trigger"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <svg class="calendar-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      </svg>
      <span :class="{ placeholder: !modelValue }">{{ displayValue }}</span>
      <svg class="chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </button>

    <Teleport to="body">
      <Transition name="calendar-pop">
        <div
          v-if="open"
          ref="popover"
          class="date-popover"
          :style="popoverStyle"
          role="dialog"
          :aria-label="ariaLabel"
        >
          <div class="calendar-header">
            <button type="button" class="month-nav" :aria-label="isMonth ? '上一年' : '上個月'" @click="isMonth ? shiftYear(-1) : shiftMonth(-1)">‹</button>
            <strong>{{ isMonth ? `${viewDate.getFullYear()}年` : monthLabel }}</strong>
            <button type="button" class="month-nav" :aria-label="isMonth ? '下一年' : '下個月'" @click="isMonth ? shiftYear(1) : shiftMonth(1)">›</button>
          </div>

          <div v-if="isMonth" class="month-grid">
            <button
              v-for="month in calendarMonths"
              :key="month.value"
              type="button"
              class="month-button"
              :class="{ current: month.current, selected: month.selected }"
              :disabled="month.disabled"
              :aria-label="month.value"
              :aria-pressed="month.selected"
              @click="selectMonth(month)"
            >{{ month.label }}</button>
          </div>
          <div v-if="!isMonth" class="weekday-grid" aria-hidden="true">
            <span v-for="weekday in weekdays" :key="weekday">{{ weekday }}</span>
          </div>
          <div v-if="!isMonth" class="day-grid">
            <button
              v-for="day in calendarDays"
              :key="day.value"
              type="button"
              class="day-button"
              :class="{ outside: day.outside, today: day.today, selected: day.selected }"
              :disabled="day.disabled"
              :aria-label="day.value"
              :aria-pressed="day.selected"
              @click="selectDay(day)"
            >{{ day.day }}</button>
          </div>

          <div v-if="isDateTime" class="time-row">
            <span class="time-label">時間</span>
            <select v-model="draftHour" aria-label="小時">
              <option v-for="hour in hours" :key="hour" :value="hour">{{ hour }}</option>
            </select>
            <span>:</span>
            <select v-model="draftMinute" aria-label="分鐘">
              <option v-for="minute in minutes" :key="minute" :value="minute">{{ minute }}</option>
            </select>
          </div>

          <div class="calendar-footer">
            <button type="button" class="today-button" @click="selectToday">{{ isMonth ? '本月' : '今天' }}</button>
            <button v-if="isDateTime" type="button" class="confirm-button" @click="confirmDateTime">套用</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.app-date-picker {
  position: relative;
  min-width: 0;
  width: 100%;
}

.date-trigger {
  width: 100%;
  min-height: 36px;
  padding: 8px 10px;
  border: 1.5px solid var(--muted-line);
  border-radius: var(--r-sm);
  background: var(--paper);
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-label);
  font-weight: 800;
  text-align: left;
  transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
}

.date-trigger:hover, .date-trigger:focus-visible {
  border-color: var(--ink);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ink) 8%, transparent);
  outline: none;
}

.calendar-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  fill: none;
  stroke: var(--selection);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.date-trigger span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.date-trigger .placeholder { color: var(--muted); }

.chevron {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  fill: none;
  stroke: var(--muted);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.compact .date-trigger {
  min-height: 30px;
  padding: 4px 8px;
  font-size: var(--text-micro);
  font-weight: 600;
  background: var(--paper);
}

.app-date-picker.compact {
  width: 150px;
  /* Width controls row layouts; an explicit basis would become height in columns. */
  flex: 0 0 auto;
}

.compact .calendar-icon { width: 14px; height: 14px; }
.disabled { opacity: 0.55; }

.date-popover {
  position: fixed;
  z-index: var(--z-popover);
  padding: 12px;
  border: 1px solid var(--muted-line);
  border-radius: var(--r-lg);
  background: var(--paper);
  color: var(--ink);
  box-shadow: 0 18px 48px color-mix(in srgb, var(--ink-2) 20%, transparent), 0 3px 10px color-mix(in srgb, var(--ink-2) 8%, transparent);
}

.calendar-header {
  display: grid;
  grid-template-columns: 34px 1fr 34px;
  align-items: center;
  margin-bottom: 8px;
}

.calendar-header strong {
  text-align: center;
  font-size: var(--text-body);
  font-weight: 900;
}

.month-nav {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--muted);
  display: grid;
  place-items: center;
  font-size: var(--text-title);
  line-height: 1;
  transition: background 150ms ease, color 150ms ease;
}

.month-nav:hover, .month-nav:focus-visible {
  background: var(--muted-line2);
  color: var(--ink);
  outline: none;
}

.weekday-grid, .day-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.weekday-grid span {
  padding: 5px 0;
  color: var(--muted);
  font-size: var(--text-micro);
  font-weight: 800;
  text-align: center;
}

.day-grid { gap: 2px; }

.month-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
  padding: 6px 0 4px;
}

.month-button {
  min-height: 38px;
  border-radius: var(--r-md);
  color: var(--ink);
  font-size: var(--text-label);
  font-weight: 800;
  transition: background 120ms ease, color 120ms ease, transform 120ms ease;
}

.month-button:hover:not(:disabled), .month-button:focus-visible:not(:disabled) {
  background: var(--selection-soft);
  color: var(--selection);

  outline: none;
}

.month-button.current { box-shadow: inset 0 0 0 1.5px var(--warning); }
.month-button.selected { background: var(--accent-solid); color: var(--text-on-accent); box-shadow: none; }
.month-button:disabled { color: color-mix(in srgb, var(--muted) 28%, transparent); cursor: not-allowed; }

.day-button {
  aspect-ratio: 1;
  min-width: 0;
  border-radius: 50%;
  color: var(--ink);
  display: grid;
  place-items: center;
  font-size: var(--text-label);
  font-weight: 700;
  transition: background 120ms ease, color 120ms ease, transform 120ms ease;
}

.day-button:hover:not(:disabled), .day-button:focus-visible:not(:disabled) {
  background: var(--selection-soft);
  color: var(--selection);

  outline: none;
}

.day-button.outside { color: color-mix(in srgb, var(--muted) 45%, transparent); }
.day-button.today { box-shadow: inset 0 0 0 1.5px var(--warning); }
.day-button.selected {
  background: var(--accent-solid);
  color: var(--text-on-accent);
  box-shadow: none;
}
.day-button:disabled { color: color-mix(in srgb, var(--muted) 28%, transparent); cursor: not-allowed; }

.time-row {
  margin-top: 10px;
  padding: 10px 8px;
  border-top: 1px solid var(--muted-line2);
  border-bottom: 1px solid var(--muted-line2);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--muted);
  font-weight: 800;
}

.time-label { margin-right: auto; font-size: var(--text-label); }

.time-row select {
  padding: 5px 8px;
  border: 1px solid var(--muted-line);
  border-radius: var(--r-sm);
  background: var(--cream);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  font-weight: 800;
  outline: none;
}

.time-row select:focus { border-color: var(--selection); }

.calendar-footer {
  min-height: 37px;
  padding-top: 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.today-button, .confirm-button {
  padding: 6px 12px;
  border-radius: var(--r-sm);
  font-size: var(--text-label);
  font-weight: 900;
}

.today-button { color: var(--selection); }
.today-button:hover { background: var(--selection-soft); }
.confirm-button { margin-left: auto; background: var(--accent-solid); color: var(--text-on-accent); }
.confirm-button:hover { opacity: 0.86; }

.calendar-pop-enter-active, .calendar-pop-leave-active { transition: opacity 140ms ease, transform 140ms ease; }
.calendar-pop-enter-from, .calendar-pop-leave-to { opacity: 0; transform: translateY(-4px) scale(0.98); }

@media (max-width: 480px) {
  .date-popover { padding: 10px; }
  .day-grid { gap: 1px; }
  .app-date-picker.compact { width: 136px; }
}

@media (prefers-reduced-motion: reduce) {
  .calendar-pop-enter-active, .calendar-pop-leave-active, .day-button { transition: none; }
}
</style>
