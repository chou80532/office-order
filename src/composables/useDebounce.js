import { ref, watch, onUnmounted, getCurrentInstance } from 'vue'

/**
 * 回傳一個延遲同步的 ref，適合用在搜尋過濾的 computed 中
 * @param {import('vue').Ref} source - 來源 ref
 * @param {number} delay - 延遲毫秒數 (預設 200)
 */
export function useDebouncedRef(source, delay = 200) {
  const debounced = ref(source.value)
  let timer = null
  watch(source, (val) => {
    clearTimeout(timer)
    timer = setTimeout(() => { debounced.value = val }, delay)
  })
  if (getCurrentInstance()) {
    onUnmounted(() => { clearTimeout(timer) })
  }
  return debounced
}
