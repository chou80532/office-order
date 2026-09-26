// ==========================================
// Confetti 工具（統一 CSS 變數色彩擷取）
// ==========================================
/**
 * 從 CSS 變數取得主題色（canvas-confetti 不支援 CSS 變數）
 */
const getThemeColors = () => {
  const rootStyle = getComputedStyle(document.documentElement)
  const get = (name) => rootStyle.getPropertyValue(name).trim() || '#D4763B'
  return [
    get('--primary-color'),
    get('--secondary-color'),
    get('--accent-color'),
    get('--cyan-color'),
    get('--success-color')
  ]
}

/**
 * 發射 confetti（自動使用主題色，動態載入 canvas-confetti）
 */
export const fireConfetti = async (options = {}) => {
  const { default: confetti } = await import('canvas-confetti')
  confetti({
    colors: getThemeColors(),
    ...options
  })
}
