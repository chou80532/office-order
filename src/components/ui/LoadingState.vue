<script setup>
import LoadingDots from './LoadingDots.vue'

defineProps({
  title: { type: String, default: '正在載入…' },
  description: { type: String, default: '' },
  paper: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
})
</script>

<template>
  <div class="loading-state" :class="{ 'on-paper': paper, compact }" role="status" aria-live="polite" aria-busy="true">
    <LoadingDots />
    <p class="loading-state-title">{{ title }}</p>
    <p v-if="description" class="loading-state-description">{{ description }}</p>
  </div>
</template>

<style scoped>
.loading-state { width: 100%; min-height: 240px; padding: 32px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; color: var(--paper); background: transparent; }
.loading-state-title { margin: 0; font-family: var(--font-sans); font-size: var(--text-body); font-weight: 700; }
.loading-state-description { margin: 0; color: var(--ink-soft); font-size: var(--text-label); line-height: 1.5; }
.loading-state.on-paper { color: var(--ink); }
.on-paper .loading-state-description { color: var(--ink-faint); }
.loading-state.compact { min-height: 120px; padding: 16px; }
</style>
