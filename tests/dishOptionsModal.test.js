import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, h, nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as menuHelpers from '../src/utils/menuCategories'
import * as dishHelpers from '../src/utils/dishOptions'
import * as constants from '../src/constants'
import * as sizeHelpers from '../src/utils/sizeOrder'
import * as formatHelpers from '../src/utils/format'
import * as optionHelpers from '../src/utils/dishOptionGroups'
import { groupDishOptions } from '../src/utils/dishOptions'
import { menuItemKey } from '../src/utils/menuCategories'

const firestoreMock = { useFirestore: () => ({
  noteGroups: { value: [{ label: '甜度', notes: ['半糖', '無糖'] }, { label: '冰量', notes: ['少冰'] }, { label: '溫度', notes: ['熱的'] }] },
  requireQuickNotes() {}, releaseQuickNotes() {},
}) }
const scrollMock = { lockBodyScroll: vi.fn(), unlockBodyScroll: vi.fn() }
// Compile the client template: the default node test transform only supplies SSR output.
const { descriptor } = parse(readFileSync(new URL('../src/components/order/DishOptionsModal.vue', import.meta.url), 'utf8'))
const compiled = compileScript(descriptor, { id: 'dish-options-test', inlineTemplate: true }).content
const modules = { vue: Vue, '../../composables/useScrollLock': scrollMock, '../../composables/useFirestore': firestoreMock, '../../utils/menuCategories': menuHelpers, '../../utils/dishOptions': dishHelpers, '../../utils/sizeOrder': sizeHelpers, '../../constants': constants }
Object.assign(modules, { '../../utils/format': formatHelpers, '../../utils/dishOptionGroups': optionHelpers })
const clientSource = compiled.replace(/import \{([^}]+)\} from ['"]([^'"]+)['"];?/g, (_, bindings, path) => `const {${bindings.replace(/\bas\b/g, ':')}} = modules[${JSON.stringify(path)}];`).replace('export default', 'return')
const DishOptionsModal = new Function('modules', clientSource)(modules)

// Vue's renderer drives real component events without Firebase or a browser session.
const node = (tag = '', text = '') => ({ tag, tagName: tag.toUpperCase(), text, children: [], props: {}, style: {}, addEventListener() {}, removeEventListener() {}, focus() {}, showModal() {}, getRootNode() { return globalThis.document } })
let app
let root
let body
function mount(context) {
  body = node('body')
  vi.stubGlobal('Document', Object)
  vi.stubGlobal('ShadowRoot', Object)
  vi.stubGlobal('document', { body, activeElement: node('button') })
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
  const renderer = createRenderer({
    createElement: node, createText: text => node('', text), createComment: () => node(),
    setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text },
    patchProp: (el, key, _old, value) => { el.props[key] = value },
    insert(el, parent, anchor) { el.parent = parent; const index = parent.children.indexOf(anchor); parent.children.splice(index < 0 ? parent.children.length : index, 0, el) },
    remove(el) { el?.parent?.children.splice(el.parent.children.indexOf(el), 1) },
    parentNode: el => el.parent, nextSibling: () => null, querySelector: () => body, setScopeId() {},
  })
  const save = vi.fn()
  const close = vi.fn()
  root = node('main')
  app = renderer.createApp({ render: () => h(DishOptionsModal, { context, onSave: save, onClose: close }) })
  app.mount(root)
  return { save, close }
}
const textOf = el => el.text + el.children.map(textOf).join('')
const find = (predicate, el = body) => predicate(el) ? el : el.children.map(child => find(predicate, child)).find(Boolean)
const click = async label => { find(el => el.tag === 'button' && textOf(el).includes(label)).props.onClick(); await nextTick() }
const small = { name: '紅茶(中杯)', category: '飲料', price: 30 }
const large = { name: '紅茶(大杯)', category: '飲料', price: 40 }
const store = { name: '茶店', category: 'drink', menuItems: [small, large, { name: '珍珠', price: 10, type: 'addon' }] }
const context = () => ({ dish: groupDishOptions([small, large])[0], store, storeName: store.name, owner: { ownerName: '會員', ownerUid: 'a' } })
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })

