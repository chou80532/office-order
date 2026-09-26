import { describe, expect, it } from 'vitest'
import { configuredCartItem, groupDishOptions, cartOptionSummary, cartCustomNote, cartPortions, hasNothingToChoose } from './dishOptions'
import { countCartDishes } from './cart'
import { menuItemKey } from './menuCategories'

const small = { name: '牛肉炒麵(小)', price: 100, category: '麵食' }
const large = { name: '牛肉炒麵(大)', price: 110, category: '麵食' }
const owner = { ownerName: '會員', ownerUid: 'a', paymentMethod: 'wallet' }
describe('直接加入購物車的條件', () => {
  const burger = { name: '招牌豬肉堡', price: 49, category: '美式漢堡' }
  it.each(['menuItems', 'items'])('有共用加點（%s）時先開啟選項', key => {
    const store = { category: 'lunch', [key]: [burger,
      { name: '牧場洗選蛋', price: 15, category: '加點' },
      { name: '起司', price: 10, type: 'addon' },
    ] }
    expect(hasNothingToChoose(burger, store)).toBe(false)
    const item = configuredCartItem({ dish: burger, owner, storeName: '早餐店',
      addons: store[key].slice(1), note: '' })
    expect(item.price).toBe(74)
    expect(item.addons).toHaveLength(2)
  })
  it('沒有共用加點或規格的主餐仍能直接加入', () => {
    expect(hasNothingToChoose(burger, { category: 'lunch', menuItems: [burger] })).toBe(true)
  })
  it('飲料、數量及多規格仍先開啟選項', () => {
    expect(hasNothingToChoose(burger, { category: 'drink' })).toBe(false)
    expect(hasNothingToChoose({ ...burger, unit: '顆' }, {})).toBe(false)
    expect(hasNothingToChoose({ ...burger, _variants: [small, large] }, {})).toBe(false)
  })
})
describe('餐點規格與購物車', () => {
  it('麵體與大小合併，選擇後保留完整品名、售價與購物車識別', () => {
    const variants = [
      { name: '牛肉湯麵(細麵)(小)', category: '湯麵', price: 120 },
      { name: '牛肉湯麵（烏龍麵／大）', category: '湯麵', price: 150 },
      { name: '牛肉湯麵(冬粉)(小)', category: '湯麵', price: 120 },
    ]
    expect(groupDishOptions(variants)).toEqual([{ ...variants[0], name: '牛肉湯麵', price: 120, _variants: variants }])
    const item = configuredCartItem({ dish: variants[1], owner, storeName: '麵店', addons: [{ name: '蛋', price: 15 }], note: '不加蔥', quantity: 2 })
    expect(item).toMatchObject({ name: variants[1].name, displayName: '牛肉湯麵', variantLabel: '烏龍麵 · 大', price: 330, _dishKey: menuItemKey(variants[1], '麵店') })
    expect(cartOptionSummary(item)).toBe('烏龍麵 · 大 · 2份 · 蛋')
  })
  it('不猜測不同菜名、不合併不同單位及加料', () => {
    const items = [{ name: '牛肉麵', price: 120 }, { name: '牛肉冬粉', price: 120 }, { name: '湯麵(油麵)', price: 80, unit: '碗' }, { name: '湯麵(米粉)', price: 80 }, { name: '加麵(油麵)', price: 10, type: 'addon' }, { name: '加麵(米粉)', price: 10, type: 'addon' }]
    expect(groupDishOptions(items)).toEqual(items)
  })
  it('冰熱與杯型組合合併，保留實際售價，不誤合併菜名', () => {
    const variants = [{ name: '紅茶(大杯)(冰)', price: 40 }, { name: '紅茶（中杯／熱）', price: 35 }]
    expect(groupDishOptions(variants)[0]).toMatchObject({ name: '紅茶', price: 35, _variants: variants })
    expect(groupDishOptions([{ name: '熱炒(小)', price: 90 }, { name: '熱炒(大)', price: 100 }])[0].name).toBe('熱炒')
  })
  it('多份餐點與每份加料一起計價，摘要與備註分開且卡片份數正確', () => {
    const item = configuredCartItem({ dish: large, owner, storeName: '不顯示的店名', addons: [{ name: '蛋', price: 15 }], note: '不加蔥', quantity: 2 })
    expect(item).toMatchObject({ price: 250, basePrice: 220, quantity: 2, addonMultiplier: 2, note: '2份、不加蔥' })
    expect(cartOptionSummary(item)).toBe('大 · 2份 · 蛋')
    expect(cartCustomNote(item)).toBe('不加蔥')
    expect(countCartDishes([item], owner)[menuItemKey(large, item.storeName)]).toBe(2)
    const changed = configuredCartItem({ dish: large, original: item, owner, storeName: item.storeName, addons: item.addons, note: item.customNote, quantity: 1 })
    expect(changed.price).toBe(125)
    expect(changed.note).toBe('不加蔥')
  })
  it('合併大小份，保留原始菜單資料、順序與價格', () => {
    const soup = { name: '酸辣湯', price: 30 }
    const result = groupDishOptions([small, large, soup])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: '牛肉炒麵', price: 100, _variants: [small, large] })
    expect(result[1]).toBe(soup)
    expect(small.name).toBe('牛肉炒麵(小)')
  })
  it('不合併不同分類、缺乏配對、重複尺寸或非尺寸括號', () => {
    const items = [small, { ...large, category: '其他' }, { name: '湯(辣)', price: 30 }, { name: '湯(原味)', price: 30 }]
    expect(groupDishOptions(items)).toHaveLength(4)
    expect(groupDishOptions([small, { ...small, price: 120 }, large])).toHaveLength(3)
  })
  it('辨識飲品杯型與全形括號', () => {
    expect(groupDishOptions([{ name: '紅茶（中杯）', price: 30 }, { name: '紅茶（大杯）', price: 40 }])[0].name).toBe('紅茶')
  })
  it('修改規格與加料會重新計價，保留代訂人與列識別，不更動原項目', () => {
    const original = configuredCartItem({ dish: small, owner, storeName: '店家', addons: [], note: '不加蔥' })
    const changed = configuredCartItem({ dish: large, original, owner: { ownerName: '別人' }, storeName: '店家', addons: [{ name: '蛋', price: 15 }], note: '醬料分開' })
    expect(changed).toMatchObject({ _key: original._key, ownerUid: 'a', ownerName: '會員', name: large.name, basePrice: 110, price: 125 })
    expect(original.price).toBe(100)
    expect(original.note).toBe('不加蔥')
  })
  it('同餐點的不同備註保留為兩列，卡片數量可累計', () => {
    const create = note => configuredCartItem({ dish: small, owner, storeName: '店家', addons: [], note })
    const items = [create('不加蔥'), create('加辣')]
    expect(items[0]._key).not.toBe(items[1]._key)
    expect(countCartDishes(items, owner)[menuItemKey(small, '店家')]).toBe(2)
  })
  it('按單位計價時保留數量，備註不影響價格', () => {
    expect(configuredCartItem({ dish: { name: '蒸餃', price: 7, unit: '顆' }, owner, storeName: '店家', addons: [{ name: '蛋', price: 15 }], note: '少鹽', quantity: 10 })).toMatchObject({ basePrice: 70, price: 85, quantity: 10, note: '10顆、少鹽' })
  })
  it('十顆視為一份，顆數與單價另列', () => {
    const item = configuredCartItem({ dish: { name: '水餃', price: 7, unit: '顆' }, owner, storeName: '店家', addons: [], note: '', quantity: 10 })
    expect(cartPortions(item)).toBe(1)
    expect(cartOptionSummary(item)).toBe('10顆')
    expect(item.price).toBe(70)
  })
})

