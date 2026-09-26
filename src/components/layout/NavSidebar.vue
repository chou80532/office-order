<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { confirmDialog } from '../../composables/useDialog'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../../composables/useAuth'
import { useToast } from '../../composables/useToast'
import { useHomeActions } from '../../composables/useHomeActions'
import { useSettingsTab } from '../../composables/useSettingsTab'
import { useSidebarState } from '../../composables/useSidebarState'
import { useScrollLock } from '../../composables/useScrollLock'

const router = useRouter()
const route = useRoute()
const { isLoggedIn, isAdmin, profileLoaded, userDisplayName, logout, changePassword } = useAuth()
const { showToast } = useToast()
const { activePanel, openStatsPanel } = useHomeActions()
const { activeTab } = useSettingsTab()
const { collapsed } = useSidebarState()
const avatarInitial = computed(() => userDisplayName.value.trim().charAt(0).toUpperCase())
const hasProfilePreview = computed(() => !!userDisplayName.value.trim())

const isActive = (path) => route.path === path
const isSettings = computed(() => route.path === '/settings')

// 手機底部導覽：只留「點餐、訂單」在主列，其餘收進「更多」清單，避免 6 顆圖示擠成一排
const moreOpen = ref(false)
useScrollLock(moreOpen)
const isMoreActive = computed(() => ['records', 'wallet', 'stats'].includes(activePanel.value) || isSettings.value)

// 這張「更多」清單原本沒有 Escape，關掉之後焦點也掉回 <body>，
// 鍵盤使用者要從頭 Tab 一次才回得到底部導覽。
const moreSheet = ref(null)
let moreTrigger = null

function onMoreKeydown(event) {
  if (event.key === 'Escape') { moreOpen.value = false; return }
  if (event.key !== 'Tab') return
  const items = [...(moreSheet.value?.querySelectorAll('button:not([disabled]), a[href]') || [])]
    .filter(el => el.offsetParent !== null || el.getClientRects().length > 0)
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (!moreSheet.value?.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault(); last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault(); first.focus()
  }
}

watch(moreOpen, async (open) => {
  if (open) {
    moreTrigger = document.activeElement
    document.addEventListener('keydown', onMoreKeydown)
    await nextTick()
    moreSheet.value?.querySelector('button')?.focus()
  } else {
    document.removeEventListener('keydown', onMoreKeydown)
    if (moreTrigger?.isConnected) moreTrigger.focus()
    moreTrigger = null
  }
})

function selectMore(action) {
  moreOpen.value = false
  action()
}

// 桌機側邊導覽：自訂樣式 tooltip 取代原生 title，滑鼠停留／鍵盤聚焦時顯示於圖示右側
const navTooltip = reactive({ visible: false, text: '', top: 0, left: 0 })
let navTooltipTimer = null
function showNavTooltip(event, text) {
  clearTimeout(navTooltipTimer)
  const rect = event.currentTarget.getBoundingClientRect()
  navTooltip.text = text
  navTooltip.top = rect.top + rect.height / 2
  navTooltip.left = rect.right + 10
  navTooltipTimer = setTimeout(() => { navTooltip.visible = true }, 150)
}
function hideNavTooltip() {
  clearTimeout(navTooltipTimer)
  navTooltip.visible = false
}

function goHome() {
  activePanel.value = null
  if (route.path !== '/') router.push('/')
}

function goDashboard() {
  activePanel.value = null
  router.push('/dashboard')
}

function goPanel(panelId) {
  activePanel.value = panelId
  if (route.path !== '/') router.push('/')
}

function goStatsPanel() {
  openStatsPanel()
  if (route.path !== '/') router.push('/')
}

const settingsItems = [
  { id: 'stores',  icon: 'fa-store',          label: '店家管理' },
  { id: 'members', icon: 'fa-users',           label: '成員名單' },
  { id: 'wallet',  icon: 'fa-piggy-bank',      label: '儲值錢包' },
  { id: 'cash',    icon: 'fa-money-bill-wave', label: '現金收款' },
  { id: 'notes',   icon: 'fa-pen-to-square',   label: '快捷備註' },
  { id: 'cleanup', icon: 'fa-trash-can',        label: '舊檔清理' },
]

function goSettings(tabId) {
  activeTab.value = tabId
  activePanel.value = null
  if (!isSettings.value) router.push('/settings')
}

const pwOpen = ref(false)
// 修改密碼是覆蓋全畫面的浮層，且內含輸入框 —— iOS 鍵盤彈出時背景更容易亂捲。
useScrollLock(pwOpen)
const pwForm = ref({ current: '', next: '', confirm: '' })
const pwLoading = ref(false)
const pwVisibility = ref({ current: false, next: false, confirm: false })

