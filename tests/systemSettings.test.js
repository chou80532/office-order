import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from './helpers/backend'

const SETUP_TOKEN = 'fictional-setup-token-0123456789'
const dateKeyIn = (timeZone, date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

describe('系統設定：代訂與付款方式', () => {
  let backend
  const setSystem = (data) => backend.records.set('settings/system', data)
  const proxyOrder = (uid) => backend.order({ ownerUid: 'proxy', ownerName: 'proxy' }, uid)
  const manualCashOrder = (uid = 'member') => backend.order({ ownerUid: '', ownerName: 'Guest', paymentMethod: 'cash' }, uid)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T04:00:00Z'))
    backend = createBackend()
  })
  afterEach(() => vi.useRealTimers())

  it('沒有 settings/system 時維持原本行為：全體可代訂、錢包與現金皆可', async () => {
    await proxyOrder('member')
    expect(backend.records.get('wallets/proxy').balance).toBe(900)
    await manualCashOrder()
    expect([...backend.records.keys()].some(path => path.startsWith('cash_payments/'))).toBe(true)
  })

  it('僅管理員可代訂：一般成員被拒，本人點餐與管理員代訂不受影響', async () => {
    setSystem({ proxyOrdering: 'admins' })
    await expect(proxyOrder('member')).rejects.toThrow('PROXY_ORDERING_DISABLED')
    await expect(manualCashOrder()).rejects.toThrow('PROXY_ORDERING_DISABLED')
    expect(backend.records.get('wallets/proxy').balance).toBe(1000)

    await backend.order()
    expect(backend.balance()).toBe(900)
    await proxyOrder('admin')
    expect(backend.records.get('wallets/proxy').balance).toBe(900)
  })

  it('關閉代訂時連管理員也只能幫自己點', async () => {
    setSystem({ proxyOrdering: 'off' })
    await expect(proxyOrder('admin')).rejects.toThrow('PROXY_ORDERING_DISABLED')
    await backend.order()
    expect(backend.balance()).toBe(900)
  })

  it('停用錢包時拒絕錢包付款，本人可改用現金', async () => {
    setSystem({ paymentMethods: { wallet: false, cash: true } })
    await expect(backend.order()).rejects.toThrow('PAYMENT_METHOD_DISABLED')
    await backend.order({ paymentMethod: 'cash' })
    expect(backend.balance()).toBe(1000)
    const payment = [...backend.records.entries()].find(([path]) => path.startsWith('cash_payments/'))[1]
    expect(payment).toMatchObject({ ownerUid: 'member', amount: 100, status: 'pending' })
  })

  it('停用現金時拒絕手動姓名的現金單', async () => {
    setSystem({ paymentMethods: { wallet: true, cash: false } })
    await expect(manualCashOrder()).rejects.toThrow('PAYMENT_METHOD_DISABLED')
    await backend.order()
    expect(backend.balance()).toBe(900)
  })

  it('兩種付款方式都停用時只統計訂單：不扣錢包、不建立現金應收', async () => {
    setSystem({ paymentMethods: { wallet: false, cash: false } })
    await expect(backend.order()).rejects.toThrow('PAYMENT_METHOD_DISABLED')
    await backend.order({ paymentMethod: 'none' })
    expect(backend.balance()).toBe(1000)
    expect([...backend.records.keys()].some(path => path.startsWith('cash_payments/'))).toBe(false)
    const order = [...backend.records.entries()].find(([path]) => path.startsWith('orders/'))[1]
    expect(order).toMatchObject({ paymentMethod: 'none', price: 100 })
  })

  it('有啟用付款方式時不接受「不收款」的訂單', async () => {
    await expect(backend.order({ paymentMethod: 'none' })).rejects.toThrow('PAYMENT_METHOD_DISABLED')
    expect(backend.balance()).toBe(1000)
  })

  it('已成功的重送請求不受之後的設定變更影響', async () => {
    const data = {
      requestId: 'same-request',
      items: [{ name: 'Meal', price: 100, ownerUid: 'proxy', ownerName: 'proxy', paymentMethod: 'wallet', storeName: 'Store' }],
    }
    const first = await backend.call('createOrdersWithWalletDebit', data, 'member')
    setSystem({ proxyOrdering: 'off' })
    const retry = await backend.call('createOrdersWithWalletDebit', data, 'member')
    expect(retry).toMatchObject({ duplicate: true, orderIds: first.orderIds })
  })
})

