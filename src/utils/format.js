// ==========================================
// 格式化工具函式
// 所有「日期邊界」一律以系統時區（settings/system.timeZone，預設 Asia/Taipei）計算，
// 與 Cloud Functions 的帳務日界一致，避免裝置時區不同造成「今日」錯亂。
// 名稱含 Taipei 的函式沿用舊名以維持相容，實際使用的是系統時區。
// ==========================================
import { DEFAULT_LOCALE, DEFAULT_TIME_ZONE, canonicalTimeZone, currencyInfo } from './systemSettings'

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

let appTimeZone = DEFAULT_TIME_ZONE
let appCurrency = currencyInfo('TWD')
// 介面語系對應的 Intl locale；日期、時間與排序都跟著介面語言。
let intlLocale = DEFAULT_LOCALE
const formatters = new Map()

/** 由 i18n 在切換語言時呼叫。 */
export const setFormatLocale = (locale) => {
  intlLocale = locale === 'en' ? 'en-US' : DEFAULT_LOCALE
}
export const getFormatLocale = () => intlLocale

/** 依目前介面語系比較文字（排序店家、成員等名稱用）。 */
export const compareText = (a, b, options) =>
  String(a || '').localeCompare(String(b || ''), intlLocale, options)

/** 目前的系統時區（IANA 名稱）。 */
export const getAppTimeZone = () => appTimeZone

/**
 * 切換系統時區；無效值退回預設時區。回傳時區是否真的改變，
 * 呼叫端據此決定是否重新整理「今日」相關資料。
 */
export const setAppTimeZone = (timeZone) => {
  const next = canonicalTimeZone(timeZone) || DEFAULT_TIME_ZONE
  if (next === appTimeZone) return false
  appTimeZone = next
  return true
}

const zonedFormatter = (key, locale, options) => {
  const cacheKey = `${appTimeZone}|${key}`
  if (!formatters.has(cacheKey)) {
    formatters.set(cacheKey, new Intl.DateTimeFormat(locale, { ...options, timeZone: appTimeZone }))
  }
  return formatters.get(cacheKey)
}

const getZonedParts = (date = new Date()) => Object.fromEntries(
  zonedFormatter('parts', 'en-US', {
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)])
)

/**
 * 將系統時區的牆上時間轉為時間戳。月、日超出範圍時依 Date.UTC 規則進位，
 * 並修正兩次時差以涵蓋日光節約時間切換。
 */
const zonedWallTimeToMs = (year, month, day, hour = 0, minute = 0) => {
  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute)
  const offsetAt = (timestamp) => {
    const parts = getZonedParts(new Date(timestamp))
    const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    return zonedAsUtc - Math.floor(timestamp / 1000) * 1000
  }
  return wallClockMs - offsetAt(wallClockMs - offsetAt(wallClockMs))
}

const pad2 = value => String(value).padStart(2, '0')

/**
 * 格式化時間戳為 HH:mm（僅時間）
 */
export const formatTimeShort = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleString(intlLocale, {
    timeZone: appTimeZone,
    hour: '2-digit', minute: '2-digit', hour12: false
  })
}

/**
 * 格式化時間戳為 M/D HH:mm（含日期）
 */
export const formatTimeWithDate = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleString(intlLocale, {
    timeZone: appTimeZone,
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  })
}

/**
 * 智慧格式化：今天只顯示時間，其他日期顯示 M/D HH:mm
 */
export const formatTimeSmart = (ts) => {
  if (!ts) return ''
  if (getLocalDateKey(new Date(ts)) === getLocalDateKey()) return formatTimeShort(ts)
  return formatTimeWithDate(ts)
}


/**
 * 取得系統時區的日期 key（YYYY-MM-DD），用於「今日」設定比對。
 */
export const getLocalDateKey = (date = new Date()) => {
  const { year, month, day } = getZonedParts(date)
  return `${year}-${pad2(month)}-${pad2(day)}`
}

const parseDateKey = (dateKey) => {
  const match = DATE_KEY_PATTERN.exec(String(dateKey || ''))
  if (!match) return null

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const utcDate = new Date(Date.UTC(year, month - 1, day))
  if (
    utcDate.getUTCFullYear() !== year
    || utcDate.getUTCMonth() !== month - 1
    || utcDate.getUTCDate() !== day
  ) return null
  return { year, month, day }
}

const getDateKeyStartMs = (dateKey, dayOffset = 0) => {
  const date = parseDateKey(dateKey)
  return date ? zonedWallTimeToMs(date.year, date.month, date.day + dayOffset) : Number.NaN
}

/**
 * 將日期選擇器的 YYYY-MM-DD 轉成系統時區範圍 [startMs, endMs)。
 * 空白邊界分別代表無下限／無上限；無效日期會回傳 NaN，避免靜默查錯資料。
 */
export const getTaipeiDateRangeBounds = (fromDateKey, toDateKey) => ({
  startMs: fromDateKey ? getDateKeyStartMs(fromDateKey) : -Infinity,
  endMs: toDateKey ? getDateKeyStartMs(toDateKey, 1) : Infinity,
})

