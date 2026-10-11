<script setup>
import { computed, ref, useId, watch } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useFirestore } from '../../composables/useFirestore'
import { useToast } from '../../composables/useToast'
import { useModalA11y } from '../../composables/useModalA11y'
import { disablePush, enablePush, pushAvailable, pushEnabledOnDevice, pushPermission } from '../../services/push'
import { SUPPORTED_LOCALES, setUserLocale, t, translateError, userLocalePreference } from '../../i18n'
import { normalizeDietaryPreferences } from '../../utils/dietaryTags'

// 由父元件以 v-if 控制開關，掛載時即為開啟狀態（useModalA11y 依掛載／卸載管理焦點）。
const emit = defineEmits(['close'])

const { allowProxyOrders, dietaryPreferences, updatePreferences } = useAuth()
const { systemSettings } = useFirestore()
const { showToast } = useToast()
const id = useId()
const dialog = ref(null)

const systemLanguageLabel = computed(() =>
  SUPPORTED_LOCALES.find(option => option.value === systemSettings.value.locale)?.label || systemSettings.value.locale)
const showConsent = computed(() => systemSettings.value.proxyOrdering === 'consent')
const savingConsent = ref(false)
const pushSupported = pushAvailable()
const pushOn = ref(pushEnabledOnDevice())
const pushBusy = ref(false)
const dietaryDraft = ref(normalizeDietaryPreferences(dietaryPreferences?.value))
const savingDietary = ref(false)
const dietaryCatalog = computed(() => [...new Set([
  ...(systemSettings.value.dietary?.tags || []),
  ...dietaryDraft.value.preferredTags, ...dietaryDraft.value.avoidedTags,
])])
watch(() => dietaryPreferences?.value, value => { dietaryDraft.value = normalizeDietaryPreferences(value) })

function toggleDietary(kind, tag, checked) {
  const other = kind === 'preferredTags' ? 'avoidedTags' : 'preferredTags'
  dietaryDraft.value[kind] = checked ? [...dietaryDraft.value[kind], tag] : dietaryDraft.value[kind].filter(value => value !== tag)
  if (checked) dietaryDraft.value[other] = dietaryDraft.value[other].filter(value => value !== tag)
}

async function saveDietary() {
  savingDietary.value = true
  try {
    await updatePreferences({ dietary: dietaryDraft.value })
    showToast(t('dietary.saved'), 'success')
  } catch (error) {
    showToast(translateError(error, 'nav.personal.saveFailed'), 'error')
  } finally {
    savingDietary.value = false
  }
}

useModalA11y(dialog, { onEscape: () => emit('close') })

async function toggleConsent(event) {
  const next = event.target.checked
  savingConsent.value = true
  try {
    await updatePreferences({ allowProxyOrders: next })
    showToast(t(next ? 'nav.personal.proxyConsentOn' : 'nav.personal.proxyConsentOff'), 'success')
  } catch (error) {
    event.target.checked = !next
    showToast(translateError(error, 'nav.personal.saveFailed'), 'error')
  } finally {
    savingConsent.value = false
  }
}

