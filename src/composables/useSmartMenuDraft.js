import { ref } from 'vue'

const drafts = ref({})

const emptyDraft = () => ({
  textInput: '',
  parsedItems: [],
  savedCount: 0,
  currentImageIndex: 0
})

export function useSmartMenuDraft() {
  const getDraft = (key) => drafts.value[key] || emptyDraft()

  const updateDraft = (key, patch) => {
    if (!key) return
    drafts.value = {
      ...drafts.value,
      [key]: {
        ...getDraft(key),
        ...patch
      }
    }
  }

  const clearDraft = (key) => {
    if (!key || !drafts.value[key]) return
    const next = { ...drafts.value }
    delete next[key]
    drafts.value = next
  }

  return { getDraft, updateDraft, clearDraft }
}
