import { describe, it, expect } from 'vitest'
import { createBackend } from './helpers/backend'

function setup() {
  const backend = createBackend()
  backend.records.set('menu_images/new', { storeName: 'New', menuItems: [{ name: 'Rice', price: 80 }] })
  backend.records.set('menu_images/third', { storeName: 'Third' })
  const day = () => [...backend.records.entries()].find(([path]) => path.startsWith('dining_days/'))?.[1]
  const change = (source = 'Store', target = 'New', uid = 'admin') => backend.call('cancelOrdersWithWalletRefund', { storeReplacement: { source, target } }, uid)
  const reorder = (need, requestId = 'reorder') => backend.call('createOrdersWithWalletDebit', { requestId, reorderNeedId: need.id, items: [{ name: 'Rice', price: 80, storeName: need.targetStore, ownerUid: need.uid, ownerName: need.name, paymentMethod: need.uid ? 'wallet' : 'cash' }] })
  return { ...backend, day, change, reorder }
}

describe('換店不換人，後端完整交易', () => {
  it('保留今日用餐人員、原餐點，退款且不影響其他店訂單', async () => {
    const b = setup()
    const old = await b.order({ note: '飯少' })
    const drink = await b.order({ storeName: 'Drink', name: 'Tea', price: 30 })
    await b.change()
    expect(b.records.has(`orders/${old}`)).toBe(false)
    expect(b.records.has(`orders/${drink}`)).toBe(true)
    expect(b.balance()).toBe(970)
    expect(Object.keys(b.day().participants)).toHaveLength(1)
    const [need] = Object.values(b.day().needs)
    expect(need.status).toBe('pending')
    expect(need.originals[0].note).toContain('飯少')
    expect(b.records.get('settings/daily').activeStores).toEqual(['New'])
    await b.order({ storeName: 'Drink' })
    expect(Object.values(b.day().needs)[0].status).toBe('pending')
  })
  it('連續換店保留尚未補點的人；明確補點才解除，重送不重扣', async () => {
    const b = setup()
    await b.order()
    await b.change()
    await b.change('New', 'Third')
    const [need] = Object.values(b.day().needs)
    expect(need.targetStore).toBe('Third')
    expect(need.sourceStore).toBe('Store')
    const result = await b.reorder(need)
    await b.reorder(need)
    expect(b.balance()).toBe(920)
    expect(Object.values(b.day().needs)[0].status).toBe('completed')
    await b.call('cancelOrdersWithWalletRefund', { orderIds: result.orderIds })
    expect(Object.values(b.day().needs)[0].status).toBe('pending')
    expect(b.balance()).toBe(1000)
  })
  it('不得用其他人或其他店的訂單解除補點', async () => {
    const b = setup()
    await b.order(); await b.change()
    const [need] = Object.values(b.day().needs)
    await expect(b.reorder({ ...need, uid: 'proxy', name: 'proxy' })).rejects.toThrow('補點狀態已更新')
    await expect(b.reorder({ ...need, targetStore: 'Drink' })).rejects.toThrow('補點狀態已更新')
    await expect(b.order()).rejects.toThrow('店家已更換')

    expect(b.balance()).toBe(1000)
  })
  it('點餐頁送單自動完成對應需求，取消後恢復待補點', async () => {
    const b = setup()
    await b.order(); await b.change()
    const id = await b.order({ storeName: 'New' })
    expect(Object.values(b.day().needs)[0]).toMatchObject({ status: 'completed', orderIds: [id] })
    await b.call('cancelOrdersWithWalletRefund', { orderIds: [id] })
    expect(Object.values(b.day().needs)[0].status).toBe('pending')
    expect(b.balance()).toBe(1000)
  })
  it('一般送單同時補點多人時，分別關聯自己的訂單並維持重送冪等', async () => {
    const b = setup()
    await b.order()
    await b.order({ ownerUid: '', ownerName: 'Guest', paymentMethod: 'cash' })
    await b.order({ ownerUid: 'proxy', ownerName: 'proxy' })
    await b.change()
    const payload = { requestId: 'home-multi', items: [
      { name: 'Rice', price: 80, storeName: 'New', ownerUid: 'member', ownerName: 'member', paymentMethod: 'wallet' },
      { name: 'Tea', price: 30, storeName: 'Drink', ownerUid: 'member', ownerName: 'member', paymentMethod: 'wallet' },
      { name: 'Rice', price: 80, storeName: 'New', ownerUid: '', ownerName: 'Guest', paymentMethod: 'cash' },
    ] }
    const result = await b.call('createOrdersWithWalletDebit', payload)
    await b.call('createOrdersWithWalletDebit', payload)
    const needs = Object.values(b.day().needs)
    expect(needs.find(n => n.uid === 'member')).toMatchObject({ status: 'completed', orderIds: [result.orderIds[0]] })
    expect(needs.find(n => n.name === 'Guest')).toMatchObject({ status: 'completed', orderIds: [result.orderIds[2]] })
    expect(needs.find(n => n.uid === 'proxy').status).toBe('pending')
    expect(b.balance()).toBe(890)
  })
  it('補點餘額不足時，需求與帳務皆維持原狀', async () => {
    const b = setup()
    await b.order(); await b.change()
    b.records.get('wallets/member').balance = 10
    await expect(b.reorder(Object.values(b.day().needs)[0])).rejects.toThrow('INSUFFICIENT_WALLET_BALANCE')
    expect(Object.values(b.day().needs)[0].status).toBe('pending')
    expect(b.balance()).toBe(10)
    expect([...b.records.keys()].filter(key => key.startsWith('orders/'))).toHaveLength(0)
  })
  it('已註冊使用者皆可換店及代為確認不吃，並記錄操作者', async () => {
    const b = setup()
    await b.order()
    await expect(b.change('Store', 'New', 'unregistered')).rejects.toThrow('需要已註冊使用者權限')
    await b.change('Store', 'New', 'member')
    const [need] = Object.values(b.day().needs)
    await expect(b.call('cancelDiningNeed', { needId: need.id }, 'unregistered')).rejects.toThrow('需要已註冊使用者權限')
    await b.call('cancelDiningNeed', { needId: need.id }, 'proxy')
    expect(Object.values(b.day().needs)[0]).toMatchObject({ status: 'declined', resolvedBy: 'proxy' })
    expect(Object.keys(b.day().participants)).toHaveLength(1)
  })
  it('現金取消應收；已收款則整筆交易不變', async () => {
    const b = setup()
    const id = await b.order({ paymentMethod: 'cash', ownerUid: '', ownerName: 'Guest' })
    const paymentId = b.records.get(`orders/${id}`).cashPaymentId
    b.records.get(`cash_payments/${paymentId}`).status = 'collected'
    await expect(b.change()).rejects.toThrow('CASH_PAYMENT_ALREADY_COLLECTED')
    expect(b.records.has(`orders/${id}`)).toBe(true)
    expect(Object.keys(b.day().needs)).toHaveLength(0)
    b.records.get(`cash_payments/${paymentId}`).status = 'pending'
    await b.change()
    expect(b.records.get(`cash_payments/${paymentId}`).status).toBe('cancelled')
    expect(Object.values(b.day().needs)[0]).toMatchObject({ name: 'Guest', uid: '', status: 'pending' })
  })
  it('免費訂單換店不重複退款，已完成後再次換店會回到待補點', async () => {
    const b = setup()
    b.freeStore()
    await b.order(); await b.change()
    expect(b.balance()).toBe(1000)
    await b.reorder(Object.values(b.day().needs)[0])
    await b.change('New', 'Third')
    expect(b.balance()).toBe(1000)
    expect(Object.values(b.day().needs)).toHaveLength(1)
    expect(Object.values(b.day().needs)[0].status).toBe('pending')
  })
})

