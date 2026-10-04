<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useToast } from '../composables/useToast'
import { useBranding } from '../composables/useBranding'
import { getSetupStatusViaFunction } from '../services/accountFunctions'
import { browserTimeZone, normalizeSystemSettings } from '../utils/systemSettings'
import { firebaseAuthMessage } from '../utils/authErrors'
import { MAX_NAME_LENGTH } from '../constants'
import { currentLocale, setSystemLocale, t } from '../i18n'
import GeneralSettings from '../components/settings/system/GeneralSettings.vue'
import PaymentSettings from '../components/settings/system/PaymentSettings.vue'
import OrderingSettings from '../components/settings/system/OrderingSettings.vue'

const router = useRouter()
const { setupFirstAdmin } = useAuth()
const { showToast } = useToast()
const { brandName, brandLogo } = useBranding()

// checking → ready（可初始化）／disabled（伺服器未設定 token）／completed（已有管理員）／error
const status = ref('checking')
const setupToken = ref('')
const memberName = ref('')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
// 新部署的預設值：時區跟隨瀏覽器、語言跟隨目前畫面，代訂採保守的「需本人同意」。
const settings = ref(normalizeSystemSettings({
  timeZone: browserTimeZone(),
  locale: currentLocale.value,
  proxyOrdering: 'consent',
}))
const loading = ref(false)

// 在設定頁選語言時，整個畫面立即切換成該語言。
watch(() => settings.value.locale, setSystemLocale)

async function checkStatus() {
  status.value = 'checking'
  try {
    const result = await getSetupStatusViaFunction()
    status.value = !result?.needsSetup ? 'completed' : result.setupEnabled ? 'ready' : 'disabled'
  } catch {
    status.value = 'error'
  }
}

onMounted(checkStatus)

