<script setup>
import { computed, onMounted, ref, useId } from 'vue'
import { sendTestNotificationViaFunction, updateNotificationSettingsViaFunction } from '../../../services/adminFunctions'
import { useToast } from '../../../composables/useToast'
import { t, translateError } from '../../../i18n'

// 通知設定存在只有管理員能讀的 settings/notifications，與系統設定分開儲存。
const EVENTS = ['storesOpened', 'cutoffReminder', 'orderingClosed', 'storeReplaced']
const normalize = (data = {}) => ({
  webhookUrl: String(data?.webhookUrl || ''),
  events: Object.fromEntries(EVENTS.map(event => [event, data?.events?.[event] !== false])),
  reminderMinutes: Number.isInteger(data?.reminderMinutes) ? data.reminderMinutes : 15,
})

const { showToast } = useToast()
const id = useId()
const saved = ref(normalize())
const draft = ref(normalize())
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)

const dirty = computed(() => JSON.stringify(saved.value) !== JSON.stringify(draft.value))
const webhookInvalid = computed(() => {
  const url = draft.value.webhookUrl.trim()
  if (!url) return false
  try {
    const parsed = new URL(url)
    return !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)))
  } catch {
    return true
  }
})
const reminderInvalid = computed(() => !Number.isInteger(draft.value.reminderMinutes) || draft.value.reminderMinutes < 5 || draft.value.reminderMinutes > 180)

onMounted(async () => {
  try {
    const [{ doc, getDoc }, { db }] = await Promise.all([import('firebase/firestore'), import('../../../firestore')])
    const snap = await getDoc(doc(db, 'settings', 'notifications'))
    saved.value = normalize(snap.exists() ? snap.data() : {})
    draft.value = JSON.parse(JSON.stringify(saved.value))
  } catch (error) {
    console.error('[notifications] load failed', error)
  } finally {
    loading.value = false
  }
})

async function save() {
  if (!dirty.value || webhookInvalid.value || reminderInvalid.value || saving.value) return
  saving.value = true
  try {
    const result = await updateNotificationSettingsViaFunction({ ...draft.value, webhookUrl: draft.value.webhookUrl.trim() })
    saved.value = normalize(result?.settings)
    draft.value = JSON.parse(JSON.stringify(saved.value))
    showToast(t('system.notifications.saved'), 'success')
  } catch (error) {
    showToast(translateError(error, 'system.saveFailed'), 'error')
  } finally {
    saving.value = false
  }
}

async function sendTest() {
  if (testing.value) return
  testing.value = true
  try {
    const result = await sendTestNotificationViaFunction()
    showToast(t('system.notifications.testResult', {
      webhook: t(`system.notifications.webhookStatus.${result?.webhook || 'skipped'}`),
      push: result?.push || 0,
    }), result?.webhook === 'failed' ? 'error' : 'success')
  } catch (error) {
    showToast(translateError(error), 'error')
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="sys-fields">
    <p class="sys-hint">{{ t('system.notifications.hint') }}</p>

    <div class="sys-field">
      <label class="sys-label" :for="`${id}-webhook`">{{ t('system.notifications.webhookLabel') }}</label>
      <input
        :id="`${id}-webhook`"
        v-model="draft.webhookUrl"
        class="sys-input"
        type="url"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('system.notifications.webhookPlaceholder')"
        :disabled="loading || saving"
        :aria-invalid="webhookInvalid"
      >
      <p v-if="webhookInvalid" class="sys-error" role="alert">{{ t('errors.INVALID_WEBHOOK_URL') }}</p>
      <p class="sys-hint">{{ t('system.notifications.webhookHint') }}</p>
    </div>

    <fieldset class="sys-field">
      <legend class="sys-label">{{ t('system.notifications.events') }}</legend>
      <label v-for="event in EVENTS" :key="event" class="sys-choice">
        <input v-model="draft.events[event]" type="checkbox" :disabled="loading || saving">
        <span><strong>{{ t(`system.notifications.eventLabels.${event}`) }}</strong></span>
      </label>
    </fieldset>

    <div class="sys-field">
      <label class="sys-label" :for="`${id}-reminder`">{{ t('system.notifications.reminderMinutes') }}</label>
      <input :id="`${id}-reminder`" v-model.number="draft.reminderMinutes" class="sys-input reminder-input" type="number" min="5" max="180" step="5" :disabled="loading || saving" :aria-invalid="reminderInvalid">
    </div>

    <div class="actions">
      <button type="button" class="btn btn-secondary" :disabled="loading || testing" @click="sendTest">
        {{ testing ? t('system.notifications.testing') : t('system.notifications.test') }}
      </button>
      <button type="button" class="btn btn-primary" :disabled="loading || saving || !dirty || webhookInvalid || reminderInvalid" @click="save">
        {{ saving ? t('common.saving') : t('system.notifications.save') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.reminder-input { max-width: 140px; }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
</style>
