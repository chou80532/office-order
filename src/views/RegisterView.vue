<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useToast } from '../composables/useToast'
import { useBranding } from '../composables/useBranding'
import { usePublicConfig } from '../composables/usePublicConfig'
import { firebaseAuthMessage } from '../utils/authErrors'
import { normalizeEmailDomain } from '../utils/systemSettings'
import { MAX_NAME_LENGTH } from '../constants'
import { t } from '../i18n'

const router = useRouter()
const {
  register, registerWithEmail, signInWithGoogle, completeRegistration,
  refreshEmailVerification, resendEmailVerification, cancelPendingRegistration, pendingRegistration,
} = useAuth()
const { showToast } = useToast()
const { brandName, brandLogo } = useBranding()
const { publicConfig, loadPublicConfig } = usePublicConfig()

onMounted(loadPublicConfig)

const allowedDomains = computed(() => publicConfig.value.registration.allowedEmailDomains)
const domainSignupEnabled = computed(() => allowedDomains.value.length > 0)
const showGoogle = computed(() => publicConfig.value.registration.googleSignIn)
const domainOf = value => normalizeEmailDomain(String(value || '').split('@').pop())

// invite：邀請碼；domain：公司信箱自助註冊。
const mode = ref('invite')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const inviteCode = ref('')
const memberName = ref('')
const loading = ref(false)

// 已通過 Firebase 驗證但還不是成員（Google 首次登入、公司信箱待驗證）。
const pending = computed(() => pendingRegistration.value)
const pendingDomainAllowed = computed(() => Boolean(pending.value) && allowedDomains.value.includes(domainOf(pending.value.email)))
const awaitingVerification = computed(() => Boolean(pending.value) && mode.value === 'domain' && !pending.value.emailVerified)
const showModeTabs = computed(() => (pending.value ? pendingDomainAllowed.value : domainSignupEnabled.value))
// 從登入頁轉來、信箱網域可自助註冊時，預設顯示公司信箱分頁。
watch(pendingDomainAllowed, (allowed) => { if (allowed) mode.value = 'domain' }, { immediate: true })

function onInviteInput(e) { inviteCode.value = e.target.value.toUpperCase() }

const PW_LEVELS = [
  { key: 'weak', color: 'var(--paprika)' },
  { key: 'weak', color: 'var(--paprika)' },
  { key: 'fair', color: 'var(--gold)' },
  { key: 'strong', color: 'var(--mint)' },
  { key: 'veryStrong', color: 'var(--mint)' },
]

const pwStrength = computed(() => {
  const p = password.value
  if (!p.length) return null
  let score = 0
  if (p.length >= 6) score++
  if (p.length >= 10) score++
  if (/[0-9]/.test(p)) score++
  if (/[A-Z]/.test(p) || /[^a-zA-Z0-9]/.test(p)) score++
  const s = Math.min(score, 4)
  return { score: s, label: t(`auth.strength.${PW_LEVELS[s].key}`), color: PW_LEVELS[s].color }
})

const fail = err => showToast(firebaseAuthMessage(err, 'auth.register.failed'), 'error')

function finish() {
  showToast(t('auth.register.success'), 'success')
  router.push('/')
}

async function run(task) {
  if (loading.value) return
  loading.value = true
  try {
    await task()
  } catch (err) {
    fail(err)
  } finally {
    loading.value = false
  }
}

const handleInviteRegister = () => run(async () => {
  await register(email.value.trim(), password.value, inviteCode.value.trim())
  finish()
})

const handleDomainRegister = () => run(async () => {
  if (!allowedDomains.value.includes(domainOf(email.value))) {
    showToast(t('auth.register.domainNotAllowed'), 'error')
    return
  }
  await registerWithEmail(email.value.trim(), password.value)
})

const handleVerified = () => run(async () => {
  if (!await refreshEmailVerification()) {
    showToast(t('auth.register.notVerifiedYet'), 'error')
    return
  }
  await completeRegistration({ memberName: memberName.value })
  finish()
})

const handleResend = () => run(async () => {
  await resendEmailVerification()
  showToast(t('auth.register.verifyResent'), 'success')
})

const handleCompletePending = () => run(async () => {
  await completeRegistration(mode.value === 'invite' ? { inviteCode: inviteCode.value } : { memberName: memberName.value })
  finish()
})

const handleGoogle = () => run(async () => {
  const result = await signInWithGoogle()
  if (!result.needsRegistration) {
    router.push('/')
    return
  }
  mode.value = allowedDomains.value.includes(domainOf(pendingRegistration.value?.email)) ? 'domain' : 'invite'
})