describe('多軸選項', () => {
  const owner = { ownerUid: 'a', ownerName: '會員' }
  const 蛋包飯 = {
    name: '創意蛋包飯',
    price: 100,
    category: '主餐',
    options: [
      { label: '口味', required: true, choices: ['原味', '咖哩'] },
      { label: '肉類', required: true, choices: ['牛肉', '蝦仁'] },
      { label: '加點', multiple: true, choices: [{ name: '另加肉類', price: 20 }] },
    ],
  }
  const 選 = (...pairs) => pairs.map(([label, name, price = 0]) => ({ label, choices: [{ name, price }] }))

  it('選到的口味與肉類寫進餐點名稱，後端訂單與統整才看得到', () => {
    const item = configuredCartItem({
      dish: 蛋包飯, owner, storeName: '中華一番', addons: [], note: '',
      optionSelections: 選(['口味', '咖哩'], ['肉類', '牛肉']),
    })
    expect(item.name).toBe('創意蛋包飯（咖哩 · 牛肉）')
    expect(item.optionLabel).toBe('咖哩 · 牛肉')
    expect(item.price).toBe(100)
  })

  it('選項加價比照加料，按份數計算', () => {
    const item = configuredCartItem({
      dish: 蛋包飯, owner, storeName: '中華一番', addons: [], note: '', quantity: 3,
      optionSelections: 選(['口味', '咖哩'], ['肉類', '牛肉'], ['加點', '另加肉類', 20]),
    })
    expect(item.basePrice).toBe(300)
    expect(item.price).toBe(360)
  })

  it('沒選任何選項時名稱與價格跟以前一樣', () => {
    const item = configuredCartItem({ dish: 蛋包飯, owner, storeName: '中華一番', addons: [], note: '' })
    expect(item.name).toBe('創意蛋包飯')
    expect(item.optionSelections).toEqual([])
    expect(item.price).toBe(100)
  })

  it('購物車摘要不重複顯示已經在名稱裡的選項', () => {
    const item = configuredCartItem({
      dish: 蛋包飯, owner, storeName: '中華一番', addons: [], note: '', quantity: 2,
      optionSelections: 選(['口味', '咖哩'], ['肉類', '牛肉']),
    })
    expect(cartOptionSummary(item)).toBe('2份')
  })

  it('修改購物車既有品項時選項會跟著更新', () => {
    const first = configuredCartItem({
      dish: 蛋包飯, owner, storeName: '中華一番', addons: [], note: '',
      optionSelections: 選(['口味', '咖哩'], ['肉類', '牛肉']),
    })
    const changed = configuredCartItem({
      dish: 蛋包飯, original: first, owner, storeName: '中華一番', addons: [], note: '',
      optionSelections: 選(['口味', '原味'], ['肉類', '蝦仁']),
    })
    expect(changed._key).toBe(first._key)
    expect(changed.name).toBe('創意蛋包飯（原味 · 蝦仁）')
  })
})
