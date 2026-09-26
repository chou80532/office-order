import { describe, it, expect } from 'vitest'
import { periodBuckets } from './periodBuckets'

describe('所選期間圖表', () => {
  it('月份的全部日期連續涵蓋，最多六組且不超出月底', () => {
    const start = Date.parse('2026-08-01T00:00:00+08:00')
    const end = Date.parse('2026-09-01T00:00:00+08:00')
    const buckets = periodBuckets(start, end)
    expect(buckets.length).toBeLessThanOrEqual(6)
    expect(buckets[0].start).toBe(start)
    expect(buckets.at(-1).end).toBe(end)
    buckets.slice(1).forEach((bucket, i) => expect(bucket.start).toBe(buckets[i].end))
  })
  it('一天只建立一組，無效或反向區間不產生圖表', () => {
    expect(periodBuckets(0, 86400000)).toHaveLength(1)
    expect(periodBuckets(NaN, 86400000)).toEqual([])
    expect(periodBuckets(10, 1)).toEqual([])
  })
})
