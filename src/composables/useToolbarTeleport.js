import { onBeforeUnmount, onMounted, ref, toValue } from 'vue'

export function useToolbarTeleport(target, minWidth = 1024) {
  const shouldTeleport = ref(false)
  let mediaQuery

  const sync = (event) => {
    shouldTeleport.value = event.matches
  }

  onMounted(() => {
    if (!toValue(target)) return
    mediaQuery = window.matchMedia(`(min-width: ${minWidth}px)`)
    shouldTeleport.value = mediaQuery.matches
    mediaQuery.addEventListener('change', sync)
  })

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', sync)
  })

  return shouldTeleport
}
