// ==========================================
// 系統設定 settings/system。文件或欄位不存在時沿用升級前的行為（台北時區、繁體中文、新台幣、
// 錢包與現金皆可、全體成員可代訂）。後端 functions/index.js 的 normalizeSystemSettings
// 使用相同規則，伺服器端會再驗證一次；兩邊修改時需同步。
// ==========================================

import { normalizeDietaryTags } from './dietaryTags'

export const DEFAULT_TIME_ZONE = 'Asia/Taipei'
export const DEFAULT_LOCALE = 'zh-TW'
export const SUPPORTED_LOCALES = ['zh-TW', 'en']

// 金額一律以最小單位整數儲存；decimals 決定與主單位的換算倍率。新台幣實務上不用角、分，所以是 0。
export const CURRENCIES = [
  { code: 'TWD', symbol: 'NT$', decimals: 0 },
  { code: 'JPY', symbol: '¥', decimals: 0 },
  { code: 'KRW', symbol: '₩', decimals: 0 },
  { code: 'IDR', symbol: 'Rp', decimals: 0 },
  { code: 'VND', symbol: '₫', decimals: 0 },
  { code: 'HKD', symbol: 'HK$', decimals: 2 },
  { code: 'CNY', symbol: 'CN¥', decimals: 2 },
  { code: 'SGD', symbol: 'S$', decimals: 2 },
  { code: 'MYR', symbol: 'RM', decimals: 2 },
  { code: 'THB', symbol: '฿', decimals: 2 },
  { code: 'PHP', symbol: '₱', decimals: 2 },
  { code: 'INR', symbol: '₹', decimals: 2 },
  { code: 'USD', symbol: '$', decimals: 2 },
  { code: 'CAD', symbol: 'CA$', decimals: 2 },
  { code: 'AUD', symbol: 'A$', decimals: 2 },
  { code: 'NZD', symbol: 'NZ$', decimals: 2 },
  { code: 'EUR', symbol: '€', decimals: 2 },
  { code: 'GBP', symbol: '£', decimals: 2 },
  { code: 'CHF', symbol: 'CHF', decimals: 2 },
]
export const currencyInfo = code => CURRENCIES.find(currency => currency.code === code) || CURRENCIES[0]

export const PROXY_ORDERING_MODES = ['all', 'consent', 'admins', 'off']
export const BRAND_ACCENT_IDS = ['persimmon', 'indigo', 'forest', 'plum', 'teal', 'charcoal']
export const MIN_RETENTION_DAYS = 30
export const MAX_RETENTION_DAYS = 3650
export const MAX_EMAIL_DOMAINS = 20
export const MAX_BRAND_NAME_LENGTH = 40
export const ABSOLUTE_MAX_AMOUNT = 100_000_000
export const DEFAULT_BRAND_NAME = 'Office Order'

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const EMAIL_DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export const isTimeOfDay = value => TIME_OF_DAY_PATTERN.test(String(value || ''))

export const defaultLimits = (currency) => {
  if (currency === 'IDR' || currency === 'VND') return { maxItemPrice: 1_000_000, maxTopUp: 5_000_000, lowBalance: 100_000 }
  if (currency === 'KRW') return { maxItemPrice: 100_000, maxTopUp: 500_000, lowBalance: 10_000 }
  if (currency === 'JPY') return { maxItemPrice: 10_000, maxTopUp: 50_000, lowBalance: 1_000 }
  if (currencyInfo(currency).decimals > 0) return { maxItemPrice: 10_000, maxTopUp: 50_000, lowBalance: 1_000 }
  return { maxItemPrice: 10_000, maxTopUp: 10_000, lowBalance: 100 }
}

// 回傳 IANA 標準名稱（例如 asia/taipei → Asia/Taipei）；無效時回傳空字串。
export const canonicalTimeZone = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).resolvedOptions().timeZone
  } catch {
    return ''
  }
}

export const normalizeEmailDomain = (value) => {
  const domain = String(value || '').trim().toLowerCase().replace(/^@/, '')
  return EMAIL_DOMAIN_PATTERN.test(domain) ? domain : ''
}

export const normalizeLogoUrl = (value) => {
  const text = String(value || '').trim()
  if (!text || text.length > 2000) return ''
  try {
    const url = new URL(text)
    if (url.protocol === 'https:') return url.href
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return url.href
  } catch { /* 無效網址 */ }
  return ''
}

const amountOr = (value, fallback, min = 1) =>
  Number.isInteger(value) && value >= min && value <= ABSOLUTE_MAX_AMOUNT ? value : fallback

