<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useToast } from '../composables/useToast'
import { useBranding } from '../composables/useBranding'
import { usePublicConfig } from '../composables/usePublicConfig'
import { readStorage, removeStorage, writeStorage } from '../utils/storage'
import { firebaseAuthMessage } from '../utils/authErrors'
import { t } from '../i18n'

const SAVED_EMAIL_KEY = 'savedEmail'
const REMEMBER_KEY = 'rememberEmail'

const router = useRouter()
const { login, signInWithGoogle, resetPassword } = useAuth()
const { showToast } = useToast()
const { brandName, brandLogo } = useBranding()
const { publicConfig, loadPublicConfig } = usePublicConfig()
const showGoogle = computed(() => publicConfig.value.registration.googleSignIn)
const googleLoading = ref(false)

const email = ref('')
const password = ref('')
const loading = ref(false)
const rememberMe = ref(false)
const showPassword = ref(false)
const capsLockOn = ref(false)
const nowStamp = ref('--:--:--')
const shakeCard = ref(false)

const forgotMode = ref(false)
const resetEmail = ref('')
const resetLoading = ref(false)
// 全新部署（還沒有任何管理員）時提示前往首次設定；查詢失敗就不顯示，不影響登入。
const needsSetup = computed(() => publicConfig.value.needsSetup)

let clockTimer = null

function checkCapsLock(e) {
  capsLockOn.value = e.getModifierState('CapsLock')
}


function tickClock() {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  nowStamp.value = `${hh}:${mm}:${ss}`
}

onMounted(() => {
  const remembered = readStorage(REMEMBER_KEY) === 'true'
  rememberMe.value = remembered
  if (remembered) email.value = readStorage(SAVED_EMAIL_KEY)
  tickClock()
  clockTimer = window.setInterval(tickClock, 1000)
  loadPublicConfig()
})
onUnmounted(() => {
  if (clockTimer) window.clearInterval(clockTimer)
})

// 已通過 Firebase 驗證但還不是成員：導向註冊頁完成最後一步。
function continueAfterSignIn(result) {
  router.push(result?.needsRegistration ? '/register' : '/')
}

async function handleGoogle() {
  if (googleLoading.value || loading.value) return
  googleLoading.value = true
  try {
    continueAfterSignIn(await signInWithGoogle())
  } catch (err) {
    showToast(firebaseAuthMessage(err, 'auth.login.failed'), 'error')
  } finally {
    googleLoading.value = false
  }
}

async function handleLogin() {
  if (loading.value) return

  if (!email.value.trim() || !password.value.trim()) {
    shakeCard.value = false
    requestAnimationFrame(() => {
      shakeCard.value = true
    })
    showToast(
      !email.value.trim() && !password.value.trim()
        ? t('auth.login.emptyBoth')
        : !email.value.trim()
          ? t('auth.login.emptyEmail')
          : t('auth.login.emptyPassword'),
      'error'
    )
    return
  }

  loading.value = true
  try {
    const result = await login(email.value.trim(), password.value)
    if (rememberMe.value) {
      writeStorage(REMEMBER_KEY, 'true')
      writeStorage(SAVED_EMAIL_KEY, email.value.trim())
    } else {
      removeStorage(REMEMBER_KEY)
      removeStorage(SAVED_EMAIL_KEY)
    }
    continueAfterSignIn(result)
  } catch (err) {
    console.error('[Login error]', err.code, err.message)
    showToast(firebaseAuthMessage(err, 'auth.login.failed'), 'error')
  } finally {
    loading.value = false
  }
}

function openForgot() {
  resetEmail.value = email.value
  forgotMode.value = true
}

