import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from './helpers/backend'

// 2026-09-06 04:00 UTC＝台北中午 12:00。
const NOON_TAIPEI = new Date('2026-09-06T04:00:00Z')

describe('代訂需本人同意', () => {
  let backend
  const setSystem = data => backend.records.set('settings/system', data)
  const proxyOrder = (uid = 'member') => backend.order({ ownerUid: 'proxy', ownerName: 'proxy' }, uid)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON_TAIPEI)
    backend = createBackend()
    setSystem({ proxyOrdering: 'consent' })
  })
  afterEach(() => vi.useRealTimers())

  it('對方尚未授權時一般成員不能代訂，授權後即可', async () => {
    await expect(proxyOrder()).rejects.toThrow('PROXY_CONSENT_REQUIRED')
    expect(backend.records.get('wallets/proxy').balance).toBe(1000)

    await expect(backend.call('updateMyPreferences', { allowProxyOrders: true }, 'proxy')).resolves.toEqual({ ok: true, allowProxyOrders: true })
    expect(backend.records.get('users/proxy').allowProxyOrders).toBe(true)
    expect(backend.records.get('member_roster/proxy')).toEqual({ uid: 'proxy', name: 'proxy', allowProxyOrders: true })

    await proxyOrder()
    expect(backend.records.get('wallets/proxy').balance).toBe(900)

    await backend.call('updateMyPreferences', { allowProxyOrders: false }, 'proxy')
    await expect(proxyOrder()).rejects.toThrow('PROXY_CONSENT_REQUIRED')
  })

  it('管理員代訂與手動輸入姓名的現金單不需要授權', async () => {
    await proxyOrder('admin')
    expect(backend.records.get('wallets/proxy').balance).toBe(900)
    await backend.order({ ownerUid: '', ownerName: 'Guest', paymentMethod: 'cash' })
    expect([...backend.records.keys()].some(path => path.startsWith('cash_payments/'))).toBe(true)
  })

  it('偏好設定只接受布林值，且必須是已註冊成員', async () => {
    await expect(backend.call('updateMyPreferences', { allowProxyOrders: 'yes' }, 'proxy')).rejects.toThrow('INVALID_PREFERENCES')
    await expect(backend.call('updateMyPreferences', { allowProxyOrders: true }, 'stranger')).rejects.toThrow('需要已註冊使用者權限')
  })
})

describe('收單時間', () => {
  let backend
  const setSystem = data => backend.records.set('settings/system', data)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON_TAIPEI)
    backend = createBackend()
  })
  afterEach(() => vi.useRealTimers())

  it('超過系統預設的收單時間後，一般成員不能下單或取消，管理員不受限', async () => {
    setSystem({ ordering: { defaultCutoff: '13:00' } })
    const orderId = await backend.order()
    expect(backend.balance()).toBe(900)

    setSystem({ ordering: { defaultCutoff: '11:30' } })
    await expect(backend.order()).rejects.toThrow('ORDERING_CLOSED')
    await expect(backend.call('cancelOrdersWithWalletRefund', { orderIds: [orderId] }, 'member')).rejects.toThrow('ORDERING_CLOSED')
    expect(backend.balance()).toBe(900)

    await backend.order({ ownerUid: 'admin', ownerName: 'Admin', paymentMethod: 'cash' }, 'admin')
    await backend.call('cancelOrdersWithWalletRefund', { orderIds: [orderId] }, 'admin')
    expect(backend.balance()).toBe(1000)
  })

  it('沒有設定收單時間時不限制', async () => {
    await backend.order()
    expect(backend.balance()).toBe(900)
  })

  it('管理員可調整今天的收單時間：不截止、立即收單、恢復預設', async () => {
    setSystem({ ordering: { defaultCutoff: '11:30' } })
    await expect(backend.order()).rejects.toThrow('ORDERING_CLOSED')

    await expect(backend.call('setDailyCutoff', { time: '' })).resolves.toEqual({ ok: true, cutoffTime: '' })
    expect(backend.records.get('settings/daily').cutoff).toMatchObject({ date: '2026-09-06', time: '', updatedByUid: 'admin' })
    await backend.order()

    await expect(backend.call('setDailyCutoff', { time: 'now' })).resolves.toEqual({ ok: true, cutoffTime: '12:00' })
    await expect(backend.order()).rejects.toThrow('ORDERING_CLOSED')

    await backend.call('setDailyCutoff', { time: '14:00' })
    await backend.order()

    await expect(backend.call('setDailyCutoff', { time: null })).resolves.toEqual({ ok: true, cutoffTime: '11:30' })
    await expect(backend.order()).rejects.toThrow('ORDERING_CLOSED')
    // 原本的開放店家等今日設定不受影響
    expect(backend.records.get('settings/daily').activeStores).toEqual(['Store'])
  })

  it('昨天留下的調整不會套用到今天', async () => {
    setSystem({ ordering: { defaultCutoff: '11:30' } })
    backend.records.get('settings/daily').cutoff = { date: '2026-09-05', time: '' }
    await expect(backend.order()).rejects.toThrow('ORDERING_CLOSED')
  })

  it('只有管理員能調整，格式錯誤時拒絕', async () => {
    await expect(backend.call('setDailyCutoff', { time: '' }, 'member')).rejects.toThrow('需要管理員權限')
    await expect(backend.call('setDailyCutoff', { time: '25:00' })).rejects.toThrow('INVALID_CUTOFF_TIME')
    await expect(backend.call('setDailyCutoff', { time: 'later' })).rejects.toThrow('INVALID_CUTOFF_TIME')
  })

  it('收單時間依系統時區計算', async () => {
    // 東京已是 13:00，11:30 的收單已過；台北才 12:00，若用台北時間 12:30 仍可下單。
    setSystem({ timeZone: 'Asia/Tokyo', ordering: { defaultCutoff: '12:30' } })
    await expect(backend.order()).rejects.toThrow('ORDERING_CLOSED')
  })
})

