import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from './helpers/backend'

const NOON_TAIPEI = new Date('2026-09-06T04:00:00Z')
const WEBHOOK = 'https://hooks.example.com/services/fictional'
const recordsUnder = (backend, prefix) => [...backend.records.entries()].filter(([path]) => path.startsWith(prefix))

describe('每月補助', () => {
  let backend
  const setSystem = data => backend.records.set('settings/system', data)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON_TAIPEI)
    backend = createBackend()
    setSystem({ subsidy: { monthlyAllowance: 500, effectiveFrom: '2026-09' } })
  })
  afterEach(() => vi.useRealTimers())

  it('管理員手動發放：每人每月只撥一次，並寫入錢包流水', async () => {
    await expect(backend.call('grantMonthlyAllowance', {})).resolves.toEqual({ ok: true, month: '2026-09', amount: 500, granted: 3, skipped: 0 })
    expect(backend.balance()).toBe(1500)
    expect(backend.records.get('wallets/admin')).toMatchObject({ ownerUid: 'admin', balance: 500 })
    const logs = recordsUnder(backend, 'wallet_logs/').map(([, log]) => log)
    expect(logs).toHaveLength(3)
    expect(logs.find(log => log.ownerUid === 'member')).toMatchObject({ type: 'allowance_credit', amount: 500, beforeBalance: 1000, afterBalance: 1500, reason: '每月補助｜2026-09' })

    await expect(backend.call('grantMonthlyAllowance', {})).resolves.toMatchObject({ granted: 0, skipped: 3 })
    expect(backend.balance()).toBe(1500)
    expect(backend.records.get('allowance_runs/2026-09')).toMatchObject({ month: '2026-09', amount: 500 })
  })

  it('流水說明依系統語言', async () => {
    setSystem({ locale: 'en', subsidy: { monthlyAllowance: 500, effectiveFrom: '2026-09' } })
    await backend.call('grantMonthlyAllowance', {})
    const log = recordsUnder(backend, 'wallet_logs/').map(([, entry]) => entry).find(entry => entry.ownerUid === 'member')
    expect(log.reason).toBe('Monthly allowance | 2026-09')
  })

  it('只有管理員能發放；停用錢包或未設定金額時拒絕', async () => {
    await expect(backend.call('grantMonthlyAllowance', {}, 'member')).rejects.toThrow('需要管理員權限')
    setSystem({ paymentMethods: { wallet: false, cash: true }, subsidy: { monthlyAllowance: 500 } })
    await expect(backend.call('grantMonthlyAllowance', {})).rejects.toThrow('WALLET_DISABLED')
    setSystem({})
    await expect(backend.call('grantMonthlyAllowance', {})).rejects.toThrow('ALLOWANCE_NOT_CONFIGURED')
    expect(backend.balance()).toBe(1000)
  })

  it('排程在生效月份後自動發放一次', async () => {
    await backend.exports.monthlyAllowanceScheduler()
    expect(backend.balance()).toBe(1500)
    await expect(backend.exports.monthlyAllowanceScheduler()).resolves.toBeNull()
    expect(backend.balance()).toBe(1500)
  })

  it('尚未到生效月份或未設定生效月份時排程不發放', async () => {
    setSystem({ subsidy: { monthlyAllowance: 500, effectiveFrom: '2026-10' } })
    await expect(backend.exports.monthlyAllowanceScheduler()).resolves.toBeNull()
    setSystem({ subsidy: { monthlyAllowance: 500 } })
    await expect(backend.exports.monthlyAllowanceScheduler()).resolves.toBeNull()
    expect(backend.balance()).toBe(1000)
  })
})

