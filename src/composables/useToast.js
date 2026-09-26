// ==========================================
// useToast — 全域 toast 通知（provide/inject）
// ==========================================
import { ref, provide, inject } from 'vue'
import { TOAST_DURATION_MS } from '../constants'

const TOAST_KEY = Symbol('toast')

/**
 * 在 App.vue 中呼叫，建立並 provide toast 狀態
 */
export const createToast = () => {
  const toasts = ref([])
  let idCounter = 0

  const dismissToast = (id) => {
    const t = toasts.value.find(t => t.id === id)
    if (t?._timer) clearTimeout(t._timer)
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  const pauseToast = (id) => {
    const t = toasts.value.find(t => t.id === id)
    if (!t || !t._timer) return
    clearTimeout(t._timer)
    t._timer = null
    t._remaining = Math.max(0, t._duration - (Date.now() - t._startedAt))
  }

  const resumeToast = (id) => {
    const t = toasts.value.find(t => t.id === id)
    if (!t || t._timer) return
    const remaining = t._remaining ?? t._duration
    t._startedAt = Date.now()
    t._remaining = remaining
    t._timer = setTimeout(() => dismissToast(id), remaining)
  }

  const showToast = (msg, type = 'success', options = {}) => {
    const id = idCounter++
    const { duration = TOAST_DURATION_MS, undoLabel = null, undoFn = null } = options
    const toast = { id, msg, type, undoLabel, undoFn, _duration: duration, _startedAt: Date.now(), _timer: null, _remaining: duration }
    toast._timer = setTimeout(() => dismissToast(id), duration)
    toasts.value.push(toast)
  }

  provide(TOAST_KEY, { toasts, showToast, dismissToast, pauseToast, resumeToast })

  return { toasts, showToast, dismissToast, pauseToast, resumeToast }
}

/**
 * 在任何子元件中呼叫，取得 toast 功能
 */
export const useToast = () => {
  const injected = inject(TOAST_KEY, null)
  if (!injected) {
    console.warn('[useToast] 未找到 provider，請確認 App.vue 已呼叫 createToast()')
    return { toasts: ref([]), showToast: () => {}, dismissToast: () => {}, pauseToast: () => {}, resumeToast: () => {} }
  }
  return injected
}
