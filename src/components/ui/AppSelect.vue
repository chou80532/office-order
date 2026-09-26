<script setup>
import { computed, ref, useId, onMounted, onUnmounted, nextTick } from 'vue'
const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '請選擇' },
  label: { type: String, required: true },
  disabled: Boolean,
})
const emit = defineEmits(['update:modelValue'])
const root = ref(null)
const trigger = ref(null)
const open = ref(false)
const id = useId()
const selected = computed(() => props.options.find(option => option.value === props.modelValue))
function close(focus = false) {
  open.value = false
  if (focus) trigger.value?.focus()
}
async function expand() {
  if (props.disabled) return
  open.value = true
  await nextTick()
  const buttons = root.value?.querySelectorAll('[role="option"]')
  const index = props.options.findIndex(option => option.value === props.modelValue)
  buttons?.[Math.max(0, index)]?.focus()
}
function choose(value) { emit('update:modelValue', value); close(true) }
function keydown(event) {
  if (event.key === 'Escape' && open.value) { event.stopPropagation(); event.preventDefault(); close(true) }
  if (!open.value || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = [...root.value.querySelectorAll('[role="option"]')]
  const index = buttons.indexOf(document.activeElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
function outside(event) { if (!root.value?.contains(event.target)) close() }
function focusout(event) { if (!root.value?.contains(event.relatedTarget)) close() }
onMounted(() => document.addEventListener('pointerdown', outside))
onUnmounted(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="app-select" @keydown="keydown" @focusout="focusout">
    <button ref="trigger" type="button" class="select-trigger" :disabled="disabled" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="id" @click="open ? close() : expand()" @keydown.down.prevent="expand" @keydown.up.prevent="expand">
      <span :class="{ placeholder: !selected }">{{ selected?.label || placeholder }}</span>
      <i class="fas fa-chevron-down" aria-hidden="true" />
    </button>
    <div v-if="open" :id="id" class="select-options" role="listbox" :aria-label="label">
      <button v-for="option in options" :key="option.value" type="button" role="option" :aria-selected="modelValue === option.value" @click="choose(option.value)">
        <span>{{ option.label }}</span><i v-if="modelValue === option.value" class="fas fa-check" aria-hidden="true" />
      </button>
      <p v-if="!options.length" class="placeholder">目前沒有可選店家</p>
    </div>
  </div>
</template>

<style scoped>
.app-select { width: 100%; min-width: 0; text-align: left; }
.select-trigger, .select-options button { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 12px 14px; color: var(--ink); font: inherit; text-align: left; }
.select-trigger { min-height: 44px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-inset); }
.select-trigger span, .select-options span { overflow-wrap: anywhere; }
.select-trigger i { font-size: var(--text-label); color: var(--muted); }
.select-trigger:disabled { opacity: .5; cursor: not-allowed; }
.select-trigger:focus-visible, .select-options button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.select-options { margin-top: 6px; padding: 4px; max-height: 220px; overflow-y: auto; overscroll-behavior: contain; background: var(--paper); border: 1px solid var(--border); border-radius: var(--r-md); box-shadow: var(--shadow-card); }
.select-options button { min-height: 44px; background: transparent; border-radius: var(--r-sm); }
.select-options button:hover, .select-options button[aria-selected="true"] { background: var(--bg-accent); color: var(--accent); }
.placeholder { color: var(--muted); }
</style>
