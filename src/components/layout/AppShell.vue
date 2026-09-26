<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import NavSidebar from './NavSidebar.vue'
import { useSidebarState } from '../../composables/useSidebarState'

const { collapsed } = useSidebarState()

const isOnline = ref(navigator.onLine)
function setOnline()  { isOnline.value = true }
function setOffline() { isOnline.value = false }
onMounted(() => {
  window.addEventListener('online',  setOnline)
  window.addEventListener('offline', setOffline)
})
onUnmounted(() => {
  window.removeEventListener('online',  setOnline)
  window.removeEventListener('offline', setOffline)
})
</script>

<template>
  <div class="shell">
    <NavSidebar />
    <div class="shell-body" :class="{ collapsed }">
      <Transition name="banner">
        <div v-if="!isOnline" class="offline-banner" role="status">
          <span class="banner-icon">📡</span>
          目前離線，顯示快取資料
        </div>
      </Transition>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.shell {
  /* 已登入的功能頁統一使用 40px 桌機左右邊界；無 Shell 的登入／註冊頁不受影響。 */
  --page-pad: 40px;
  display: flex;
  min-height: 100vh;
}

.shell-body {
  flex: 1;
  margin-left: 240px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  transition: margin-left 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.shell-body.collapsed { margin-left: 60px; }

.offline-banner {
  display: flex;
  align-items: center;
  gap: 7px;
  /* 離線橫幅排在標題列之前，捲到頂時它才是最上面的元素，同樣要避開狀態列 */
  padding: calc(8px + env(safe-area-inset-top, 0px)) 20px 8px;
  background: var(--highlight);
  color: var(--text-on-highlight);
  font-size: var(--text-label);
  font-weight: 700;
  letter-spacing: 0.1px;
  z-index: 50;
  flex-shrink: 0;
}
.banner-icon { font-size: var(--text-body); }

.banner-enter-active, .banner-leave-active { transition: all 0.25s; }
.banner-enter-from, .banner-leave-to { opacity: 0; transform: translateY(-100%); }

@media (max-width: 768px) {
  .shell { --page-pad: 16px; }

  .shell-body {
    margin-left: 0 !important;
    padding-bottom: var(--mobile-nav-height);
  }
}

.shell { background: var(--ink); }
/* 768.02 而不是 769：非預設縮放時 viewport 會是 768.5 這種分數像素，
   768/769 這組在中間會兩條都不成立，.shell-body 退回基準的 margin-left:240px，
   但側欄實寬只有 92px，左邊會憑空多出 148px 空白。 */
@media (min-width: 768.02px) { .shell-body, .shell-body.collapsed { margin-left: 92px; } }
</style>
