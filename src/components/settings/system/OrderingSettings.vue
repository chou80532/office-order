<script setup>
import { useId } from 'vue'
import { PROXY_ORDERING_MODES } from '../../../utils/systemSettings'
import { t } from '../../../i18n'

// 代訂規則與每日收單時間。compact（首次設定頁）只顯示代訂規則。
const props = defineProps({
  modelValue: { type: Object, required: true },
  disabled: Boolean,
  compact: Boolean,
})
const emit = defineEmits(['update:modelValue'])

const id = useId()
const update = patch => emit('update:modelValue', { ...props.modelValue, ...patch })
const setCutoff = value => update({ ordering: { ...props.modelValue.ordering, defaultCutoff: value } })
</script>

<template>
  <div class="sys-fields">
    <fieldset class="sys-field">
      <legend class="sys-label">{{ t('system.proxy.label') }}</legend>
      <label v-for="option in PROXY_ORDERING_MODES" :key="option" class="sys-choice">
        <input type="radio" :name="`${id}-proxy`" :value="option" :checked="modelValue.proxyOrdering === option" :disabled="disabled" @change="update({ proxyOrdering: option })">
        <span><strong>{{ t(`system.proxy.${option}.label`) }}</strong><small>{{ t(`system.proxy.${option}.description`) }}</small></span>
      </label>
    </fieldset>

    <div v-if="!compact" class="sys-field">
      <label class="sys-label" :for="`${id}-cutoff`">{{ t('system.cutoff.label') }}</label>
      <div class="cutoff-row">
        <input :id="`${id}-cutoff`" class="sys-input" type="time" :value="modelValue.ordering.defaultCutoff" :disabled="disabled" @change="setCutoff($event.target.value)">
        <button v-if="modelValue.ordering.defaultCutoff" type="button" class="sys-secondary-btn" :disabled="disabled" @click="setCutoff('')">
          {{ t('common.clear') }}
        </button>
      </div>
      <p class="sys-hint">{{ t('system.cutoff.hint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.cutoff-row { display: flex; gap: 8px; align-items: center; }
.cutoff-row .sys-input { max-width: 180px; }
</style>
