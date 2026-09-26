// ==========================================
// 格式化工具函式
// 所有「日期邊界」一律以台北時區（Asia/Taipei）計算，
// 與 Cloud Functions 的帳務日界一致，避免裝置時區不同造成「今日」錯亂。
// ==========================================

const TAIPEI_TIME_ZONE = 'Asia/Taipei'
// 台灣無日光節約時間，固定 UTC+8。
const TAIPEI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

const taipeiDatePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TAIPEI_TIME_ZONE,
  year: 'numeric', month: 'numeric', day: 'numeric',
})

const taipeiDateStampFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TAIPEI_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
})

const getTaipeiDateParts = (date = new Date()) => Object.fromEntries(
  taipeiDatePartsFormatter.formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)])
)

/**
 * 格式化時間戳為 HH:mm（僅時間）
 */
export const formatTimeShort = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleString('zh-TW', {
    timeZone: TAIPEI_TIME_ZONE,
    hour: '2-digit', minute: '2-digit', hour12: false
  })
}

/**
 * 格式化時間戳為 M/D HH:mm（含日期）
 */
export const formatTimeWithDate = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleString('zh-TW', {
    timeZone: TAIPEI_TIME_ZONE,
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
 * 取得台北日期 key（YYYY-MM-DD），用於「今日」設定比對。
 */
export const getLocalDateKey = (date = new Date()) => {
  const { year, month, day } = getTaipeiDateParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const getTaipeiDateKeyStartMs = (dateKey) => {
  const match = DATE_KEY_PATTERN.exec(String(dateKey || ''))
  if (!match) return Number.NaN

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const utcDate = new Date(Date.UTC(year, month - 1, day))
  if (
    utcDate.getUTCFullYear() !== year
    || utcDate.getUTCMonth() !== month - 1
    || utcDate.getUTCDate() !== day
  ) return Number.NaN

  return utcDate.getTime() - TAIPEI_UTC_OFFSET_MS
}

/**
 * 將日期選擇器的 YYYY-MM-DD 轉成台北時區範圍 [startMs, endMs)。
 * 空白邊界分別代表無下限／無上限；無效日期會回傳 NaN，避免靜默查錯資料。
 */
export const getTaipeiDateRangeBounds = (fromDateKey, toDateKey) => {
  const startMs = fromDateKey ? getTaipeiDateKeyStartMs(fromDateKey) : -Infinity
  const endStartMs = toDateKey ? getTaipeiDateKeyStartMs(toDateKey) : Infinity
  return {
    startMs,
    endMs: Number.isFinite(endStartMs) ? endStartMs + DAY_MS : endStartMs,
  }
}

/** 取得指定時間所屬台北月份的第一天與最後一天。 */
export const getTaipeiMonthRange = (date = new Date()) => {
  const { year, month } = getTaipeiDateParts(date)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}

/** 將 YYYY-MM 轉成台北月份範圍 [startMs, endMs)。 */
export const getTaipeiMonthBounds = (monthKey) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''))
  if (!match) return { startMs: Number.NaN, endMs: Number.NaN }
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return { startMs: Number.NaN, endMs: Number.NaN }
  return {
    startMs: Date.UTC(year, month - 1, 1) - TAIPEI_UTC_OFFSET_MS,
    endMs: Date.UTC(year, month, 1) - TAIPEI_UTC_OFFSET_MS,
  }
}

/** 將 datetime-local 欄位值視為台北時間並轉為時間戳。 */
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
  return utcDate.getTime() - TAIPEI_UTC_OFFSET_MS
}

/** 將時間轉成台北時區的 datetime-local 欄位值。 */
export const getTaipeiDateTimeValue = (date = new Date()) =>
  new Date(date.getTime() + TAIPEI_UTC_OFFSET_MS).toISOString().slice(0, 16)

/**
 * 取得指定時間所屬台北日的 00:00 時間戳。
 */
export const getTaipeiDayStartMs = (date = new Date()) => {
  const { year, month, day } = getTaipeiDateParts(date)
  return Date.UTC(year, month - 1, day) - TAIPEI_UTC_OFFSET_MS
}

/**
 * 取得台北「今天」的時間戳範圍 [startMs, endMs)。
 */
export const getTodayBounds = () => {
  const startMs = getTaipeiDayStartMs()
  return { startMs, endMs: startMs + DAY_MS }
}

/**
 * 取得下一個台北午夜的時間戳（跨日刷新排程用）。
 */
export const getTaipeiNextMidnightMs = () => getTaipeiDayStartMs() + DAY_MS

/**
 * 文字截斷
 */
export const truncate = (text, max) => {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '...' : text
}

/**
 * 取得本週的時間範圍（台北時區，週一 00:00 ~ 週日 23:59:59）
 */
export const getThisWeekRange = () => {
  const dayStartMs = getTaipeiDayStartMs()
  const weekday = new Date(dayStartMs + TAIPEI_UTC_OFFSET_MS).getUTCDay()
  const diff = weekday === 0 ? -6 : 1 - weekday
  const startTime = dayStartMs + diff * DAY_MS
  const endTime = startTime + 7 * DAY_MS - 1
  return { startTime, endTime }
}

// ── 金額 ────────────────────────────────────────────────────────────
// 全站唯一的金額顯示入口。原本各元件自己寫，結果同一個畫面裡
// 「$8,706」與「NT$ 8,706」並存（裸 $ 28 處、NT$ 53 處）。
export const formatMoney = (value) => `NT$ ${formatAmount(value)}`

/** 只要數字（欄位標題已經寫了 NT$、或本來就在 NT$ 後面接著用時） */
export const formatAmount = (value) => Math.round(Number(value) || 0).toLocaleString('en-US')

// ── 日期 ────────────────────────────────────────────────────────────
/** 2026/09/16 —— 報表、清單、日期選擇器 */
export const formatDateShort = (value) => {
  const date = value instanceof Date ? value : new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(taipeiDateStampFormatter.formatToParts(date)
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return `${parts.year}/${parts.month}/${parts.day}`
}

/** 09/16 —— 空間不夠的紀錄列 */
export const formatDateCompact = (value) => formatDateShort(value).slice(5)

/** 2026/09/01 – 2026/09/30 —— 區間，分隔符全站統一用 en dash */
export const formatDateRange = (from, to) => [formatDateShort(from), formatDateShort(to)].filter(Boolean).join(' – ')
