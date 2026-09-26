<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useToast } from '../composables/useToast'

const router = useRouter()
const { register } = useAuth()
const { showToast } = useToast()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const inviteCode = ref('')
const loading = ref(false)

function onInviteInput(e) { inviteCode.value = e.target.value.toUpperCase() }

const PW_LEVELS = [
  { label: '弱',   color: 'var(--paprika)' },
  { label: '弱',   color: 'var(--paprika)' },
  { label: '一般', color: 'var(--gold)'    },
  { label: '強',   color: 'var(--mint)'    },
  { label: '很強', color: 'var(--mint)'    },
]

const pwStrength = computed(() => {
  const p = password.value
  if (!p.length) return null
  let score = 0
  if (p.length >= 6)                            score++
  if (p.length >= 10)                           score++
  if (/[0-9]/.test(p))                          score++
  if (/[A-Z]/.test(p) || /[^a-zA-Z0-9]/.test(p)) score++
  const s = Math.min(score, 4)
  return { score: s, ...PW_LEVELS[s] }
})

const ERROR_MAP = {
  INVALID_CODE: '邀請碼無效',
  CODE_USED: '邀請碼已使用',
  CODE_EXPIRED: '邀請碼已過期',
  MEMBER_NAME_TAKEN: '此成員姓名已綁定其他帳號',
  INVALID_MEMBER_NAME: '邀請碼的成員姓名無效',
  EMAIL_EXISTS: '此 Email 已被註冊',
  'auth/weak-password': '密碼至少需要 6 個字元'
}

async function handleRegister() {
  if (loading.value) return
  loading.value = true
  try {
    await register(email.value.trim(), password.value, inviteCode.value.trim())
    showToast('註冊成功！', 'success')
    router.push('/')
  } catch (err) {
    showToast(ERROR_MAP[err.message] || ERROR_MAP[err.code] || '註冊失敗', 'error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <img class="brand-mark" src="/office-lunch.svg" alt="" />
        <span class="brand-name">Office Lunch</span>
      </div>

      <h1 class="login-title">使用邀請碼註冊</h1>

      <form class="login-form" @submit.prevent="handleRegister">
        <div class="field">
          <label class="label">邀請碼</label>
          <input
            v-model="inviteCode"
            type="text"
            class="input mono"
            placeholder="XXXXXX"
            maxlength="6"
            autocomplete="off"
            style="text-transform: uppercase"
            @input="onInviteInput"
            required
          />
        </div>

        <div class="field">
          <label class="label">Email</label>
          <input
            v-model="email"
            type="email"
            class="input"
            placeholder="you@example.test"
            autocomplete="email"
            required
          />
        </div>

        <div class="field">
          <label class="label">密碼</label>
          <div class="input-wrap">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              class="input"
              placeholder="至少 6 個字元"
              minlength="6"
              autocomplete="new-password"
              required
            />
            <button type="button" class="eye-btn" @click="showPassword = !showPassword" tabindex="-1" aria-label="切換顯示密碼">
              <svg v-if="showPassword" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
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
          {{ loading ? '註冊中…' : '建立帳號' }}
        </button>
      </form>

      <p class="register-link">
        已有帳號？ <RouterLink to="/login">登入</RouterLink>
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
  max-width: 380px;
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
  margin-bottom: 24px;
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

.submit-btn {
  margin-top: 4px;
  padding: 12px;
  font-size: var(--text-body);
  font-weight: 700;
  transition: opacity 0.15s;
}

.submit-btn:hover:not(:disabled) { opacity: 0.88; }
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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

