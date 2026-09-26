import { ref, watch } from 'vue'
import { readStorage, writeStorage } from '../utils/storage'

const STORAGE_KEY = 'sidebar-collapsed'
const collapsed = ref(readStorage(STORAGE_KEY) === 'true')

watch(collapsed, (v) => writeStorage(STORAGE_KEY, v))

export function useSidebarState() {
  return { collapsed }
}
