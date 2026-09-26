<script setup>
defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  wideCenter: { type: Boolean, default: false }
})
</script>

<template>
  <header class="top-header" :class="{ 'wide-center': wideCenter }">
    <div class="top-header-inner">
      <div class="title-group">
        <h1 class="page-title">{{ title }}</h1>
        <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.center" class="header-center">
        <slot name="center" />
      </div>
      <div class="header-right" v-if="$slots.actions">
        <slot name="actions" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.top-header {
  /* viewport-fit=cover 後版面會延伸到狀態列／瀏海底下。多出來的高度用 padding 撐開，
     標題列背景剛好蓋住狀態列區域，內容區維持 --header-height。 */
  height: calc(var(--header-height) + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  background: var(--paper);
  color: var(--ink);
  border-bottom: 3px solid var(--persimmon);
  position: sticky;
  top: 0;
  z-index: 40;
  flex-shrink: 0;
}

.top-header-inner {
  height: 100%;
  /* 與各頁 .content 同寬同邊距，標題才會跟內容切齊 */
  width: min(100%, var(--page-max));
  margin: 0 auto;
  padding: 0 var(--page-pad);
  display: flex;
  align-items: center;
  gap: 16px;
}

.title-group {
  flex-shrink: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
}

.page-title {
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: 700;
  letter-spacing: .04em;
  color: var(--ink);
  line-height: 1.2;
}

.page-subtitle {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-label);
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 768px) {
  .page-title { font-size: var(--text-body); }
  .page-subtitle { display: none; }
}

.header-center {
  flex: 1;
  max-width: 360px;
}

.top-header.wide-center .header-center {
  min-width: 0;
  max-width: none;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  min-width: 0;
  flex-shrink: 1;
  overflow-x: auto;
  scrollbar-width: none;
}
.header-right::-webkit-scrollbar { display: none; }
</style>
