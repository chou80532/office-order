<script setup>
import { ref, watch, nextTick } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useDialog } from '../../composables/useDialog'

// 全域對話框宿主：在 App.vue 掛載一次，
// 各處以 confirmDialog() / promptDialog() 呼叫。
const { state, handleConfirm, handleCancel } = useDialog()

const inputEl = ref(null)

// prompt 模式開啟時聚焦輸入框（confirm 模式由 ConfirmDialog 聚焦取消鈕）
watch(() => state.open, (open) => {
  if (open && state.mode === 'prompt') nextTick(() => inputEl.value?.focus())
})
</script>

<template>
  <ConfirmDialog
    :open="state.open"
    :title="state.title"
    :message="state.message"
    :detail="state.detail"
    :variant="state.variant"
    :confirm-text="state.confirmText"
    :cancel-text="state.cancelText"
    :autofocus="state.mode === 'prompt' ? 'none' : 'cancel'"
    @confirm="handleConfirm"
    @cancel="handleCancel"
  >
    <input
      v-if="state.mode === 'prompt'"
      ref="inputEl"
      v-model="state.inputValue"
      class="dialog-input"
      type="text"
      :placeholder="state.inputPlaceholder"
      @keyup.enter="handleConfirm"
    />
  </ConfirmDialog>
</template>

<style scoped>
.dialog-input {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--input-border);
  border-radius: var(--r-md);
  background: var(--input-bg);
  color: var(--ink);
  font-size: var(--text-body);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.dialog-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--input-focus-ring);
}
.dialog-input::placeholder { color: var(--muted); }
</style>
