import { ref, watch } from 'vue'
import { readStorage, writeStorage } from '../utils/storage'

const STORAGE_KEY = 'theme'
const ACCENT_KEY = 'accent-scheme'

/** 預設配色方案清單：id 對應 tokens.css 的 [data-accent]，swatch 供選色 UI 顯示 */
export const ACCENT_SCHEMES = [
  { id: 'orange', label: '暖橘', swatch: '#E8622A' },
  { id: 'ocean', label: '海洋藍', swatch: '#2E7CC7' },
  { id: 'forest', label: '森林綠', swatch: '#2F8F53' },
  { id: 'grape', label: '葡萄紫', swatch: '#8A5CE0' },
  { id: 'rose', label: '玫瑰粉', swatch: '#D6486E' },
]

const theme = ref(readStorage(STORAGE_KEY, 'auto'))
const accent = ref(readStorage(ACCENT_KEY, 'orange'))
let themeSwitchFrame = 0

/** 切換當下抑制全站 transition，避免顏色漸變造成雜訊閃爍 */
function suppressTransitions() {
  const root = document.documentElement
  cancelAnimationFrame(themeSwitchFrame)
  root.classList.add('theme-switching')
  themeSwitchFrame = requestAnimationFrame(() => {
    themeSwitchFrame = requestAnimationFrame(() => {
      root.classList.remove('theme-switching')
    })
  })
}

function apply(t, withSuppress = false) {
  const root = document.documentElement
  if (withSuppress) suppressTransitions()

  if (t === 'auto') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', t)
  }
}

function applyAccent(id, withSuppress = false) {
  const root = document.documentElement
  if (withSuppress) suppressTransitions()

  if (id === 'orange' || !ACCENT_SCHEMES.some(s => s.id === id)) {
    root.removeAttribute('data-accent')
  } else {
    root.setAttribute('data-accent', id)
  }
}

apply(theme.value)
applyAccent(accent.value)

watch(theme, (t) => {
  apply(t, true)
  writeStorage(STORAGE_KEY, t)
})

watch(accent, (id) => {
  applyAccent(id, true)
  writeStorage(ACCENT_KEY, id)
})

// auto 模式時跟隨系統主題切換
if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => { if (theme.value === 'auto') apply('auto') }
  mq.addEventListener?.('change', onChange)
}

export function useTheme() {
  return { theme, accent }
}
