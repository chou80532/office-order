<script setup>
import { computed, ref, watch } from 'vue'
import { useFirestore } from '../../composables/useFirestore'
import { useToast } from '../../composables/useToast'
import { updateSystemSettingsViaFunction } from '../../services/adminFunctions'
import { currencyInfo, isTrackingOnly, normalizeSystemSettings } from '../../utils/systemSettings'
import { t, translateError } from '../../i18n'
import LoadingState from '../ui/LoadingState.vue'
import GeneralSettings from './system/GeneralSettings.vue'
import BrandingSettings from './system/BrandingSettings.vue'
import PaymentSettings from './system/PaymentSettings.vue'
import OrderingSettings from './system/OrderingSettings.vue'
import RegistrationSettings from './system/RegistrationSettings.vue'
import RetentionSettings from './system/RetentionSettings.vue'
import NotificationSettings from './system/NotificationSettings.vue'

const { systemSettings, systemSettingsReady } = useFirestore()
const { showToast } = useToast()

const clone = settings => normalizeSystemSettings(JSON.parse(JSON.stringify(settings)))
const draft = ref(clone(systemSettings.value))
const saving = ref(false)

const sameSettings = (a, b) => JSON.stringify(normalizeSystemSettings(a)) === JSON.stringify(normalizeSystemSettings(b))
const dirty = computed(() => !sameSettings(draft.value, systemSettings.value))

// 其他管理員更新設定時，未修改的草稿跟著同步；正在編輯的內容不覆蓋。
watch(systemSettings, (next, previous) => {
  if (!previous || sameSettings(draft.value, previous)) draft.value = clone(next)
})

const SECTIONS = [
  { id: 'general', icon: 'fa-globe', component: GeneralSettings },
  { id: 'branding', icon: 'fa-palette', component: BrandingSettings },
  { id: 'payment', icon: 'fa-wallet', component: PaymentSettings },
  { id: 'ordering', icon: 'fa-clipboard-list', component: OrderingSettings },
  { id: 'registration', icon: 'fa-user-plus', component: RegistrationSettings },
  { id: 'retention', icon: 'fa-box-archive', component: RetentionSettings },
]

const warnings = computed(() => {
  const current = systemSettings.value
  const next = draft.value
  const list = []
  if (next.timeZone !== current.timeZone) list.push(t('system.warnings.timeZone'))
  if (currencyInfo(next.currency).decimals !== currencyInfo(current.currency).decimals) list.push(t('system.warnings.currencyDecimals'))
  if (isTrackingOnly(next) && !isTrackingOnly(current)) list.push(t('system.warnings.trackingOnly'))
  else {
    if (current.paymentMethods.wallet && !next.paymentMethods.wallet) list.push(t('system.warnings.wallet'))
    if (current.paymentMethods.cash && !next.paymentMethods.cash) list.push(t('system.warnings.cash'))
  }
  const days = next.retention.autoDeleteDays
  if (days && (!current.retention.autoDeleteDays || days < current.retention.autoDeleteDays)) {
    list.push(t('system.warnings.retention', { days }))
  }
  return list
})

async function save() {
  if (!dirty.value || saving.value) return
  saving.value = true
  try {
    const result = await updateSystemSettingsViaFunction(draft.value)
    draft.value = clone(result?.settings || draft.value)
    showToast(t('system.saved'), 'success')
  } catch (error) {
    showToast(translateError(error, 'system.saveFailed'), 'error')
  } finally {
    saving.value = false
  }
}

function reset() {
  draft.value = clone(systemSettings.value)
}
</script>

<template>
  <div class="system-panel ops-surface">
    <LoadingState v-if="!systemSettingsReady" :title="t('common.loading')" :description="t('system.loading')" />
    <template v-else>
      <form class="system-form" @submit.prevent="save">
        <section v-for="section in SECTIONS" :key="section.id" class="system-card" :aria-labelledby="`system-${section.id}`">
          <h2 :id="`system-${section.id}`" class="card-title">
            <i :class="['fas', section.icon]" aria-hidden="true"></i>
            {{ t(`system.sections.${section.id}`) }}
          </h2>
          <component :is="section.component" v-model="draft" v-bind="section.id === 'payment' ? { savedSettings: systemSettings } : {}" :disabled="saving" />
        </section>

        <div class="save-bar" :class="{ visible: dirty }">
          <ul v-if="warnings.length" class="warnings" role="status">
            <li v-for="warning in warnings" :key="warning">
              <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
              <span>{{ warning }}</span>
            </li>
          </ul>
          <div class="actions">
            <button type="button" class="btn btn-secondary" :disabled="!dirty || saving" @click="reset">{{ t('common.reset') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="!dirty || saving">
              {{ saving ? t('common.saving') : t('common.saveSettings') }}
            </button>
          </div>
        </div>
      </form>

      <section class="system-card notifications-card" aria-labelledby="system-notifications">
        <h2 id="system-notifications" class="card-title">
          <i class="fas fa-bell" aria-hidden="true"></i>
          {{ t('system.sections.notifications') }}
        </h2>
        <NotificationSettings />
      </section>
    </template>
  </div>
</template>

<style scoped>
.system-panel { min-height: 100%; display: flex; flex-direction: column; gap: 16px; }
.system-form { display: flex; flex-direction: column; gap: 16px; }

.system-card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 760px;
  padding: 22px 24px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-card);
}
.card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: var(--text-lead);
  color: var(--text-primary);
}
.card-title i { color: var(--persimmon-light); font-size: var(--text-body); }

.save-bar {
  position: sticky;
  bottom: 12px;
  z-index: 2;
  display: none;
  flex-direction: column;
  gap: 12px;
  max-width: 760px;
  padding: 14px 16px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-lg);
  background: var(--bg-elevated, var(--bg-card));
  box-shadow: var(--shadow-soft);
}
.save-bar.visible { display: flex; }

.warnings { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.warnings li {
  display: flex;
  gap: 10px;
  color: var(--text-primary);
  font-size: var(--text-label);
  line-height: 1.6;
}
.warnings i { margin-top: 3px; color: var(--gold); }

.actions { display: flex; justify-content: flex-end; gap: 8px; }

@media (max-width: 640px) {
  .system-card { padding: 16px; }
}
</style>