export const normalizeSystemSettings = (data = {}) => {
  const currency = CURRENCIES.some(item => item.code === data?.currency) ? data.currency : 'TWD'
  const limitDefaults = defaultLimits(currency)
  const retentionDays = data?.retention?.autoDeleteDays
  const domains = Array.isArray(data?.registration?.allowedEmailDomains)
    ? [...new Set(data.registration.allowedEmailDomains.map(normalizeEmailDomain).filter(Boolean))].slice(0, MAX_EMAIL_DOMAINS)
    : []
  return {
    timeZone: canonicalTimeZone(data?.timeZone) || DEFAULT_TIME_ZONE,
    locale: SUPPORTED_LOCALES.includes(data?.locale) ? data.locale : DEFAULT_LOCALE,
    currency,
    limits: {
      maxItemPrice: amountOr(data?.limits?.maxItemPrice, limitDefaults.maxItemPrice),
      maxTopUp: amountOr(data?.limits?.maxTopUp, limitDefaults.maxTopUp),
      lowBalance: amountOr(data?.limits?.lowBalance, limitDefaults.lowBalance, 0),
    },
    // 兩種付款方式都停用代表「只統計訂單、不收款」。
    paymentMethods: { wallet: data?.paymentMethods?.wallet !== false, cash: data?.paymentMethods?.cash !== false },
    proxyOrdering: PROXY_ORDERING_MODES.includes(data?.proxyOrdering) ? data.proxyOrdering : 'all',
    registration: { allowedEmailDomains: domains, googleSignIn: data?.registration?.googleSignIn === true },
    subsidy: {
      monthlyAllowance: amountOr(data?.subsidy?.monthlyAllowance, 0, 0),
      effectiveFrom: MONTH_KEY_PATTERN.test(String(data?.subsidy?.effectiveFrom || '')) ? data.subsidy.effectiveFrom : '',
    },
    retention: {
      autoDeleteDays: Number.isInteger(retentionDays) && retentionDays >= MIN_RETENTION_DAYS && retentionDays <= MAX_RETENTION_DAYS
        ? retentionDays
        : 0,
    },
    branding: {
      name: String(data?.branding?.name || '').trim().slice(0, MAX_BRAND_NAME_LENGTH),
      logoUrl: normalizeLogoUrl(data?.branding?.logoUrl),
      accent: BRAND_ACCENT_IDS.includes(data?.branding?.accent) ? data.branding.accent : 'persimmon',
    },
    ordering: { defaultCutoff: isTimeOfDay(data?.ordering?.defaultCutoff) ? data.ordering.defaultCutoff : '' },
    dietary: { enabled: data?.dietary?.enabled === true, tags: normalizeDietaryTags(data?.dietary?.tags) },
  }
}

export const DEFAULT_SYSTEM_SETTINGS = Object.freeze(normalizeSystemSettings())

// ── 付款模式 ─────────────────────────────────────────────────────────
// 介面以單選呈現四種模式，資料仍存成 paymentMethods 兩個布林值。
export const PAYMENT_MODES = ['both', 'wallet', 'cash', 'none']
export const paymentModeOf = ({ wallet, cash } = {}) => (wallet && cash ? 'both' : wallet ? 'wallet' : cash ? 'cash' : 'none')
export const paymentMethodsForMode = mode => ({ wallet: mode === 'both' || mode === 'wallet', cash: mode === 'both' || mode === 'cash' })
export const isTrackingOnly = settings => !settings?.paymentMethods?.wallet && !settings?.paymentMethods?.cash

// 「需本人同意」模式下一般成員仍可代訂，但對象必須自行開啟授權。
export const canProxyOrder = (settings, isAdmin) =>
  ['all', 'consent'].includes(settings?.proxyOrdering) || (settings?.proxyOrdering === 'admins' && Boolean(isAdmin))

// 代訂某位有帳號的成員：同意模式下需對方開啟授權（管理員不受限）。
export const canProxyOrderFor = (settings, isAdmin, member) => {
  if (!canProxyOrder(settings, isAdmin)) return false
  if (settings?.proxyOrdering !== 'consent' || isAdmin || !member?.uid) return true
  return member.allowProxyOrders === true
}

// 幫自己點餐：有錢包就扣錢包，只收現金時列入應收，兩者皆停用時只統計。
export const selfPaymentMethod = (settings) => {
  if (isTrackingOnly(settings)) return 'none'
  return settings?.paymentMethods?.wallet === false ? 'cash' : 'wallet'
}

// 代訂對象的付款方式；回傳空字串代表此對象在目前設定下無法點餐
// （例如只用錢包時，沒有帳號的成員或手動輸入的姓名沒有可用的付款方式）。
export const memberPaymentMethod = (settings, hasAccount) => {
  if (isTrackingOnly(settings)) return 'none'
  const { wallet, cash } = settings?.paymentMethods || DEFAULT_SYSTEM_SETTINGS.paymentMethods
  if (hasAccount && wallet) return 'wallet'
  return cash ? 'cash' : ''
}

// 時區選單：瀏覽器支援時列出完整 IANA 清單，否則退回常用時區。
const COMMON_TIME_ZONES = [
  'UTC', 'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore',
  'Asia/Bangkok', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
  'Australia/Sydney', 'Pacific/Auckland',
]

export const listTimeZones = (...required) => {
  let zones = COMMON_TIME_ZONES
  try {
    if (typeof Intl.supportedValuesOf === 'function') zones = Intl.supportedValuesOf('timeZone')
  } catch { /* 使用常用清單 */ }
  return [...new Set([...required.map(canonicalTimeZone).filter(Boolean), ...zones])].sort()
}

export const browserTimeZone = () => {
  try {
    return canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) || DEFAULT_TIME_ZONE
  } catch {
    return DEFAULT_TIME_ZONE
  }
}
