import { createRouter, createWebHistory } from 'vue-router'

let resolveAuthState
const authStateReady = new Promise((resolve) => {
  resolveAuthState = resolve
})

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('../views/DashboardView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue'),
    meta: { requiresAdmin: true }
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { guest: true, noShell: true }
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('../views/RegisterView.vue'),
    meta: { guest: true, noShell: true }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'home' }
  }
]

const reducedMotionQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null

const router = createRouter({
  history: createWebHistory(),
  routes,
  // 配合頁面轉場（離場 220ms）：等舊頁淡出、新頁開始進場時才調整捲動，
  // 避免舊頁淡出中畫面跳動。上一頁/下一頁還原先前位置，一般導航回到頂端。
  scrollBehavior(to, from, savedPosition) {
    const delay = reducedMotionQuery?.matches ? 0 : 240
    return new Promise((resolve) => {
      setTimeout(() => resolve(savedPosition || { top: 0 }), delay)
    })
  }
})

// 首頁就緒後於瀏覽器空閒時預載其他路由 chunk，之後切頁不必等下載
router.isReady().then(() => {
  const prefetchRoutes = () => {
    routes.forEach((route) => {
      if (typeof route.component === 'function') route.component()
    })
  }
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(prefetchRoutes, { timeout: 3000 })
  } else {
    setTimeout(prefetchRoutes, 2000)
  }
})

router.beforeEach(async (to) => {
  // Vue Router starts its first navigation during app.use(router), before
  // App.vue has finished setup. Waiting for the provider here prevents a
  // cached signed-in user from briefly landing on (or getting stuck on) login.
  const authState = await authStateReady
  const { isAdmin, isLoggedIn, isInitialized } = authState

  if (isInitialized && !isInitialized.value && authState.initPromise) {
    await authState.initPromise
  }

  if (to.meta.guest) {
    if (isLoggedIn && isLoggedIn.value) return { name: 'home' }
    return true
  }

  if (to.meta.requiresAuth || to.meta.requiresAdmin || to.name !== 'home') {
    if (!isLoggedIn || !isLoggedIn.value) return { name: 'login' }
  }

  if (to.meta.requiresAdmin) {
    if (authState.profileLoaded && !authState.profileLoaded.value && authState.waitForProfile) {
      await authState.waitForProfile()
    }
    if (!isAdmin || !isAdmin.value) return { name: 'home' }
  }

  return true
})

export const setRouterAuthState = (authState) => {
  if (!resolveAuthState) return
  resolveAuthState(authState)
  resolveAuthState = null
}

export default router