const resetPwForm = () => {
  pwForm.value = { current: '', next: '', confirm: '' }
  pwVisibility.value = { current: false, next: false, confirm: false }
}

// 原本點背景、點 × 或點取消都會直接關掉，三個欄位全部清空而且不提醒。
// 密碼是手打的、又看不見，重打一次特別煩，所以填過東西就先問一聲。
const pwIsDirty = () => Object.values(pwForm.value).some(value => value.length > 0)

async function closePwPanel({ force = false } = {}) {
  if (pwLoading.value) return
  if (!force && pwIsDirty() && !await confirmDialog({
    title: '放棄修改密碼？',
    message: '已經填了一部分，關掉就要重打。',
    variant: 'danger',
    confirmText: '放棄',
    cancelText: '繼續填',
  })) return
  pwOpen.value = false
  resetPwForm()
}

function togglePwVisibility(field) {
  pwVisibility.value[field] = !pwVisibility.value[field]
}

const PW_LEVELS = [
  { label: '弱',   color: 'var(--paprika)' },
  { label: '弱',   color: 'var(--paprika)' },
  { label: '一般', color: 'var(--gold)'    },
  { label: '強',   color: 'var(--mint)'    },
  { label: '很強', color: 'var(--mint)'    },
]

const pwStrength = computed(() => {
  const p = pwForm.value.next
  if (!p.length) return null
  let score = 0
  if (p.length >= 6)                              score++
  if (p.length >= 10)                             score++
  if (/[0-9]/.test(p))                            score++
  if (/[A-Z]/.test(p) || /[^a-zA-Z0-9]/.test(p))  score++
  const s = Math.min(score, 4)
  return { score: s, ...PW_LEVELS[s] }
})

async function handleChangePassword() {
  if (pwForm.value.next !== pwForm.value.confirm) { showToast('兩次密碼不一致', 'error'); return }
  if (pwForm.value.next.length < 6) { showToast('密碼至少 6 個字元', 'error'); return }
  pwLoading.value = true
  try {
    await changePassword(pwForm.value.current, pwForm.value.next)
    showToast('密碼已更新', 'success')
    pwOpen.value = false
    resetPwForm()
  } catch (err) {
    const msg = err.code === 'auth/wrong-password' ? '目前密碼錯誤' : '修改失敗'
    showToast(msg, 'error')
  } finally {
    pwLoading.value = false
  }
}

async function handleLogout() {
  await logout()
  router.push('/login')
}
</script>

