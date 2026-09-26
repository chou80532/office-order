export const UNCATEGORIZED_MENU_CATEGORY = '其他'
export const ADDON_MENU_CATEGORY = '加點'

export const DEFAULT_MENU_CATEGORIES = [
  '主餐',
  '便當',
  '飯類',
  '麵類',
  '炒飯炒麵',
  '飲料',
  '湯品',
  '小菜',
  '套餐',
  '老闆推薦',
  UNCATEGORIZED_MENU_CATEGORY,
  ADDON_MENU_CATEGORY
]

const CATEGORY_ORDER = new Map(DEFAULT_MENU_CATEGORIES.map((category, index) => [category, index]))

export function normalizeMenuCategory(category, fallback = UNCATEGORIZED_MENU_CATEGORY) {
  const normalized = String(category || '').trim().slice(0, 20)
  return normalized || fallback
}

export function isAddonMenuCategory(category) {
  return normalizeMenuCategory(category, UNCATEGORIZED_MENU_CATEGORY) === ADDON_MENU_CATEGORY
}

export function isAddonMenuItem(item) {
  return item?.type === 'addon' || isAddonMenuCategory(item?.category)
}

export function menuItemKey(item, storeName = '') {
  const name = String(item?.name || '').trim()
  const category = normalizeMenuCategory(item?.category, UNCATEGORIZED_MENU_CATEGORY)
  const unit = String(item?.unit || '').trim()
  const price = Number(item?.price) || 0
  return `${storeName || ''}::${category}::${name}::${unit}::${price}`
}

export function categorySortValue(category) {
  return CATEGORY_ORDER.has(category) ? CATEGORY_ORDER.get(category) : DEFAULT_MENU_CATEGORIES.length - 2
}

export function compareMenuCategory(a, b) {
  const sortA = categorySortValue(a)
  const sortB = categorySortValue(b)
  if (sortA !== sortB) return sortA - sortB
  return String(a || '').localeCompare(String(b || ''), 'zh-TW')
}
