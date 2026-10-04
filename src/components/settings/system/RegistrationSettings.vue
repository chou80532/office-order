<script setup>
import { computed, ref, useId, watch } from 'vue'
import { MAX_EMAIL_DOMAINS, normalizeEmailDomain } from '../../../utils/systemSettings'
import { t } from '../../../i18n'

const props = defineProps({
  modelValue: { type: Object, required: true },
  disabled: Boolean,
})
const emit = defineEmits(['update:modelValue'])

const id = useId()
const domainsText = ref(props.modelValue.registration.allowedEmailDomains.join('\n'))
const lines = computed(() => domainsText.value.split(/[\n,]/).map(line => line.trim()).filter(Boolean))
const invalidLines = computed(() => lines.value.filter(line => !normalizeEmailDomain(line)))
const tooMany = computed(() => lines.value.length > MAX_EMAIL_DOMAINS)

// 外部（例如「還原」）改變設定時同步文字框；使用者正在輸入的不合法內容不覆蓋。
watch(() => props.modelValue.registration.allowedEmailDomains, (domains) => {
  const current = [...new Set(lines.value.map(normalizeEmailDomain).filter(Boolean))]
  if (current.join('\n') !== domains.join('\n')) domainsText.value = domains.join('\n')
})

const update = registration => emit('update:modelValue', {
  ...props.modelValue,
  registration: { ...props.modelValue.registration, ...registration },
})

function onDomainsInput(event) {
  domainsText.value = event.target.value
  if (invalidLines.value.length || tooMany.value) return
  update({ allowedEmailDomains: [...new Set(lines.value.map(normalizeEmailDomain))] })
}
</script>

<template>
  <div class="sys-fields">
    <div class="sys-field">
      <label class="sys-label" :for="`${id}-domains`">{{ t('system.registration.domainsLabel') }}</label>
      <textarea
        :id="`${id}-domains`"
        class="sys-input"
        rows="3"
        placeholder="example.com"
        :value="domainsText"
        :disabled="disabled"
        :aria-invalid="invalidLines.length > 0 || tooMany"
        @input="onDomainsInput"
      ></textarea>
      <p v-if="invalidLines.length || tooMany" class="sys-error" role="alert">{{ t('errors.INVALID_EMAIL_DOMAIN') }}</p>
      <p class="sys-hint">{{ t('system.registration.domainsHint') }}</p>
    </div>

    <label class="sys-choice">
      <input type="checkbox" :checked="modelValue.registration.googleSignIn" :disabled="disabled" @change="update({ googleSignIn: $event.target.checked })">
      <span><strong>{{ t('system.registration.googleLabel') }}</strong><small>{{ t('system.registration.googleHint') }}</small></span>
    </label>
  </div>
</template>