<template>
  <aside class="nav-sidebar" :class="{ collapsed }">

    <!-- Brand + toggle -->
    <div class="sidebar-top">
      <div class="sidebar-brand">
          <span class="brand-tile" aria-hidden="true"><img src="/office-lunch.svg" alt="" /></span>
        <span class="brand-text">
          <span class="brand-name">Office Order</span>
          <span class="brand-sub">辦公室團體訂購</span>
        </span>
      </div>

    </div>

    <!-- Scrollable nav area -->
    <div class="sidebar-scroll">

    <!-- Main nav -->
    <nav class="sidebar-nav">
      <button
        class="nav-item"
        :class="{ active: isActive('/') && !activePanel }"
        @click="goHome"
        @mouseenter="showNavTooltip($event, '點餐')"
        @mouseleave="hideNavTooltip"
        @focus="showNavTooltip($event, '點餐')"
        @blur="hideNavTooltip"
      >
        <i class="fas fa-utensils nav-icon"></i>
        <span class="nav-label">點餐</span>
      </button>
      <button
        class="nav-item"
        :class="{ active: isActive('/dashboard') }"
        @click="goDashboard"
        @mouseenter="showNavTooltip($event, '今日訂單')"
        @mouseleave="hideNavTooltip"
        @focus="showNavTooltip($event, '今日訂單')"
        @blur="hideNavTooltip"
      >
        <i class="fas fa-list-check nav-icon"></i>
        <span class="nav-label">今日訂單</span>
      </button>
      <template v-if="isLoggedIn">
        <button
          class="nav-item action"
          :class="{ active: activePanel === 'records' }"
          @click="goPanel('records')"
          @mouseenter="showNavTooltip($event, '歷史訂單')"
          @mouseleave="hideNavTooltip"
          @focus="showNavTooltip($event, '歷史訂單')"
          @blur="hideNavTooltip"
        >
          <i class="fas fa-clock-rotate-left nav-icon"></i>
          <span class="nav-label">歷史訂單</span>
        </button>
        <button
          class="nav-item action"
          :class="{ active: activePanel === 'wallet' }"
          @click="goPanel('wallet')"
          @mouseenter="showNavTooltip($event, '虛擬錢包')"
          @mouseleave="hideNavTooltip"
          @focus="showNavTooltip($event, '虛擬錢包')"
          @blur="hideNavTooltip"
        >
          <i class="fas fa-wallet nav-icon"></i>
          <span class="nav-label">虛擬錢包</span>
        </button>
        <button
          class="nav-item action"
          :class="{ active: activePanel === 'stats' }"
          @click="goStatsPanel"
          @mouseenter="showNavTooltip($event, '統計')"
          @mouseleave="hideNavTooltip"
          @focus="showNavTooltip($event, '統計')"
          @blur="hideNavTooltip"
        >
          <i class="fas fa-chart-column nav-icon"></i>
          <span class="nav-label">統計</span>
        </button>
      </template>
    </nav>

    <!-- Management nav -->
    <template v-if="isAdmin && isLoggedIn">
      <div class="section-divider" />
      <div class="settings-nav">
        <p v-if="!collapsed" class="nav-section-label">管理功能</p>
        <button
          v-for="item in settingsItems"
          :key="item.id"
          class="nav-item action"
          :class="{ active: isSettings && activeTab === item.id }"
          @click="goSettings(item.id)"
          @mouseenter="showNavTooltip($event, item.label)"
          @mouseleave="hideNavTooltip"
          @focus="showNavTooltip($event, item.label)"
          @blur="hideNavTooltip"
        >
          <i :class="['fas', item.icon, 'nav-icon']"></i>
          <span class="nav-label">{{ item.label }}</span>
        </button>
      </div>
    </template>

    </div>
    <!-- /Scrollable nav area -->

    <!-- User section -->
    <div v-if="isLoggedIn" class="user-section">
      <div class="section-divider" />
      <div class="user-info" :title="collapsed ? userDisplayName : ''">
        <span class="user-avatar" :class="{ loading: !hasProfilePreview }">
          <i v-if="!hasProfilePreview" class="fas fa-circle-notch fa-spin" aria-label="載入使用者資料"></i>
          <template v-else>{{ avatarInitial }}</template>
        </span>
        <div class="user-text">
          <p class="user-name">{{ hasProfilePreview ? userDisplayName : '載入中…' }}</p>
          <p v-if="profileLoaded && isAdmin" class="user-role">管理員</p>
        </div>
      </div>
      <div class="user-actions">
        <button
          class="user-action-btn"
          @click="pwOpen = true"
          @mouseenter="showNavTooltip($event, '修改密碼')"
          @mouseleave="hideNavTooltip"
          @focus="showNavTooltip($event, '修改密碼')"
          @blur="hideNavTooltip"
        >
          <i class="fas fa-key"></i>
          <span class="nav-label">修改密碼</span>
        </button>
        <button
          class="user-action-btn danger"
          @click="handleLogout"
          @mouseenter="showNavTooltip($event, '登出')"
          @mouseleave="hideNavTooltip"
          @focus="showNavTooltip($event, '登出')"
          @blur="hideNavTooltip"
        >
          <i class="fas fa-right-from-bracket"></i>
          <span class="nav-label">登出</span>
        </button>
      </div>
    </div>
  </aside>

  <!-- 桌機側邊導覽：自訂樣式 tooltip（取代原生 title），Teleport 到 body 避免被側欄 overflow:hidden 裁切 -->
  <Teleport to="body">
    <Transition name="nav-tooltip-fade">
      <div
        v-if="navTooltip.visible"
        class="nav-tooltip"
        role="tooltip"
        :style="{ top: navTooltip.top + 'px', left: navTooltip.left + 'px' }"
      >{{ navTooltip.text }}</div>
    </Transition>
  </Teleport>

  <!-- Mobile bottom nav -->
  <nav class="mobile-bottom-nav">
    <button class="mob-item" :class="{ active: isActive('/') && !activePanel }" @click="goHome">
      <i class="fas fa-utensils mob-icon"></i>
      <span class="mob-label">點餐</span>
    </button>
    <button class="mob-item" :class="{ active: isActive('/dashboard') }" @click="goDashboard">
      <i class="fas fa-list-check mob-icon"></i>
      <span class="mob-label">訂單</span>
    </button>
    <template v-if="isLoggedIn">
      <button
        class="mob-item"
        :class="{ active: isMoreActive }"
        aria-haspopup="true"
        :aria-expanded="moreOpen"
        @click="moreOpen = !moreOpen"
      >
        <i class="fas fa-ellipsis mob-icon"></i>
        <span class="mob-label">更多</span>
      </button>
    </template>
  </nav>

  <!-- Mobile bottom nav：更多選單（歷史／錢包／統計／設定） -->
  <Teleport to="body">
    <Transition name="mob-more">
      <div v-if="moreOpen" class="mob-more-overlay" @click.self="moreOpen = false">
        <div ref="moreSheet" class="mob-more-sheet" role="menu" aria-label="更多功能">
          <button class="mob-more-item" role="menuitem" :class="{ active: activePanel === 'records' }" @click="selectMore(() => goPanel('records'))">
            <i class="fas fa-clock-rotate-left" aria-hidden="true"></i>
            <span>歷史訂單</span>
          </button>
          <button class="mob-more-item" role="menuitem" :class="{ active: activePanel === 'wallet' }" @click="selectMore(() => goPanel('wallet'))">
            <i class="fas fa-wallet" aria-hidden="true"></i>
            <span>虛擬錢包</span>
          </button>
          <button class="mob-more-item" role="menuitem" :class="{ active: activePanel === 'stats' }" @click="selectMore(goStatsPanel)">
            <i class="fas fa-chart-column" aria-hidden="true"></i>
            <span>統計</span>
          </button>
          <button v-if="isAdmin" class="mob-more-item" role="menuitem" :class="{ active: isSettings }" @click="selectMore(() => goSettings('stores'))">
            <i class="fas fa-gear" aria-hidden="true"></i>
            <span>設定</span>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Change password modal -->
  <Teleport to="body">
    <Transition name="overlay">
      <div v-if="pwOpen" class="overlay" @click.self="closePwPanel()">
        <div class="pw-modal">
          <div class="pw-header">
            <span class="pw-head-icon" aria-hidden="true"><i class="fas fa-key"></i></span>
            <div class="pw-head-text">
              <h3 class="pw-title">修改密碼</h3>
              <p class="pw-sub">為了帳號安全，建議定期更換</p>
            </div>
            <button class="pw-close" @click="closePwPanel()" aria-label="關閉">×</button>
          </div>
          <div class="pw-body">
            <div class="field">
              <label class="field-label">目前密碼</label>
              <div class="password-input-wrap">
                <input
                  v-model="pwForm.current"
                  :type="pwVisibility.current ? 'text' : 'password'"
                  class="field-input password-input"
                  autocomplete="current-password"
                />
                <button
                  type="button"
                  class="password-toggle"
                  :aria-label="pwVisibility.current ? '隱藏目前密碼' : '顯示目前密碼'"
                  :title="pwVisibility.current ? '隱藏密碼' : '顯示密碼'"
                  @click="togglePwVisibility('current')"
                >
                  <i :class="['fas', pwVisibility.current ? 'fa-eye-slash' : 'fa-eye']"></i>
                </button>
              </div>
            </div>
            <div class="field">
              <label class="field-label">新密碼</label>
              <div class="password-input-wrap">
                <input
                  v-model="pwForm.next"
                  :type="pwVisibility.next ? 'text' : 'password'"
                  class="field-input password-input"
                  autocomplete="new-password"
                />
                <button
                  type="button"
                  class="password-toggle"
                  :aria-label="pwVisibility.next ? '隱藏新密碼' : '顯示新密碼'"
                  :title="pwVisibility.next ? '隱藏密碼' : '顯示密碼'"
                  @click="togglePwVisibility('next')"
                >
                  <i :class="['fas', pwVisibility.next ? 'fa-eye-slash' : 'fa-eye']"></i>
                </button>
              </div>
              <Transition name="strength">
                <div v-if="pwStrength" class="pw-strength">
                  <div class="pw-bars">
                    <div
                      v-for="i in 4"
                      :key="i"
                      class="pw-bar"
                      :style="i <= pwStrength.score ? { background: pwStrength.color } : {}"
                    ></div>
                  </div>
                  <span class="pw-label" :style="{ color: pwStrength.color }">{{ pwStrength.label }}</span>
                </div>
              </Transition>
            </div>
            <div class="field">
              <label class="field-label">確認新密碼</label>
              <div class="password-input-wrap">
                <input
                  v-model="pwForm.confirm"
                  :type="pwVisibility.confirm ? 'text' : 'password'"
                  class="field-input password-input"
                  autocomplete="new-password"
                  @keyup.enter="handleChangePassword"
                />
                <button
                  type="button"
                  class="password-toggle"
                  :aria-label="pwVisibility.confirm ? '隱藏確認新密碼' : '顯示確認新密碼'"
                  :title="pwVisibility.confirm ? '隱藏密碼' : '顯示密碼'"
                  @click="togglePwVisibility('confirm')"
                >
                  <i :class="['fas', pwVisibility.confirm ? 'fa-eye-slash' : 'fa-eye']"></i>
                </button>
              </div>
            </div>
          </div>
          <div class="pw-footer">
            <button class="pw-cancel" @click="closePwPanel()">取消</button>
            <button class="pw-submit" @click="handleChangePassword" :disabled="pwLoading">
              {{ pwLoading ? '更新中…' : '確認修改' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Sidebar shell ── */
.nav-sidebar {
  position: fixed;
  top: 0; left: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  z-index: 50;
  flex-shrink: 0;
  transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}

/* ── Brand + toggle ── */
.sidebar-top {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  flex-shrink: 0;
  gap: 4px;
}
.collapsed .sidebar-top {
  justify-content: center;
  gap: 4px;
  margin-bottom: 2px;
}
.sidebar-brand {
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.collapsed .sidebar-brand {
  flex: 0 0 38px;
  width: 38px;
  overflow: visible;
}
.brand-tile {
  width: 38px;
  height: 38px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.brand-tile img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  overflow: hidden;
  transition: opacity 0.15s, max-width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.brand-name {
  font-family: var(--font-display);
  font-weight: 800;
}
.brand-sub {
  font-size: var(--text-micro);
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}

.toggle-btn {
  flex-shrink: 0;
  width: 24px; height: 24px;
  border-radius: var(--r-sm);
  display: flex; align-items: center; justify-content: center;
  color: var(--sidebar-text);
  transition: all 0.15s;
}
.toggle-btn:hover { background: var(--sidebar-bg-active); color: var(--sidebar-text-active); }
.toggle-icon { font-size: var(--text-body); font-weight: 700; line-height: 1; }
.collapsed .toggle-btn {
  width: 38px;
  height: 22px;
  border: 1px solid var(--sidebar-border);
  background: var(--bg-inset);
}

/* ── Nav + action items (shared) ── */
.sidebar-nav, .quick-actions, .settings-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.user-actions {
  display: flex;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  color: var(--sidebar-text);
  font-size: var(--text-body);
  font-weight: 600;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  overflow: hidden;
  width: 100%;
  text-align: left;
}
.nav-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  translate: 0 -50%;
  width: 3px;
  height: 0;
  border-radius: 999px;
  background: var(--sidebar-text-active);
  transition: height 0.18s ease;
}
/* hover 只提一階，強調色（柿橘）保留給「已選取」，兩者才分得開 */
.nav-item:hover { background: color-mix(in srgb, var(--paper) 10%, transparent); color: var(--sidebar-text-active); }
.nav-item.active { background: var(--sidebar-bg-active); color: var(--sidebar-text-active); font-weight: 700; }
.nav-item.active::before { height: 55%; }
.nav-item.active .nav-icon { color: var(--sidebar-text-active); }
.nav-item.danger { color: var(--text-danger); }
.nav-item.danger:hover { background: var(--bg-danger); color: var(--text-danger); }

.nav-icon { width: 19px; text-align: center; flex-shrink: 0; transition: color 0.15s; }
.nav-item:hover .nav-icon { color: var(--sidebar-text-active); }
.nav-item.active:hover { background: var(--sidebar-bg-active); }
.sub-item.active:hover { background: var(--sidebar-bg-active); }

.nav-section-label {
  margin: 12px 12px 6px;
  color: var(--text-muted);
  font-size: var(--text-micro);
  font-weight: 700;
  letter-spacing: 1.5px;
}

.nav-label {
  overflow: hidden;
  transition: opacity 0.15s, max-width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.collapsed .nav-item {
  padding-inline: 0;
}

/* ── Settings sub-nav ── */
.sub-nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-left: 26px;
  margin-top: 2px;
}
.sub-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  color: var(--sidebar-text);
  font-size: var(--text-label);
  font-weight: 600;
  text-align: left;
  width: 100%;
  transition: all 0.15s;
  white-space: nowrap;
}
.sub-item:hover { background: color-mix(in srgb, var(--paper) 10%, transparent); color: var(--sidebar-text-active); }
.sub-item.active { color: var(--sidebar-text-active); background: var(--sidebar-bg-active); }
.sub-item.active .sub-icon { color: var(--sidebar-text-active); }
.sub-icon { width: 14px; text-align: center; font-size: var(--text-label); flex-shrink: 0; }

/* ── Dividers ── */
.section-divider {
  height: 1px;
  background: var(--sidebar-border);
  margin: 8px 0;
  flex-shrink: 0;
}

/* ── Scrollable nav area ── */
.sidebar-scroll {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  /* thin, unobtrusive scrollbar */
  scrollbar-width: thin;
  scrollbar-color: var(--sidebar-border) transparent;
}
.sidebar-scroll::-webkit-scrollbar { width: 6px; }
.sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
.sidebar-scroll::-webkit-scrollbar-thumb {
  background: var(--sidebar-border);
  border-radius: 999px;
}

/* ── User section ── */
.user-section { display: flex; flex-direction: column; }
.user-info {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 8px;
  border-radius: 13px;
  overflow: hidden;
}
.user-avatar {
  background: var(--jade);
  width: 38px; height: 38px;
  border-radius: 12px;
  font-family: var(--font-display);
  font-size: var(--text-lead); font-weight: 700; color: var(--paper);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.user-avatar.loading {
  background: var(--muted-line);
  color: var(--muted);
  font-size: var(--text-micro);
}
.user-text {
  overflow: hidden;
  transition: opacity 0.15s, max-width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  max-width: 130px;
}
.collapsed .user-text { max-width: 0; opacity: 0; }
.collapsed .user-info {
  justify-content: center;
  gap: 0;
  padding-inline: 0;
}
.user-name { font-size: var(--text-body); font-weight: 700; color: var(--ink); white-space: nowrap; }
.user-role { font-size: var(--text-micro); font-weight: 600; color: var(--text-muted); margin-top: 1px; }

/* ── User action buttons (修改密碼 / 登出) ── */
.user-actions {
  gap: 8px;
  margin-top: 8px;
}
.collapsed .user-actions { flex-direction: column; gap: 4px; }
.user-action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  font-size: var(--text-label);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  transition: background 0.15s, color 0.15s;
}
.user-action-btn:hover { background: var(--border); color: var(--ink); }
.user-action-btn.danger {
  background: var(--bg-danger);
  color: var(--text-danger);
  font-weight: 700;
}
.user-action-btn.danger:hover { background: var(--bg-danger); filter: brightness(0.96); }
.collapsed .user-action-btn .nav-label { display: none; }

/* ── Theme switcher ── */
.theme-section {
  padding: 4px 0;
  flex-shrink: 0;
}

.theme-cycle-btn {
  width: 100%;
}

.theme-segment {
  display: flex;
  gap: 3px;
  background: var(--bg-inset);
  border-radius: 14px;
  padding: 4px;
}

.theme-opt {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  border-radius: 11px;
  color: var(--sidebar-text);
  font-size: var(--text-micro);
  font-weight: 600;
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.theme-opt i { font-size: var(--text-body); }
.theme-opt:hover { color: var(--sidebar-text-active); }
.theme-opt.active {
  background: var(--bg-card);
  color: var(--sidebar-text-active);
  font-weight: 700;
  box-shadow: 0 2px 6px -2px color-mix(in srgb, var(--persimmon-dark) 30%, transparent);
}

/* ── 預設配色色點 ── */
.accent-row {
  display: flex;
  gap: 10px;
  padding: 10px 6px 4px;
}
.accent-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: transform 0.15s, box-shadow 0.15s;
}
.accent-dot.active {
  box-shadow: 0 0 0 2px var(--sidebar-bg), 0 0 0 4px var(--accent);
}

/* ── Password modal ── */
.overlay {
  position: fixed; inset: 0;
  background: var(--overlay);
  backdrop-filter: blur(6px);
  z-index: var(--z-drawer);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.pw-modal {
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  width: 100%; max-width: 400px;
  overflow: hidden;
  box-shadow: var(--shadow-modal);
}
.pw-header { display: flex; align-items: flex-start; gap: 13px; padding: 20px 22px 16px; border-bottom: 1px solid var(--border); }
.pw-head-icon {
  width: 44px; height: 44px;
  border-radius: 14px;
  background: var(--accent-gradient);
  color: var(--text-on-accent);
  display: flex; align-items: center; justify-content: center;
  font-size: var(--text-lead);
  box-shadow: 0 8px 16px -6px color-mix(in srgb, var(--persimmon) 60%, transparent);
  flex-shrink: 0;
}
.pw-head-text { flex: 1; min-width: 0; }
.pw-title { font-family: var(--font-display); font-size: var(--text-lead); font-weight: 800; color: var(--ink); }
.pw-sub { font-size: var(--text-label); font-weight: 600; color: var(--muted); margin-top: 2px; }
.pw-close {
  width: 34px; height: 34px;
  border-radius: 11px;
  background: var(--bg-inset);
  font-size: var(--text-title); color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s; flex-shrink: 0;
}
.pw-close:hover { background: var(--border); color: var(--ink); }
.pw-body { padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: var(--text-label); font-weight: 700; color: var(--muted); }
.field-input { width: 100%; padding: 11px 14px; border: 1px solid var(--input-border); border-radius: 14px; font-size: var(--text-body); color: var(--ink); background: var(--bg-inset); outline: none; transition: border-color 0.15s, box-shadow 0.15s, background 0.15s; }
.field-input:focus { border-color: var(--accent); background: var(--input-bg); box-shadow: 0 0 0 4px var(--input-focus-ring); }
.password-input-wrap { position: relative; display: flex; align-items: center; }
.password-input { padding-right: 40px; }
.password-toggle { position: absolute; right: 8px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; color: var(--muted); transition: all 0.15s; }
.password-toggle:hover { background: var(--muted-line2); color: var(--ink); }
.pw-strength { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.pw-bars { display: flex; gap: 4px; flex: 1; }
.pw-bar { flex: 1; height: 3px; border-radius: 2px; background: var(--muted-line); transition: background 0.25s; }
.pw-label { font-size: var(--text-micro); font-weight: 700; letter-spacing: 0.3px; min-width: 22px; text-align: right; transition: color 0.25s; }
.strength-enter-active, .strength-leave-active { transition: opacity 0.2s, transform 0.2s; }
.strength-enter-from, .strength-leave-to { opacity: 0; transform: translateY(-4px); }
.pw-footer { display: flex; gap: 10px; padding: 12px 22px 20px; }
.pw-cancel { flex: 1; padding: 12px 0; border-radius: 14px; background: var(--bg-inset); font-size: var(--text-body); font-weight: 700; color: var(--text-secondary); transition: background 0.15s; }
.pw-cancel:hover { background: var(--border); color: var(--ink); }
.pw-submit { flex: 1.4; padding: 12px 0; border-radius: 14px; background: var(--accent-solid); color: var(--text-on-accent); font-size: var(--text-body); font-weight: 800; transition: background 0.15s, opacity 0.15s; box-shadow: 0 12px 24px -12px color-mix(in srgb, var(--persimmon) 75%, transparent); }
.pw-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.pw-submit:hover:not(:disabled) { background: var(--accent-hover); }
.overlay-enter-active, .overlay-leave-active { transition: opacity 0.22s ease; }
.overlay-enter-from, .overlay-leave-to { opacity: 0; }
.overlay-enter-active .pw-modal { animation: navPwModalIn 0.28s cubic-bezier(0.34, 1.56, 0.64, 1); }
.overlay-leave-active .pw-modal { animation: navPwModalOut 0.18s ease; }

@keyframes navPwModalIn {
  from { transform: scale(0.92) translateY(10px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}
@keyframes navPwModalOut {
  from { transform: scale(1) translateY(0); opacity: 1; }
  to   { transform: scale(0.95) translateY(6px); opacity: 0; }
}

.sub-nav-enter-active {
  transition: opacity 0.2s ease, max-height 0.26s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.sub-nav-leave-active {
  transition: opacity 0.15s ease, max-height 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.sub-nav-enter-from, .sub-nav-leave-to { opacity: 0; max-height: 0; }
.sub-nav-enter-to, .sub-nav-leave-from { max-height: 200px; }

/* ── Mobile bottom nav ── */
.mobile-bottom-nav { display: none; }

@media (max-width: 768px) {
  .nav-sidebar { display: none; }

  .mobile-bottom-nav {
    display: flex;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    height: var(--mobile-nav-height);
    background: var(--sidebar-bg);
    border-top: 1px solid var(--sidebar-border);
    z-index: 200;
    padding: 0 4px;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .mob-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    color: var(--sidebar-text);
    font-size: var(--text-micro);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-radius: var(--r-sm);
    transition: color 0.15s;
    padding: 6px 2px;
  }
  .mob-item:hover { color: var(--sidebar-text-active); }
  .mob-item.active { color: var(--sidebar-text-active); }
  .mob-item.active .mob-icon { color: var(--selection); }

  .mob-icon {
    font-size: var(--text-lead);
    padding: 3px 12px;
    border-radius: 999px;
    background: transparent;
    transition: background 0.18s ease;
  }
  .mob-item.active .mob-icon { background: var(--sidebar-bg-active); }
  .mob-label { line-height: 1; }
}

/* ── 手機「更多」清單：底部彈出，收納歷史／錢包／統計／設定 ── */
.mob-more-overlay {
  position: fixed; inset: 0;
  background: var(--overlay);
  backdrop-filter: blur(4px);
  z-index: var(--z-drawer);
  display: flex; align-items: flex-end; justify-content: center;
}
.mob-more-sheet {
  width: 100%;
  max-width: 480px;
  border: 1px solid var(--sidebar-border);
  border-bottom: none;
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  padding: 10px 10px calc(10px + env(safe-area-inset-bottom, 0px));
  box-shadow: var(--shadow-modal);
  display: flex; flex-direction: column; gap: 2px;
}
.mob-more-item {
  width: 100%;
  display: flex; align-items: center; gap: 14px;
  padding: 14px 12px;
  border-radius: var(--r-md);
  font-size: var(--text-body);
  font-weight: 700;
  transition: background 0.15s, color 0.15s;
}
.mob-more-item i { width: 22px; text-align: center; font-size: var(--text-body); }

.mob-more-enter-active, .mob-more-leave-active { transition: opacity 0.22s ease; }
.mob-more-enter-from, .mob-more-leave-to { opacity: 0; }
.mob-more-enter-active .mob-more-sheet { animation: mobMoreSheetIn 0.26s cubic-bezier(0.34, 1.4, 0.64, 1); }
.mob-more-leave-active .mob-more-sheet { animation: mobMoreSheetOut 0.18s ease; }
@keyframes mobMoreSheetIn {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}
@keyframes mobMoreSheetOut {
  from { transform: translateY(0); }
  to   { transform: translateY(100%); }
}

/* ── 桌機側邊導覽：自訂 tooltip ── */
.nav-tooltip {
  position: fixed;
  transform: translateY(-50%);
  background: var(--ink);
  color: var(--paper);
  padding: 6px 11px;
  border-radius: 6px;
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
  box-shadow: var(--shadow-soft);
  pointer-events: none;
  z-index: 400;
}
.nav-tooltip::before {
  content: '';
  position: absolute;
  top: 50%; left: -4px;
  width: 8px; height: 8px;
  background: var(--ink);
  transform: translateY(-50%) rotate(45deg);
  border-radius: 1px;
}
.nav-tooltip-fade-enter-active, .nav-tooltip-fade-leave-active { transition: opacity 0.12s ease, transform 0.12s ease; }
.nav-tooltip-fade-enter-from, .nav-tooltip-fade-leave-to { opacity: 0; transform: translateY(-50%) translateX(-4px); }

.nav-sidebar, .nav-sidebar.collapsed { width: 92px; padding: 8px; background: var(--ink-2); border-right: 1px solid var(--line); }
.sidebar-top, .collapsed .sidebar-top { flex-direction: column; padding: 10px 0; }
.sidebar-brand { flex-direction: column; gap: 6px; }
.brand-text, .collapsed .brand-text { max-width: none; opacity: 1; }
.brand-name { font-size: var(--text-label); color: var(--paper); }
.brand-sub, .nav-section-label { display: none; }
.nav-item, .collapsed .nav-item { flex-direction: column; justify-content: center; gap: 5px; padding: 10px 2px; border-radius: 6px; }
.nav-label, .collapsed .nav-label { max-width: none; opacity: 1; font-size: var(--text-micro); }
.nav-icon { color: var(--ink-soft); font-size: var(--text-lead); }
.nav-item::before { display: none; }
.nav-item:not(.active):hover { background: var(--ink-3); color: var(--paper); }
.user-info { justify-content: center; }
.user-text { display: none; }
.user-actions { flex-direction: column; }
.user-action-btn { color: var(--ink-soft); background: var(--ink-3); padding: 8px 2px; gap: 4px; }
.theme-segment { flex-direction: column; }
.theme-opt { padding: 5px 2px; }
.theme-section { border-top: 1px solid var(--line); }
.accent-row { flex-wrap: wrap; justify-content: center; }
.accent-dot { background: var(--persimmon); }
.mobile-bottom-nav { background: var(--ink-2); border-top: 1px solid var(--line); }
.mob-item { color: var(--ink-soft); }
.mob-item.active { background: var(--accent-solid); color: var(--paper); border-radius: 5px; }
.mob-item.active .mob-icon, .mob-item.active .mob-label { color: var(--paper); }
.mob-more-sheet { background: var(--ink-2); border-color: var(--line); }
.mob-more-item { color: var(--ink-soft); }
.mob-more-item:active { background: var(--ink-3); }
.mob-more-item.active { background: var(--accent-solid); color: var(--paper); }
.mob-more-item.active i { color: var(--paper); }
</style>