describe('資料保留', () => {
  let backend
  const OLD = Date.parse('2026-07-01T04:00:00Z')
  const RECENT = NOON_TAIPEI.getTime() - 60_000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON_TAIPEI)
    backend = createBackend()
    const seed = {
      'orders/old': { timestamp: OLD },
      'orders/recent': { timestamp: RECENT },
      'orders/unpaidCash': { timestamp: OLD },
      'cash_payments/pending': { status: 'pending', orderIds: ['unpaidCash'], createdTimestamp: OLD },
      'cash_payments/collected': { status: 'collected', orderIds: ['old'], createdTimestamp: OLD },
      'cash_payment_logs/pendingLog': { timestamp: OLD, cashPaymentId: 'pending' },
      'cash_payment_logs/collectedLog': { timestamp: OLD, cashPaymentId: 'collected' },
      'wallet_logs/old': { timestamp: OLD },
      'wallet_logs/recent': { timestamp: RECENT },
      'wallet_requests/old': { createdAt: OLD },
      'inviteCodes/OLDCODE': { expiresAt: OLD },
      'dining_days/2026-07-01': {},
      'dining_days/2026-09-06': {},
    }
    Object.entries(seed).forEach(([path, data]) => backend.records.set(path, data))
  })
  afterEach(() => vi.useRealTimers())

  it('預設關閉，不刪任何資料', async () => {
    await expect(backend.exports.retentionScheduler()).resolves.toBeNull()
    expect(backend.records.has('orders/old')).toBe(true)
  })

  it('刪除超過保留天數的紀錄，但保留未收款的現金單與錢包餘額', async () => {
    backend.records.set('settings/system', { retention: { autoDeleteDays: 30 } })
    const result = await backend.exports.retentionScheduler()
    expect(result).toEqual({
      cutoffDate: '2026-08-07',
      orders: 1, cashPayments: 1, cashLogs: 1, walletLogs: 1, walletRequests: 1, inviteCodes: 1, diningDays: 1,
    })
    for (const path of ['orders/old', 'cash_payments/collected', 'cash_payment_logs/collectedLog', 'wallet_logs/old', 'wallet_requests/old', 'inviteCodes/OLDCODE', 'dining_days/2026-07-01']) {
      expect(backend.records.has(path), path).toBe(false)
    }
    for (const path of ['orders/recent', 'orders/unpaidCash', 'cash_payments/pending', 'cash_payment_logs/pendingLog', 'wallet_logs/recent', 'dining_days/2026-09-06']) {
      expect(backend.records.has(path), path).toBe(true)
    }
    expect(backend.balance()).toBe(1000)
    expect(backend.records.get('retention_runs/2026-09-06')).toMatchObject({ cutoffDate: '2026-08-07', orders: 1 })
  })
})

