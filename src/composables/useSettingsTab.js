import { ref } from 'vue'

const activeTab = ref('stores')
const storePanelPosition = ref({ storeName: '', offset: 0, scrollY: 0 })

export function useSettingsTab() {
  return { activeTab, storePanelPosition }
}
