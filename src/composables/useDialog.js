import { reactive } from 'vue'

// 站內對話框（confirm / prompt）全域狀態，取代原生 confirm() 與 prompt()。
// 由 App.vue 掛載的 DialogHost 負責渲染，各處直接 import confirmDialog / promptDialog 使用。
const state = reactive({
  open: false,
  mode: 'confirm', // 'confirm' | 'prompt'
  title: '',
  message: '',
  detail: '',
  variant: 'primary',
  confirmText: '確認',
  cancelText: '取消',
  inputValue: '',
  inputPlaceholder: '',
})

let resolver = null

function openDialog(mode, options = {}) {
  // 若前一個對話框尚未關閉，視同取消，避免 Promise 懸置
  resolver?.(mode === 'prompt' ? null : false)

  return new Promise((resolve) => {
    resolver = resolve
    state.mode = mode
    state.title = options.title || (mode === 'prompt' ? '請輸入' : '確認操作')
    state.message = options.message || ''
    state.detail = options.detail || ''
    state.variant = options.variant || 'primary'
    state.confirmText = options.confirmText || '確認'
    state.cancelText = options.cancelText || '取消'
    state.inputValue = options.defaultValue || ''
    state.inputPlaceholder = options.placeholder || ''
    state.open = true
  })
}

/** 站內版 confirm()：回傳 Promise<boolean> */
export function confirmDialog(options) {
  return openDialog('confirm', options)
}

/** 站內版 prompt()：確認回傳輸入字串，取消回傳 null（與原生行為一致） */
export function promptDialog(options) {
  return openDialog('prompt', options)
}

/** 供 DialogHost 渲染與回應使用 */
export function useDialog() {
  function handleConfirm() {
    const result = state.mode === 'prompt' ? state.inputValue : true
    state.open = false
    resolver?.(result)
    resolver = null
  }

  function handleCancel() {
    const result = state.mode === 'prompt' ? null : false
    state.open = false
    resolver?.(result)
    resolver = null
  }

  return { state, handleConfirm, handleCancel }
}
