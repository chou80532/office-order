// Presentation only: never changes a meal's stored category or ordering behavior.
// Explicit categories win; older records without categories use recognizable names.
export function mealTone(name, category = '') {
  const type = String(category || '').trim().toLowerCase()
  if (/^(drink|飲料|飲品)$/.test(type)) return 'var(--jade)'
  if (/^(rice|飯類)$/.test(type)) return 'var(--gold)'
  if (/^(noodle|soup|麵類|湯類)$/.test(type)) return 'var(--persimmon-dark)'
  const meal = String(name || '').trim()
  if (/飯|丼|粥|壽司|飯糰/.test(meal)) return 'var(--gold)'
  if (/麵|麪|湯|米粉|冬粉|粄條|水餃|餛飩/.test(meal)) return 'var(--persimmon-dark)'
  if (/茶|咖啡|拿鐵|奶|果汁|可可|豆漿|冰沙|多多|烏龍/.test(meal)) return 'var(--jade)'
  return 'var(--ink-faint)'
}