describe('公司信箱自助註冊', () => {
  let backend
  const register = (memberName, token = {}, uid = 'newbie') => backend.call('completeDomainRegistration', { memberName }, uid, {
    email: 'new.person@Example.com',
    email_verified: true,
    ...token,
  })

  beforeEach(() => {
    backend = createBackend()
    backend.records.set('settings/system', { registration: { allowedEmailDomains: ['example.com'] } })
  })

  it('允許的網域且已驗證信箱即可成為成員', async () => {
    await expect(register('  New   Person ')).resolves.toEqual({ ok: true, memberName: 'New Person' })
    expect(backend.records.get('users/newbie')).toMatchObject({
      email: 'new.person@example.com',
      memberName: 'New Person',
      isAdmin: false,
      registeredVia: 'email_domain',
    })
    expect(backend.records.get('member_roster/newbie')).toEqual({ uid: 'newbie', name: 'New Person' })
    await expect(register('Again')).rejects.toThrow('PROFILE_EXISTS')
  })

  it('網域不在名單、信箱未驗證、姓名重複或空白時拒絕', async () => {
    await expect(register('A', { email: 'someone@other.org' })).rejects.toThrow('EMAIL_DOMAIN_NOT_ALLOWED')
    await expect(register('A', { email: 'someone@sub.example.com' })).rejects.toThrow('EMAIL_DOMAIN_NOT_ALLOWED')
    await expect(register('A', { email_verified: false })).rejects.toThrow('EMAIL_NOT_VERIFIED')
    await expect(register('MEMBER')).rejects.toThrow('MEMBER_NAME_TAKEN')
    await expect(register('   ')).rejects.toThrow('INVALID_MEMBER_NAME')
    expect(backend.records.has('users/newbie')).toBe(false)
  })

  it('沒有設定允許網域時停用', async () => {
    backend.records.set('settings/system', {})
    await expect(register('A')).rejects.toThrow('EMAIL_DOMAIN_NOT_ALLOWED')
  })
})

describe('登入前的公開設定', () => {
  it('只回傳品牌、語系與註冊方式，不需登入', async () => {
    const backend = createBackend()
    backend.records.set('settings/system', {
      locale: 'en',
      currency: 'USD',
      branding: { name: 'Example Corp Lunch', accent: 'indigo' },
      registration: { allowedEmailDomains: ['example.com'], googleSignIn: true },
      subsidy: { monthlyAllowance: 5000, effectiveFrom: '2026-09' },
    })
    const config = await backend.callAnonymous('getPublicConfig', {})
    expect(config).toEqual({
      locale: 'en',
      branding: { name: 'Example Corp Lunch', logoUrl: '', accent: 'indigo' },
      registration: { allowedEmailDomains: ['example.com'], googleSignIn: true },
      needsSetup: false,
      setupEnabled: false,
    })
  })
})
