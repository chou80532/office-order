import { afterEach, expect, it, vi } from 'vitest'
import AppDatePicker from '../src/components/ui/AppDatePicker.vue'
import { mountComponent } from './helpers/mountComponent'

let mounted
afterEach(() => {
  mounted?.unmount()
  vi.unstubAllGlobals()
})

it('Escape only restores focus when the calendar is open', () => {
  const listeners = {}
  vi.stubGlobal('document', {
    addEventListener: (name, handler) => { listeners[name] = handler },
    removeEventListener: (name) => { delete listeners[name] },
  })
  vi.stubGlobal('window', { removeEventListener: vi.fn() })
  mounted = mountComponent(AppDatePicker)
  const focus = vi.fn()
  mounted.state.trigger = { focus }
  listeners.keydown({ key: 'Escape' })
  expect(focus).not.toHaveBeenCalled()
  mounted.state.open = true
  listeners.keydown({ key: 'Escape' })
  expect(mounted.state.open).toBe(false)
  expect(focus).toHaveBeenCalledOnce()
  listeners.keydown({ key: 'Escape' })
  expect(focus).toHaveBeenCalledOnce()
})