async function togglePush(event) {
  const next = event.target.checked
  pushBusy.value = true
  try {
    if (next) await enablePush()
    else await disablePush()
    pushOn.value = next
    showToast(t(next ? 'nav.personal.pushEnabled' : 'nav.personal.pushDisabled'), 'success')
  } catch (error) {
    event.target.checked = pushOn.value
    showToast(error?.message === 'PUSH_DENIED' || pushPermission() === 'denied' ? t('nav.personal.pushDenied') : t('nav.personal.pushFailed'), 'error')
  } finally {
    pushBusy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="overlay" appear>
      <div class="overlay" @click.self="emit('close')">
        <div ref="dialog" class="personal-modal" role="dialog" aria-modal="true" :aria-labelledby="`${id}-title`" tabindex="-1">
          <div class="personal-header">
            <span class="head-icon" aria-hidden="true"><i class="fas fa-user-gear"></i></span>
            <div class="head-text">
              <h3 :id="`${id}-title`" class="personal-title">{{ t('nav.personal.title') }}</h3>
              <p class="personal-sub">{{ t('nav.personal.subtitle') }}</p>
            </div>
            <button type="button" class="personal-close" :aria-label="t('common.close')" @click="emit('close')">×</button>
          </div>

          <div class="personal-body sys-fields">
            <div class="sys-field">
              <label class="sys-label" :for="`${id}-locale`">{{ t('nav.personal.language') }}</label>
              <select :id="`${id}-locale`" class="sys-input" :value="userLocalePreference" @change="setUserLocale($event.target.value)">
                <option value="">{{ t('nav.personal.followSystem', { language: systemLanguageLabel }) }}</option>
                <option v-for="option in SUPPORTED_LOCALES" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
              <p class="sys-hint">{{ t('nav.personal.languageHint') }}</p>
            </div>

            <div v-if="systemSettings.dietary?.enabled" class="sys-field">
              <strong class="sys-label">{{ t('dietary.personal') }}</strong>
              <fieldset v-for="kind in ['preferredTags', 'avoidedTags']" :key="kind" :disabled="savingDietary">
                <legend class="sys-label">{{ t(kind === 'preferredTags' ? 'dietary.preferred' : 'dietary.avoided') }}</legend>
                <label v-for="tag in dietaryCatalog" :key="tag" class="sys-choice">
                  <input type="checkbox" :checked="dietaryDraft[kind].includes(tag)" @change="toggleDietary(kind, tag, $event.target.checked)">
                  <span>{{ tag }}<small v-if="!systemSettings.dietary.tags.includes(tag)">{{ t('dietary.retired') }}</small></span>
                </label>
              </fieldset>
              <p class="sys-hint">{{ t('dietary.hint') }}</p>
              <p v-if="!dietaryCatalog.length" class="sys-hint">{{ t('dietary.emptyCatalog') }}</p>
              <button type="button" class="sys-secondary-btn" :disabled="savingDietary" @click="saveDietary">{{ savingDietary ? t('common.saving') : t('dietary.save') }}</button>
            </div>

            <label v-if="showConsent" class="sys-choice">
              <input type="checkbox" :checked="allowProxyOrders" :disabled="savingConsent" @change="toggleConsent">
              <span><strong>{{ t('nav.personal.proxyConsent') }}</strong><small>{{ t('nav.personal.proxyConsentHint') }}</small></span>
            </label>

            <label v-if="pushSupported" class="sys-choice">
              <input type="checkbox" :checked="pushOn" :disabled="pushBusy" @change="togglePush">
              <span><strong>{{ t('nav.personal.push') }}</strong><small>{{ t('nav.personal.pushHint') }}</small></span>
            </label>
            <p v-else class="sys-hint">{{ t('nav.personal.pushUnsupported') }}</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: color-mix(in srgb, var(--ink) 55%, transparent);
}
.personal-modal {
  width: 100%;
  max-width: 440px;
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  border-radius: var(--r-xl);
  border-top: 3px solid var(--persimmon);
  background: var(--paper);
  box-shadow: var(--shadow-modal);
}
.personal-modal:focus { outline: none; }
.personal-header { display: flex; align-items: flex-start; gap: 12px; padding: 20px 20px 12px; }
.head-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--r-md);
  background: var(--bg-accent);
  color: var(--text-accent);
}
.head-text { flex: 1; min-width: 0; }
.personal-title { margin: 0; font-family: var(--font-display); font-size: var(--text-lead); color: var(--ink); }
.personal-sub { margin-top: 2px; font-size: var(--text-label); color: var(--muted); }
.personal-close { padding: 0 4px; font-size: 22px; line-height: 1; color: var(--muted); background: none; }
.personal-close:hover { color: var(--ink); }
.personal-body { padding: 8px 20px 22px; }

.overlay-enter-active, .overlay-leave-active { transition: opacity 0.18s ease; }
.overlay-enter-from, .overlay-leave-to { opacity: 0; }
</style>
