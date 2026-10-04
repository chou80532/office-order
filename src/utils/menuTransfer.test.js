import { afterEach, describe, expect, it } from 'vitest'
import { buildMenuCsv, buildMenuJson, parseCsv, parseMenuFile } from './menuTransfer'
import { setAppCurrency } from './format'

const stores = [
  {
    name: '範例便當',
    category: 'lunch',
    phone: '+1 555 0100',
    address: '中山路 1 號',
    images: [{ url: 'https://example.com/menu.jpg' }, { url: '' }],
    menuItems: [
      { type: 'main', category: '便當', name: '雞腿便當', price: 110 },
      {
        type: 'main', category: '主餐', name: '蛋包飯, 特製', price: 100,
        options: [{ label: '大小', required: true, multiple: false, choices: [{ name: '小', price: 0 }, { name: '大', price: 20 }] }],
      },
      { type: 'addon', category: '加點', name: '滷蛋', price: 15 },
      { type: 'main', category: '其他', name: '水餃', price: 5, unit: '顆', defaultQty: 1 },
    ],
  },
  { name: '=公式店', category: 'drink', phone: '', address: '', images: [], menuItems: [] },
]

afterEach(() => setAppCurrency('TWD'))

describe('menuTransfer', () => {
  it('JSON 匯出再匯入，品項與選項都保留', () => {
    const json = buildMenuJson(stores, { currency: 'TWD', exportedAt: new Date('2026-01-01T00:00:00Z') })
    const { stores: parsed, errors } = parseMenuFile(json, { fileName: 'menu.json', currency: 'TWD', maxPrice: 10_000 })
    expect(errors).toEqual([])
    expect(parsed).toHaveLength(2)
    expect(parsed[0].images).toEqual(['https://example.com/menu.jpg'])
    expect(parsed[0].menuItems).toEqual([
      { type: 'main', category: '便當', name: '雞腿便當', price: 110 },
      {
        type: 'main', category: '主餐', name: '蛋包飯, 特製', price: 100,
        options: [{ label: '大小', required: true, multiple: false, choices: [{ name: '小', price: 0 }, { name: '大', price: 20 }] }],
      },
      { type: 'addon', category: '加點', name: '滷蛋', price: 15 },
      { type: 'main', category: '其他', name: '水餃', price: 5, unit: '顆', defaultQty: 1 },
    ])
  })

  it('JSON 的幣別與系統不同時拒絕匯入', () => {
    const json = buildMenuJson(stores, { currency: 'TWD' })
    const { errors } = parseMenuFile(json, { fileName: 'menu.json', currency: 'USD', maxPrice: 10_000 })
    expect(errors).toHaveLength(1)
  })

  it('CSV 匯出再匯入結果相同，公式字元會被跳脫再還原', () => {
    const csv = buildMenuCsv(stores)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain("'=公式店")
    expect(csv).toContain('"蛋包飯, 特製"')
    const { stores: parsed, errors } = parseMenuFile(csv, { fileName: 'menu.csv', maxPrice: 10_000 })
    expect(errors).toEqual([])
    expect(parsed.map(store => store.name)).toEqual(['範例便當', '=公式店'])
    expect(parsed[0].phone).toBe('+1 555 0100')
    expect(parsed[0].menuItems[1].options[0].choices[1]).toEqual({ name: '大', price: 20 })
    expect(parsed[1].menuItems).toEqual([])
  })

  it('CSV 金額是主單位：美元 12.50 存成 1250 分', () => {
    setAppCurrency('USD')
    const csv = 'store,item,price,options\nCafe,Latte,4.50,Size* Small/Large+0.75\n'
    const { stores: parsed, errors } = parseMenuFile(csv, { fileName: 'menu.csv', maxPrice: 10_000 })
    expect(errors).toEqual([])
    expect(parsed[0].menuItems[0]).toMatchObject({ name: 'Latte', price: 450 })
    expect(parsed[0].menuItems[0].options[0].choices[1]).toEqual({ name: 'Large', price: 75 })
  })

  it('CSV 的錯誤會標出列號，超過上限的價格也會擋下', () => {
    const csv = 'store,item,price\n店家,湯,abc\n店家,便當,20000\n,沒有店名,10\n'
    const { errors } = parseMenuFile(csv, { fileName: 'menu.csv', maxPrice: 10_000 })
    expect(errors).toHaveLength(3)
  })

  it('缺少必要欄位或不是菜單檔時回報錯誤', () => {
    expect(parseMenuFile('name,cost\nA,1', { fileName: 'x.csv', maxPrice: 10_000 }).errors).toHaveLength(1)
    expect(parseMenuFile('{"hello":1}', { fileName: 'x.json', maxPrice: 10_000 }).errors).toHaveLength(1)
    expect(parseMenuFile('{broken', { fileName: 'x.json', maxPrice: 10_000 }).errors).toHaveLength(1)
  })

  it('parseCsv 處理引號內的換行與跳脫引號', () => {
    expect(parseCsv('a,b\r\n"x\ny","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x\ny', 'say "hi"']])
  })
})
