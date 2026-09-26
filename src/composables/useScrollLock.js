// ==========================================
// useScrollLock — 全站共用的背景捲動鎖
// ==========================================
// 各元件過去各自寫 document.body.style.overflow，兩個彈層同時開啟時，先關閉的那個
// 會把鎖清掉，另一個還開著卻已經能捲背景。這裡改用引用計數，最後一個解鎖才真正還原。
//
// 另外 body { overflow: hidden } 在 iOS Safari 擋不住背景捲動，必須改用
// position: fixed + 負的 top 位移，解鎖時再把捲動位置還原回去。
import { onUnmounted, watch } from 'vue'

let lockCount = 0
let savedScrollY = 0
let savedScrollX = 0
let savedStyles = []
let fixedBody = false

const preserve = (element, properties) => {
  properties.forEach(property => savedStyles.push([
    element.style, property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property),
  ]))
}

const applyLock = () => {
  savedScrollY = window.scrollY
  savedScrollX = window.scrollX
  const { body, documentElement } = document
  // Measure fractional layout widths, not rounded innerWidth/clientWidth.
  // With scrollbar-gutter: stable the width stays unchanged and no padding is needed.
  const unlockedWidth = documentElement.getBoundingClientRect().width
  const paddingRight = parseFloat(window.getComputedStyle(body).paddingRight) || 0
  savedStyles = []
  preserve(body, ['position', 'top', 'left', 'right', 'overflow', 'padding-right'])
  preserve(documentElement, ['overflow'])
  fixedBody = window.matchMedia('(pointer: coarse)').matches
  // Desktop keeps the body in normal flow, so sticky headers do not jump.
  // Touch browsers retain the fixed-body lock needed by iOS Safari.
  if (fixedBody) {
    body.style.position = 'fixed'
    body.style.top = `-${savedScrollY}px`
    body.style.left = `-${savedScrollX}px`
    body.style.right = '0'
    body.style.overflow = 'hidden'
  }
  documentElement.style.overflow = 'hidden'
  const scrollbarWidth = Math.max(0, documentElement.getBoundingClientRect().width - unlockedWidth)
  if (scrollbarWidth > 0) body.style.paddingRight = `${paddingRight + scrollbarWidth}px`
}

const releaseLock = () => {
  savedStyles.forEach(([style, property, value, priority]) => {
    if (value) style.setProperty(property, value, priority)
    else style.removeProperty(property)
  })
  savedStyles = []
  if (fixedBody) window.scrollTo({ left: savedScrollX, top: savedScrollY, behavior: 'instant' })
}

export const lockBodyScroll = () => {
  lockCount += 1
  if (lockCount === 1) applyLock()
}

export const unlockBodyScroll = () => {
  if (lockCount === 0) return
  lockCount -= 1
  if (lockCount === 0) releaseLock()
}

/**
 * 綁定一個 ref：為 true 時鎖住背景捲動，為 false 或元件卸載時解鎖。
 * 同一個元件不會重複計數 —— 內部自行記錄目前是否持有鎖。
 */
export const useScrollLock = (isLocked) => {
  let held = false

  const sync = (shouldLock) => {
    if (shouldLock === held) return
    held = shouldLock
    if (shouldLock) lockBodyScroll()
    else unlockBodyScroll()
  }

  watch(isLocked, (value) => sync(!!value), { immediate: true })
  onUnmounted(() => sync(false))
}
