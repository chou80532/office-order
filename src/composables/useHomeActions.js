import { ref, watch } from 'vue'

// null | 'records' | 'store-manager' | 'stats'
const activePanel = ref(null)
const replacementSource = ref('')
watch(activePanel, panel => {
  if (panel !== 'store-manager') replacementSource.value = ''
}, { flush: 'sync' })

function openStatsPanel() {
  activePanel.value = 'stats'
}

function closePanel() { activePanel.value = null; replacementSource.value = '' }

export function useHomeActions() {
  return { activePanel, replacementSource, openStatsPanel, closePanel }
}