describe('通知', () => {
  let backend
  const today = '2026-09-06'
  const configure = (settings, uid = 'admin') => backend.call('updateNotificationSettings', { settings }, uid)
  const dailyWrite = (before, after) => backend.exports.notifyStoresOpened({
    data: {
      before: { exists: Boolean(before), data: () => before },
      after: { exists: Boolean(after), data: () => after },
    },
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON_TAIPEI)
    backend = createBackend()
  })
  afterEach(() => vi.useRealTimers())

  it('只有管理員能設定，網址必須是 https，提醒分鐘數有範圍', async () => {
    await expect(configure({ webhookUrl: WEBHOOK }, 'member')).rejects.toThrow('需要管理員權限')
    await expect(configure({ webhookUrl: 'http://hooks.example.com/x' })).rejects.toThrow('INVALID_WEBHOOK_URL')
    await expect(configure({ webhookUrl: 'not a url' })).rejects.toThrow('INVALID_WEBHOOK_URL')
    await expect(configure({ reminderMinutes: 2 })).rejects.toThrow('INVALID_NOTIFICATION_SETTINGS')
    await expect(configure({ events: { somethingElse: true } })).rejects.toThrow('INVALID_NOTIFICATION_SETTINGS')
    const result = await configure({ webhookUrl: WEBHOOK, events: { orderingClosed: false }, reminderMinutes: 10 })
    expect(result.settings).toEqual({
      webhookUrl: WEBHOOK,
      events: { storesOpened: true, cutoffReminder: true, orderingClosed: false, storeReplaced: true },
      reminderMinutes: 10,
    })
  })

  it('測試通知送到 webhook 與已註冊的推播裝置', async () => {
    await configure({ webhookUrl: WEBHOOK })
    await backend.call('registerPushToken', { token: 'fictional-device-token' }, 'member')
    const result = await backend.call('sendTestNotification', {})
    expect(result).toEqual({ ok: true, webhook: 'sent', push: 1 })
    expect(backend.webhookCalls).toHaveLength(1)
    expect(backend.webhookCalls[0]).toMatchObject({ url: WEBHOOK, body: { event: 'test', title: '測試通知' } })
    expect(backend.webhookCalls[0].body.text).toContain('測試通知')
    expect(backend.pushes[0].tokens).toEqual(['fictional-device-token'])
  })

  it('webhook 失敗不會讓呼叫失敗', async () => {
    backend = createBackend({ fetch: async () => ({ ok: false, status: 500 }) })
    await configure({ webhookUrl: WEBHOOK })
    await expect(backend.call('sendTestNotification', {})).resolves.toMatchObject({ ok: true, webhook: 'failed' })
  })

  it('推播 token 只能由本人取消註冊', async () => {
    await backend.call('registerPushToken', { token: 'fictional-device-token' }, 'member')
    expect(recordsUnder(backend, 'push_tokens/')).toHaveLength(1)
    await backend.call('unregisterPushToken', { token: 'fictional-device-token' }, 'proxy')
    expect(recordsUnder(backend, 'push_tokens/')).toHaveLength(1)
    await backend.call('unregisterPushToken', { token: 'fictional-device-token' }, 'member')
    expect(recordsUnder(backend, 'push_tokens/')).toHaveLength(0)
    await expect(backend.call('registerPushToken', { token: 'x' }, 'stranger')).rejects.toThrow('需要已註冊使用者權限')
  })

  it('今天第一次開放店家時通知一次，之後增減店家不重複', async () => {
    await configure({ webhookUrl: WEBHOOK })
    backend.records.set('settings/system', { ordering: { defaultCutoff: '12:30' } })
    await dailyWrite({ serviceDate: '2026-09-05', activeStores: ['Old'] }, { serviceDate: today, activeStores: ['Store', 'Cafe'] })
    expect(backend.webhookCalls).toHaveLength(1)
    expect(backend.webhookCalls[0].body).toMatchObject({ event: 'storesOpened', data: { stores: ['Store', 'Cafe'], cutoff: '12:30' } })
    expect(backend.webhookCalls[0].body.body).toContain('Store、Cafe')

    await dailyWrite({ serviceDate: today, activeStores: ['Store'] }, { serviceDate: today, activeStores: ['Store', 'Noodles'] })
    await dailyWrite(null, { serviceDate: today, activeStores: ['Store'] })
    expect(backend.webhookCalls).toHaveLength(1)
  })

  it('收單前提醒一次，收單後送出彙整', async () => {
    await configure({ webhookUrl: WEBHOOK, reminderMinutes: 15 })
    backend.records.set('settings/system', { locale: 'en', ordering: { defaultCutoff: '12:10' } })
    await backend.order()

    await backend.exports.orderingNotificationScheduler()
    await backend.exports.orderingNotificationScheduler()
    expect(backend.webhookCalls.map(call => call.body.event)).toEqual(['cutoffReminder'])
    expect(backend.webhookCalls[0].body.body).toBe('Orders close in 10 min (12:10). Place your order now.')

    vi.setSystemTime(new Date('2026-09-06T04:12:00Z'))
    await backend.exports.orderingNotificationScheduler()
    await backend.exports.orderingNotificationScheduler()
    expect(backend.webhookCalls.map(call => call.body.event)).toEqual(['cutoffReminder', 'orderingClosed'])
    expect(backend.webhookCalls[1].body).toMatchObject({ data: { cutoff: '12:10', orderCount: 1, stores: { Store: 1 } } })
  })

  it('關閉的事件、沒有店家或沒有收單時間時不通知', async () => {
    await configure({ webhookUrl: WEBHOOK, events: { cutoffReminder: false } })
    backend.records.set('settings/system', { ordering: { defaultCutoff: '12:10' } })
    await backend.exports.orderingNotificationScheduler()
    expect(backend.webhookCalls).toHaveLength(0)

    backend.records.set('settings/system', {})
    await configure({ events: { cutoffReminder: true } })
    await backend.exports.orderingNotificationScheduler()
    backend.records.get('settings/daily').activeStores = []
    backend.records.set('settings/system', { ordering: { defaultCutoff: '12:10' } })
    await backend.exports.orderingNotificationScheduler()
    expect(backend.webhookCalls).toHaveLength(0)
  })
})
