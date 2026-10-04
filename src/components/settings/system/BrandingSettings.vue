<script setup>
import { ref, useId } from 'vue'
import { BRAND_ACCENTS, brandLogo } from '../../../utils/branding'
import { MAX_BRAND_NAME_LENGTH } from '../../../utils/systemSettings'
import { useToast } from '../../../composables/useToast'
import { t } from '../../../i18n'

const props = defineProps({
  modelValue: { type: Object, required: true },
  disabled: Boolean,
})
const emit = defineEmits(['update:modelValue'])
const { showToast } = useToast()

const id = useId()
const fileInput = ref(null)
const uploading = ref(false)
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_LOGO_BYTES = 1024 * 1024

const update = patch => emit('update:modelValue', { ...props.modelValue, branding: { ...props.modelValue.branding, ...patch } })

// Logo 上傳到 Storage 的 branding/（公開讀取），儲存設定後才會套用到登入頁。
async function onFileChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!LOGO_TYPES[file.type]) { showToast(t('system.branding.logoType'), 'error'); return }
  if (file.size > MAX_LOGO_BYTES) { showToast(t('system.branding.logoTooLarge'), 'error'); return }
  uploading.value = true
  try {
    const [{ ref: storageRef, uploadBytes, getDownloadURL }, { storage }] = await Promise.all([
      import('firebase/storage'),
      import('../../../firebaseStorage'),
    ])
    const target = storageRef(storage, `branding/logo-${Date.now()}.${LOGO_TYPES[file.type]}`)
    await uploadBytes(target, file, { contentType: file.type, cacheControl: 'public, max-age=31536000' })
    update({ logoUrl: await getDownloadURL(target) })
  } catch (error) {
    console.error('[branding] logo upload failed', error)
    showToast(t('system.branding.uploadFailed'), 'error')
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="sys-fields">
    <div class="sys-field">
      <label class="sys-label" :for="`${id}-name`">{{ t('system.branding.name') }}</label>
      <input
        :id="`${id}-name`"
        class="sys-input"
        type="text"
        :maxlength="MAX_BRAND_NAME_LENGTH"
        :placeholder="t('system.branding.namePlaceholder')"
        :value="modelValue.branding.name"
        :disabled="disabled"
        @input="update({ name: $event.target.value })"
      >
      <p class="sys-hint">{{ t('system.branding.nameHint') }}</p>
    </div>

    <div class="sys-field">
      <span class="sys-label">{{ t('system.branding.logo') }}</span>
      <div class="logo-row">
        <img class="logo-preview" :src="brandLogo(modelValue.branding)" alt="">
        <input ref="fileInput" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" :disabled="disabled || uploading" @change="onFileChange">
        <button type="button" class="sys-secondary-btn" :disabled="disabled || uploading" @click="fileInput?.click()">
          <i class="fas fa-upload" aria-hidden="true"></i>
          {{ uploading ? t('system.branding.uploading') : modelValue.branding.logoUrl ? t('system.branding.replaceLogo') : t('system.branding.uploadLogo') }}
        </button>
        <button v-if="modelValue.branding.logoUrl" type="button" class="sys-secondary-btn" :disabled="disabled || uploading" @click="update({ logoUrl: '' })">
          {{ t('system.branding.removeLogo') }}
        </button>
      </div>
      <p class="sys-hint">{{ t('system.branding.logoHint') }}</p>
    </div>

    <fieldset class="sys-field">
      <legend class="sys-label">{{ t('system.branding.accent') }}</legend>
      <div class="accent-grid">
        <label v-for="accent in BRAND_ACCENTS" :key="accent.id" class="accent-option" :class="{ selected: modelValue.branding.accent === accent.id }">
          <input type="radio" class="sr-only" :name="`${id}-accent`" :value="accent.id" :checked="modelValue.branding.accent === accent.id" :disabled="disabled" @change="update({ accent: accent.id })">
          <span class="swatch" :style="{ background: accent.dark }" aria-hidden="true"></span>
          <span>{{ t(`system.branding.accents.${accent.id}`) }}</span>
        </label>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.logo-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.logo-preview { width: 48px; height: 48px; object-fit: contain; border-radius: var(--r-md); border: 1px solid var(--border); background: var(--paper); }
.accent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.accent-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  color: var(--text-primary);
  font-size: var(--text-label);
  cursor: pointer;
}
.accent-option.selected { border-color: var(--text-primary); box-shadow: inset 0 0 0 1px var(--text-primary); }
.accent-option:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.swatch { width: 18px; height: 18px; flex-shrink: 0; border-radius: 50%; }
</style>