describe('系統設定：時區', () => {
  let backend
  beforeEach(() => {
    vi.useFakeTimers()
    // UTC 11:30：台北已是隔天 19:30，UTC-12 仍是前一天 23:30。
    vi.setSystemTime(new Date('2026-09-06T11:30:00Z'))
    backend = createBackend()
  })
  afterEach(() => vi.useRealTimers())

  it('預設以台北日期記錄用餐名單', async () => {
    await backend.order()
    expect(backend.records.has('dining_days/2026-09-06')).toBe(true)
  })

  it('改用其他時區後，用餐名單與換日依該時區的日期', async () => {
    backend.records.set('settings/system', { timeZone: 'Etc/GMT+12' })
    expect(dateKeyIn('Etc/GMT+12')).toBe('2026-09-05')
    await backend.order()
    expect(backend.records.has('dining_days/2026-09-05')).toBe(true)
    expect(backend.records.has('dining_days/2026-09-06')).toBe(false)
  })

  it('無效時區退回台北，不影響點餐', async () => {
    backend.records.set('settings/system', { timeZone: 'Mars/Olympus_Mons' })
    await backend.order()
    expect(backend.records.has('dining_days/2026-09-06')).toBe(true)
  })
})

describe('updateSystemSettings', () => {
  let backend
  const update = (settings, uid = 'admin') => backend.call('updateSystemSettings', { settings }, uid)
  beforeEach(() => { backend = createBackend() })

  it('只有管理員可以修改', async () => {
    await expect(update({ proxyOrdering: 'off' }, 'member')).rejects.toThrow('需要管理員權限')
    expect(backend.records.has('settings/system')).toBe(false)
  })

  it('儲存標準化後的設定，未提供的欄位保留原值', async () => {
    const result = await update({ timeZone: 'asia/tokyo' })
    expect(result.settings).toMatchObject({ timeZone: 'Asia/Tokyo', currency: 'TWD', paymentMethods: { wallet: true, cash: true }, proxyOrdering: 'all' })
    await update({ proxyOrdering: 'admins' })
    expect(backend.records.get('settings/system')).toMatchObject({
      timeZone: 'Asia/Tokyo',
      proxyOrdering: 'admins',
      paymentMethods: { wallet: true, cash: true },
      updatedByUid: 'admin',
      updatedByName: 'Admin',
    })
  })

  it.each([
    [{ timeZone: 'Not/AZone' }, 'INVALID_TIME_ZONE'],
    [{ paymentMethods: { wallet: 'yes', cash: true } }, 'INVALID_PAYMENT_METHODS'],
    [{ currency: 'XYZ' }, 'INVALID_CURRENCY'],
    [{ locale: 'tlh' }, 'INVALID_LOCALE'],
    [{ limits: { maxItemPrice: 0 } }, 'INVALID_LIMITS'],
    [{ retention: { autoDeleteDays: 7 } }, 'INVALID_RETENTION_DAYS'],
    [{ registration: { allowedEmailDomains: ['not a domain'] } }, 'INVALID_EMAIL_DOMAIN'],
    [{ branding: { logoUrl: 'javascript:alert(1)' } }, 'INVALID_BRANDING'],
    [{ ordering: { defaultCutoff: '25:00' } }, 'INVALID_CUTOFF_TIME'],
    [{ proxyOrdering: 'everyone' }, 'INVALID_PROXY_ORDERING'],
    [null, 'INVALID_SYSTEM_SETTINGS'],
  ])('拒絕無效設定 %j', async (settings, code) => {
    await expect(update(settings)).rejects.toThrow(code)
    expect(backend.records.has('settings/system')).toBe(false)
  })
})

