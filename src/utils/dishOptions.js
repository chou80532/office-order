import { isAddonMenuItem, menuItemKey, normalizeMenuCategory } from './menuCategories'
import { compactOptionSelections, optionSelectionsLabel, optionSelectionsPrice, normalizeOptionGroups } from './dishOptionGroups'

export function hasNothingToChoose(dish, store) {
  const variants = dish._variants || [dish]
  if (variants.length !== 1) return false
  if (normalizeOptionGroups(variants[0]?.options).length || variants[0]?.unit) return false
  if ((store?.menuItems || store?.items || []).some(isAddonMenuItem)) return false
  const category = variants[0]?.category || dish.category || ''
  if (store?.category === 'drink' || /飲料|飲品|茶|咖啡|果汁/.test(category)) return false
  return true
}

// Recognize only explicit trailing option labels, leaving recipe names intact.
const OPTION = /^(小|中|大|小份|中份|大份|小杯|中杯|大杯|XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|特小|特大|超大|冰|冷|熱|温|溫|冰飲|冷飲|熱飲|溫飲|冰的|熱的|溫的|麵|油麵|意麵|意面|烏龍麵|烏冬麵|拉麵|細麵|粗麵|寬麵|白麵|黃麵|陽春麵|刀削麵|手工麵|家常麵|雞絲麵|麵線|米粉|細米粉|粗米粉|冬粉|粄條|板條|河粉|粿仔條)$/i
export function dishSpecification(item) {
  let name = String(item?.name || '').trim()
  const labels = []
  while (true) {
    const match = name.match(/[（(]([^（()）]+)[）)]\s*$/)
    if (!match) break
    const parts = match[1].trim().split(/[／/、,，\s]+/)
    if (!parts.length || !parts.every(part => OPTION.test(part))) break
    labels.unshift(...parts)
    name = name.slice(0, match.index).trim()
  }
  return { name: name || item.name, label: labels.join(' · '), temperature: labels.find(label => /^(冰|冷|熱|温|溫)/.test(label)) || '' }
}
export const sizeLabel = item => dishSpecification(item).label
export const cartPortions = item => item.unit ? 1 : Math.max(1, Number(item.quantity) || 1)
export function cartOptionSummary(item) {
  const spec = item.variantLabel ?? dishSpecification(item).label
  // 選項軸（口味、肉類…）已經寫進 name 了，購物車摘要不重複顯示，
  // 只有當品項名稱沒帶上它們（例如舊資料）時才補在這裡。
  const options = item.optionLabel && !String(item.name || '').includes(item.optionLabel) ? item.optionLabel : ''
  const quantity = item.unit ? `${item.quantity || 1}${item.unit}` : Number(item.quantity) > 1 ? `${item.quantity}份` : ''
  return [spec, options, quantity, ...(item.addons || []).map(a => a.name)].filter(Boolean).join(' · ')
}
export function cartCustomNote(item) {
  if (typeof item.customNote === 'string') return item.customNote
  return item.note || ''
}

export function groupDishOptions(items) {
  const buckets = new Map()
  for (const item of items) {
    const size = sizeLabel(item)
    if (!size || isAddonMenuItem(item)) continue
    const name = dishSpecification(item).name
    const key = JSON.stringify([normalizeMenuCategory(item.category), item.unit || '', name])
    if (!buckets.has(key)) buckets.set(key, { name, items: [] })
    buckets.get(key).items.push(item)
  }
  const groups = new Map()
  for (const { name, items: variants } of buckets.values()) {
    if (variants.length < 2 || new Set(variants.map(sizeLabel)).size !== variants.length) continue
    const group = { ...variants[0], name, price: Math.min(...variants.map(i => Number(i.price))), _variants: variants }
    variants.forEach(item => groups.set(item, group))
  }
  const seen = new Set()
  return items.flatMap(item => {
    const group = groups.get(item) || item
    if (seen.has(group)) return []
    seen.add(group)
    return [group]
  })
}

export function configuredCartItem({ dish, original, owner, storeName, addons, note, quantity = 1, optionSelections = [] }) {
  const qty = Math.max(1, Math.min(99, Math.trunc(Number(quantity)) || 1))
  const basePrice = Number(dish.price) * qty
  const multiplier = dish.unit ? 1 : qty
  const addonPrice = addons.reduce((sum, a) => sum + Number(a.price || 0), 0) * multiplier
  const chosenOptions = compactOptionSelections(optionSelections)
  // 選項加價跟加料一樣是「每一份」另計
  const optionPrice = optionSelectionsPrice(chosenOptions) * multiplier
  const optionLabel = optionSelectionsLabel(chosenOptions)
  const spec = dishSpecification(dish)
  // 選到的口味／肉類直接寫進餐點名稱：後端訂單只收 name 與 note，
  // 今日訂單的「店家餐點統整」也是用餐點名稱分組，打電話訂餐時才看得到咖哩牛肉。
  const name = optionLabel ? `${dish.name}（${optionLabel}）` : dish.name
  return {
    ...original,
    ...(!original ? { _key: Date.now() + Math.random(), ...owner, who: owner.ownerName } : {}),
    _dishKey: menuItemKey(dish, storeName), name, category: dish.category || '',
    storeName, unit: dish.unit || '', quantity: qty, unitPrice: Number(dish.price),
    displayName: spec.name, variantLabel: spec.label, optionLabel, optionSelections: chosenOptions,
    customNote: note.trim(), addonMultiplier: multiplier,
    basePrice, addons: addons.map(a => ({ ...a })),
    price: basePrice + addonPrice + optionPrice,
    note: [dish.unit ? `${qty}${dish.unit}` : qty > 1 ? `${qty}份` : '', note.trim()].filter(Boolean).join('、'),
  }
}
