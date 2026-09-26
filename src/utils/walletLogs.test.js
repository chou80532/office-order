import { describe, it, expect } from 'vitest'
import {
  mergeEditLogPairs,
  matchesLogTypeFilter,
  editGroupShortId,
  composeLogDescription,
  MERGED_EDIT_TYPE,
} from './walletLogs'

// 建一組編輯配對：$100 排骨飯 → $120 雞腿飯
const editPair = (groupId = 'g1') => [
  {
    id: `refund_${groupId}`, type: 'order_edit_refund', editGroupId: groupId,
    amount: 100, beforeBalance: 380, afterBalance: 480, timestamp: 1000,
    ownerName: '王小明', operatorName: '王小明', storeName: '八方雲集',
    items: [{ meal: '排骨飯', price: 100, note: '少飯' }],
  },
  {
    id: `debit_${groupId}`, type: 'order_edit_debit', editGroupId: groupId,
    amount: -120, beforeBalance: 480, afterBalance: 360, timestamp: 1001,
    ownerName: '王小明', operatorName: '王小明', storeName: '八方雲集',
    items: [{ meal: '雞腿飯', price: 120, note: '' }],
  },
]

describe('mergeEditLogPairs', () => {
  it('把一退一扣配對合併成單筆淨額', () => {
    const merged = mergeEditLogPairs(editPair())
    expect(merged).toHaveLength(1)
    const row = merged[0]
    expect(row.type).toBe(MERGED_EDIT_TYPE)
    expect(row.merged).toBe(true)
    expect(row.amount).toBe(-20) // 100 + (-120)
    expect(row.beforeBalance).toBe(380) // 退款前
    expect(row.afterBalance).toBe(360) // 扣款後
    expect(row.reason).toContain('排骨飯 → 雞腿飯')
    expect(row.pairLogs).toHaveLength(2)
  })

  it('餘額鏈保持連續（beforeBalance → afterBalance）', () => {
    const [row] = mergeEditLogPairs(editPair())
    // 淨額 = afterBalance - beforeBalance
    expect(row.afterBalance - row.beforeBalance).toBe(row.amount)
  })

  it('金額調升（換更貴的）淨額為負', () => {
    const [row] = mergeEditLogPairs(editPair())
    expect(row.amount).toBeLessThan(0)
  })

  it('保留其他非編輯流水原樣且維持順序', () => {
    const logs = [
      { id: 'top1', type: 'top_up', amount: 500, timestamp: 900 },
      ...editPair(),
      { id: 'deb2', type: 'order_debit', amount: -50, timestamp: 1100 },
    ]
    const merged = mergeEditLogPairs(logs)
    expect(merged.map(l => l.id)).toEqual(['top1', 'edit_g1', 'deb2'])
  })

  it('缺一半的編輯流水不合併（維持原樣）', () => {
    const [refundOnly] = editPair()
    const merged = mergeEditLogPairs([refundOnly])
    expect(merged).toHaveLength(1)
    expect(merged[0].type).toBe('order_edit_refund')
  })

  it('舊資料（無 editGroupId）維持原樣不合併', () => {
    const legacy = [
      { id: 'r', type: 'order_edit_refund', amount: 100, timestamp: 1 },
      { id: 'd', type: 'order_edit_debit', amount: -120, timestamp: 2 },
    ]
    const merged = mergeEditLogPairs(legacy)
    expect(merged).toHaveLength(2)
    expect(merged.every(l => l.type !== MERGED_EDIT_TYPE)).toBe(true)
  })

  it('兩組不同 editGroupId 各自合併', () => {
    const merged = mergeEditLogPairs([...editPair('a'), ...editPair('b')])
    expect(merged).toHaveLength(2)
    expect(merged.every(l => l.merged)).toBe(true)
  })

  it('同名品項（只改備註但價格有變）也能合併', () => {
    const pair = editPair()
    pair[1].items = [{ meal: '排骨飯', price: 120, note: '加辣' }]
    const [row] = mergeEditLogPairs(pair)
    expect(row.reason).toContain('排骨飯')
  })
})

describe('matchesLogTypeFilter', () => {
  it('all 命中全部', () => {
    expect(matchesLogTypeFilter({ type: 'top_up' }, 'all')).toBe(true)
  })

  it('精準類型只命中該類型', () => {
    expect(matchesLogTypeFilter({ type: 'top_up' }, 'top_up')).toBe(true)
    expect(matchesLogTypeFilter({ type: 'order_debit' }, 'top_up')).toBe(false)
  })

  it('order_edit 同時命中合併列與原始編輯列', () => {
    expect(matchesLogTypeFilter({ type: 'order_edit' }, 'order_edit')).toBe(true)
    expect(matchesLogTypeFilter({ type: 'order_edit_refund' }, 'order_edit')).toBe(true)
    expect(matchesLogTypeFilter({ type: 'order_edit_debit' }, 'order_edit')).toBe(true)
    expect(matchesLogTypeFilter({ type: 'top_up' }, 'order_edit')).toBe(false)
  })
})

describe('editGroupShortId', () => {
  it('取前 8 碼', () => {
    expect(editGroupShortId({ editGroupId: '1234567890abcdef' })).toBe('12345678')
  })
  it('無 editGroupId 回空字串', () => {
    expect(editGroupShortId({})).toBe('')
  })
})

describe('composeLogDescription', () => {
  it('點餐扣款組出 動作｜店家｜品項', () => {
    const log = { storeName: '八方雲集', items: [{ meal: '排骨飯' }, { meal: '雞腿飯' }] }
    expect(composeLogDescription(log, '點餐扣款')).toBe('點餐扣款｜八方雲集｜排骨飯、雞腿飯')
  })

  it('品項帶備註以括號附上', () => {
    const log = { storeName: '春陽茶事', items: [{ meal: '珍奶', note: '半糖少冰' }] }
    expect(composeLogDescription(log, '點餐扣款')).toBe('點餐扣款｜春陽茶事｜珍奶（半糖少冰）')
  })

  it('無店家無品項（儲值）顯示自訂原因', () => {
    const log = { reason: '現金儲值', items: [] }
    expect(composeLogDescription(log, '儲值')).toBe('現金儲值')
  })

  it('無店家無品項也無原因時退回動作名稱', () => {
    expect(composeLogDescription({}, '管理員修正')).toBe('管理員修正')
  })

  it('只有店家沒有品項', () => {
    expect(composeLogDescription({ storeName: '八方雲集' }, '取消退款')).toBe('取消退款｜八方雲集')
  })
})
