// ==========================================
// 快捷備註的預設群組，依系統語言提供。管理員在「快捷備註」儲存自己的群組後就不再使用。
// 群組名稱「冰量／甜度／溫度」（Ice／Sugar／Temperature）只會出現在飲料，見 CartPanel。
// ==========================================
const NOTE_GROUPS = {
  'zh-TW': [
    { label: '冰量', icon: 'snowflake', notes: ['正常冰', '少冰', '微冰', '去冰'] },
    { label: '甜度', icon: 'candy-cane', notes: ['正常糖', '半糖', '微糖', '無糖'] },
    { label: '溫度', icon: 'temperature-high', notes: ['溫的', '熱的'] },
    { label: '其他', icon: 'comment-dots', notes: ['不要豆芽菜', '不加蔥', '不加香菜'] },
  ],
  en: [
    { label: 'Ice', icon: 'snowflake', notes: ['Regular ice', 'Less ice', 'Light ice', 'No ice'] },
    { label: 'Sugar', icon: 'candy-cane', notes: ['Regular sugar', 'Half sugar', 'Less sugar', 'No sugar'] },
    { label: 'Temperature', icon: 'temperature-high', notes: ['Warm', 'Hot'] },
    { label: 'Other', icon: 'comment-dots', notes: ['No onion', 'No cilantro', 'Sauce on the side'] },
  ],
}

export const defaultNoteGroups = locale => structuredClone(NOTE_GROUPS[locale] || NOTE_GROUPS['zh-TW'])

// 依群組名稱判斷用途（中英文預設名稱都認得），決定飲料／餐點各自顯示哪些群組。
const ROLE_LABELS = {
  sugar: ['甜度', 'sugar', 'sweetness'],
  ice: ['冰量', 'ice'],
  temperature: ['溫度', 'temperature'],
  portion: ['份量', 'portion', 'size'],
  other: ['其他', '備註', '其他備註', 'other', 'notes'],
}
export const DRINK_NOTE_ROLES = new Set(['sugar', 'ice', 'temperature'])
export const noteGroupRole = (label) => {
  const value = String(label || '').trim().toLowerCase()
  return Object.keys(ROLE_LABELS).find(role => ROLE_LABELS[role].includes(value)) || ''
}
