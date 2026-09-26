import { afterEach, describe, expect, it } from 'vitest'
import { readStorage, removeStorage, writeStorage } from './storage'

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor)
  else delete globalThis.localStorage
})

describe('安全 localStorage 存取', () => {
  it('儲存空間不可用時回傳 fallback，且不丟出例外', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('blocked') },
    })
    expect(readStorage('theme', 'auto')).toBe('auto')
    expect(writeStorage('theme', 'dark')).toBe(false)
    expect(removeStorage('theme')).toBe(false)
  })

  it('正常讀寫與移除字串值', () => {
    const values = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
      },
    })
    expect(writeStorage('sidebar', true)).toBe(true)
    expect(readStorage('sidebar')).toBe('true')
    expect(removeStorage('sidebar')).toBe(true)
    expect(readStorage('sidebar', 'missing')).toBe('missing')
  })
})
