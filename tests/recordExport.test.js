import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import fs from 'node:fs'
import RecordTable from '../src/components/order/RecordTable.vue'
import { mountComponent, clientRender } from './helpers/componentRenderer'
import OrderRow from '../src/components/order/OrderRow.vue'
import OrderRowHead from '../src/components/order/OrderRowHead.vue'

OrderRow.render = clientRender(fs.readFileSync(new URL('../src/components/order/OrderRow.vue', import.meta.url), 'utf8'))
OrderRowHead.render = clientRender(fs.readFileSync(new URL('../src/components/order/OrderRowHead.vue', import.meta.url), 'utf8'))

const state = vi.hoisted(() => ({ history: null, range: null }))
vi.mock('../src/composables/useOrderHistory', () => ({
  useOrderHistory: (from, to) => { state.range = { from, to }; return state.history },
}))
vi.mock('../src/composables/useAuth', () => ({ useAuth: () => ({ userDisplayName: { value: 'Member' } }) }))
vi.mock('../src/composables/useToast', () => ({ useToast: () => ({ showToast() {} }) }))
vi.mock('../src/composables/useToolbarTeleport', () => ({ useToolbarTeleport: () => ({ value: false }) }))
vi.mock('../src/components/ui/AppDatePicker.vue', () => ({ default: { template: '<input />' } }))

let mounted
const source = fs.readFileSync(new URL('../src/components/order/RecordTable.vue', import.meta.url), 'utf8')
const mountRecords = () => mountComponent(RecordTable, {}, source)
let downloadedBlob
const anchor = { click: vi.fn() }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-06T04:00:00Z'))
  state.history = { orders: ref([]), loading: ref(false), error: ref(''), ready: ref(true), reload: vi.fn() }
  downloadedBlob = null
  anchor.click.mockClear()
  vi.stubGlobal('document', { createElement: () => anchor })
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloadedBlob = blob; return 'blob:export' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  mounted?.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const exportButton = () => mounted.findAll(node => node.type === 'button' && node.props.class?.includes('export-csv-btn'))[0]

describe('歷史查詢畫面的 CSV 匯出', () => {
  it('實際 CSV 包含全部 451 筆與正確總額', async () => {
    state.history.orders.value = Array.from({ length: 451 }, (_, i) => ({
      id: String(i), name: 'Member', meal: `Meal ${i}`, storeName: 'Store', price: 100,
      timestamp: new Date('2026-09-02T04:00:00Z').getTime(), isFree: i === 0,
    }))
    mounted = mountRecords()
    expect(exportButton().props.disabled).toBe(false)
    await exportButton().props.onClick()
    expect(anchor.click).toHaveBeenCalledOnce()
    const csv = await downloadedBlob.text()
    expect(csv.split('\n')).toHaveLength(453)
    expect(csv).toContain('Meal 450')
    expect(csv.split('\n').at(-1)).toBe('"合計","","451 筆","","45000","",""')
    expect(anchor.download).toBe('歷史訂單_2026-09-01_2026-09-05.csv')
    expect(mounted.findAll(node => node.props.class?.split(' ').includes('order-row'))).toHaveLength(451)
  })

  it.each(['loading', 'error'])('%s 時按鈕及事件都阻止匯出，避免不完整報表', async mode => {
    state.history.ready.value = false
    state.history.loading.value = mode === 'loading'
    state.history.error.value = mode === 'error' ? '未能完整載入' : ''
    mounted = mountRecords()
    expect(exportButton().props.disabled).toBe(true)
    await exportButton().props.onClick()
    expect(anchor.click).not.toHaveBeenCalled()
    expect(downloadedBlob).toBeNull()
    expect(mounted.findAll(node => node.props.class === 'record-kpis')).toHaveLength(0)
  })

  it('每月一日預設查詢上月，避免起訖日期倒置', () => {
    vi.setSystemTime(new Date('2026-09-01T04:00:00Z'))
    mounted = mountRecords()
    expect(state.range.from.value).toBe('2026-08-01')
    expect(state.range.to.value).toBe('2026-08-31')
  })
})