async function handleReset() {
  if (resetLoading.value || !resetEmail.value.trim()) return
  resetLoading.value = true
  try {
    await resetPassword(resetEmail.value.trim())
    showToast(t('auth.login.resetSent'), 'success')
    forgotMode.value = false
  } catch {
    showToast(t('auth.login.resetFailed'), 'error')
  } finally {
    resetLoading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="stage">
      <section class="brand-panel" aria-hidden="true">
        <div class="logo">
          <img class="logo-mark" :src="brandLogo" alt="" />
          <div class="logo-text">{{ brandName }} <span>{{ t('auth.login.brandSuffix') }}</span></div>
        </div>

        <div class="scene">
          <div class="float-token t1">{{ t('auth.login.token1') }}</div>
          <div class="float-token t2">{{ t('auth.login.token2') }}</div>
          <div class="float-token t3">{{ t('auth.login.token3') }}</div>
          <div class="float-token t4">{{ t('auth.login.token4') }}</div>

        </div>

        <div class="tagline">
          <h1>{{ t('auth.login.taglineLine1') }}<br>{{ t('auth.login.taglineLine2Before') }}<span>{{ t('auth.login.taglineHighlight') }}</span>{{ t('auth.login.taglineLine2After') }}</h1>
          <p>{{ t('auth.login.intro') }}</p>
        </div>

        <div class="meta-row">
          <span class="dot"></span>
          <span>{{ t('auth.login.systemRunning') }}</span>
          <span>·</span>
          <span>{{ nowStamp }}</span>
          <span>·</span>
          <span>{{ t('auth.login.edition') }}</span>
        </div>
      </section>

      <section class="form-panel">


        <div class="form-card" :class="{ shake: shakeCard }" @animationend="shakeCard = false">
          <div class="eyebrow">{{ t('auth.login.eyebrow') }}</div>
          <h2>{{ t('auth.login.title') }}</h2>
          <p>{{ t('auth.login.subtitle') }}</p>

          <form v-if="forgotMode" class="login-form" @submit.prevent="handleReset">
            <p class="forgot-hint">{{ t('auth.login.forgotHint') }}</p>
            <div class="field">
              <label for="reset-email">{{ t('auth.emailLabel') }}</label>
              <input
                id="reset-email"
                v-model="resetEmail"
                type="email"
                class="input"
                :placeholder="t('auth.emailPlaceholder')"
                autocomplete="email"
                required
              />
            </div>
            <button class="submit-btn" :disabled="resetLoading" type="submit">
              {{ resetLoading ? t('auth.login.sending') : t('auth.login.sendReset') }}
            </button>
            <button class="text-btn" type="button" @click="forgotMode = false">← {{ t('auth.backToLogin') }}</button>
          </form>

          <form v-else class="login-form" @submit.prevent="handleLogin" autocomplete="off" novalidate>
            <div class="field">
              <label for="login-email">{{ t('auth.login.accountLabel') }}</label>
              <input
                id="login-email"
                v-model="email"
                type="email"
                class="input"
                :placeholder="t('auth.login.accountPlaceholder')"
                autocomplete="email"
                required
              />
            </div>

            <div class="field">
              <label for="login-password">{{ t('auth.passwordLabel') }}</label>
              <div class="input-wrap">
                <input
                  id="login-password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  class="input"
                  :placeholder="t('auth.login.passwordPlaceholder')"
                  autocomplete="current-password"
                  required
                  @keydown="checkCapsLock"
                  @keyup="checkCapsLock"
                />
                <button class="eye-btn" type="button" @click="showPassword = !showPassword">
                  {{ showPassword ? t('auth.login.hide') : t('auth.login.show') }}
                </button>
              </div>
              <p v-if="capsLockOn && !showPassword" class="caps-warn">{{ t('auth.login.capsLock') }}</p>
            </div>

            <div class="row">
              <label class="remember">
                <input v-model="rememberMe" type="checkbox" />
                {{ t('auth.login.remember') }}
              </label>
              <button class="text-btn" type="button" @click="openForgot">{{ t('auth.login.forgot') }}</button>
            </div>

            <button class="submit-btn" :disabled="loading" type="submit">
              {{ loading ? t('auth.login.submitting') : t('auth.login.submit') }}
            </button>
          </form>

          <template v-if="showGoogle && !forgotMode">
            <div class="or-divider"><span>{{ t('auth.or') }}</span></div>
            <button class="google-btn" type="button" :disabled="googleLoading || loading" @click="handleGoogle">
              <i class="fab fa-google" aria-hidden="true"></i> {{ t('auth.google') }}
            </button>
          </template>

          <p class="register-link">{{ t('auth.login.noAccount') }} <RouterLink to="/register">{{ t('auth.login.registerLink') }}</RouterLink></p>
          <p v-if="needsSetup" class="setup-banner" role="status">
            {{ t('auth.login.needsSetup') }} <RouterLink to="/setup">{{ t('auth.login.setupLink') }}</RouterLink>
          </p>
        </div>

        <div class="small-foot">{{ t('auth.login.footer', { name: brandName }) }}</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  --panel: var(--bg-card);
  --panel-2: var(--bg-panel);
  --line: var(--border);
  --line-2: var(--border-strong);
  --text: var(--text-primary);
  --text-dim: var(--text-secondary);
  --text-faint: var(--text-muted);
  --accent-soft: var(--bg-accent);
  min-height: 100vh;
  color: var(--text);
}

.login-page[data-theme='light'] {
  --panel: var(--bg-card);
  --panel-2: var(--bg-panel);
  --line: var(--border);
  --line-2: var(--border-strong);
  --text: var(--text-primary);
  --text-dim: var(--text-secondary);
  --text-faint: var(--text-muted);
  --accent-soft: var(--bg-accent);
}

.stage {
  min-height: 100vh;
  max-width: 1600px;
  margin-inline: auto;
  display: grid;
  grid-template-columns: 1.05fr 1fr;
}

/* 超寬螢幕：兩側留白處以品牌漸層延伸，避免置中舞台外露出突兀的純色邊 */
@media (min-width: 1601px) {
  .login-page { background: linear-gradient(140deg, var(--bg-2) 0%, var(--bg) 70%); }
}

.brand-panel {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 40px 52px;
}

.brand-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, var(--line) 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.35;
}