const handleUseAnotherAccount = () => run(async () => {
  await cancelPendingRegistration()
  mode.value = 'invite'
})
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <img class="brand-mark" :src="brandLogo" alt="" />
        <span class="brand-name">{{ brandName }}</span>
      </div>

      <h1 class="login-title">{{ pending ? (awaitingVerification ? t('auth.register.verifyTitle') : t('auth.register.completeTitle')) : t('auth.register.title') }}</h1>

      <div v-if="showModeTabs && !awaitingVerification" class="mode-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="mode === 'invite'" :class="{ active: mode === 'invite' }" @click="mode = 'invite'">
          {{ t('auth.register.inviteTab') }}
        </button>
        <button type="button" role="tab" :aria-selected="mode === 'domain'" :class="{ active: mode === 'domain' }" @click="mode = 'domain'">
          {{ t('auth.register.domainTab') }}
        </button>
      </div>

      <!-- 公司信箱：等待使用者點擊驗證信 -->
      <div v-if="awaitingVerification" class="login-form">
        <p class="intro">{{ t('auth.register.verifyIntro', { email: pending.email }) }}</p>
        <div class="field">
          <label class="label" for="verify-name">{{ t('auth.register.nameLabel') }}</label>
          <input id="verify-name" v-model="memberName" type="text" class="input" :maxlength="MAX_NAME_LENGTH" :placeholder="t('auth.register.namePlaceholder')" required />
        </div>
        <button type="button" class="submit-btn" :disabled="loading || !memberName.trim()" @click="handleVerified">
          {{ loading ? t('auth.register.verifyChecking') : t('auth.register.verifyDone') }}
        </button>
        <button type="button" class="text-btn" :disabled="loading" @click="handleResend">{{ t('auth.register.verifyResend') }}</button>
        <button type="button" class="text-btn" :disabled="loading" @click="handleUseAnotherAccount">{{ t('auth.register.useAnotherAccount') }}</button>
      </div>

      <!-- 已登入但尚未成為成員：補上邀請碼或姓名 -->
      <form v-else-if="pending" class="login-form" @submit.prevent="handleCompletePending">
        <p class="intro">{{ t('auth.register.completeIntro', { email: pending.email }) }}</p>
        <div v-if="mode === 'invite'" class="field">
          <label class="label" for="pending-invite">{{ t('auth.register.inviteLabel') }}</label>
          <input id="pending-invite" v-model="inviteCode" type="text" class="input mono" :placeholder="t('auth.register.invitePlaceholder')" maxlength="6" autocomplete="off" style="text-transform: uppercase" required @input="onInviteInput" />
        </div>
        <div v-else class="field">
          <label class="label" for="pending-name">{{ t('auth.register.nameLabel') }}</label>
          <input id="pending-name" v-model="memberName" type="text" class="input" :maxlength="MAX_NAME_LENGTH" :placeholder="t('auth.register.namePlaceholder')" required />
        </div>
        <button type="submit" class="submit-btn" :disabled="loading">
          {{ loading ? t('auth.register.submitting') : t('auth.register.completeSubmit') }}
        </button>
        <button type="button" class="text-btn" :disabled="loading" @click="handleUseAnotherAccount">{{ t('auth.register.useAnotherAccount') }}</button>
      </form>

      <!-- 新帳號 -->
      <form v-else class="login-form" @submit.prevent="mode === 'invite' ? handleInviteRegister() : handleDomainRegister()">
        <div v-if="mode === 'invite'" class="field">
          <label class="label" for="register-invite">{{ t('auth.register.inviteLabel') }}</label>
          <input
            id="register-invite"
            v-model="inviteCode"
            type="text"
            class="input mono"
            :placeholder="t('auth.register.invitePlaceholder')"
            maxlength="6"
            autocomplete="off"
            style="text-transform: uppercase"
            required
            @input="onInviteInput"
          />
        </div>

        <template v-else>
          <p class="intro">{{ t('auth.register.domainHint', { domains: allowedDomains.join(', ') }) }}</p>
          <div class="field">
            <label class="label" for="register-name">{{ t('auth.register.nameLabel') }}</label>
            <input id="register-name" v-model="memberName" type="text" class="input" :maxlength="MAX_NAME_LENGTH" :placeholder="t('auth.register.namePlaceholder')" required />
          </div>
        </template>

        <div class="field">
          <label class="label" for="register-email">{{ t('auth.emailLabel') }}</label>
          <input
            id="register-email"
            v-model="email"
            type="email"
            class="input"
            :placeholder="t('auth.emailPlaceholder')"
            autocomplete="email"
            required
          />
        </div>

        <div class="field">
          <label class="label" for="register-password">{{ t('auth.passwordLabel') }}</label>
          <div class="input-wrap">
            <input
              id="register-password"
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
          <Transition name="strength">
            <div v-if="pwStrength" class="pw-strength">
              <div class="pw-bars">
                <div
                  v-for="i in 4" :key="i"
                  class="pw-bar"
                  :style="i <= pwStrength.score ? { background: pwStrength.color } : {}"
                ></div>
              </div>
              <span class="pw-label" :style="{ color: pwStrength.color }">{{ pwStrength.label }}</span>
            </div>
          </Transition>
        </div>

        <button type="submit" class="submit-btn" :disabled="loading">
          {{ loading ? t('auth.register.submitting') : t('auth.register.submit') }}
        </button>

        <template v-if="showGoogle">
          <div class="or-divider"><span>{{ t('auth.or') }}</span></div>
          <button type="button" class="google-btn" :disabled="loading" @click="handleGoogle">
            <i class="fab fa-google" aria-hidden="true"></i> {{ t('auth.googleRegister') }}
          </button>
        </template>
      </form>

      <p class="register-link">
        {{ t('auth.register.haveAccount') }} <RouterLink to="/login">{{ t('auth.register.loginLink') }}</RouterLink>
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
  /* 註冊頁沒有標題列，viewport-fit=cover 後要自行避開狀態列與底部 home indicator */
  padding: calc(var(--page-pad) + env(safe-area-inset-top, 0px)) var(--page-pad)
           calc(var(--page-pad) + env(safe-area-inset-bottom, 0px));
}

