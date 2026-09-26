<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  alert: { type: Boolean, default: false },
})
</script>

<template>
  <div class="status-notice" :role="alert ? 'alert' : 'status'">
    <i :class="['fas', alert ? 'fa-triangle-exclamation' : 'fa-circle-info']" class="status-notice-icon" aria-hidden="true"></i>
    <span class="status-notice-title">{{ title }}</span>
    <span v-if="description" class="status-notice-description">{{ description }}</span>
    <slot />
  </div>
</template>

<style scoped>
/* 空狀態瘦身：單行文字＋小 icon，不另外加框／貼紙卡；顏色走語意 token，
   在一般紙色背景與 .ops-surface 暗色工作區都能正確配色。 */
.status-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  column-gap: 8px;
  row-gap: 2px;
  width: 100%;
  margin: 18px auto;
  padding: 2px 16px;
  color: var(--text-primary);
  text-align: center;
}
.status-notice-icon {
  align-self: center;
  font-size: var(--text-body);
  color: var(--muted);
}
.status-notice-title { font-family: var(--font-display); font-size: var(--text-label); font-weight: 700; }
.status-notice-description { font-size: var(--text-micro); font-weight: 400; color: var(--muted); }
.status-notice :slotted(button) { margin-left: 6px; }
</style>
