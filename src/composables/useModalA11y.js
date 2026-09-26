import { onMounted, onBeforeUnmount, nextTick, unref } from 'vue'

// 浮層的鍵盤行為：Escape 關閉、Tab 不會跑出浮層、關閉後焦點回到原本的地方。
//
// 專案裡有 12 個浮層，只有 DishOptionsModal 因為用了原生 <dialog>.showModal()
// 四件事都對。其餘 11 個關閉後焦點都會掉回 <body>，鍵盤使用者等於從頭再 Tab
// 一次；圖片燈箱甚至連 Escape 都沒有。與其在每個元件各補一次（而且各補各的），
// 收成一個 composable。
//
// 用法：
//   const root = ref(null)
//   useModalA11y(root, { onEscape: close })
//   <div ref="root" role="dialog" aria-modal="true"> … </div>
//
// 捲動鎖不在這裡：已經有 useScrollLock，而且不是每個浮層都要鎖（例如
// 貼在按鈕下方的小選單）。需要的元件自己呼叫。

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const visibleFocusable = (root) => {
  if (!root) return []
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute('inert') || el.closest('[inert]')) return false
    // offsetParent 為 null 代表 display:none 或在 position:fixed 之外被隱藏；
    // 用 getClientRects 補掉 fixed 元素的誤判。
    return el.offsetParent !== null || el.getClientRects().length > 0
  })
}

export function useModalA11y(target, options = {}) {
  const { onEscape = null, autofocus = true, trap = true } = options
  let previouslyFocused = null
  let detachKeydown = null

  const root = () => {
    const el = unref(target)
    return el?.$el ?? el ?? null
  }

  const handleKeydown = (event) => {
    if (options.ignoreOtherDialogs && event.target.closest?.('[role="dialog"]') !== root()) return
    if (event.key === 'Escape' && onEscape) {
      event.stopPropagation()
      onEscape()
      return
    }
    if (event.key !== 'Tab' || !trap) return
    const items = visibleFocusable(root())
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    // 焦點已經在浮層外（例如剛開啟還沒 focus）就直接拉回來
    if (!root()?.contains(active)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
      return
    }
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onMounted(async () => {
    previouslyFocused = document.activeElement
    document.addEventListener('keydown', handleKeydown, true)
    detachKeydown = () => document.removeEventListener('keydown', handleKeydown, true)
    if (!autofocus) return
    await nextTick()
    const el = root()
    if (!el) return
    // 優先讓 data-autofocus 指定的元素拿到焦點（通常是「取消」而不是「刪除」），
    // 其次是第一個可聚焦的元素，最後退回浮層本身。
    const preferred = el.querySelector('[data-autofocus]') || visibleFocusable(el)[0]
    if (preferred) { preferred.focus(); return }
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    el.focus()
  })

  onBeforeUnmount(() => {
    detachKeydown?.()
    // 焦點還原：只在焦點還留在浮層內（或已經掉回 body）時才搶回來，
    // 使用者關閉前自己點到別的地方就尊重他。
    const active = document.activeElement
    const inside = root()?.contains(active)
    if (previouslyFocused?.isConnected && (inside || active === document.body || !active)) {
      previouslyFocused.focus()
    }
    previouslyFocused = null
  })
}
