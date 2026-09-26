<script setup>
import { useToast } from '../../composables/useToast'
const { toasts, dismissToast, pauseToast, resumeToast } = useToast()

const TYPE_ICON = {
  success: 'fa-circle-check',
  error: 'fa-circle-exclamation',
  info: 'fa-circle-info'
}

function iconFor(t) {
  return TYPE_ICON[t.type] || TYPE_ICON.info
}

function handleUndo(t) {
  dismissToast(t.id)
  t.undoFn?.()
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-wrap" role="status" aria-live="polite" aria-atomic="true">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="toast"
          :class="[t.type, { 'has-undo': t.undoLabel }]"
          :role="t.type === 'error' ? 'alert' : 'status'"
          @mouseenter="pauseToast(t.id)"
          @mouseleave="resumeToast(t.id)"
        >
          <span class="toast-icon" aria-hidden="true"><i :class="['fas', iconFor(t)]"></i></span>
          <span class="toast-msg">{{ t.msg }}</span>
          <button v-if="t.undoLabel" type="button" class="undo-btn" @click="handleUndo(t)">{{ t.undoLabel }}</button>
          <button type="button" class="close-btn" @click="dismissToast(t.id)" aria-label="關閉通知">×</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: var(--z-toast);
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--highlight);
  border-radius: 14px;
  font-size: var(--text-body);
  font-weight: 700;
  background: var(--bg-card);
  color: var(--ink);
  box-shadow: 0 14px 30px -20px color-mix(in srgb, var(--persimmon-dark) 40%, transparent), var(--shadow-soft);
  white-space: nowrap;
  pointer-events: auto;
}

.toast-icon {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lead);
  flex-shrink: 0;
  background: var(--bg-highlight);
  color: var(--text-highlight);
}

.toast.error   { border-left-color: var(--danger); }
.toast.error .toast-icon { background: var(--bg-danger); color: var(--text-danger); }
.toast.success { border-left-color: var(--success); }
.toast.success .toast-icon { background: var(--bg-success); color: var(--text-success); }

.toast-msg { flex: 1; }

.undo-btn {
  font-size: var(--text-label);
  font-weight: 700;
  padding: 5px 11px;
  border-radius: var(--r-sm);
  background: var(--bg-inset);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.undo-btn:hover { background: var(--border); color: var(--ink); }

/* 22×22 在手機上太小。用 ::after 把可點範圍撐到 44×44，
   視覺尺寸與版面完全不動。 */
.close-btn::after { content: ''; position: absolute; inset: -11px; }
.close-btn {
  position: relative;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: var(--text-lead);
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0.7;
  transition: opacity 0.15s, background 0.15s;
  padding: 0;
}
.close-btn:hover { opacity: 1; background: var(--bg-inset); }

.toast-enter-active, .toast-leave-active { transition: all 0.2s; }
.toast-enter-from { opacity: 0; transform: translateY(8px); }
.toast-leave-to   { opacity: 0; transform: translateY(-8px); }

/* 底部導覽只在手機出現，但 toast 的 z-index(1000) 高於它(200)，
   不讓開的話會直接壓在導覽上。--mobile-nav-height 已含 safe-area inset。 */
@media (max-width: 768px) {
  .toast-wrap { bottom: calc(12px + var(--mobile-nav-height)); }
}
</style>
