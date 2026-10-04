import { compareText } from './format'
import { t } from '../i18n'

// 這兩個分類名稱會存進菜單資料，作為內部識別；畫面上用 menuCategoryLabel 翻譯。
export const UNCATEGORIZED_MENU_CATEGORY = '其他'
export const ADDON_MENU_CATEGORY = '加點'
// 英文菜單寫「# Add-ons」也當成全店共用的加點。
const ADDON_CATEGORY_ALIASES = new Set(['加點', 'add-ons', 'add-on', 'addons', 'extras'])
const UNCATEGORIZED_ALIASES = new Set(['其他', 'other'])

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
  'Main',
  'Rice',
  'Noodles',
  'Drinks',
  'Soup',
  'Sides',
  'Set meals',
  UNCATEGORIZED_MENU_CATEGORY,
  ADDON_MENU_CATEGORY
]

const CATEGORY_ORDER = new Map(DEFAULT_MENU_CATEGORIES.map((category, index) => [category, index]))

export function normalizeMenuCategory(category, fallback = UNCATEGORIZED_MENU_CATEGORY) {
  const normalized = String(category || '').trim().slice(0, 20)
  return normalized || fallback
}

export function isAddonMenuCategory(category) {
  return ADDON_CATEGORY_ALIASES.has(normalizeMenuCategory(category, UNCATEGORIZED_MENU_CATEGORY).toLowerCase())
}

/** 分類的顯示名稱：內部的「其他」「加點」依介面語言翻譯，其餘照店家輸入的名稱。 */
export function menuCategoryLabel(category) {
  const normalized = normalizeMenuCategory(category, UNCATEGORIZED_MENU_CATEGORY)
  if (UNCATEGORIZED_ALIASES.has(normalized.toLowerCase())) return t('dish.category.other')
  if (ADDON_CATEGORY_ALIASES.has(normalized.toLowerCase())) return t('dish.category.addon')
  return normalized
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
  if (UNCATEGORIZED_ALIASES.has(String(category || '').toLowerCase())) return CATEGORY_ORDER.get(UNCATEGORIZED_MENU_CATEGORY)
  if (ADDON_CATEGORY_ALIASES.has(String(category || '').toLowerCase())) return CATEGORY_ORDER.get(ADDON_MENU_CATEGORY)
  return CATEGORY_ORDER.has(category) ? CATEGORY_ORDER.get(category) : DEFAULT_MENU_CATEGORIES.length - 2
}

export function compareMenuCategory(a, b) {
  const sortA = categorySortValue(a)
  const sortB = categorySortValue(b)
  if (sortA !== sortB) return sortA - sortB
  return compareText(a, b)
}
