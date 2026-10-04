<script setup>
import { computed, ref, useId } from 'vue'
import { useOrderingCutoff } from '../../composables/useOrderingCutoff'
import { useToast } from '../../composables/useToast'
import { confirmDialog } from '../../composables/useDialog'
import { setDailyCutoffViaFunction } from '../../services/adminFunctions'
import { t, translateError } from '../../i18n'

// 管理員在今日訂單調整「今天」的收單時間；系統預設值在「系統設定 → 點餐規則」。
const { cutoffTime, closed, isOverride, refreshNow } = useOrderingCutoff()
const { showToast } = useToast()
const id = useId()
const editing = ref(false)
const timeInput = ref('')
const busy = ref(false)

const summary = computed(() => {
  if (!cutoffTime.value) return t('dashboard.cutoff.none')
  return closed.value ? t('dashboard.cutoff.closed', { time: cutoffTime.value }) : t('dashboard.cutoff.at', { time: cutoffTime.value })
})

async function apply(time) {
  busy.value = true
  try {
    await setDailyCutoffViaFunction(time)
    refreshNow()
    editing.value = false
    showToast(t('dashboard.cutoff.saved'), 'success')
  } catch (error) {
    showToast(translateError(error, 'dashboard.cutoff.failed'), 'error')
  } finally {
    busy.value = false
  }
}

async function closeNow() {
  const confirmed = await confirmDialog({
    title: t('dashboard.cutoff.closeNowConfirmTitle'),
    message: t('dashboard.cutoff.closeNowConfirmMessage'),
    confirmText: t('dashboard.cutoff.closeNow'),
  })
  if (confirmed) await apply('now')
}

function startEditing() {
  timeInput.value = cutoffTime.value || ''
  editing.value = true
}
</script>

<template>
  <section class="cutoff-control" :class="{ closed }" :aria-labelledby="`${id}-label`">
    <div class="cutoff-summary">
      <i :class="['fas', closed ? 'fa-lock' : 'fa-clock']" aria-hidden="true"></i>
      <span :id="`${id}-label`" class="cutoff-label">{{ t('dashboard.cutoff.label') }}</span>
      <strong>{{ summary }}</strong>
      <small>{{ isOverride ? t('dashboard.cutoff.todayHint') : t('dashboard.cutoff.defaultHint') }}</small>
    </div>

    <form v-if="editing" class="cutoff-edit" @submit.prevent="timeInput && apply(timeInput)">
      <input v-model="timeInput" class="cutoff-time" type="time" required :aria-label="t('dashboard.cutoff.setTime')" :disabled="busy">
      <button type="submit" class="cutoff-btn primary" :disabled="busy || !timeInput">{{ t('dashboard.cutoff.apply') }}</button>
      <button type="button" class="cutoff-btn" :disabled="busy" @click="editing = false">{{ t('common.cancel') }}</button>
    </form>
    <div v-else class="cutoff-actions">
      <button v-if="!closed" type="button" class="cutoff-btn primary" :disabled="busy" @click="closeNow">{{ t('dashboard.cutoff.closeNow') }}</button>
      <button type="button" class="cutoff-btn" :disabled="busy" @click="startEditing">{{ t('dashboard.cutoff.setTime') }}</button>
      <button v-if="cutoffTime" type="button" class="cutoff-btn" :disabled="busy" @click="apply('')">{{ t('dashboard.cutoff.noCutoff') }}</button>
      <button v-if="isOverride" type="button" class="cutoff-btn" :disabled="busy" @click="apply(null)">{{ t('dashboard.cutoff.useDefault') }}</button>
    </div>
  </section>
</template>

<style scoped>
.cutoff-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  margin-bottom: 16px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-card);
}
.cutoff-control.closed { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
.cutoff-summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; min-width: 0; font-size: var(--text-body); color: var(--text-primary); }
.cutoff-summary i { color: var(--accent); }
.cutoff-control.closed .cutoff-summary i { color: var(--danger); }
.cutoff-label { color: var(--muted); font-size: var(--text-label); font-weight: 600; }
.cutoff-summary small { color: var(--muted); font-size: var(--text-micro); }
.cutoff-actions, .cutoff-edit { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.cutoff-time { padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: var(--r-md); background: var(--input-bg); color: var(--text-primary); font-size: var(--text-label); }
.cutoff-btn {
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 700;
}
.cutoff-btn.primary { border-color: transparent; background: var(--accent-solid); color: var(--text-on-accent); }
.cutoff-btn:disabled { opacity: .5; cursor: not-allowed; }
</style>