.logo, .tagline, .meta-row {
  position: relative;
  z-index: 2;
}

.logo { display: flex; align-items: center; gap: 10px; }
.logo-mark {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: block;
  object-fit: contain;
}
.logo-text { font-weight: 700; }
.logo-text span { font-weight: 500; }

.scene {
  z-index: 1;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.lunchbox-wrap {
  position: relative;
  width: min(400px, 50vw);
  aspect-ratio: 1;
  /* 基礎 transform 需與 keyframes 0% 相同：動畫引擎接手前的第一幀（重新整理瞬間）才不會跳動 */
  transform: translate(116px, 10px) rotate(-1.4deg);
  animation: floatBox 6s ease-in-out infinite;
}

.lunchbox-wrap::after {
  content: '';
  position: absolute;
  left: 10%;
  right: 6%;
  bottom: 4%;
  height: 13%;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 20%, transparent);
  filter: blur(22px);
  opacity: 0.45;
  transform: rotate(-2deg);
}

.food-art {
  position: absolute;
  display: block;
  object-fit: contain;
  user-select: none;
  filter: drop-shadow(0 18px 20px color-mix(in srgb, var(--ink) 22%, transparent));
}

.phone-art {
  top: -4%;
  left: 0;
  width: 74%;
  z-index: 1;
  transform-origin: 52% 86%;
  transform: rotate(-7deg);
  animation: phoneLean 6s ease-in-out infinite;
}

.drink-art {
  top: 25%;
  right: 0;
  width: 36%;
  z-index: 2;
  transform-origin: 50% 88%;
  transform: rotate(1deg);
  animation: drinkBob 4.8s ease-in-out infinite 0.2s;
}

.riceball-art {
  right: 12%;
  bottom: 1%;
  width: 39%;
  z-index: 5;
  transform-origin: 50% 88%;
  animation: riceballBounce 4.4s ease-in-out infinite 0.45s;
}

