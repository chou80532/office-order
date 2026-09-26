<script setup>
import { h, ref, computed, watch, defineAsyncComponent } from 'vue'
import { useSettingsTab } from '../composables/useSettingsTab'
import TopHeader from '../components/layout/TopHeader.vue'

// 各面板改用 defineAsyncComponent 的 loadingComponent 顯示載入中，
// 不用 Suspense：Suspense 與 Transition(out-in) 併用時 fallback 離場會卡住，面板永遠不進場。
const PanelLoading = {
  render: () => h('div', { class: 'panel-loading' }, [h('span', { class: 'panel-spinner' }), ' 載入中…'])
}
const asyncPanel = (loader) => defineAsyncComponent({ loader, loadingComponent: PanelLoading, delay: 120 })

const StoreManagementPanel = asyncPanel(() => import('../components/settings/StoreManagementPanel.vue'))
const MemberListPanel      = asyncPanel(() => import('../components/settings/MemberListPanel.vue'))
const QuickNotesPanel      = asyncPanel(() => import('../components/settings/QuickNotesPanel.vue'))
const OldFileCleanupPanel  = asyncPanel(() => import('../components/settings/OldFileCleanupPanel.vue'))
const WalletManagementPanel = asyncPanel(() => import('../components/settings/WalletManagementPanel.vue'))
const CashPaymentPanel = asyncPanel(() => import('../components/settings/CashPaymentPanel.vue'))

const { activeTab } = useSettingsTab()

const menuItems = [
  { id: 'stores',  icon: 'fa-store',           label: '店家管理', shortLabel: '店家', description: '維護店家資料、菜單品項與菜單圖片' },
  { id: 'members', icon: 'fa-users',           label: '成員名單', shortLabel: '成員', description: '管理成員名單、帳號與管理員權限' },
  { id: 'wallet',  icon: 'fa-wallet',          label: '儲值錢包', shortLabel: '錢包', description: '成員錢包儲值、調整與異動紀錄' },
  { id: 'cash',    icon: 'fa-money-bill-wave', label: '現金收款', shortLabel: '現金', description: '追蹤現金應收款項並標記已收' },
  { id: 'notes',   icon: 'fa-pen-to-square',   label: '快捷備註', shortLabel: '備註', description: '設定點餐時可快速選用的備註選項' },
  { id: 'cleanup', icon: 'fa-trash-can',       label: '舊檔清理', shortLabel: '清理', description: '清理過期的菜單圖片與舊資料，釋放空間' },
]

const currentMenuItem = computed(() => menuItems.find(m => m.id === activeTab.value) || menuItems[0])

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
            placeholder="搜尋店家名稱..."
            @keyup.escape="storeSearch = ''"
          />
          <button
            v-if="storeSearch"
            type="button"
            class="header-search-clear app-search-clear"
            aria-label="清除搜尋"
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
