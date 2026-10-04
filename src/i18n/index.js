// ==========================================
// 介面多語系。語言優先順序：使用者自己的選擇（存在此裝置）→ 系統預設語言
// （settings/system.locale，登入前由公開設定提供）→ 繁體中文。
// 元件與工具函式直接 import { t }，不需要在每個元件註冊 i18n plugin，測試也能直接渲染。
// 新增語言：複製 locales/en 成新資料夾、翻譯後加進下方 SUPPORTED_LOCALES 與 messages。
// ==========================================
import { computed, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import zhTW from './locales/zh-TW'
import en from './locales/en'
import { readStorage, removeStorage, writeStorage } from '../utils/storage'
import { setFormatLocale } from '../utils/format'
import { DEFAULT_LOCALE } from '../utils/systemSettings'

export const SUPPORTED_LOCALES = [
  { value: 'zh-TW', label: '繁體中文', htmlLang: 'zh-Hant' },
  { value: 'en', label: 'English', htmlLang: 'en' },
]

const USER_LOCALE_KEY = 'userLocale'
const isSupported = locale => SUPPORTED_LOCALES.some(option => option.value === locale)

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: { 'zh-TW': zhTW, en },
  missingWarn: false,
  fallbackWarn: false,
})

const systemLocale = ref(DEFAULT_LOCALE)
const storedUserLocale = readStorage(USER_LOCALE_KEY)
const userLocale = ref(isSupported(storedUserLocale) ? storedUserLocale : '')

/** 目前實際使用的語言。 */
export const currentLocale = computed(() => userLocale.value || systemLocale.value)
/** 使用者在此裝置的選擇；空字串代表跟隨系統預設。 */
export const userLocalePreference = computed(() => userLocale.value)

const applyLocale = () => {
  const locale = currentLocale.value
  i18n.global.locale.value = locale
  setFormatLocale(locale)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = SUPPORTED_LOCALES.find(option => option.value === locale)?.htmlLang || locale
  }
}

// 啟動時就套用此裝置記住的語言；之後系統預設語言載入時，使用者的選擇仍優先。
applyLocale()

export const setSystemLocale = (locale) => {
  if (!isSupported(locale) || systemLocale.value === locale) return
  systemLocale.value = locale
  applyLocale()
}

export const setUserLocale = (locale) => {
  userLocale.value = isSupported(locale) ? locale : ''
  if (userLocale.value) writeStorage(USER_LOCALE_KEY, userLocale.value)
  else removeStorage(USER_LOCALE_KEY)
  applyLocale()
}

// 英文訊息可寫成「單數 | 複數」兩種形式（例如 '{count} item | {count} items'），
// 呼叫時只要在參數裡帶 count，這裡就會自動選擇正確的形式；繁中訊息沒有複數形式，照常顯示。
const pluralCount = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^[\d.,\s]+$/.test(value.trim())) return Number(value.replace(/[^\d.]/g, ''))
  return null
}
const hasPluralForms = (key) => {
  const source = i18n.global.tm(key)
  return typeof source === 'string' && source.includes(' | ')
}
export const t = (...args) => {
  const [key, named] = args
  if (args.length === 2 && named && typeof named === 'object') {
    const count = pluralCount(named.count)
    if (count !== null && hasPluralForms(key)) return i18n.global.t(key, named, count)
  }
  return i18n.global.t(...args)
}
export const te = key => i18n.global.te(key)

/**
 * 把 Cloud Functions 的錯誤轉成目前語言的訊息。後端以錯誤代碼（例如 ORDERING_CLOSED）
 * 或舊版中文訊息回傳，兩種都在 errors 底下對照；找不到時使用 fallbackKey。
 */
export const translateError = (error, fallbackKey = 'errors.generic') => {
  const message = String(error?.message || '').trim()
  if (/^[A-Z0-9_]+$/.test(message) && te(`errors.${message}`)) return t(`errors.${message}`)
  const legacyKey = LEGACY_SERVER_MESSAGES[message]
  if (legacyKey) return t(`errors.${legacyKey}`)
  const code = String(error?.code || '').replace(/^functions\//, '')
  if (code === 'unavailable' || code === 'deadline-exceeded') return t('errors.network')
  return t(fallbackKey)
}

// 後端早期以中文回傳的錯誤訊息，對應到 errors 底下的代碼。
const LEGACY_SERVER_MESSAGES = {
  '請先登入': 'UNAUTHENTICATED',
  '需要管理員權限': 'ADMIN_REQUIRED',
  '需要已註冊使用者權限': 'REGISTRATION_REQUIRED',
  '購物車是空的': 'CART_EMPTY',
  '訂單資料不完整': 'ORDER_INCOMPLETE',
  '店家已更換，請重新選擇餐點': 'STORE_REPLACED',
  '補點狀態已更新，請重新整理名單': 'REORDER_STALE',
  '補點狀態已更新': 'REORDER_STALE',
  '補點店家尚未開放': 'REORDER_STORE_CLOSED',
  '換店設定格式錯誤': 'STORE_CHANGE_INVALID',
  '請選擇不同的新店家': 'STORE_CHANGE_SAME',
  '缺少訂單': 'ORDER_MISSING',
  '換店不可指定個別訂單': 'STORE_CHANGE_INVALID',
  '店家設定格式錯誤': 'STORE_CHANGE_INVALID',
  '免費店家必須是今日店家': 'FREE_STORE_INVALID',
  '只有管理員可以設定免費店家': 'FREE_STORE_ADMIN_ONLY',
  '今日店家已更新，請重新開啟設定後再試': 'DAILY_STORES_CHANGED',
  '今日店家尚未設定': 'DAILY_STORES_MISSING',
  '不可選擇今日已停用店家': 'STORE_REPLACED',
  '此店家已更換，請重新整理': 'STORE_REPLACED',
  '換店與今日店家設定不一致': 'DAILY_STORES_CHANGED',
  '新店家不存在': 'STORE_NOT_FOUND',
  '移除的店家已有訂單或待補點人員，請重新確認接替店家': 'STORE_HAS_ORDERS',
  '換店訂單超過單次上限 100 筆': 'TOO_MANY_ORDERS',
  '沒有需要換店的訂單或補點人員': 'NOTHING_TO_REPLACE',
  '缺少現金單': 'CASH_PAYMENT_NOT_FOUND',
  '缺少現金單或原因': 'CASH_CANCEL_REASON_REQUIRED',
  '日期時間區間不正確': 'INVALID_RANGE',
  '單次清理區間不可超過 31 天': 'RANGE_TOO_LONG',
  '確認文字不正確': 'CONFIRMATION_MISMATCH',
  '清理區間未涵蓋關聯訂單，請調整區間後重新預覽': 'CLEANUP_LINKED_ORDERS',
}