describe('餐點選購視窗互動', () => {
  it('未設定價格的零元餐點不能加入，避免到送單才被後端拒絕', () => {
    const { save } = mount({ dish: { name: '待定價餐點', price: 0 }, store: { name: 'Store' }, storeName: 'Store', owner: { ownerName: '會員', ownerUid: 'a' } })
    find(el => el.tag === 'form').props.onSubmit({ preventDefault() {} })
    expect(save).not.toHaveBeenCalled()
    expect(find(el => el.tag === 'button' && el.props.type === 'submit').props.disabled).toBe(true)
  })
  it('退場期間保留捲動鎖，重複儲存與取消只送出一次', async () => {
    vi.useFakeTimers()
    const { save, close } = mount(context())
    window.matchMedia = () => ({ matches: false })
    await click('大杯')
    const submit = () => find(el => el.tag === 'form').props.onSubmit({ preventDefault() {} })
    submit()
    submit()
    await click('取消')
    expect(save).not.toHaveBeenCalled()
    expect(scrollMock.unlockBodyScroll).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(180)
    expect(save).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    app.unmount()
    app = null
    expect(scrollMock.unlockBodyScroll).toHaveBeenCalledOnce()
  })
  it('動畫期間卸載會清除待送出的事件並以 preventScroll 還原焦點', async () => {
    vi.useFakeTimers()
    const { close } = mount(context())
    window.matchMedia = () => ({ matches: false })
    const focus = vi.fn()
    document.activeElement.isConnected = true
    document.activeElement.focus = focus
    await click('取消')
    app.unmount()
    app = null
    await vi.runAllTimersAsync()
    expect(close).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(scrollMock.unlockBodyScroll).toHaveBeenCalledOnce()
  })
  it('預設一份，增加份數會連同加料計價，重開保留份數與純備註', async () => {
    const { save } = mount(context())
    expect(find(el => el.tag === 'input').value).toBe(1)
    await click('大杯')
    await click('珍珠')
    await click('無糖')
    find(el => el.props['aria-label'] === '增加數量').props.onClick()
    await nextTick()
    find(el => el.tag === 'form').props.onSubmit({ preventDefault() {} })
    const original = save.mock.calls[0][0]
    expect(original).toMatchObject({ price: 100, quantity: 2, note: '2份、無糖', customNote: '無糖' })
    app.unmount()
    mount({ ...context(), original })
    expect(find(el => el.tag === 'input').value).toBe(2)
    expect(find(el => el.tag === 'textarea').value).toBe('無糖')
  })
  it('切換冰熱規格會移除冰量衝突，依規格價格保存', async () => {
    const variants = [{ name: '紅茶(冰)', price: 30, category: '飲料' }, { name: '紅茶(熱)', price: 35, category: '飲料' }]
    const { save } = mount({ ...context(), dish: groupDishOptions(variants)[0] })
    await click('冰 NT$')
    await click('少冰')
    await click('熱 NT$')
    expect(find(el => el.tag === 'button' && textOf(el) === '少冰')).toBeUndefined()
    find(el => el.tag === 'form').props.onSubmit({ preventDefault() {} })
    expect(save.mock.calls[0][0]).toMatchObject({ price: 35, name: '紅茶(熱)', note: '' })
  })
  it('未選規格不能加入；規格、加料與單選備註確認後一起保存', async () => {
    const { save } = mount(context())
    expect(find(el => el.props.class === 'confirm').props.disabled).toBe(true)
    await click('大杯')
    await click('珍珠')
    await click('半糖')
    await click('無糖')
    await click('少冰')
    await click('熱的')
    expect(save).not.toHaveBeenCalled()
    find(el => el.tag === 'form').props.onSubmit({ preventDefault() {} })
    expect(save.mock.calls[0][0]).toMatchObject({ name: large.name, price: 50, note: '無糖、熱的', addons: [{ name: '珍珠', price: 10 }] })
  })
  it('取消修改不更新原本餐點，重開仍保留原設定', async () => {
    const original = { _key: 123, _dishKey: menuItemKey(small, store.name), name: small.name, price: 40, basePrice: 30, note: '半糖', addons: [{ name: '珍珠', price: 10 }], ownerUid: 'a' }
    const { save, close } = mount({ ...context(), original })
    expect(find(el => el.tag === 'button' && textOf(el).includes('中杯')).props['aria-pressed']).toBe(true)
    await click('大杯')
    await click('珍珠')
    await click('取消')
    expect(close).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
    expect(original).toMatchObject({ price: 40, note: '半糖', addons: [{ name: '珍珠', price: 10 }] })
  })
  it('修改儲存保留原購物車識別與會員，並重算價格', async () => {
    const original = { _key: 123, name: small.name, price: 30, note: '半糖', ownerUid: 'original-owner', ownerName: '代訂人' }
    const { save } = mount({ ...context(), original })
    await click('大杯')
    find(el => el.tag === 'form').props.onSubmit({ preventDefault() {} })
    expect(save.mock.calls[0][0]).toMatchObject({ _key: 123, price: 40, ownerUid: 'original-owner', ownerName: '代訂人', note: '半糖' })
  })
})
