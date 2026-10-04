<script setup>
import { computed, useId } from 'vue'
import { t } from '../../../i18n'

const props = defineProps({
  modelValue: { type: Object, required: true },
  disabled: Boolean,
})
const emit = defineEmits(['update:modelValue'])

const id = useId()
const PRESETS = [0, 30, 60, 90, 180, 365, 730]
const options = computed(() => [...new Set([...PRESETS, props.modelValue.retention.autoDeleteDays])].sort((a, b) => a - b))
const setDays = days => emit('update:modelValue', { ...props.modelValue, retention: { autoDeleteDays: Number(days) } })
</script>

<template>
  <div class="sys-fields">
    <div class="sys-field">
      <label class="sys-label" :for="`${id}-retention`">{{ t('system.retention.label') }}</label>
      <select :id="`${id}-retention`" class="sys-input" :value="modelValue.retention.autoDeleteDays" :disabled="disabled" @change="setDays($event.target.value)">
        <option v-for="days in options" :key="days" :value="days">
          {{ days ? t('system.retention.days', { days }) : t('system.retention.off') }}
        </option>
      </select>
      <p class="sys-hint">{{ t('system.retention.hint') }}</p>
    </div>
  </div>
</template>
