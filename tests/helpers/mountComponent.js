import { createRenderer, ssrContextKey } from 'vue'

// 在記憶體宿主掛載真正的 Vue 元件，測試事件與響應式狀態，不需瀏覽器或 Firebase。
const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null })
const renderer = createRenderer({
  createElement: type => node(type), createText: text => node('text', text), createComment: text => node('comment', text),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1],
  patchProp: (el, key, _old, value) => { el.props[key] = value },
  insert(el, parent, anchor) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    el.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, el)
  },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1) },
})
export function mountComponent(component, props = {}) {
  const root = node('root')
  const app = renderer.createApp({ ...component, render: () => null }, props)
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(root)
  return { state: vm.$.setupState, root, unmount: () => app.unmount() }
}
