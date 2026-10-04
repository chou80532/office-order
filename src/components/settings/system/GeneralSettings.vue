<script setup>
import { computed, useId } from 'vue'
import { CURRENCIES, defaultLimits, listTimeZones } from '../../../utils/systemSettings'
import { SUPPORTED_LOCALES, t } from '../../../i18n'
import MoneyInput from './MoneyInput.vue'

// 語言、時區、幣別與金額上限。compact（首次設定頁）只顯示前三項。
const props = defineProps({
  modelValue: { type: Object, required: true },
  disabled: Boolean,
  compact: Boolean,
})
const emit = defineEmits(['update:modelValue'])

const id = useId()
const timeZones = computed(() => listTimeZones('UTC', props.modelValue.timeZone))
const update = patch => emit('update:modelValue', { ...props.modelValue, ...patch })
// 換幣別時金額上限一併換成新幣別的預設值，避免小數位數不同時上限變得不合理。
const setCurrency = code => update({ currency: code, limits: defaultLimits(code) })
const setLimit = (key, value) => update({ limits: { ...props.modelValue.limits, [key]: value } })
</script>

<template>
  <div class="sys-fields">
    <div class="sys-row">
      <div class="sys-field">
        <label class="sys-label" :for="`${id}-locale`">{{ t('system.locale.label') }}</label>
        <select :id="`${id}-locale`" class="sys-input" :value="modelValue.locale" :disabled="disabled" @change="update({ locale: $event.target.value })">
          <option v-for="option in SUPPORTED_LOCALES" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>
      <div class="sys-field">
        <label class="sys-label" :for="`${id}-currency`">{{ t('system.currency.label') }}</label>
        <select :id="`${id}-currency`" class="sys-input" :value="modelValue.currency" :disabled="disabled" @change="setCurrency($event.target.value)">
          <option v-for="currency in CURRENCIES" :key="currency.code" :value="currency.code">{{ currency.code }} ({{ currency.symbol }})</option>
        </select>
      </div>
    </div>
    <p class="sys-hint">{{ t('system.locale.hint') }}</p>

    <div class="sys-field">
      <label class="sys-label" :for="`${id}-time-zone`">{{ t('system.timeZone.label') }}</label>
      <select :id="`${id}-time-zone`" class="sys-input" :value="modelValue.timeZone" :disabled="disabled" @change="update({ timeZone: $event.target.value })">
        <option v-for="zone in timeZones" :key="zone" :value="zone">{{ zone }}</option>
      </select>
      <p class="sys-hint">{{ t('system.timeZone.hint') }}</p>
    </div>

    <div v-if="!compact" class="sys-row">
      <div class="sys-field">
        <label class="sys-label" :for="`${id}-max-item`">{{ t('system.limits.maxItemPrice') }}</label>
        <MoneyInput :id="`${id}-max-item`" :model-value="modelValue.limits.maxItemPrice" :currency="modelValue.currency" :min="1" :disabled="disabled" @update:model-value="setLimit('maxItemPrice', $event)" />
      </div>
      <div class="sys-field">
        <label class="sys-label" :for="`${id}-max-top-up`">{{ t('system.limits.maxTopUp') }}</label>
        <MoneyInput :id="`${id}-max-top-up`" :model-value="modelValue.limits.maxTopUp" :currency="modelValue.currency" :min="1" :disabled="disabled" @update:model-value="setLimit('maxTopUp', $event)" />
      </div>
      <div class="sys-field">
        <label class="sys-label" :for="`${id}-low-balance`">{{ t('system.limits.lowBalance') }}</label>
        <MoneyInput :id="`${id}-low-balance`" :model-value="modelValue.limits.lowBalance" :currency="modelValue.currency" :disabled="disabled" @update:model-value="setLimit('lowBalance', $event)" />
      </div>
    </div>
    <p v-if="!compact" class="sys-hint">{{ t('system.limits.lowBalanceHint') }}</p>
  </div>
</template>
