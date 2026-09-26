import { describe, expect, it } from 'vitest'
import { isMissingMenuImage } from './menuImageHealth'

describe('失效菜單圖片', () => {
  it('只移除確定不存在的網址，暫時錯誤不視為失效', async () => {
    for (const status of [200, 403, 404, 410, 429, 500, 503]) {
      expect(await isMissingMenuImage({ url: 'https://example.com/menu.png', request: async () => ({ status }) })).toBe([404, 410].includes(status))
    }
    expect(await isMissingMenuImage({ request: async () => { throw new Error('offline or CORS') } })).toBe(false)
  })
  it('Storage 權限錯誤不刪除，object-not-found 才視為已失效', async () => {
    for (const code of ['storage/object-not-found', 'storage/unauthorized', 'storage/retry-limit-exceeded']) {
      expect(await isMissingMenuImage({ objectRef: {}, metadata: async () => { throw { code } } })).toBe(code === 'storage/object-not-found')
    }
  })
})
