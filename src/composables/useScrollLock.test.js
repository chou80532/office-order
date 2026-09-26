import { afterEach, describe, expect, it, vi } from 'vitest'
import { lockBodyScroll, unlockBodyScroll } from './useScrollLock'

function style(initial = {}) {
  const values = { ...initial }
  return new Proxy({
    getPropertyValue: key => values[key] || '',
    getPropertyPriority: () => '',
    setProperty: (key, value) => { values[key] = value },
    removeProperty: key => { delete values[key] },
  }, {
    get: (target, key) => key in target ? target[key] : values[key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)] || '',
    set: (_, key, value) => { values[key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)] = value; return true },
  })
}
function setup(touch = false, gutter = 10) {
  const body = { style: style({ 'padding-right': '7px', position: 'relative' }) }
  const documentElement = { style: style({ overflow: 'auto' }), clientWidth: 990 }
  documentElement.getBoundingClientRect = () => ({ width: 990 + (documentElement.style.overflow === 'hidden' ? gutter : 0) })
  vi.stubGlobal('document', { body, documentElement })
  vi.stubGlobal('window', {
    scrollY: 420, scrollX: 0, innerWidth: 1000,
    matchMedia: () => ({ matches: touch }),
    getComputedStyle: () => ({ paddingRight: '7px' }), scrollTo: vi.fn(),
  })
  return { body, documentElement }
}
afterEach(() => { unlockBodyScroll(); unlockBodyScroll(); vi.unstubAllGlobals() })
describe('共用捲動鎖', () => {
  it('瀏覽器已保留捲軸空間時不再重複補 padding', () => {
    const { body } = setup(false, 0)
    lockBodyScroll()
    expect(body.style.paddingRight).toBe('7px')
    unlockBodyScroll()
    expect(body.style.paddingRight).toBe('7px')
  })
  it('不支援固定捲軸空間時，保留缩放後的次像素精度', () => {
    const { body } = setup(false, 9.875)
    lockBodyScroll()
    expect(body.style.paddingRight).toBe('16.875px')
  })
  it('桌面保留正常排版，巢狀視窗最後關閉才還原原始樣式', () => {
    const { body, documentElement } = setup()
    lockBodyScroll()
    lockBodyScroll()
    expect(body.style.position).toBe('relative')
    expect(body.style.paddingRight).toBe('17px')
    expect(documentElement.style.overflow).toBe('hidden')
    unlockBodyScroll()
    expect(documentElement.style.overflow).toBe('hidden')
    unlockBodyScroll()
    expect(documentElement.style.overflow).toBe('auto')
    expect(body.style.paddingRight).toBe('7px')
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
  it('觸控鎖定保留原捲動位置，解鎖不使用平滑捲動', () => {
    const { body } = setup(true)
    lockBodyScroll()
    expect(body.style.position).toBe('fixed')
    expect(body.style.top).toBe('-420px')
    unlockBodyScroll()
    expect(body.style.position).toBe('relative')
    expect(body.style.top).toBe('')
    expect(window.scrollTo).toHaveBeenCalledWith({ left: 0, top: 420, behavior: 'instant' })
  })
})
