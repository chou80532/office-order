// ==========================================
// 菜單匯入／匯出
//
// JSON：完整備份，金額為幣別最小單位的整數（新台幣為元、美元為分），並記錄幣別；
//       匯入時幣別必須相同，避免 110 元被當成 1.10 美元。
// CSV：給試算表編輯用，一列一個品項，金額寫主單位（12.50），以目前系統幣別解讀。
//       選項群組寫成菜單編輯器的文字格式，多個群組以「;」分隔。
// ==========================================
import { fromMinorUnits, parseMoneyInput } from './format'
import { isAddonMenuCategory, normalizeMenuCategory, UNCATEGORIZED_MENU_CATEGORY } from './menuCategories'
import { parseOptionGroupLine, serializeOptionGroups, stringifyOptionGroups } from './dishOptionGroups'
import { menuIssues } from './menuEditor'
import { t } from '../i18n'
import { normalizeDietaryTags } from './dietaryTags'

export const MENU_EXPORT_FORMAT = 'office-order-menu'
export const MENU_EXPORT_VERSION = 1
export const CSV_COLUMNS = ['store', 'store_category', 'phone', 'address', 'category', 'item', 'price', 'unit', 'options', 'tags']
export const MAX_IMPORT_STORES = 200
export const MAX_IMPORT_ITEMS_PER_STORE = 500

const STORE_CATEGORIES = new Set(['lunch', 'drink'])
const text = (value, max) => String(value ?? '').trim().slice(0, max)
const storeCategory = value => (STORE_CATEGORIES.has(String(value || '').trim().toLowerCase()) ? String(value).trim().toLowerCase() : 'lunch')
const isHttpUrl = value => /^https?:\/\/\S+$/i.test(String(value || '').trim())

/** 存進 Firestore 的品項形狀（與菜單編輯器儲存時一致）。 */
function cleanMenuItem({ category, name, price, unit, options, tags }) {
  const normalizedCategory = normalizeMenuCategory(category, UNCATEGORIZED_MENU_CATEGORY)
  const item = {
    type: isAddonMenuCategory(normalizedCategory) ? 'addon' : 'main',
    category: normalizedCategory,
    name: text(name, 50),
    price,
  }
  const cleanUnit = text(unit, 4)
  if (cleanUnit) { item.unit = cleanUnit; item.defaultQty = 1 }
  const cleanOptions = serializeOptionGroups(options)
  if (cleanOptions.length) item.options = cleanOptions
  const cleanTags = normalizeDietaryTags(tags)
  if (cleanTags.length) item.tags = cleanTags
  return item
}

const exportItem = item => {
  const result = {
    category: normalizeMenuCategory(item.category, UNCATEGORIZED_MENU_CATEGORY),
    name: String(item.name || '').trim(),
    price: Math.round(Number(item.price) || 0),
  }
  if (item.unit) result.unit = String(item.unit).trim()
  const options = serializeOptionGroups(item.options)
  if (options.length) result.options = options
  const tags = normalizeDietaryTags(item.tags)
  if (tags.length) result.tags = tags
  return result
}

const storeImages = store => (store.images || []).map(image => String(image?.url || '').trim()).filter(isHttpUrl)

// ── 匯出 ────────────────────────────────────────────────────────────
export function buildMenuJson(stores, { currency, exportedAt = new Date() } = {}) {
  return JSON.stringify({
    format: MENU_EXPORT_FORMAT,
    version: MENU_EXPORT_VERSION,
    currency,
    exportedAt: exportedAt.toISOString(),
    stores: stores.map(store => ({
      name: store.name,
      category: storeCategory(store.category),
      phone: store.phone || '',
      address: store.address || '',
      images: storeImages(store),
      menuItems: (store.menuItems || []).map(exportItem),
    })),
  }, null, 2)
}

