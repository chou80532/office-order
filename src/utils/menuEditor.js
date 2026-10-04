import { optionGroupIssues } from './dishOptionGroups'
import { formatMoney } from './format'
import { t } from '../i18n'

export const DEFAULT_MAX_MENU_PRICE = 9999

// 價格以幣別最小單位的整數檢查（新台幣為元、美元為分），上限預設 9999。
export function menuIssues(items, { maxPrice = DEFAULT_MAX_MENU_PRICE } = {}) {
  const keys = items.map(item => JSON.stringify([String(item.category || '').trim(), String(item.name || '').trim().toLocaleLowerCase(), String(item.unit || '').trim()]))
  return items.map((item, index) => {
    const errors = []
    const warnings = []
    if (!String(item.name || '').trim()) errors.push(t('menu.issues.nameRequired'))
    const price = Number(item.price)
    if (item.price === '' || item.price == null || !Number.isInteger(price) || price < 0 || price > maxPrice) errors.push(t('menu.issues.priceRange', { max: formatMoney(maxPrice) }))
    else if (price === 0) warnings.push(t('menu.issues.zeroPrice'))
    if (String(item.name || '').trim() && keys.some((key, i) => i !== index && key === keys[index])) warnings.push(t('menu.issues.duplicate'))
    const options = optionGroupIssues(item.options, { maxPrice })
    errors.push(...options.errors)
    warnings.push(...options.warnings)
    return { errors, warnings }
  })
}

