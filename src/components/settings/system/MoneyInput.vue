<script setup>
import { computed, ref, watch } from 'vue'
import { currencyInfo } from '../../../utils/systemSettings'

// v-model 是幣別最小單位的整數；畫面上顯示、輸入的是主單位（例如 12.50 美元）。
const props = defineProps({
  modelValue: { type: [Number, String], default: 0 },
  currency: { type: String, default: 'TWD' },
  min: { type: Number, default: 0 },
  disabled: Boolean,
  id: { type: String, default: undefined },
  // 表格裡的小輸入框不需要幣別符號，樣式也沿用該表格的 class。
  showSymbol: { type: Boolean, default: true },
  inputClass: { type: String, default: 'sys-input' },
  ariaLabel: { type: String, default: undefined },
  placeholder: { type: String, default: undefined },
})
const emit = defineEmits(['update:modelValue'])

const info = computed(() => currencyInfo(props.currency))
const factor = computed(() => 10 ** info.value.decimals)
const toText = minor => (Math.round(Number(minor) || 0) / factor.value).toFixed(info.value.decimals)
const parse = (value) => {
  const text = String(value ?? '').trim().replace(/,/g, '')
  const decimals = info.value.decimals
  const pattern = decimals ? new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`) : /^\d+$/
  return pattern.test(text) ? Math.round(Number(text) * factor.value) : Number.NaN
}

const text = ref(toText(props.modelValue))
watch(() => [props.modelValue, props.currency], () => {
  if (parse(text.value) !== props.modelValue) text.value = toText(props.modelValue)
})

const invalid = computed(() => {
  const value = parse(text.value)
  return !Number.isFinite(value) || value < props.min
})

function onInput(event) {
  text.value = event.target.value
  const value = parse(text.value)
  if (Number.isFinite(value) && value >= props.min) emit('update:modelValue', value)
}
</script>

<template>
  <div v-if="showSymbol" class="sys-money">
    <span class="sys-money-symbol" aria-hidden="true">{{ info.symbol }}</span>
    <input
      :id="id"
      :class="inputClass"
      type="text"
      inputmode="decimal"
      :value="text"
      :disabled="disabled"
      :aria-invalid="invalid"
      :aria-label="ariaLabel"
      :placeholder="placeholder"
      @input="onInput"
      @blur="text = toText(modelValue)"
    >
  </div>
  <input
    v-else
    :id="id"
    :class="inputClass"
    type="text"
    inputmode="decimal"
    :value="text"
    :disabled="disabled"
    :aria-invalid="invalid"
    :aria-label="ariaLabel"
    :placeholder="placeholder"
    @input="onInput"
    @blur="text = toText(modelValue)"
  >
</template>
