<script setup>
import { computed, onMounted, ref, useId } from 'vue'
import { PAYMENT_MODES, paymentMethodsForMode, paymentModeOf } from '../../../utils/systemSettings'
import { formatMoney, getLocalDateKey } from '../../../utils/format'
import { grantMonthlyAllowanceViaFunction } from '../../../services/adminFunctions'
import { confirmDialog } from '../../../composables/useDialog'
import { useToast } from '../../../composables/useToast'
import { t, translateError } from '../../../i18n'
import MoneyInput from './MoneyInput.vue'

// 付款模式與每月補助。compact（首次設定頁）只顯示付款模式。
const props = defineProps({
  modelValue: { type: Object, required: true },
  savedSettings: { type: Object, default: null },
  disabled: Boolean,
  compact: Boolean,
})
const emit = defineEmits(['update:modelValue'])
const { showToast } = useToast()

const id = useId()
const mode = computed(() => paymentModeOf(props.modelValue.paymentMethods))
const walletOn = computed(() => props.modelValue.paymentMethods.wallet)
const update = patch => emit('update:modelValue', { ...props.modelValue, ...patch })
const setMode = value => update({ paymentMethods: paymentMethodsForMode(value) })
const setAllowance = amount => update({ subsidy: { ...props.modelValue.subsidy, monthlyAllowance: amount } })

// 「立即發放」只看已儲存的設定，避免草稿金額尚未生效就被撥出。
const savedAllowance = computed(() => props.savedSettings?.paymentMethods?.wallet ? props.savedSettings.subsidy.monthlyAllowance : 0)
const currentMonth = () => getLocalDateKey().slice(0, 7)
const lastRun = ref(null)
const granting = ref(false)

async function loadLastRun() {
  if (props.compact) return
  try {
    const [{ doc, getDoc }, { db }] = await Promise.all([import('firebase/firestore'), import('../../../firestore')])
    const snap = await getDoc(doc(db, 'allowance_runs', currentMonth()))
    lastRun.value = snap.exists() ? snap.data() : null
  } catch {
    lastRun.value = null
  }
}
onMounted(loadLastRun)

async function grantNow() {
  if (granting.value || savedAllowance.value <= 0) return
  const confirmed = await confirmDialog({
    title: t('system.subsidy.grantConfirmTitle'),
    message: t('system.subsidy.grantConfirmMessage', { amount: formatMoney(savedAllowance.value) }),
  })
  if (!confirmed) return
  granting.value = true
  try {
    const result = await grantMonthlyAllowanceViaFunction()
    showToast(t('system.subsidy.granted', { count: result?.granted || 0 }), 'success')
    await loadLastRun()
  } catch (error) {
    showToast(translateError(error), 'error')
  } finally {
    granting.value = false
  }
}
</script>

<template>
  <div class="sys-fields">
    <fieldset class="sys-field">
      <legend class="sys-label">{{ t('system.paymentMode.label') }}</legend>
      <label v-for="option in PAYMENT_MODES" :key="option" class="sys-choice">
        <input type="radio" :name="`${id}-payment-mode`" :value="option" :checked="mode === option" :disabled="disabled" @change="setMode(option)">
        <span><strong>{{ t(`system.paymentMode.${option}.label`) }}</strong><small>{{ t(`system.paymentMode.${option}.description`) }}</small></span>
      </label>
    </fieldset>

    <div v-if="!compact" class="sys-field">
      <label class="sys-label" :for="`${id}-allowance`">{{ t('system.subsidy.label') }}</label>
      <template v-if="walletOn">
        <MoneyInput :id="`${id}-allowance`" :model-value="modelValue.subsidy.monthlyAllowance" :currency="modelValue.currency" :disabled="disabled" @update:model-value="setAllowance" />
        <p class="sys-hint">{{ t('system.subsidy.hint') }}</p>
        <p v-if="savedSettings?.subsidy?.effectiveFrom && savedAllowance > 0" class="sys-hint">
          {{ t('system.subsidy.effectiveFrom', { month: savedSettings.subsidy.effectiveFrom }) }}
        </p>
        <p v-if="lastRun" class="sys-hint">{{ t('system.subsidy.lastRun', { month: lastRun.month, count: lastRun.granted }) }}</p>
        <button type="button" class="sys-secondary-btn" :disabled="disabled || granting || savedAllowance <= 0" :title="savedAllowance <= 0 ? t('system.subsidy.saveFirst') : ''" @click="grantNow">
          <i class="fas fa-hand-holding-dollar" aria-hidden="true"></i>
          {{ granting ? t('system.subsidy.granting') : t('system.subsidy.grantNow') }}
        </button>
      </template>
      <p v-else class="sys-hint">{{ t('system.subsidy.walletRequired') }}</p>
    </div>
  </div>
</template>
