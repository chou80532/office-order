<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useToast } from '../composables/useToast'
import { readStorage, removeStorage, writeStorage } from '../utils/storage'

const SAVED_EMAIL_KEY = 'savedEmail'
const REMEMBER_KEY = 'rememberEmail'

const router = useRouter()
const { login, resetPassword } = useAuth()
const { showToast } = useToast()

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
})
onUnmounted(() => {
  if (clockTimer) window.clearInterval(clockTimer)
})

const ERROR_MAP = {
  'auth/user-not-found': '帳號不存在',
  'auth/wrong-password': '密碼錯誤',
  'auth/invalid-credential': '帳號或密碼錯誤',
  'auth/too-many-requests': '登入嘗試次數過多，請稍後再試'
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
        ? '請輸入帳號與密碼'
        : !email.value.trim()
          ? '請輸入帳號'
          : '請輸入密碼',
      'error'
    )
    return
  }

  loading.value = true
  try {
    await login(email.value.trim(), password.value)
    if (rememberMe.value) {
      writeStorage(REMEMBER_KEY, 'true')
      writeStorage(SAVED_EMAIL_KEY, email.value.trim())
    } else {
      removeStorage(REMEMBER_KEY)
      removeStorage(SAVED_EMAIL_KEY)
    }
    router.push('/')
  } catch (err) {
    console.error('[Login error]', err.code, err.message)
    showToast(ERROR_MAP[err.code] || '登入失敗，請稍後再試', 'error')
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
    showToast('重設密碼信已寄出，請檢查信箱', 'success')
    forgotMode.value = false
  } catch {
    showToast('寄送失敗，請確認 Email 是否正確', 'error')
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
          <img class="logo-mark" src="/office-lunch.svg" alt="" />
          <div class="logo-text">Office Order <span>/ Group Ordering</span></div>
        </div>

        <div class="scene">
          <div class="float-token t1">紅燒小排飯</div>
          <div class="float-token t2">花雕雞飯</div>
          <div class="float-token t3">招牌雞腿飯</div>
          <div class="float-token t4">挪威鯖魚飯</div>

        </div>

        <div class="tagline">
          <h1>今天午餐<br>想吃<span>什麼</span>？</h1>
          <p>登入辦公室訂餐系統，瀏覽今日合作店家、加入訂單、與同事一起省下決定的時間。</p>
        </div>

        <div class="meta-row">
          <span class="dot"></span>
          <span>系統運行中</span>
          <span>·</span>
          <span>{{ nowStamp }}</span>
          <span>·</span>
          <span>Self-hosted edition</span>
        </div>
      </section>

      <section class="form-panel">


        <div class="form-card" :class="{ shake: shakeCard }" @animationend="shakeCard = false">
          <div class="eyebrow">員工登入 / Staff Sign In</div>
          <h2>歡迎回來 👋</h2>
          <p>輸入您的員工帳號，繼續今天的訂餐。</p>

          <form v-if="forgotMode" class="login-form" @submit.prevent="handleReset">
            <p class="forgot-hint">輸入 Email 後，我們會寄送重設密碼連結。</p>
            <div class="field">
              <label>Email</label>
              <input
                v-model="resetEmail"
                type="email"
                class="input"
                placeholder="you@example.test"
                autocomplete="email"
                required
              />
            </div>
            <button class="submit-btn" :disabled="resetLoading" type="submit">
              {{ resetLoading ? '寄送中…' : '寄送重設連結' }}
            </button>
            <button class="text-btn" type="button" @click="forgotMode = false">← 返回登入</button>
          </form>

          <form v-else class="login-form" @submit.prevent="handleLogin" autocomplete="off" novalidate>
            <div class="field">
              <label>帳號 (Email)</label>
              <input
                v-model="email"
                type="email"
                class="input"
                placeholder="請輸入帳號"
                autocomplete="email"
                required
              />
            </div>

            <div class="field">
              <label>密碼</label>
              <div class="input-wrap">
                <input
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  class="input"
                  placeholder="請輸入密碼"
                  autocomplete="current-password"
                  required
                  @keydown="checkCapsLock"
                  @keyup="checkCapsLock"
                />
                <button class="eye-btn" type="button" @click="showPassword = !showPassword">
                  {{ showPassword ? '隱藏' : '顯示' }}
                </button>
              </div>
              <p v-if="capsLockOn && !showPassword" class="caps-warn">⇪ Caps Lock 已開啟</p>
            </div>

            <div class="row">
              <label class="remember">
                <input v-model="rememberMe" type="checkbox" />
                記住帳號
              </label>
              <button class="text-btn" type="button" @click="openForgot">忘記密碼？</button>
            </div>

            <button class="submit-btn" :disabled="loading" type="submit">
              {{ loading ? '登入中…' : '登入並開始點餐' }}
            </button>
          </form>

          <p class="register-link">沒有帳號？ <RouterLink to="/register">使用邀請碼註冊</RouterLink></p>
        </div>

        <div class="small-foot">Office Order · Self-hosted for your team</div>
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

