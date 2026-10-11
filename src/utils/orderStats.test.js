import { describe, expect, it } from 'vitest'
import { aggregateOrderStats } from './orderStats'

describe('訂餐統計', () => {
  it('人數包含榜外參與者與免費餐，費用只計個人負擔', () => {
    const records = Array.from({ length: 12 }, (_, i) => ({ name: `同事${i}`, meal: '飯', storeName: '便當店', price: 100, isFree: i === 11, timestamp: 1789185600000 }))
    const result = aggregateOrderStats(records)
    expect(Object.keys(result.peopleMap)).toHaveLength(12)
    expect(result.orders).toBe(12)
    expect(result.total).toBe(1100)
    expect(result.storeMap['便當店'].count).toBe(12)
  })
  it('不同店家的同名餐點分開排行', () => {
    const result = aggregateOrderStats(['甲店', '乙店'].map(storeName => ({ name: '同事', storeName, meal: '雞腿飯', price: 100 })))
    expect(Object.keys(result.mealMap)).toHaveLength(2)
    expect(result.mealMap['甲店・雞腿飯'].count).toBe(1)
    expect(result.mealMap['乙店・雞腿飯'].count).toBe(1)
  })
  it.each(['__proto__', 'constructor', 'toString'])('姓名與店名 %s 不會撞到內建物件屬性', name => {
    const result = aggregateOrderStats([
      { name, storeName: name, meal: 'Example Meal', price: 100, timestamp: 1789185600000 },
      { name, storeName: name, meal: 'Example Meal', price: 150, timestamp: 1789185600000 },
    ])
    expect(Object.keys(result.peopleMap)).toEqual([name])
    expect(result.peopleMap[name]).toMatchObject({ count: 2, total: 250 })
    expect(result.peopleMap[name].stores).toEqual(new Set([name]))
    expect(Object.keys(result.storeMap)).toEqual([name])
    expect(result.storeMap[name]).toMatchObject({ count: 2, amount: 250 })
    expect(result.total).toBe(250)
  })
})
