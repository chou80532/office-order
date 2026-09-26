import { describe, expect, it, vi } from 'vitest'

vi.mock('vue', async (importOriginal) => ({
  ...await importOriginal(),
  provide: vi.fn(),
}))

import { createFirestore } from './useFirestore'

describe('店家加入日期', () => {
  const originalDate = Date.UTC(2025, 0, 1)
  const updatedDate = Date.UTC(2026, 8, 6)

  it('替換失效菜單後仍保留原始加入日期', () => {
    const state = createFirestore()
    state.rawMenuData.value = [{ storeName: '老店', timestamp: originalDate }]
    expect(state.allStores.value[0].createdAtTs).toBe(originalDate)

    state.rawMenuData.value = [{
      storeName: '老店', createdAt: originalDate,
      timestamp: updatedDate, menuUpdatedAt: updatedDate,
    }]
    expect(state.allStores.value[0].createdAtTs).toBe(originalDate)
  })

  it.each([originalDate, new Date(originalDate), { toMillis: () => originalDate }])(
    '支援數字、Date 與 Firestore Timestamp 的加入日期：%s',
    (createdAt) => {
      const state = createFirestore()
      state.rawMenuData.value = [{ storeName: '老店', createdAt, timestamp: updatedDate }]
      expect(state.allStores.value[0].createdAtTs).toBe(originalDate)
    },
  )

  it('多頁菜單取最早加入日期，真正新店家保留新日期', () => {
    const state = createFirestore()
    state.rawMenuData.value = [
      { storeName: '老店', createdAt: updatedDate, timestamp: updatedDate },
      { storeName: '老店', timestamp: originalDate },
      { storeName: '新店', createdAt: updatedDate, timestamp: updatedDate },
    ]
    expect(state.allStores.value.find(store => store.name === '老店').createdAtTs).toBe(originalDate)
    expect(state.allStores.value.find(store => store.name === '新店').createdAtTs).toBe(updatedDate)
  })

  it('缺少有效日期時不誤判為新店家', () => {
    const state = createFirestore()
    state.rawMenuData.value = [{ storeName: '無日期店家', createdAt: null, timestamp: 'invalid' }]
    expect(state.allStores.value[0].createdAtTs).toBeNull()
  })
})