const csvCell = (value) => {
  const raw = String(value ?? '')
  // 開頭是 = + - @ 的字串在試算表裡會被當成公式執行，前面補單引號。
  const safe = /^[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function buildMenuCsv(stores) {
  const rows = [CSV_COLUMNS]
  for (const store of stores) {
    const base = [store.name, storeCategory(store.category), store.phone || '', store.address || '']
    const items = store.menuItems || []
    if (!items.length) rows.push([...base, '', '', '', '', '', ''])
    for (const item of items) {
      rows.push([
        ...base,
        normalizeMenuCategory(item.category, UNCATEGORIZED_MENU_CATEGORY),
        String(item.name || '').trim(),
        String(fromMinorUnits(item.price)),
        item.unit || '',
        stringifyOptionGroups(item.options).map(line => line.trim()).join('; '),
        JSON.stringify(normalizeDietaryTags(item.tags)),
      ])
    }
  }
  // 加 BOM，Excel 才會用 UTF-8 開啟中文。
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

// ── CSV 解析（支援引號、引號內的逗號與換行） ─────────────────────────
export function parseCsv(source) {
  const input = String(source || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1 }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"' && cell === '') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += char
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(cells => cells.some(value => value.trim() !== ''))
}

const unquoteFormula = value => (/^'[=+\-@]/.test(value) ? value.slice(1) : value)

// ── 匯入 ────────────────────────────────────────────────────────────
function finishStores(storeMap, errors, maxPrice) {
  const stores = [...storeMap.values()]
  if (!stores.length) errors.push(t('menuTransfer.errors.empty'))
  if (stores.length > MAX_IMPORT_STORES) errors.push(t('menuTransfer.errors.tooManyStores', { max: MAX_IMPORT_STORES }))
  for (const store of stores) {
    if (store.menuItems.length > MAX_IMPORT_ITEMS_PER_STORE) {
      errors.push(t('menuTransfer.errors.tooManyItems', { store: store.name, max: MAX_IMPORT_ITEMS_PER_STORE }))
    }
    menuIssues(store.menuItems, { maxPrice }).forEach((issue, index) => {
      issue.errors.forEach(message => errors.push(t('menuTransfer.errors.item', {
        store: store.name,
        item: store.menuItems[index].name || `#${index + 1}`,
        message,
      })))
    })
  }
  return { stores, errors }
}

function parseJsonMenu(source, { currency, maxPrice }) {
  const errors = []
  let data
  try { data = JSON.parse(source) } catch { return { stores: [], errors: [t('menuTransfer.errors.invalidJson')] } }
  if (data?.format !== MENU_EXPORT_FORMAT || !Array.isArray(data?.stores)) {
    return { stores: [], errors: [t('menuTransfer.errors.notMenuFile')] }
  }
  if (Number(data.version) > MENU_EXPORT_VERSION) {
    return { stores: [], errors: [t('menuTransfer.errors.newerVersion')] }
  }
  if (data.currency && currency && data.currency !== currency) {
    return { stores: [], errors: [t('menuTransfer.errors.currency', { file: data.currency, system: currency })] }
  }
  const storeMap = new Map()
  data.stores.forEach((raw, index) => {
    const name = text(raw?.name, 40)
    if (!name) { errors.push(t('menuTransfer.errors.storeName', { row: index + 1 })); return }
    const items = Array.isArray(raw?.menuItems) ? raw.menuItems : []
    const store = storeMap.get(name) || {
      name,
      category: storeCategory(raw?.category),
      phone: text(raw?.phone, 30),
      address: text(raw?.address, 120),
      images: (Array.isArray(raw?.images) ? raw.images : []).filter(isHttpUrl).map(url => String(url).trim()).slice(0, 20),
      menuItems: [],
    }
    for (const item of items) {
      if (item?.tags !== undefined && (!Array.isArray(item.tags) || item.tags.length !== normalizeDietaryTags(item.tags).length)) {
        errors.push(t('menuTransfer.errors.item', { store: name, item: item?.name || '', message: t('errors.INVALID_DIETARY_SETTINGS') }))
      }
      const price = Number(item?.price)
      store.menuItems.push(cleanMenuItem({
        category: item?.category,
        name: item?.name,
        price: Number.isFinite(price) ? price : '',
        unit: item?.unit,
        options: item?.options,
        tags: item?.tags,
      }))
    }
    storeMap.set(name, store)
  })
  return finishStores(storeMap, errors, maxPrice)
}

function parseCsvMenu(source, { maxPrice }) {
  const errors = []
  const rows = parseCsv(source)
  if (!rows.length) return { stores: [], errors: [t('menuTransfer.errors.empty')] }
  const header = rows[0].map(cell => cell.trim().toLowerCase())
  const column = Object.fromEntries(CSV_COLUMNS.map(key => [key, header.indexOf(key)]))
  if (column.store < 0 || column.item < 0 || column.price < 0) {
    return { stores: [], errors: [t('menuTransfer.errors.csvHeader', { columns: 'store, item, price' })] }
  }
  const cell = (cells, key) => (column[key] >= 0 ? unquoteFormula(String(cells[column[key]] ?? '').trim()) : '')
  const storeMap = new Map()
  rows.slice(1).forEach((cells, index) => {
    const line = index + 2
    const name = text(cell(cells, 'store'), 40)
    if (!name) { errors.push(t('menuTransfer.errors.storeName', { row: line })); return }
    if (!storeMap.has(name)) {
      storeMap.set(name, {
        name,
        category: storeCategory(cell(cells, 'store_category')),
        phone: text(cell(cells, 'phone'), 30),
        address: text(cell(cells, 'address'), 120),
        images: [],
        menuItems: [],
      })
    }
    const store = storeMap.get(name)
    const itemName = cell(cells, 'item')
    if (!itemName && !cell(cells, 'price')) return // 沒有品項的店家列
    const price = parseMoneyInput(cell(cells, 'price'))
    if (!Number.isFinite(price)) {
      errors.push(t('menuTransfer.errors.price', { row: line, value: cell(cells, 'price') }))
      return
    }
    const options = []
    for (const part of cell(cells, 'options').split(/[;\n]/).map(value => value.trim()).filter(Boolean)) {
      const group = parseOptionGroupLine(part)
      if (group) options.push(group)
      else errors.push(t('menuTransfer.errors.options', { row: line, value: part }))
    }
    let tags = []
    const rawTags = cell(cells, 'tags')
    if (rawTags) {
      try {
        tags = rawTags.startsWith('[') ? JSON.parse(rawTags) : rawTags.split(';').map(tag => tag.trim()).filter(Boolean)
        if (!Array.isArray(tags) || tags.length !== normalizeDietaryTags(tags).length) throw new Error('Invalid tags')
      } catch {
        errors.push(t('menuTransfer.errors.item', { store: name, item: itemName, message: t('errors.INVALID_DIETARY_SETTINGS') }))
      }
    }
    store.menuItems.push(cleanMenuItem({ category: cell(cells, 'category'), name: itemName, price, unit: cell(cells, 'unit'), options, tags }))
  })
  return finishStores(storeMap, errors, maxPrice)
}

/**
 * 解析匯入檔案。回傳 { stores, errors }；有 errors 時不應寫入。
 * stores[].menuItems 已是可直接存進 Firestore 的形狀。
 */
export function parseMenuFile(source, { fileName = '', currency, maxPrice }) {
  const trimmed = String(source || '').replace(/^\uFEFF/, '').trim()
  const isJson = /\.json$/i.test(fileName) || (!/\.csv$/i.test(fileName) && trimmed.startsWith('{'))
  return isJson ? parseJsonMenu(trimmed, { currency, maxPrice }) : parseCsvMenu(trimmed, { maxPrice })
}