/** 取得指定時間所屬月份（系統時區）的第一天與最後一天。 */
export const getTaipeiMonthRange = (date = new Date()) => {
  const { year, month } = getZonedParts(date)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(lastDay)}`,
  }
}

/** 將 YYYY-MM 轉成系統時區的月份範圍 [startMs, endMs)。 */
export const getTaipeiMonthBounds = (monthKey) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''))
  if (!match) return { startMs: Number.NaN, endMs: Number.NaN }
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return { startMs: Number.NaN, endMs: Number.NaN }
  return {
    startMs: zonedWallTimeToMs(year, month, 1),
    endMs: zonedWallTimeToMs(year, month + 1, 1),
  }
}

/** 將 datetime-local 欄位值視為系統時區時間並轉為時間戳。 */
export const getTaipeiDateTimeMs = (dateTimeValue) => {
  const match = DATE_TIME_PATTERN.exec(String(dateTimeValue || ''))
  if (!match) return Number.NaN
  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const values = [yearText, monthText, dayText, hourText, minuteText].map(Number)
  const [year, month, day, hour, minute] = values
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (
    utcDate.getUTCFullYear() !== year
    || utcDate.getUTCMonth() !== month - 1
    || utcDate.getUTCDate() !== day
    || utcDate.getUTCHours() !== hour
    || utcDate.getUTCMinutes() !== minute
  ) return Number.NaN
  return zonedWallTimeToMs(year, month, day, hour, minute)
}

/** 將時間轉成系統時區的 datetime-local 欄位值。 */
export const getTaipeiDateTimeValue = (date = new Date()) => {
  const { year, month, day, hour, minute } = getZonedParts(date)
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`
}

/**
 * 取得指定時間所屬日（系統時區）的 00:00 時間戳。
 */
export const getTaipeiDayStartMs = (date = new Date()) => {
  const { year, month, day } = getZonedParts(date)
  return zonedWallTimeToMs(year, month, day)
}

/**
 * 取得系統時區「今天」的時間戳範圍 [startMs, endMs)。
 * 遇到日光節約時間切換的日子，一天可能是 23 或 25 小時。
 */
export const getTodayBounds = () => {
  const { year, month, day } = getZonedParts()
  return { startMs: zonedWallTimeToMs(year, month, day), endMs: zonedWallTimeToMs(year, month, day + 1) }
}

/**
 * 取得下一個系統時區午夜的時間戳（跨日刷新排程用）。
 */
export const getTaipeiNextMidnightMs = () => getTodayBounds().endMs

/**
 * 文字截斷
 */
export const truncate = (text, max) => {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '...' : text
}

/**
 * 取得本週的時間範圍（系統時區，週一 00:00 ~ 週日 23:59:59）
 */
export const getThisWeekRange = () => {
  const { year, month, day } = getZonedParts()
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const diff = weekday === 0 ? -6 : 1 - weekday
  const startTime = zonedWallTimeToMs(year, month, day + diff)
  const endTime = zonedWallTimeToMs(year, month, day + diff + 7) - 1
  return { startTime, endTime }
}

// ── 金額 ────────────────────────────────────────────────────────────
// 全站唯一的金額顯示入口。原本各元件自己寫，結果同一個畫面裡
// 「$8,706」與「NT$ 8,706」並存（裸 $ 28 處、NT$ 53 處）。
// 所有金額都以幣別最小單位的整數傳入（新台幣為元、美元為分），由這裡換算成主單位顯示。

/** 由系統設定切換幣別。 */
export const setAppCurrency = (code) => { appCurrency = currencyInfo(code) }
export const getAppCurrency = () => appCurrency

const minorFactor = () => 10 ** appCurrency.decimals

/** 最小單位 → 主單位數值（輸入欄位的初始值用）。 */
export const fromMinorUnits = (value) => Math.round(Number(value) || 0) / minorFactor()

/** 主單位輸入值 → 最小單位整數。 */
export const toMinorUnits = (value) => Math.round((Number(value) || 0) * minorFactor())

/**
 * 解析使用者輸入的主單位金額；格式錯誤或小數位數超過幣別允許時回傳 NaN。
 * 例如美元可輸入 12.5、12.50，新台幣只接受整數。
 */
export const parseMoneyInput = (value) => {
  const text = String(value ?? '').trim().replace(/,/g, '')
  const decimals = appCurrency.decimals
  const pattern = decimals ? new RegExp(`^-?\\d+(\\.\\d{1,${decimals}})?$`) : /^-?\d+$/
  if (!pattern.test(text)) return Number.NaN
  return Math.round(Number(text) * minorFactor())
}

/** number 輸入欄位的 step。 */
export const moneyInputStep = () => (appCurrency.decimals ? 1 / minorFactor() : 1)

export const formatMoney = (value) => `${appCurrency.symbol} ${formatAmount(value)}`

/** Excel 數字格式：小數位數跟著幣別，負數標紅。金額欄的值請先用 fromMinorUnits 換算。 */
export const excelMoneyFormat = ({ signed = true } = {}) => {
  const base = appCurrency.decimals ? `#,##0.${'0'.repeat(appCurrency.decimals)}` : '#,##0'
  const zero = appCurrency.decimals ? `0.${'0'.repeat(appCurrency.decimals)}` : '0'
  return signed ? `${base};[Red]-${base};${zero}` : base
}

/** 只要數字（欄位標題已經寫了幣別符號、或本來就接在符號後面時） */
export const formatAmount = (value) => fromMinorUnits(value).toLocaleString('en-US', {
  minimumFractionDigits: appCurrency.decimals,
  maximumFractionDigits: appCurrency.decimals,
})

// ── 日期 ────────────────────────────────────────────────────────────
/** 2026/09/16 —— 報表、清單、日期選擇器 */
export const formatDateShort = (value) => {
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'string' && DATE_KEY_PATTERN.test(value) ? getDateKeyStartMs(value) : value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(zonedFormatter('stamp', 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${parts.year}/${parts.month}/${parts.day}`
}

/** 09/16 —— 空間不夠的紀錄列 */
export const formatDateCompact = (value) => formatDateShort(value).slice(5)

/** 2026/09/01 – 2026/09/30 —— 區間，分隔符全站統一用 en dash */
export const formatDateRange = (from, to) => [formatDateShort(from), formatDateShort(to)].filter(Boolean).join(' – ')