.sushi-art {
  left: 14%;
  bottom: 1%;
  width: 34%;
  z-index: 4;
  transform-origin: 52% 82%;
  transform: rotate(-2deg);
  animation: sushiNod 4.9s ease-in-out infinite 0.1s;
}

.float-token {
  border: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 6px;
}
.float-token::before {
  color: var(--accent);
  font-size: var(--text-micro);
  flex-shrink: 0;
}
.t1 { top: 18%; left: 8%; animation: floatToken1 6s ease-in-out infinite; }
.t2 { top: 22%; right: 8%; animation: floatToken2 7.5s ease-in-out infinite 1.2s; }
.t3 { bottom: 28%; left: 12%; animation: floatToken3 5.5s ease-in-out infinite 0.6s; }
.t4 { bottom: 22%; right: 9%; animation: floatToken4 8s ease-in-out infinite 2s; }

.tagline h1 {
  margin: 0 0 14px;
  font-size: var(--text-display);
  line-height: 1.2;
}
.tagline p { margin: 0; }

.meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-label);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  animation: ping 2s ease-out infinite;
}

.form-panel {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  /* 登入頁沒有標題列，viewport-fit=cover 後要自行避開狀態列與底部 home indicator */
  padding: calc(32px + env(safe-area-inset-top, 0px)) 32px calc(32px + env(safe-area-inset-bottom, 0px));
}

.theme-switch {
  position: absolute;
  right: 28px;
  top: calc(24px + env(safe-area-inset-top, 0px));
  display: flex;
  gap: 4px;
  border: 1px solid var(--line);
  background: var(--panel);
  border-radius: 10px;
  padding: 4px;
}
.theme-switch button {
  border: 0;
  background: transparent;
  color: var(--text-dim);
  padding: 6px 10px;
  border-radius: 7px;
  cursor: pointer;
}
.theme-switch button.active {
  background: var(--bg-accent);
  color: var(--text-accent);
}

.form-card {
  width: 100%;
  max-width: 420px;
  border: 1px solid var(--line);
  padding: 26px;
}
.eyebrow { color: var(--accent); font-size: var(--text-micro); letter-spacing: 0.16em; text-transform: uppercase; }
h2 { margin: 10px 0 6px; font-size: var(--text-title); }
h2 + p { margin: 0 0 24px; color: var(--text-dim); }

.login-form { display: grid; gap: 14px; }
.field label { display: block; font-size: var(--text-label); color: var(--text-dim); margin-bottom: 6px; }
.input {
  width: 100%;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
  border-radius: 11px;
  padding: 12px;
  outline: none;
}
.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.input-wrap { position: relative; }
.eye-btn {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  border: 0;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--text-label);
}
.remember { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
.remember input { accent-color: var(--accent); }

.submit-btn {
  border: 0;
  border-radius: 11px;
  padding: 12px;
  background: var(--accent-solid);
  color: var(--text-on-accent);
  font-weight: 700;
  cursor: pointer;
}
.submit-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.text-btn {
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  padding: 0;
}
.text-btn:hover { text-decoration: underline; }

.caps-warn {
  margin: 6px 0 0;
  font-size: var(--text-micro);
  color: var(--warning);
}

.forgot-hint {
  margin: 0;
  color: var(--text-dim);
  font-size: var(--text-label);
  line-height: 1.5;
}

.register-link {
  margin: 16px 0 0;
  text-align: center;
  color: var(--text-dim);
  font-size: var(--text-label);
}
.register-link a {
  color: var(--accent);
  font-weight: 700;
}

.or-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0 12px;
  color: var(--text-dim);
  font-size: var(--text-label);
}
.or-divider::before, .or-divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--line);
}

.google-btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-md);
  background: var(--panel);
  color: var(--text);
  font-weight: 700;
  font-size: var(--text-body);
}
.google-btn:hover:not(:disabled) { border-color: var(--accent); }
.google-btn:disabled { opacity: .6; cursor: not-allowed; }

