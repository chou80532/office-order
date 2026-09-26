import { getLocalDateKey } from './format'

export function aggregateOrderStats(records) {
    const peopleMap = {}
    const storeMap = {}
    const mealMap = {}
    const dayMap = {}
    let total = 0
    let orders = 0
    records.forEach(data => {
      const price = data.isFree ? 0 : Number(data.price) || 0
      const name = data.name || '?'
      const storeName = data.storeName || '未知店家'
      const mealName = `${storeName}・${data.meal || '未命名餐點'}`
      const dayKey = getLocalDateKey(new Date(data.timestamp || Date.now()))

      if (!peopleMap[name]) peopleMap[name] = { name, count: 0, stores: new Set(), total: 0 }
      peopleMap[name].count += 1
      peopleMap[name].stores.add(storeName)
      peopleMap[name].total += price

      if (!storeMap[storeName]) storeMap[storeName] = { name: storeName, count: 0, amount: 0 }
      storeMap[storeName].count += 1
      storeMap[storeName].amount += price

      if (!mealMap[mealName]) mealMap[mealName] = { name: mealName, storeName, count: 0, stores: new Set() }
      mealMap[mealName].count += 1
      mealMap[mealName].stores.add(storeName)

      if (!dayMap[dayKey]) dayMap[dayKey] = { date: dayKey, count: 0, amount: 0 }
      dayMap[dayKey].count += 1
      dayMap[dayKey].amount += price

      total += price
      orders += 1
    })
  return { peopleMap, storeMap, mealMap, dayMap, total, orders }
}
