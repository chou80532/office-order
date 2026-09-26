import { describe, it, expect } from 'vitest'
import {
  formatTimeShort,
  formatTimeWithDate,
  getLocalDateKey,
  getTaipeiDayStartMs,
  getTaipeiDateRangeBounds,
  getTaipeiDateTimeMs,
  getTaipeiDateTimeValue,
  getTaipeiMonthBounds,
  getTaipeiMonthRange,
  getTaipeiNextMidnightMs,
  getTodayBounds,
  getThisWeekRange,
  truncate,
} from './format'

const DAY_MS = 24 * 60 * 60 * 1000

describe('getLocalDateKey（台北時區）', () => {
  it('UTC 深夜對台北而言已是隔天', () => {
    // 2026-07-06 20:00 UTC = 台北 2026-07-07 04:00
    const ts = Date.UTC(2026, 6, 6, 20, 0, 0)
    expect(getLocalDateKey(new Date(ts))).toBe('2026-07-07')
  })

  it('台北午夜前一毫秒仍是同一天', () => {
    // 台北 2026-07-07 00:00 = 2026-07-06 16:00 UTC
    const taipeiMidnightUtc = Date.UTC(2026, 6, 6, 16, 0, 0)
    expect(getLocalDateKey(new Date(taipeiMidnightUtc - 1))).toBe('2026-07-06')
    expect(getLocalDateKey(new Date(taipeiMidnightUtc))).toBe('2026-07-07')
  })
})

describe('getTaipeiDayStartMs', () => {
  it('回傳該時間所屬台北日的 00:00（UTC 前一日 16:00）', () => {
    const ts = Date.UTC(2026, 6, 6, 20, 0, 0) // 台北 07-07 04:00
    expect(getTaipeiDayStartMs(new Date(ts))).toBe(Date.UTC(2026, 6, 6, 16, 0, 0))
  })

  it('日界起點的 date key 與輸入時間一致', () => {
    const startMs = getTaipeiDayStartMs()
    expect(getLocalDateKey(new Date(startMs))).toBe(getLocalDateKey())
    expect(getLocalDateKey(new Date(startMs - 1))).not.toBe(getLocalDateKey())
  })
})

describe('getTodayBounds', () => {
  it('範圍剛好是一整天且包含現在', () => {
    const { startMs, endMs } = getTodayBounds()
    const now = Date.now()
    expect(endMs - startMs).toBe(DAY_MS)
    expect(now).toBeGreaterThanOrEqual(startMs)
    expect(now).toBeLessThan(endMs)
  })
})

describe('getTaipeiDateRangeBounds', () => {
  it('使用台北午夜，且結束時間採不含上限', () => {
    const bounds = getTaipeiDateRangeBounds('2026-07-01', '2026-07-31')
    expect(bounds.startMs).toBe(Date.UTC(2026, 5, 30, 16))
    expect(bounds.endMs).toBe(Date.UTC(2026, 6, 31, 16))
  })

  it('支援開放邊界並拒絕不存在的日期', () => {
    expect(getTaipeiDateRangeBounds('', '').startMs).toBe(-Infinity)
    expect(getTaipeiDateRangeBounds('', '').endMs).toBe(Infinity)
    expect(getTaipeiDateRangeBounds('2026-02-30', '2026-03-01').startMs).toBeNaN()
  })
})

describe('getTaipeiMonthRange', () => {
  it('以台北日期決定月份，並正確處理閏年', () => {
    const taipeiMarchFirst = new Date(Date.UTC(2024, 1, 29, 16))
    expect(getTaipeiMonthRange(new Date(taipeiMarchFirst.getTime() - 1))).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(getTaipeiMonthRange(taipeiMarchFirst)).toEqual({ from: '2024-03-01', to: '2024-03-31' })
  })
})

describe('台北月份與日期時間輸入', () => {
  it('月份範圍跨年時仍正確', () => {
    expect(getTaipeiMonthBounds('2026-12')).toEqual({
      startMs: Date.UTC(2026, 10, 30, 16),
      endMs: Date.UTC(2026, 11, 31, 16),
    })
  })

  it('datetime-local 與台北時間戳可往返', () => {
    const value = '2026-07-10T23:45'
    const timestamp = Date.UTC(2026, 6, 10, 15, 45)
    expect(getTaipeiDateTimeMs(value)).toBe(timestamp)
    expect(getTaipeiDateTimeValue(new Date(timestamp))).toBe(value)
    expect(getTaipeiDateTimeMs('2026-02-30T10:00')).toBeNaN()
  })
})

describe('getTaipeiNextMidnightMs', () => {
  it('是未來時間且與今日日界相差一天', () => {
    expect(getTaipeiNextMidnightMs()).toBe(getTaipeiDayStartMs() + DAY_MS)
    expect(getTaipeiNextMidnightMs()).toBeGreaterThan(Date.now())
  })
})

describe('getThisWeekRange', () => {
  it('範圍為 7 天且包含現在', () => {
    const { startTime, endTime } = getThisWeekRange()
    const now = Date.now()
    expect(endTime - startTime).toBe(7 * DAY_MS - 1)
    expect(now).toBeGreaterThanOrEqual(startTime)
    expect(now).toBeLessThanOrEqual(endTime)
  })

  it('起點是台北時間的週一 00:00', () => {
    const { startTime } = getThisWeekRange()
    expect(startTime).toBe(getTaipeiDayStartMs(new Date(startTime)))
    const weekdayInTaipei = new Date(startTime).toLocaleDateString('en-US', {
      timeZone: 'Asia/Taipei',
      weekday: 'short',
    })
    expect(weekdayInTaipei).toBe('Mon')
  })
})

describe('formatTime（台北時區顯示）', () => {
  it('formatTimeShort 以台北時間顯示 HH:mm', () => {
    // 2026-07-06 20:30 UTC = 台北 07-07 04:30
    expect(formatTimeShort(Date.UTC(2026, 6, 6, 20, 30))).toBe('04:30')
  })

  it('formatTimeWithDate 以台北日期顯示', () => {
    // 日期與時間之間的空白因 ICU 版本可能是一般空格或窄空格，用 \s 比對。
    expect(formatTimeWithDate(Date.UTC(2026, 6, 6, 20, 30))).toMatch(/^7\/7\s04:30$/)
  })

  it('空值回傳空字串', () => {
    expect(formatTimeShort(null)).toBe('')
    expect(formatTimeWithDate(undefined)).toBe('')
  })
})

describe('truncate', () => {
  it('超過上限時截斷並加省略號', () => {
    expect(truncate('abcdef', 3)).toBe('abc...')
    expect(truncate('ab', 3)).toBe('ab')
    expect(truncate('', 3)).toBe('')
  })
})
