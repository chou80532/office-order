import { afterEach, describe, expect, it, vi } from 'vitest'
import zhTW from '../src/i18n/locales/zh-TW'
import en from '../src/i18n/locales/en'
import { i18n, setUserLocale, t, translateError } from '../src/i18n'

const flatten = (messages, prefix = '') => Object.entries(messages).flatMap(([key, value]) =>
  value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]])

describe('語系檔', () => {
  afterEach(() => setUserLocale(''))

  it('繁中與英文的 key 完全一致，避免英文介面混入中文或缺字', () => {
    const zhKeys = flatten(zhTW).map(([key]) => key).sort()
    const enKeys = flatten(en).map(([key]) => key).sort()
    expect(enKeys.filter(key => !zhKeys.includes(key))).toEqual([])
    expect(zhKeys.filter(key => !enKeys.includes(key))).toEqual([])
  })

  it('訊息都是非空字串，且沒有 vue-i18n 會誤判的特殊字元', () => {
    for (const [locale, messages] of [['zh-TW', zhTW], ['en', en]]) {
      for (const [key, value] of flatten(messages)) {
        expect(typeof value, `${locale}:${key}`).toBe('string')
        expect(value.trim(), `${locale}:${key}`).not.toBe('')
        // @ 會被當成 linked message，需要時請用 {'@'} 轉義。
        expect(/(^|[^{'])@/.test(value), `${locale}:${key} has unescaped @`).toBe(false)
        // | 只能用在「單數 | 複數」：前後有空白、帶 {count}，且只有兩種形式。
        if (value.includes('|')) {
          const forms = value.split(' | ')
          expect(forms.length === 2 && forms.every(form => form.trim() && !form.includes('|')) && (value.includes('{count}') || key.endsWith('Unit')), `${locale}:${key} has a stray |`).toBe(true)
        }
      }
    }
  })

  it('每則訊息都能編譯，沒有語法錯誤', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const locale of ['zh-TW', 'en']) {
      setUserLocale(locale)
      for (const [key] of flatten(locale === 'en' ? en : zhTW)) {
        const output = t(key, { count: 1, month: '2026-10', amount: '$ 1', days: 30, webhook: 'ok', push: 0, name: 'A', time: '11:00' })
        expect(typeof output).toBe('string')
      }
    }
    expect(errors).not.toHaveBeenCalled()
    expect(warnings).not.toHaveBeenCalled()
    errors.mockRestore()
    warnings.mockRestore()
  })

  it('英文依 count 選擇單複數，繁中不受影響', () => {
    setUserLocale('en')
    expect(t('stores.totalStores', { count: 1 })).toBe('1 store')
    expect(t('stores.totalStores', { count: 0 })).toBe('0 stores')
    expect(t('stores.totalStores', { count: 3 })).toBe('3 stores')
    expect(t('cleanup.records', { count: '1,234' })).toBe('1,234 records')
    expect(t('dashboard.summary.sameDetail', { count: 1, store: 'A' })).toBe('The order is from "A" – you can place it in one go.')
    setUserLocale('zh-TW')
    expect(t('stores.totalStores', { count: 1 })).toBe('共 1 間店家')
  })

  it('切換語言會改變 t() 的結果與 html lang', () => {
    setUserLocale('en')
    expect(i18n.global.locale.value).toBe('en')
    expect(t('common.save')).toBe('Save')
    setUserLocale('zh-TW')
    expect(t('common.save')).toBe('儲存')
  })

  it('後端錯誤代碼與舊版中文訊息都能翻譯，未知錯誤使用預設訊息', () => {
    setUserLocale('en')
    expect(translateError({ message: 'ORDERING_CLOSED' })).toBe(en.errors.ORDERING_CLOSED)
    expect(translateError({ message: '購物車是空的' })).toBe(en.errors.CART_EMPTY)
    expect(translateError({ message: 'something odd' })).toBe(en.errors.generic)
    expect(translateError({ code: 'functions/unavailable' })).toBe(en.errors.network)
  })
})
