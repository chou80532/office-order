import { cartPortions } from './dishOptions'
import { menuItemKey } from './menuCategories'

// 已註冊成員以 UID 區分；手動代訂以姓名區分，付款方式也必須相同。
export const cartOwnerKey = (item) => JSON.stringify([
  item?.paymentMethod || 'wallet',
  item?.ownerUid || '',
  item?.ownerUid ? '' : String(item?.ownerName || item?.who || '').trim(),
])

const dishKeyFor = (item) => item._dishKey || menuItemKey(item, item.storeName || '')

export const countCartDishes = (items, owner) => {
  const counts = {}
  items.forEach(item => {
    if (cartOwnerKey(item) !== cartOwnerKey(owner)) return
    const key = dishKeyFor(item)
    counts[key] = (counts[key] || 0) + cartPortions(item)
  })
  return counts
}

export const toggleCartDish = (items, dish, owner, storeName, qty = 1) => {
  const dishKey = menuItemKey(dish, storeName)
  const matches = item => cartOwnerKey(item) === cartOwnerKey(owner) && dishKeyFor(item) === dishKey
  if (items.some(matches)) return items.filter(item => !matches(item))
  const actualQty = dish.unit && qty > 1 ? qty : 1
  const basePrice = dish.price * actualQty
  return [...items, {
    _key: Date.now() + Math.random(),
    _dishKey: dishKey,
    name: dish.name,
    price: basePrice,
    basePrice,
    addons: [],
    note: dish.unit ? `${actualQty}${dish.unit}` : '',
    category: dish.category || '',
    who: owner.ownerName,
    ...owner,
    storeName,
  }]
}
