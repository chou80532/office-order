import { computed, onScopeDispose, ref, watch } from 'vue'
import { fetchOrdersInRange } from '../services/orderHistory'
import { getTaipeiDateRangeBounds, getTaipeiDayStartMs } from '../utils/format'

export function useOrderHistory(from, to) {
  const orders = ref([])
  const loading = ref(false)
  const error = ref('')
  const loaded = ref(false)
  let requestId = 0

  async function reload() {
    const id = ++requestId
    orders.value = []
    loaded.value = false
    error.value = ''
    loading.value = true
    try {
      const { startMs, endMs } = getTaipeiDateRangeBounds(from.value, to.value)
      if (!from.value || !to.value || endMs > getTaipeiDayStartMs()) throw new Error('請選擇今天以前的完整日期區間')
      const result = await fetchOrdersInRange(startMs, endMs, () => id === requestId)
      if (id !== requestId) return
      orders.value = result
      loaded.value = true
    } catch (err) {
      if (id !== requestId) return
      error.value = err.message === '請選擇有效的起訖日期' || err.message === '請選擇今天以前的完整日期區間'
        ? err.message
        : '歷史訂單未能完整載入，請確認網路後重試。'
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  watch([from, to], reload, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { requestId += 1 })
  return { orders, loading, error, ready: computed(() => loaded.value && !loading.value && !error.value), reload }
}
