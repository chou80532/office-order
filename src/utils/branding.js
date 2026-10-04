// ==========================================
// 品牌主題色預設值。每組都驗證過對比：dark 放米白字 ≥ 5.2、light 放在深色面板 ≥ 4.9、
// base 用於線條與標記 ≥ 3.7（非文字元素需 3:1），與原本的柿紅同級或更好。
// ==========================================
import { DEFAULT_BRAND_NAME } from './systemSettings'

export const BRAND_ACCENTS = [
  { id: 'persimmon', base: '#c4502d', dark: '#a1401f', light: '#e0805f' },
  { id: 'indigo', base: '#4a62b0', dark: '#34498f', light: '#94a8e6' },
  { id: 'forest', base: '#3f7d55', dark: '#2d5f3f', light: '#86bb94' },
  { id: 'plum', base: '#8a4f96', dark: '#6b3a77', light: '#c79bd0' },
  { id: 'teal', base: '#2c7f86', dark: '#1f6066', light: '#77bcc2' },
  { id: 'charcoal', base: '#5b5b5b', dark: '#3f3f3f', light: '#b0aaa3' },
]

export const brandAccent = id => BRAND_ACCENTS.find(accent => accent.id === id) || BRAND_ACCENTS[0]

export const brandName = branding => String(branding?.name || '').trim() || DEFAULT_BRAND_NAME
export const brandLogo = branding => String(branding?.logoUrl || '').trim() || '/office-lunch.svg'

/** 套用到整個頁面：瀏覽器分頁標題與主題色 CSS 變數。 */
export const applyBranding = (branding) => {
  if (typeof document === 'undefined') return
  document.title = brandName(branding)
  const accent = brandAccent(branding?.accent)
  const root = document.documentElement.style
  if (accent.id === 'persimmon') {
    // 預設色直接用 tokens.css 的值，不留行內樣式。
    root.removeProperty('--persimmon')
    root.removeProperty('--persimmon-dark')
    root.removeProperty('--persimmon-light')
    return
  }
  root.setProperty('--persimmon', accent.base)
  root.setProperty('--persimmon-dark', accent.dark)
  root.setProperty('--persimmon-light', accent.light)
}