.login-card {
  width: 100%;
  max-width: 400px;
  border: 1.5px solid var(--muted-line);
  padding: 32px;
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 28px;
}

.brand-mark {
  width: 24px;
  height: 24px;
  display: block;
  object-fit: contain;
  border-radius: 7px;
}
.brand-name { font-size: var(--text-body); font-weight: 800; color: var(--ink); letter-spacing: -0.3px; }

.login-title {
  font-size: var(--text-title);
  font-weight: 900;
  color: var(--ink);
  letter-spacing: -0.3px;
  margin-bottom: 20px;
}

.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  margin-bottom: 20px;
  border-radius: var(--r-md);
  background: var(--paper-2);
}
.mode-tabs button {
  padding: 8px;
  border-radius: 6px;
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 700;
}
.mode-tabs button.active { background: var(--paper); color: var(--ink); box-shadow: 0 1px 2px color-mix(in srgb, var(--ink) 15%, transparent); }

.intro { font-size: var(--text-label); line-height: 1.6; color: var(--text-secondary); overflow-wrap: anywhere; }

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

.submit-btn {
  margin-top: 4px;
  padding: 12px;
  font-size: var(--text-body);
  font-weight: 700;
  transition: opacity 0.15s;
}

.submit-btn:hover:not(:disabled) { opacity: 0.88; }
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.text-btn {
  align-self: center;
  padding: 0;
  border: none;
  background: none;
  color: var(--ink);
  font-size: var(--text-label);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.text-btn:disabled { opacity: .5; cursor: not-allowed; }

.or-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: var(--text-label);
}
.or-divider::before, .or-divider::after { content: ''; flex: 1; border-top: 1px solid var(--muted-line); }

.google-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 12px;
  border: 1.5px solid var(--muted-line);
  border-radius: var(--r-md);
  background: var(--paper);
  color: var(--ink);
  font-weight: 700;
  font-size: var(--text-body);
}
.google-btn:hover:not(:disabled) { border-color: var(--ink); }
.google-btn:disabled { opacity: .5; cursor: not-allowed; }

.register-link {
  margin-top: 20px;
  text-align: center;
  font-size: var(--text-label);
  color: var(--muted);
}

.register-link a {
  color: var(--ink);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.input-wrap .input {
  width: 100%;
  padding-right: 40px;
}

.eye-btn {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--muted);
  display: flex;
  align-items: center;
  padding: 0;
  line-height: 1;
}

.eye-btn:hover { color: var(--ink); }

.pw-strength {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.pw-bars {
  display: flex;
  gap: 4px;
  flex: 1;
}

.pw-bar {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: var(--muted-line);
  transition: background 0.25s;
}

.pw-label {
  font-size: var(--text-micro);
  font-weight: 700;
  letter-spacing: 0.3px;
  transition: color 0.25s;
  min-width: 22px;
  text-align: right;
}

.strength-enter-active, .strength-leave-active { transition: opacity 0.2s, transform 0.2s; }
.strength-enter-from, .strength-leave-to { opacity: 0; transform: translateY(-4px); }

.login-page { background: var(--ink); }
.login-card { background: var(--paper); border-radius: 6px; border-top: 3px solid var(--persimmon); box-shadow: var(--shadow-modal); }
.login-title, .brand-name { font-family: var(--font-display); }
.submit-btn { background: var(--accent-solid); color: var(--paper); border-radius: 4px; }
</style>
