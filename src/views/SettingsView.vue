<script setup>
import { h, ref, computed, watch, defineAsyncComponent } from 'vue'
import { useSettingsTab } from '../composables/useSettingsTab'
import { useFirestore } from '../composables/useFirestore'
import { t } from '../i18n'
import TopHeader from '../components/layout/TopHeader.vue'

// 各面板改用 defineAsyncComponent 的 loadingComponent 顯示載入中，
// 不用 Suspense：Suspense 與 Transition(out-in) 併用時 fallback 離場會卡住，面板永遠不進場。
const PanelLoading = {
  render: () => h('div', { class: 'panel-loading' }, [h('span', { class: 'panel-spinner' }), ` ${t('settings.panelLoading')}`])
}
const asyncPanel = (loader) => defineAsyncComponent({ loader, loadingComponent: PanelLoading, delay: 120 })

const StoreManagementPanel = asyncPanel(() => import('../components/settings/StoreManagementPanel.vue'))
const MemberListPanel      = asyncPanel(() => import('../components/settings/MemberListPanel.vue'))
const QuickNotesPanel      = asyncPanel(() => import('../components/settings/QuickNotesPanel.vue'))
const OldFileCleanupPanel  = asyncPanel(() => import('../components/settings/OldFileCleanupPanel.vue'))
const WalletManagementPanel = asyncPanel(() => import('../components/settings/WalletManagementPanel.vue'))
const CashPaymentPanel = asyncPanel(() => import('../components/settings/CashPaymentPanel.vue'))
const SystemSettingsPanel = asyncPanel(() => import('../components/settings/SystemSettingsPanel.vue'))

const { activeTab } = useSettingsTab()
const { systemSettings } = useFirestore()

const allMenuItems = [
  { id: 'stores',  icon: 'fa-store' },
  { id: 'members', icon: 'fa-users' },
  { id: 'wallet',  icon: 'fa-wallet' },
  { id: 'cash',    icon: 'fa-money-bill-wave' },
  { id: 'notes',   icon: 'fa-pen-to-square' },
  { id: 'cleanup', icon: 'fa-trash-can' },
  { id: 'system',  icon: 'fa-sliders' },
]

// 停用的付款方式不顯示對應的管理分頁。
const menuItems = computed(() => allMenuItems
  .filter(item => (item.id !== 'wallet' || systemSettings.value.paymentMethods.wallet)
    && (item.id !== 'cash' || systemSettings.value.paymentMethods.cash))
  .map(item => ({
    ...item,
    label: t(`settings.tabs.${item.id}.label`),
    shortLabel: t(`settings.tabs.${item.id}.short`),
    description: t(`settings.tabs.${item.id}.description`),
  })))

const currentMenuItem = computed(() => menuItems.value.find(m => m.id === activeTab.value) || menuItems.value[0])
watch(menuItems, (items) => {
  if (!items.some(item => item.id === activeTab.value)) activeTab.value = items[0].id
}, { immediate: true })

const storeSearch = ref('')
watch(activeTab, () => { storeSearch.value = '' })
</script>

<template>
  <div class="settings-page">
    <TopHeader :title="currentMenuItem.label" :subtitle="currentMenuItem.description" :wide-center="activeTab === 'cash'">
      <template v-if="activeTab === 'stores'" #center>
        <div class="header-search-wrap app-search-shell">
          <input
            v-model="storeSearch"
            class="header-search"
            :placeholder="t('settings.storeSearchPlaceholder')"
            @keyup.escape="storeSearch = ''"
          />
          <button
            v-if="storeSearch"
            type="button"
            class="header-search-clear app-search-clear"
            :aria-label="t('common.clearSearch')"
            @click="storeSearch = ''"
          ><i class="fas fa-xmark" aria-hidden="true"></i></button>
        </div>
      </template>
      <template v-else-if="activeTab === 'cash'" #center>
        <div id="cash-toolbar-target" class="settings-toolbar-target"></div>
      </template>
    </TopHeader>

    <!-- Mobile tab bar (replaces sidebar sub-nav on small screens) -->
    <nav class="mobile-tabs">
      <button
        v-for="item in menuItems"
        :key="item.id"
        class="mobile-tab"
        :class="{ active: activeTab === item.id }"
        @click="activeTab = item.id"
      >
        <i :class="['fas', item.icon, 'tab-icon']"></i>
        <span>{{ item.shortLabel }}</span>
      </button>
    </nav>

    <main class="settings-content">
      <!-- 桌機由左側「管理功能」側邊欄切換,不再重複一排分頁列;手機用上方 mobile-tabs -->
      <!-- 頁名與說明統一收在 TopHeader（標題＋副標），此處不再重複區塊標頭 -->
      <div class="content-body">
        <Transition name="page" mode="out-in">
          <KeepAlive>
            <StoreManagementPanel v-if="activeTab === 'stores'" v-model:search-query="storeSearch" />
            <MemberListPanel      v-else-if="activeTab === 'members'" />
            <WalletManagementPanel v-else-if="activeTab === 'wallet'" />
            <CashPaymentPanel v-else-if="activeTab === 'cash'" toolbar-target="#cash-toolbar-target" />
            <QuickNotesPanel      v-else-if="activeTab === 'notes'" />
            <OldFileCleanupPanel  v-else-if="activeTab === 'cleanup'" />
            <SystemSettingsPanel  v-else-if="activeTab === 'system'" />
          </KeepAlive>
        </Transition>
      </div>
    </main>
  </div>
