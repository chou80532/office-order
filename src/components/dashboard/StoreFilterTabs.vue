<script setup>
// 今日訂單的店家篩選膠囊。桌機掛在訂單表的工具列（與搜尋同一列），
// 手機改掛在 KPI 卡片下方 —— 這個篩選同時影響 KPI、店家統整與訂單表，
// 放在最上面才看得出關聯，不必捲到頁面底部才找得到。
import { computed } from 'vue'

const props = defineProps({
  orders:     { type: Array,  default: () => [] },
  allStores:  { type: Array,  default: () => [] },
  modelValue: { type: String, default: '__all__' },
})

const emit = defineEmits(['update:modelValue'])

const compareZh = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-TW')

const storeCategoryMap = computed(() => {
  const map = new Map()
  props.allStores.forEach(store => { if (store?.name) map.set(store.name, store.category || 'other') })
  return map
})

const tabs = computed(() => {
  const counts = new Map()
  props.orders.forEach(order => {
    const name = order.storeName || '未指定店家'
    counts.set(name, (counts.get(name) || 0) + 1)
  })
  const categoryOrder = { lunch: 0, drink: 1, other: 2 }
  const stores = [...counts.entries()]
    .map(([name, count]) => ({
      key: name,
      label: name,
      count,
      category: storeCategoryMap.value.get(name) || 'other',
    }))
    .sort((a, b) => {
      const byCategory = (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99)
      return byCategory || compareZh(a.label, b.label)
    })
  return [{ key: '__all__', label: '全部', count: props.orders.length }, ...stores]
})
</script>

<template>
  <div class="store-tabs" role="group" aria-label="依店家篩選訂單">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="store-tab"
      :class="{ active: modelValue === tab.key }"
      :aria-pressed="modelValue === tab.key"
      @click="emit('update:modelValue', tab.key)"
    >{{ tab.label }} {{ tab.count }}</button>
  </div>
</template>

<style scoped>
.store-tabs { display: flex; gap: 9px; flex-wrap: wrap; }

.store-tab {
  padding: 7px 15px;
  border-radius: 999px;
  font-size: var(--text-label);
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--paper);
  border: 1px solid var(--input-border);
  transition: all 0.15s;
}
.store-tab:hover { border-color: var(--border-accent); }
.store-tab.active {
  color: var(--text-on-accent);
  background: var(--accent-solid);
  border-color: var(--accent);
  font-weight: 700;
}
</style>
