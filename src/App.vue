<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { createAuth } from './composables/useAuth'
import { createFirestore } from './composables/useFirestore'
import { createToast } from './composables/useToast'
import { setRouterAuthState } from './router'
import { getTaipeiNextMidnightMs } from './utils/format'
import { useHomeActions } from './composables/useHomeActions'
import { resetPendingCart } from './composables/usePendingCart'
import { usePublicConfig } from './composables/usePublicConfig'
import { applyBranding, brandName } from './utils/branding'
import { t } from './i18n'
import ToastContainer from './components/layout/ToastContainer.vue'
import DialogHost from './components/ui/DialogHost.vue'
import AppShell from './components/layout/AppShell.vue'
import LoadingState from './components/ui/LoadingState.vue'

const auth = createAuth()
const firestore = createFirestore(auth)
createToast()
const router = useRouter()
const route = useRoute()
const { closePanel } = useHomeActions()

setRouterAuthState(auth)
auth.initAuth()

// 品牌（名稱、主題色）：登入後跟著即時的系統設定，登入前用公開設定。
const { publicConfig, loadPublicConfig } = usePublicConfig()
const activeBranding = computed(() => (auth.isLoggedIn.value ? firestore.systemSettings.value.branding : publicConfig.value.branding))
watch(activeBranding, applyBranding, { immediate: true, deep: true })
loadPublicConfig()

const FIRESTORE_REFRESH_COOLDOWN_MS = 30_000
let lastFirestoreRefreshAt = 0
let resumeClassTimer = null
let dailyDateRefreshTimer = null

function refreshFirestoreListeners() {
  if (!auth.isLoggedIn.value) return
  firestore.refreshDailyStoreDate()
  firestore.refreshTodayOrdersListener()

  const now = Date.now()
  if (now - lastFirestoreRefreshAt < FIRESTORE_REFRESH_COOLDOWN_MS) return

  lastFirestoreRefreshAt = now
  firestore.startListeners()
}

function scheduleDailyDateRefresh() {
  clearTimeout(dailyDateRefreshTimer)
  // 系統時區午夜後 1 秒刷新「今日」相關監聽。
  dailyDateRefreshTimer = setTimeout(() => {
    firestore.refreshDailyStoreDate()
    firestore.refreshTodayOrdersListener()
    scheduleDailyDateRefresh()
  }, getTaipeiNextMidnightMs() + 1000 - Date.now())
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    markAppResuming()
    refreshFirestoreListeners()
  }
}

function handleWindowFocus() {
  markAppResuming()
  refreshFirestoreListeners()
}

function markAppResuming() {
  document.documentElement.classList.add('app-resuming')
  clearTimeout(resumeClassTimer)
  resumeClassTimer = setTimeout(() => {
    document.documentElement.classList.remove('app-resuming')
  }, 250)
}

// Toggle Firestore listeners with the auth session.
watch(() => auth.userUid.value, (uid, previousUid) => {
  if (previousUid && uid !== previousUid) { resetPendingCart(); closePanel() }
}, { flush: 'sync' })

watch(() => auth.isLoggedIn.value, (loggedIn) => {
  if (loggedIn) {
    lastFirestoreRefreshAt = Date.now()
    firestore.startListeners()
    if (auth.isInitialized.value && route.meta.guest) {
      router.replace({ name: 'home' })
    }
  } else {
    resetPendingCart()
    closePanel()
    firestore.stopListeners()
  }
}, { immediate: true })

// 管理員改了系統時區後，下一個午夜的時間點也跟著改變。
watch(() => firestore.systemSettings.value.timeZone, scheduleDailyDateRefresh)

onMounted(() => {
  scheduleDailyDateRefresh()
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('focus', handleWindowFocus)
  window.addEventListener('online', refreshFirestoreListeners)
})

onUnmounted(() => {
  clearTimeout(resumeClassTimer)
  clearTimeout(dailyDateRefreshTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('focus', handleWindowFocus)
  window.removeEventListener('online', refreshFirestoreListeners)
})

const appReady = ref(false)

// 切頁完成後將焦點移至新頁根節點（無障礙）：preventScroll 避免畫面跳動；
// tabindex="-1" 讓非互動容器可程式聚焦，鍵盤與螢幕閱讀器從頁面開頭繼續操作。
function focusPageRoot(el) {
  if (!(el instanceof HTMLElement)) return
  el.dataset.pageFocus = 'true'
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}

// Wait for auth init and route guards before rendering the shell.
watch(() => auth.isInitialized.value, async (initialized) => {
  if (!initialized) return

  await router.isReady()
  appReady.value = true
}, { once: true })
</script>

<template>
  <template v-if="appReady">
    <AppShell v-if="!route.meta.noShell">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in" @after-enter="focusPageRoot">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </AppShell>
    <RouterView v-else v-slot="{ Component }">
      <Transition name="page" mode="out-in" @after-enter="focusPageRoot">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </template>
  <LoadingState v-else class="app-loading" :title="brandName(activeBranding)" :description="t('common.loading')" />
  <ToastContainer />
  <DialogHost />
</template>

<style scoped>
.app-loading {
  min-height: 100dvh;
  display: grid;
  place-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  color: var(--paper);
  background: var(--ink);
}
</style>
