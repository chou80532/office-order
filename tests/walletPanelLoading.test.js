import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import WalletPanel from '../src/components/order/WalletPanel.vue'
import { mountComponent } from './helpers/mountComponent'

const backend = vi.hoisted(() => ({ success: null, failure: null, resolve: null }))
vi.mock('../src/firestore', () => ({ db: {} }))
vi.mock('../src/composables/useAuth', () => ({ useAuth: () => ({ userUid: ref('member'), userDisplayName: ref('Member') }) }))
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), query: vi.fn(), where: vi.fn(),
  onSnapshot: (_doc, success, failure) => { backend.success = success; backend.failure = failure; return vi.fn() },
  getDocs: () => new Promise(resolve => { backend.resolve = resolve }),
}))
let mounted
afterEach(() => mounted?.unmount())

it.each(['balance', 'logs'])('waits for both requests when %s arrives first', async (first) => {
  mounted = mountComponent(WalletPanel)
  expect(mounted.state.pageLoading).toBe(true)
  const balanceReady = () => backend.success({ exists: () => true, data: () => ({ balance: 500 }) })
  const logsReady = async () => { backend.resolve({ docs: [] }); await nextTick() }
  if (first === 'balance') balanceReady()
  else await logsReady()
  expect(mounted.state.pageLoading).toBe(true)
  if (first === 'balance') await logsReady()
  else balanceReady()
  expect(mounted.state.pageLoading).toBe(false)
  expect(mounted.state.balance).toBe(500)
})

it('reports balance failure instead of presenting zero as a loaded balance', async () => {
  mounted = mountComponent(WalletPanel)
  backend.failure(new Error('offline'))
  backend.resolve({ docs: [] })
  await nextTick()
  expect(mounted.state.pageLoading).toBe(false)
  expect(mounted.state.walletError).toContain('載入失敗')
})
