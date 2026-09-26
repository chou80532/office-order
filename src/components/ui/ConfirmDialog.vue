<script setup>
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { useScrollLock } from '../../composables/useScrollLock'

// 站內統一的確認對話框：取代原生 confirm()，
// 危險操作（刪除、清空）請使用 variant="danger"。
const props = defineProps({
  open:        { type: Boolean, default: false },
  title:       { type: String,  default: '確認操作' },
  message:     { type: String,  default: '' },
  detail:      { type: String,  default: '' },
  confirmText: { type: String,  default: '確認' },
  cancelText:  { type: String,  default: '取消' },
  variant:     { type: String,  default: 'primary' }, // 'primary' | 'danger'
  loading:     { type: Boolean, default: false },
  autofocus:   { type: String,  default: 'cancel' }   // 'cancel' | 'none'（含輸入框時由外部自行聚焦）
})

const emit = defineEmits(['confirm', 'cancel'])

const cancelBtn = ref(null)

// 開啟時焦點放在「取消」，避免 Enter 直接觸發危險操作
watch(() => props.open, (open) => {
  if (open && props.autofocus === 'cancel') nextTick(() => cancelBtn.value?.focus())
})

// 這個元件常駐掛載、靠 open 切換，所以不能用 useModalA11y（它綁的是掛載生命週期）。
// 焦點還原與 Tab 困住要在這裡自己做：對話框關掉之後焦點應該回到剛才按的那顆按鈕，
// 而不是掉回 <body> 讓鍵盤使用者從頭 Tab 一次。
const dialogRoot = ref(null)
let previouslyFocused = null

const focusableItems = () => {
  const root = dialogRoot.value
  if (!root) return []
  return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null || el.getClientRects().length > 0)
}

function onKeydown(e) {
  if (e.key === 'Escape' && props.open && !props.loading) { emit('cancel'); return }
  if (e.key !== 'Tab' || !props.open) return
  const items = focusableItems()
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (!dialogRoot.value?.contains(active)) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  } else if (e.shiftKey && active === first) {
    e.preventDefault(); last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault(); first.focus()
  }
}

watch(() => props.open, (open) => {
  if (open) {
    previouslyFocused = document.activeElement
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('keydown', onKeydown)
    if (previouslyFocused?.isConnected) previouslyFocused.focus()
    previouslyFocused = null
  }
}, { immediate: true })

onUnmounted(() => document.removeEventListener('keydown', onKeydown))

// 元件常駐掛載、靠 open 切換顯示，所以綁 prop 而不是綁掛載生命週期。
useScrollLock(() => props.open)
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-overlay">
      <div
        v-if="open"
        class="confirm-overlay"
        @click.self="!loading && emit('cancel')"
      >
        <div
          ref="dialogRoot"
          class="confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          :aria-label="title"
        >
          <div class="confirm-icon" :class="variant" aria-hidden="true">
            <i :class="['fas', variant === 'danger' ? 'fa-triangle-exclamation' : 'fa-circle-question']"></i>
          </div>
          <h3 class="confirm-title">{{ title }}</h3>
          <p v-if="message" class="confirm-message">{{ message }}</p>
          <p v-if="detail" class="confirm-detail">{{ detail }}</p>
          <div v-if="$slots.default" class="confirm-slot">
            <slot />
          </div>
          <div class="confirm-actions">
            <button
              ref="cancelBtn"
              type="button"
              class="confirm-btn cancel"
              :disabled="loading"
              @click="emit('cancel')"
            >{{ cancelText }}</button>
            <button
              type="button"
              class="confirm-btn"
              :class="variant"
              :disabled="loading"
              @click="emit('confirm')"
            >
              <span v-if="loading" class="confirm-spinner" aria-hidden="true"></span>
              {{ loading ? '處理中…' : confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  backdrop-filter: blur(6px);
  z-index: var(--z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  /* 訊息長、螢幕矮的時候原本會直接被切掉，而且捲不動 */
  overflow-y: auto;
}

.confirm-dialog {
  width: 100%;
  max-width: 400px;
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  background: var(--paper);
  box-shadow: var(--shadow-modal);
  text-align: left;
}

.confirm-icon {
  width: 52px;
  height: 52px;
  margin: 0 0 15px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-title);
}
.confirm-icon.danger  { background: var(--bg-danger); color: var(--text-danger); }
.confirm-icon.primary { background: var(--bg-accent); color: var(--text-accent); }

.confirm-title {
  font-family: var(--font-display);
  font-size: var(--text-lead);
  font-weight: 800;
  color: var(--ink);
}

.confirm-message {
  margin-top: 7px;
  font-size: var(--text-body);
  color: var(--text-secondary);
  line-height: 1.6;
}

.confirm-detail {
  margin-top: 10px;
  padding: 9px 12px;
  border-radius: var(--r-md);
  background: var(--bg-inset);
  font-size: var(--text-label);
  font-weight: 700;
  color: var(--muted);
  line-height: 1.5;
}

.confirm-slot {
  margin-top: 12px;
  text-align: left;
}

.confirm-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.confirm-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 12px 14px;
  border-radius: 13px;
  font-size: var(--text-body);
  font-weight: 800;
  transition: opacity 0.15s, transform 0.12s, background 0.15s, border-color 0.15s;
}
.confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.confirm-btn:active:not(:disabled) { transform: scale(0.98); }

.confirm-btn.cancel {
  color: var(--text-secondary);
  background: var(--bg-inset);
  font-weight: 700;
}
.confirm-btn.cancel:hover:not(:disabled) { background: var(--border); color: var(--ink); }

.confirm-btn.primary {
  background: var(--accent-solid);
  color: var(--text-on-accent);
  box-shadow: 0 12px 24px -12px color-mix(in srgb, var(--persimmon) 75%, transparent);
}
.confirm-btn.primary:hover:not(:disabled) { background: var(--accent-hover); }

.confirm-btn.danger {
  background: var(--danger);
  color: var(--paper);
  box-shadow: 0 12px 24px -12px color-mix(in srgb, var(--persimmon) 70%, transparent);
}
.confirm-btn.danger:hover:not(:disabled) { background: var(--danger-hover); }

.confirm-spinner {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, currentColor 40%, transparent);
  border-top-color: currentColor;
  animation: confirm-spin 0.7s linear infinite;
}

@keyframes confirm-spin {
  to { transform: rotate(360deg); }
}

.confirm-overlay-enter-active, .confirm-overlay-leave-active { transition: opacity 0.2s ease; }
.confirm-overlay-enter-from, .confirm-overlay-leave-to { opacity: 0; }
.confirm-overlay-enter-active .confirm-dialog { animation: confirmDialogIn 0.26s cubic-bezier(0.34, 1.4, 0.64, 1); }
.confirm-overlay-leave-active .confirm-dialog { animation: confirmDialogOut 0.16s ease; }

@keyframes confirmDialogIn {
  from { transform: scale(0.93) translateY(8px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}
@keyframes confirmDialogOut {
  from { transform: scale(1); opacity: 1; }
  to   { transform: scale(0.96); opacity: 0; }
}
</style>