async function handleSetup() {
  if (loading.value) return
  loading.value = true
  try {
    await setupFirstAdmin({
      email: email.value.trim(),
      password: password.value,
      setupToken: setupToken.value.trim(),
      memberName: memberName.value.trim(),
      settings: settings.value,
    })
    showToast(t('auth.setup.success'), 'success')
    router.push('/settings')
  } catch (err) {
    showToast(firebaseAuthMessage(err, 'auth.setup.failed'), 'error')
    if (err.message === 'SETUP_ALREADY_COMPLETED') status.value = 'completed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <img class="brand-mark" :src="brandLogo" alt="" />
        <span class="brand-name">{{ brandName }}</span>
      </div>

      <h1 class="login-title">{{ t('auth.setup.title') }}</h1>

      <p v-if="status === 'checking'" class="setup-note" role="status">{{ t('auth.setup.checking') }}</p>

      <div v-else-if="status === 'error'" class="setup-note" role="alert">
        <p>{{ t('auth.setup.serverError') }}</p>
        <button type="button" class="text-btn" @click="checkStatus">{{ t('auth.setup.recheck') }}</button>
      </div>

      <div v-else-if="status === 'completed'" class="setup-note">
        <p>{{ t('auth.setup.completed') }}</p>
      </div>

      <div v-else-if="status === 'disabled'" class="setup-note">
        <p>{{ t('auth.setup.disabledIntro') }}</p>
        <ol>
          <li>{{ t('auth.setup.disabledStep1') }}</li>
          <li>{{ t('auth.setup.disabledStep2') }}</li>
          <li>{{ t('auth.setup.disabledStep3') }}</li>
        </ol>
        <button type="button" class="text-btn" @click="checkStatus">{{ t('auth.setup.recheck') }}</button>
      </div>

      <form v-else class="login-form" @submit.prevent="handleSetup">
        <p class="setup-intro">{{ t('auth.setup.intro') }}</p>

        <div class="field">
          <label class="label" for="setup-token">{{ t('auth.setup.tokenLabel') }}</label>
          <input
            id="setup-token"
            v-model="setupToken"
            type="password"
            class="input mono"
            :placeholder="t('auth.setup.tokenPlaceholder')"
            autocomplete="off"
            required
          />
        </div>

        <div class="field">
          <label class="label" for="setup-name">{{ t('auth.setup.nameLabel') }}</label>
          <input
            id="setup-name"
            v-model="memberName"
            type="text"
            class="input"
            :placeholder="t('auth.setup.namePlaceholder')"
            :maxlength="MAX_NAME_LENGTH"
            autocomplete="name"
            required
          />
        </div>

        <div class="field">
          <label class="label" for="setup-email">{{ t('auth.emailLabel') }}</label>
          <input
            id="setup-email"
            v-model="email"
            type="email"
            class="input"
            :placeholder="t('auth.emailPlaceholder')"
            autocomplete="email"
            required
          />
        </div>

        <div class="field">
          <label class="label" for="setup-password">{{ t('auth.passwordLabel') }}</label>
          <div class="input-wrap">
            <input
              id="setup-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              class="input"
              :placeholder="t('auth.passwordPlaceholder')"
              minlength="6"
              autocomplete="new-password"
              required
            />
            <button type="button" class="eye-btn" tabindex="-1" :aria-label="t('auth.togglePassword')" @click="showPassword = !showPassword">
              <i :class="['fas', showPassword ? 'fa-eye-slash' : 'fa-eye']" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <section class="rules">
          <h2 class="rules-title">{{ t('auth.setup.rulesTitle') }}</h2>
          <p class="setup-intro">{{ t('auth.setup.rulesHint') }}</p>
          <GeneralSettings v-model="settings" compact :disabled="loading" />
          <PaymentSettings v-model="settings" compact :disabled="loading" />
          <OrderingSettings v-model="settings" compact :disabled="loading" />
        </section>

        <button type="submit" class="submit-btn" :disabled="loading">
          {{ loading ? t('auth.setup.submitting') : t('auth.setup.submit') }}
        </button>
      </form>

      <p class="register-link">
        <RouterLink to="/login">{{ t('auth.backToLogin') }}</RouterLink>
      </p>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 設定頁沒有標題列，viewport-fit=cover 後要自行避開狀態列與底部 home indicator */
  padding: calc(var(--page-pad) + env(safe-area-inset-top, 0px)) var(--page-pad)
           calc(var(--page-pad) + env(safe-area-inset-bottom, 0px));
  background: var(--ink);
}

.login-card {
  width: 100%;
  max-width: 460px;
  padding: 32px;
  border: 1.5px solid var(--muted-line);
  border-top: 3px solid var(--persimmon);
  border-radius: 6px;
  background: var(--paper);
  box-shadow: var(--shadow-modal);
}

.login-brand { display: flex; align-items: center; gap: 8px; margin-bottom: 28px; }
.brand-mark { width: 24px; height: 24px; display: block; object-fit: contain; border-radius: 7px; }
.brand-name { font-family: var(--font-display); font-size: var(--text-body); font-weight: 800; color: var(--ink); letter-spacing: -0.3px; }

.login-title {
  margin-bottom: 16px;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: 900;
  color: var(--ink);
  letter-spacing: -0.3px;
}

.setup-note, .setup-intro {
  font-size: var(--text-body);
  line-height: 1.7;
  color: var(--text-secondary);
}
.setup-note { display: flex; flex-direction: column; gap: 12px; }
.setup-note ol { padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
.setup-note code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--paper-2);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  overflow-wrap: anywhere;
}

.login-form { display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }

.label {
  font-size: var(--text-micro);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--muted);
}

.input {
  padding: 10px 12px;
  border: 1.5px solid var(--muted-line);
  border-radius: var(--r-md);
  font-size: var(--text-body);
  color: var(--ink);
  background: var(--cream);
  transition: border-color 0.15s;
  outline: none;
}
.input:focus { border-color: var(--ink); }

.input-wrap { position: relative; display: flex; align-items: center; }
.input-wrap .input { width: 100%; padding-right: 40px; }
.eye-btn {
  position: absolute;
  right: 10px;
  display: flex;
  align-items: center;
  padding: 0;
  border: none;
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.eye-btn:hover { color: var(--ink); }

.rules { display: flex; flex-direction: column; gap: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
.rules-title { font-family: var(--font-display); font-size: var(--text-lead); font-weight: 800; color: var(--ink); }

.submit-btn {
  margin-top: 4px;
  padding: 12px;
  border-radius: 4px;
  background: var(--accent-solid);
  color: var(--paper);
  font-size: var(--text-body);
  font-weight: 700;
  transition: opacity 0.15s;
}
.submit-btn:hover:not(:disabled) { opacity: 0.88; }
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.text-btn {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--ink);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.register-link { margin-top: 20px; text-align: center; font-size: var(--text-label); color: var(--muted); }
.register-link a { color: var(--ink); font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
</style>
