import { describe, expect, it } from 'vitest'
import { countCartDishes, toggleCartDish } from './cart'
import { menuItemKey } from './menuCategories'

const alice = { ownerUid: 'a', ownerName: 'Alice', paymentMethod: 'wallet' }
const bob = { ownerUid: 'b', ownerName: 'Bob', paymentMethod: 'wallet' }
const dish = { name: '雞腿飯', price: 100, category: '便當' }

describe('多人代訂的購物車', () => {
  it('替 A、B 點相同餐點會保留兩筆，再取消 B 不影響 A', () => {
    let items = toggleCartDish([], dish, alice, 'Store')
    expect(countCartDishes(items, bob)).toEqual({})
    items = toggleCartDish(items, dish, bob, 'Store')
    expect(items.map(item => item.ownerUid)).toEqual(['a', 'b'])
    expect(countCartDishes(items, alice)[menuItemKey(dish, 'Store')]).toBe(1)
    expect(countCartDishes(items, bob)[menuItemKey(dish, 'Store')]).toBe(1)
    items = toggleCartDish(items, dish, bob, 'Store')
    expect(items.map(item => item.ownerUid)).toEqual(['a'])
  })

  it('手動姓名和不同付款方式分別保留，單價和數量不變', () => {
    const manualA = { ownerName: 'Guest A', paymentMethod: 'cash' }
    const manualB = { ownerName: 'Guest B', paymentMethod: 'cash' }
    const unitDish = { ...dish, unit: '份' }
    let items = toggleCartDish([], unitDish, manualA, 'Store', 2)
    items = toggleCartDish(items, unitDish, manualB, 'Store', 3)
    expect(items.map(item => item.price)).toEqual([200, 300])
    expect(items.map(item => item.note)).toEqual(['2份', '3份'])
    items = toggleCartDish(items, unitDish, manualA, 'Store', 1)
    expect(items).toHaveLength(1)
    expect(items[0].ownerName).toBe('Guest B')
  })

  it('同名不同 UID 的會員、不同店家與加料品項不互相移除', () => {
    let items = toggleCartDish([], dish, alice, 'Store')
    items[0].price += 20
    items[0].addons = [{ name: '蛋', price: 20 }]
    items = toggleCartDish(items, dish, { ...bob, ownerName: 'Alice' }, 'Store')
    items = toggleCartDish(items, dish, alice, 'OtherStore')
    items = toggleCartDish(items, dish, alice, 'Store')
    expect(items).toHaveLength(2)
    expect(items.map(item => [item.ownerUid, item.storeName])).toEqual([['b', 'Store'], ['a', 'OtherStore']])
  })
})