.setup-banner {
  margin: 12px 0 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: var(--r-md);
  text-align: center;
  color: var(--text-dim);
  font-size: var(--text-label);
}
.setup-banner a {
  color: var(--accent);
  font-weight: 700;
}

.small-foot {
  position: absolute;
  bottom: calc(18px + env(safe-area-inset-bottom, 0px));
  left: 0;
  right: 0;
  text-align: center;
  font-size: var(--text-micro);
}

.shake { animation: shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97); }

@keyframes rise {
  0% { opacity: 0; transform: translateY(8px); }
  30% { opacity: 0.5; }
  100% { opacity: 0; transform: translateY(-24px); }
}
@keyframes ping {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--success) 50%, transparent); }
  100% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--success) 0%, transparent); }
}
@keyframes floatBox {
  0%, 100% { transform: translate(116px, 10px) rotate(-1.4deg); }
  50% { transform: translate(116px, -4px) rotate(1deg); }
}
@keyframes phoneLean {
  0%, 100% { transform: rotate(-7deg) translateY(0) scale(1); }
  50% { transform: rotate(-5deg) translateY(-5px) scale(1.012); }
}
@keyframes drinkBob {
  0%, 100% { transform: translateY(0) rotate(1deg); }
  50% { transform: translateY(-10px) rotate(-1.4deg); }
}
@keyframes riceballBounce {
  0%, 100% { transform: translateY(0) scale(1); }
  45% { transform: translateY(-8px) scale(1.018); }
  62% { transform: translateY(-5px) scale(0.996); }
}
@keyframes sushiNod {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50% { transform: translateY(-6px) rotate(2.5deg); }
}
@keyframes shake {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-4px); }
  40%, 60% { transform: translateX(4px); }
}
@keyframes floatToken1 {
  0%, 100% { transform: translateY(0) translateX(0); }
  40% { transform: translateY(-12px) translateX(6px); }
  70% { transform: translateY(5px) translateX(-4px); }
}
@keyframes floatToken2 {
  0%, 100% { transform: translateY(0) translateX(0); }
  35% { transform: translateY(10px) translateX(-7px); }
  65% { transform: translateY(-8px) translateX(5px); }
}
@keyframes floatToken3 {
  0%, 100% { transform: translateY(0) translateX(0); }
  45% { transform: translateY(-9px) translateX(-5px); }
  75% { transform: translateY(6px) translateX(8px); }
}
@keyframes floatToken4 {
  0%, 100% { transform: translateY(0) translateX(0); }
  30% { transform: translateY(11px) translateX(6px); }
  60% { transform: translateY(-7px) translateX(-5px); }
}

@media (max-width: 960px) {
  .stage { grid-template-columns: 1fr; }
  .brand-panel { display: none; }
}

.login-page, .login-page[data-theme='light'] { --bg: var(--ink); --bg-2: var(--ink-2); }
.login-page, .brand-panel { background: var(--ink); }
.brand-panel { color: var(--paper); border-right: 1px solid var(--line); }
.tagline h1, .logo-text { font-family: var(--font-display); }
.tagline p, .meta-row, .logo-text span { color: var(--ink-soft); }
.tagline h1 span { color: var(--paper-2); }
.form-card { background: var(--paper); color: var(--ink); border-radius: 6px; border-top: 3px solid var(--persimmon); box-shadow: var(--shadow-modal); }
.lunchbox-wrap { display: none; }
.scene { position: relative; inset: auto; grid-template-columns: 1fr 1fr; gap: 24px; padding: 60px 0; }
.float-token { position: relative; inset: auto; min-height: 110px; padding: 28px 16px; border-radius: 8px; background: var(--paper); color: var(--ink); font-family: var(--font-display); font-size: var(--text-lead); justify-content: center; animation: none; border-bottom: 2px dashed var(--ink-faint); }
.float-token::before { content: ''; position: absolute; width: 11px; height: 11px; border: 2px solid var(--paper-2); background: var(--ink); top: -6px; left: calc(50% - 5.5px); border-radius: 50%; }
.small-foot { color: var(--ink-soft); }
</style>