function settingsPayload(b, activeStores, freeStores = [], storeReplacements = []) {
  const daily = b.records.get('settings/daily')
  return { storeReplacements, dailyStoreSettings: {
    activeStores, freeStores, expectedActiveStores: [...daily.activeStores], expectedFreeStores: [...daily.freeStores], serviceDate: daily.serviceDate,
  } }
}

describe('設定店家交易回歸', () => {
  it('一般已註冊成員可整店更換他人訂單，但不可任意取消他人單', async () => {
    const b = setup()
    const id = await b.order()
    await expect(b.call('cancelOrdersWithWalletRefund', { orderIds: [id] }, 'proxy')).rejects.toThrow('ORDER_CANCEL_NOT_ALLOWED')
    await b.change('Store', 'New', 'proxy')
    expect(b.balance()).toBe(1000)
    expect(Object.values(b.day().needs)[0].status).toBe('pending')
  })
  it('多店一次換店，退款、名單和新店免費設定一起生效', async () => {
    const b = setup()
    b.records.get('settings/daily').activeStores.push('Drink')
    await b.order()
    await b.order({ storeName: 'Drink', price: 30 })
    await b.call('cancelOrdersWithWalletRefund', settingsPayload(b, ['New', 'Third'], ['New'], [
      { source: 'Store', target: 'New' }, { source: 'Drink', target: 'Third' },
    ]), 'proxy')
    expect(b.balance()).toBe(1000)
    expect(Object.values(b.day().needs).map(n => n.targetStore).sort()).toEqual(['New', 'Third'])
    expect(b.records.get('settings/daily')).toMatchObject({ activeStores: ['New', 'Third'], freeStores: ['New'] })
    const id = await b.order({ storeName: 'New' })
    expect(b.records.get(`orders/${id}`).isFree).toBe(true)
    expect(b.balance()).toBe(1000)
  })
  it('任一店含已收現金，整次換店皆不變', async () => {
    const b = setup()
    b.records.get('settings/daily').activeStores.push('Drink')
    await b.order()
    const id = await b.order({ storeName: 'Drink', ownerUid: '', ownerName: 'Guest', paymentMethod: 'cash' })
    b.records.get(`cash_payments/${b.records.get(`orders/${id}`).cashPaymentId}`).status = 'collected'
    const before = structuredClone([...b.records])
    await expect(b.call('cancelOrdersWithWalletRefund', settingsPayload(b, ['New', 'Third'], [], [
      { source: 'Store', target: 'New' }, { source: 'Drink', target: 'Third' },
    ]))).rejects.toThrow('CASH_PAYMENT_ALREADY_COLLECTED')
    expect([...b.records]).toEqual(before)
  })
  it('面板開啟後才有人下單，不能直接移除店家漏掉該成員', async () => {
    const b = setup()
    const payload = settingsPayload(b, ['New'])
    await b.order()
    await expect(b.call('cancelOrdersWithWalletRefund', payload)).rejects.toThrow('請重新確認接替店家')
    expect(b.balance()).toBe(900)
    expect(b.records.get('settings/daily').activeStores).toEqual(['Store'])
  })
  it('過期草稿不能蓋掉別人的新設定，跨日草稿也不可套用', async () => {
    const b = setup()
    const payload = settingsPayload(b, ['New'])
    b.records.get('settings/daily').activeStores.push('Drink')
    await expect(b.call('cancelOrdersWithWalletRefund', payload)).rejects.toThrow('今日店家已更新')
    const stale = settingsPayload(b, ['New'])
    stale.dailyStoreSettings.serviceDate = '2000-01-01'
    await expect(b.call('cancelOrdersWithWalletRefund', stale)).rejects.toThrow('今日店家已更新')
  })
  it('沒有訂單可正常改設定；未註冊與偽造換店不得取消任意單', async () => {
    const b = setup()
    const payload = settingsPayload(b, ['New'], ['New'])
    await expect(b.call('cancelOrdersWithWalletRefund', payload, 'unregistered')).rejects.toThrow('需要已註冊')
    await b.call('cancelOrdersWithWalletRefund', payload, 'proxy')
    expect(b.records.get('settings/daily').freeStores).toEqual(['New'])
    await expect(b.call('cancelOrdersWithWalletRefund', { ...payload, orderIds: ['injected'] })).rejects.toThrow('不可指定個別訂單')
  })
  it('補點後加點再刪除第一筆，不得誤報仍需補點', async () => {
    const b = setup()
    await b.order(); await b.change()
    const first = await b.order({ storeName: 'New' })
    const second = await b.order({ storeName: 'New' })
    await b.call('cancelOrdersWithWalletRefund', { orderIds: [first] })
    expect(Object.values(b.day().needs)[0]).toMatchObject({ status: 'completed', orderIds: [second] })
    await b.call('cancelOrdersWithWalletRefund', { orderIds: [second] })
    expect(Object.values(b.day().needs)[0].status).toBe('pending')
  })
})
