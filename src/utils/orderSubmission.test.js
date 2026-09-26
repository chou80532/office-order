import { describe, expect, it } from 'vitest'
import { prepareSubmission, remainingCartItems, submissionDefinitelyRejected } from './orderSubmission'

describe('送單結果不明時的防重複處理', () => {
  it('網路逾時後改購物車，仍以原請求編號及原餐點確認前次結果', () => {
    const items = [{ _key: 1, name: '飯', price: 100, addons: [{ name: '蛋' }] }]
    const first = prepareSubmission(null, { items, fallbackName: 'A', selectedStoreName: 'Store', fingerprint: 'one', requestId: 'request-1' })
    items[0].price = 200
    items[0].addons[0].name = '菜'
    const retry = prepareSubmission(first, { items, fingerprint: 'two', requestId: 'request-2' })
    expect(retry).toBe(first)
    expect(retry.items[0]).toMatchObject({ price: 100, addons: [{ name: '蛋' }] })
    expect(retry.requestId).toBe('request-1')
  })

  it('确认成功只移除內容相同的已送品項，保留後續編輯和新增', () => {
    const sent = [{ _key: 1, price: 100 }, { _key: 2, price: 200 }]
    const current = [{ _key: 1, price: 150 }, { _key: 2, price: 200 }, { _key: 3, price: 300 }]
    expect(remainingCartItems(current, sent)).toEqual([current[0], current[2]])
  })

  it('只有確定拒絕才可建立新請求，逾時及連線錯誤保留原編號', () => {
    expect(submissionDefinitelyRejected({ code: 'functions/failed-precondition' })).toBe(true)
    expect(submissionDefinitelyRejected({ code: 'functions/permission-denied' })).toBe(true)
    expect(submissionDefinitelyRejected({ code: 'functions/deadline-exceeded' })).toBe(false)
    expect(submissionDefinitelyRejected({ code: 'functions/unavailable' })).toBe(false)
  })
})
