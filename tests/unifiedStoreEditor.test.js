import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import SmartMenuEditorModal from '../src/components/settings/SmartMenuEditorModal.vue'
import { mountComponent } from './helpers/mountComponent'
import { useSmartMenuDraft } from '../src/composables/useSmartMenuDraft'
import { isAddonMenuItem } from '../src/utils/menuCategories'

vi.mock('../src/firestore', () => ({ db: {} }))
vi.mock('../src/composables/useScrollLock', () => ({ useScrollLock: () => {} }))
vi.mock('../src/composables/useModalA11y', () => ({ useModalA11y: () => {} }))
vi.mock('../src/composables/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
let mounted
beforeEach(() => {
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const { clearDraft } = useSmartMenuDraft()
  clearDraft('原店家'); clearDraft('新店家')
})
afterEach(() => { mounted?.unmount(); vi.unstubAllGlobals() })

it('adds inline batch choices to the selected group and preserves other groups', async () => {
  mounted = mountComponent(SmartMenuEditorModal, {
    store: { name: '原店家', images: [], menuItems: [] }, unifiedEditor: true,
  })
  mounted.state.textInput = '套餐 75\n  小菜* 海帶\n  飲料* 紅茶'
  mounted.state.parseText()
  const [side, drink] = mounted.state.parsedItems[0].options
  mounted.state.openOptionPaste(side)
  mounted.state.optionPasteDrafts.get(side).text = '海帶/豆干+10\n滷蛋+15'
  mounted.state.openOptionPaste(side)
  expect(mounted.state.optionPasteDrafts.get(side).text).toContain('豆干')
  mounted.state.pasteOptionChoices(side)
  expect(side.choices).toEqual([
    { name: '海帶', price: 0 }, { name: '豆干', price: 10 }, { name: '滷蛋', price: 15 },
  ])
  expect(drink.choices).toEqual([{ name: '紅茶', price: 0 }])
  expect(mounted.state.optionPasteDrafts.has(side)).toBe(false)
})

it('renaming the store preserves unsaved menu text and option groups', async () => {
  const store = reactive({ name: '原店家', images: [], menuItems: [] })
  mounted = mountComponent(SmartMenuEditorModal, { store, unifiedEditor: true })
  mounted.state.textInput = '漢堡 50\n  加點! 蛋+15/起司+10'
  mounted.state.parseText()
  await nextTick()
  store.name = '新店家'
  await nextTick()
  expect(mounted.state.parsedItems[0].options[0].choices).toHaveLength(2)
  expect(useSmartMenuDraft().getDraft('新店家').textInput).toContain('漢堡 50')
  expect(useSmartMenuDraft().getDraft('原店家').textInput).toBe('')
})

it('closing asks the store form before emitting close', async () => {
  const onClose = vi.fn()
  const beforeClose = vi.fn().mockResolvedValue(false)
  mounted = mountComponent(SmartMenuEditorModal, {
    store: { name: '原店家', images: [] }, beforeClose, onClose,
  })
  await mounted.state.finishClose()
  expect(beforeClose).toHaveBeenCalledOnce()
  expect(onClose).not.toHaveBeenCalled()
  beforeClose.mockResolvedValue(true)
  await mounted.state.finishClose()
  expect(onClose).toHaveBeenCalledOnce()
})

it('loads existing items and saves shared addons with the store in one callback', async () => {
  const saveAll = vi.fn().mockResolvedValue(true)
  mounted = mountComponent(SmartMenuEditorModal, {
    store: { name: '原店家', docIds: ['menu'], images: [], menuItems: [
      { name: '漢堡', price: 50, category: '主餐' },
      { name: '牧場洗選蛋', price: 15, category: '加點', type: 'addon' },
      { name: '起司', price: 10, category: '加點', type: 'addon' },
    ] }, unifiedEditor: true, saveAll,
  })
  mounted.state.loadExistingToEditor()
  await nextTick()
  expect(mounted.state.parsedItems).toHaveLength(3)
  expect(mounted.state.optionGroupCount(mounted.state.parsedItems[0])).toBe(0)
  expect(mounted.state.optionItemCount).toBe(0)
  expect(mounted.state.textInput).toContain('+牧場洗選蛋 15')
  mounted.state.parsedItems[0].price = 60
  await mounted.state.save()
  expect(saveAll).toHaveBeenCalledOnce()
  const items = saveAll.mock.calls[0][0]
  expect(items[0].price).toBe(60)
  expect(items.filter(isAddonMenuItem).map(item => item.name)).toEqual(['牧場洗選蛋', '起司'])
})

it('parses changed text before saving and keeps the draft on save failure', async () => {
  const saveAll = vi.fn().mockResolvedValue(false)
  mounted = mountComponent(SmartMenuEditorModal, {
    store: { name: '原店家', docIds: ['menu'], images: [] }, unifiedEditor: true, saveAll,
  })
  mounted.state.textInput = '#主餐\n漢堡 50\n#加點\n+牧場洗選蛋 15\n+起司 10'
  await mounted.state.save()
  expect(saveAll.mock.calls[0][0]).toHaveLength(3)
  expect(mounted.state.parsedItems).toHaveLength(3)
  expect(mounted.state.textInput).toContain('+起司 10')
})