describe('首次部署初始化', () => {
  const freshBackend = (env) => {
    const backend = createBackend({ env })
    // 模擬全新部署：移除測試預設的管理員。
    backend.records.delete('users/admin')
    return backend
  }
  const setup = (backend, data = {}, uid = 'founder') => backend.call('completeFirstAdminSetup', {
    setupToken: SETUP_TOKEN,
    memberName: '  總務  小林 ',
    settings: { timeZone: 'Europe/London', paymentMethods: { wallet: false, cash: true }, proxyOrdering: 'admins' },
    ...data,
  }, uid)

  it('已有管理員時不需要初始化，也無法再次初始化', async () => {
    const backend = createBackend({ env: { SETUP_TOKEN } })
    await expect(backend.callAnonymous('getSetupStatus', {})).resolves.toEqual({ needsSetup: false, setupEnabled: false })
    await expect(setup(backend)).rejects.toThrow('SETUP_ALREADY_COMPLETED')
    expect(backend.records.has('users/founder')).toBe(false)
  })

  it('未設定或 token 太短時停用初始化', async () => {
    for (const env of [{}, { SETUP_TOKEN: 'short-token' }]) {
      const backend = freshBackend(env)
      await expect(backend.callAnonymous('getSetupStatus', {})).resolves.toEqual({ needsSetup: true, setupEnabled: false })
      await expect(setup(backend, { setupToken: env.SETUP_TOKEN })).rejects.toThrow('SETUP_DISABLED')
    }
  })

  it('token 錯誤或未登入時拒絕', async () => {
    const backend = freshBackend({ SETUP_TOKEN })
    await expect(setup(backend, { setupToken: `${SETUP_TOKEN}x` })).rejects.toThrow('INVALID_SETUP_TOKEN')
    await expect(backend.callAnonymous('completeFirstAdminSetup', { setupToken: SETUP_TOKEN, memberName: 'X' })).rejects.toThrow('請先登入')
    expect(backend.records.has('users/founder')).toBe(false)
  })

  it('建立第一位管理員與系統設定，之後立即關閉初始化', async () => {
    const backend = freshBackend({ SETUP_TOKEN })
    await expect(backend.callAnonymous('getSetupStatus', {})).resolves.toEqual({ needsSetup: true, setupEnabled: true })

    const result = await setup(backend)
    expect(result).toMatchObject({ ok: true, memberName: '總務 小林' })
    expect(backend.records.get('users/founder')).toMatchObject({ memberName: '總務 小林', isAdmin: true })
    expect(backend.records.get('member_roster/founder')).toEqual({ uid: 'founder', name: '總務 小林' })
    expect(backend.records.get('wallets/founder')).toMatchObject({ ownerUid: 'founder', balance: 0 })
    expect(backend.records.get('settings/system')).toMatchObject({
      timeZone: 'Europe/London',
      paymentMethods: { wallet: false, cash: true },
      proxyOrdering: 'admins',
    })
    expect(backend.records.has('settings/setup')).toBe(true)
    const nameKey = backend.records.get('users/founder').memberNameKey
    expect(backend.records.get(`member_name_keys/${nameKey}`)).toMatchObject({ uid: 'founder' })

    await expect(backend.callAnonymous('getSetupStatus', {})).resolves.toEqual({ needsSetup: false, setupEnabled: false })
    await expect(setup(backend, { memberName: 'Intruder' }, 'intruder')).rejects.toThrow('SETUP_ALREADY_COMPLETED')
    expect(backend.records.has('users/intruder')).toBe(false)
  })

  it('沒有提供設定時套用預設值；姓名與設定格式錯誤時拒絕', async () => {
    const backend = freshBackend({ SETUP_TOKEN })
    await expect(setup(backend, { memberName: '   ' })).rejects.toThrow('INVALID_MEMBER_NAME')
    await expect(setup(backend, { settings: { timeZone: 'Nowhere/City' } })).rejects.toThrow('INVALID_TIME_ZONE')
    await setup(backend, { settings: undefined })
    expect(backend.records.get('settings/system')).toMatchObject({
      timeZone: 'Asia/Taipei',
      paymentMethods: { wallet: true, cash: true },
      proxyOrdering: 'all',
    })
  })
})
