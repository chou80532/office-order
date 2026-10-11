import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SYSTEM_SETTINGS,
  canProxyOrder,
  canonicalTimeZone,
  isTrackingOnly,
  listTimeZones,
  memberPaymentMethod,
  normalizeSystemSettings,
  selfPaymentMethod,
} from './systemSettings'

describe('normalizeSystemSettings', () => {
  it('缺少文件時沿用升級前的行為（台北時區、新台幣、全體可代訂、兩種付款皆可）', () => {
    expect(normalizeSystemSettings()).toEqual({
      timeZone: 'Asia/Taipei',
      locale: 'zh-TW',
      currency: 'TWD',
      limits: { maxItemPrice: 10_000, maxTopUp: 10_000, lowBalance: 100 },
      paymentMethods: { wallet: true, cash: true },
      proxyOrdering: 'all',
      registration: { allowedEmailDomains: [], googleSignIn: false },
      subsidy: { monthlyAllowance: 0, effectiveFrom: '' },
      retention: { autoDeleteDays: 0 },
      branding: { name: '', logoUrl: '', accent: 'persimmon' },
      ordering: { defaultCutoff: '' },
      dietary: { enabled: false, tags: [] },
    })
    expect(DEFAULT_SYSTEM_SETTINGS).toEqual(normalizeSystemSettings({}))
  })

  it('無效值退回預設', () => {
    expect(normalizeSystemSettings({
      timeZone: 'Mars/Base',
      locale: 'tlh',
      currency: 'XYZ',
      limits: { maxItemPrice: -1, maxTopUp: 1.5, lowBalance: 'a lot' },
      proxyOrdering: 'everyone',
      registration: { allowedEmailDomains: ['not a domain'], googleSignIn: 'yes' },
      subsidy: { monthlyAllowance: -100, effectiveFrom: '2026-13' },
      retention: { autoDeleteDays: 7 },
      branding: { logoUrl: 'javascript:alert(1)', accent: 'neon' },
      ordering: { defaultCutoff: '25:00' },
    })).toEqual(DEFAULT_SYSTEM_SETTINGS)
  })

  it('兩種付款方式都停用代表只統計訂單、不收款', () => {
    const settings = normalizeSystemSettings({ paymentMethods: { wallet: false, cash: false } })
    expect(settings.paymentMethods).toEqual({ wallet: false, cash: false })
    expect(isTrackingOnly(settings)).toBe(true)
    expect(isTrackingOnly(DEFAULT_SYSTEM_SETTINGS)).toBe(false)
  })

  it('保留有效設定並轉成標準時區名稱；金額上限預設值依幣別', () => {
    expect(normalizeSystemSettings({
      timeZone: 'america/new_york',
      locale: 'en',
      currency: 'USD',
      paymentMethods: { wallet: false },
      proxyOrdering: 'admins',
      registration: { allowedEmailDomains: ['@Example.COM', 'example.com'] },
      retention: { autoDeleteDays: 90 },
    })).toMatchObject({
      timeZone: 'America/New_York',
      locale: 'en',
      currency: 'USD',
      limits: { maxItemPrice: 10_000, maxTopUp: 50_000, lowBalance: 1_000 },
      paymentMethods: { wallet: false, cash: true },
      proxyOrdering: 'admins',
      registration: { allowedEmailDomains: ['example.com'] },
      retention: { autoDeleteDays: 90 },
    })
  })
})

describe('canonicalTimeZone', () => {
  it('拒絕空值、非字串與不存在的時區', () => {
    expect(canonicalTimeZone('')).toBe('')
    expect(canonicalTimeZone(null)).toBe('')
    expect(canonicalTimeZone('Not/AZone')).toBe('')
    expect(canonicalTimeZone('UTC')).toBe('UTC')
  })
})

describe('代訂與付款規則', () => {
  const settings = (patch) => normalizeSystemSettings(patch)

  it('canProxyOrder 依規則與管理員身分判斷', () => {
    expect(canProxyOrder(settings({ proxyOrdering: 'all' }), false)).toBe(true)
    expect(canProxyOrder(settings({ proxyOrdering: 'admins' }), false)).toBe(false)
    expect(canProxyOrder(settings({ proxyOrdering: 'admins' }), true)).toBe(true)
    expect(canProxyOrder(settings({ proxyOrdering: 'off' }), true)).toBe(false)
  })

  it('停用錢包時本人與有帳號的成員都改用現金', () => {
    const cashOnly = settings({ paymentMethods: { wallet: false, cash: true } })
    expect(selfPaymentMethod(cashOnly)).toBe('cash')
    expect(memberPaymentMethod(cashOnly, true)).toBe('cash')
    expect(memberPaymentMethod(cashOnly, false)).toBe('cash')
  })

  it('停用現金時，沒有帳號的人沒有可用的付款方式', () => {
    const walletOnly = settings({ paymentMethods: { wallet: true, cash: false } })
    expect(selfPaymentMethod(walletOnly)).toBe('wallet')
    expect(memberPaymentMethod(walletOnly, true)).toBe('wallet')
    expect(memberPaymentMethod(walletOnly, false)).toBe('')
  })
})

describe('listTimeZones', () => {
  it('一定包含指定的時區，且排序、不重複', () => {
    const zones = listTimeZones('UTC', 'Asia/Taipei', 'asia/taipei')
    expect(zones).toContain('UTC')
    expect(zones).toContain('Asia/Taipei')
    expect(zones.filter(zone => zone === 'Asia/Taipei')).toHaveLength(1)
    expect([...zones].sort()).toEqual(zones)
  })
})
