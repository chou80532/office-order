import { optionGroupIssues } from './dishOptionGroups'

export function menuIssues(items) {
  const keys = items.map(item => JSON.stringify([String(item.category || '').trim(), String(item.name || '').trim().toLocaleLowerCase(), String(item.unit || '').trim()]))
  return items.map((item, index) => {
    const errors = []
    const warnings = []
    if (!String(item.name || '').trim()) errors.push('名稱不能空白')
    const price = Number(item.price)
    if (item.price === '' || item.price == null || !Number.isInteger(price) || price < 0 || price > 9999) errors.push('單價需為 0–9999 的整數')
    else if (price === 0) warnings.push('零元價格待確認')
    if (String(item.name || '').trim() && keys.some((key, i) => i !== index && key === keys[index])) warnings.push('同分類有重複餐點')
    const options = optionGroupIssues(item.options)
    errors.push(...options.errors)
    warnings.push(...options.warnings)
    return { errors, warnings }
  })
}