</template>

<style scoped>
.settings-toolbar-target {
  width: 100%;
  min-width: 0;
}

/* ── Root CSS var aliases for settings panels ─────────────────────── */
.settings-page {
  --bg-card: var(--paper);
  --bg-surface: var(--cream);
  --bg-body: var(--cream);
  --bg-input: var(--cream);
  --bg-elevated: var(--paper);
  --bg-card-hover: color-mix(in srgb, var(--text-primary) 2%, transparent);
  --bg-glass-2: var(--cream);
  --text-main: var(--ink);
  --text-muted: var(--muted);
  --text-light: var(--text-muted);
  --border-color: var(--muted-line);
  --primary-color: var(--selection);
  --primary-soft: var(--selection-soft);
  --accent-color: var(--accent);
  --accent-soft: var(--bg-accent);
  --secondary-color: var(--mint);
  --success-color: var(--mint);
  --danger-color: var(--paprika);
  --radius-sm: var(--r-sm);
  --radius-md: var(--r-md);
  --radius-lg: var(--r-lg);
  --radius-pill: 999px;
  --transition: all 0.15s;

  display: flex;
  min-height: 100vh;
}

/* ── Main content ──────────────────────────────────────────────────── */
.settings-page {
  flex-direction: column;
}

.settings-content {
  flex: 1;
  /* 與今日訂單頁的 .content 同一組容器設定 */
  width: min(100%, var(--page-max));
  margin: 0 auto;
  padding: 20px var(--page-pad) 40px;
}

.header-search-wrap {
  position: relative;
  width: 100%;
  border: 1.5px solid var(--muted-line);
  border-radius: 999px;
  background: var(--input-bg);
}
.header-search {
  width: 100%;
  padding: 7px 38px 7px 14px;
  border: 0;
  border-radius: inherit;
  font-size: var(--text-label);
  font-weight: 500;
  color: var(--ink);
  background: transparent;
  outline: none;
}
.header-search::placeholder { color: var(--muted); }
.header-search-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: var(--text-muted);
}
.header-search-clear:hover { background: var(--muted-line2); color: var(--ink); }

.content-body { min-height: 400px; }

.panel-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 40px;
  color: var(--muted);
  font-size: var(--text-body);
  font-weight: 600;
}

.panel-spinner {
  display: inline-block;
  width: 16px; height: 16px;
  border: 2px solid var(--muted-line);
  border-radius: 50%;
  border-top-color: var(--paprika);
  animation: spin 0.8s linear infinite;
}

/* ── Mobile tab bar ────────────────────────────────────────────────── */
.mobile-tabs { display: none; }

/* ── Responsive ────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .settings-content { padding: 14px var(--page-pad) 28px; }

  .mobile-tabs {
    display: flex;
    background: var(--paper);
    border-bottom: 1.5px solid var(--muted-line);
    flex-shrink: 0;
  }

  .mobile-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 10px 4px;
    font-size: var(--text-micro);
    font-weight: 700;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }
  .mobile-tab.active { color: var(--selection); border-bottom-color: var(--selection); }
  .tab-icon { font-size: var(--text-body); }
}

/* 這一頁把底色換成 --ink，但語意 token（--text-muted 等）預設是為紙卡調的，
   --ink-mute 落在 --ink 上只有 3.09。跟 .ops-surface 一樣，深底就得自己宣告一組。 */
.settings-page {
  background: var(--ink);
  --text-primary: var(--paper);
  --text-secondary: var(--ink-soft);
  --text-muted: var(--ink-soft);
  --muted: var(--ink-soft);
}
.content-body { background: var(--ink); border: 0; border-radius: 0; padding: 0; color: var(--paper); }
@media (max-width: 768px) { .settings-content { padding: 12px var(--page-pad) 28px; } .content-body { padding: 0; } }
</style>
