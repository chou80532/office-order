import * as Vue from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'

export function clientRender(source) {
  const { descriptor } = parse(source)
  const { bindings } = compileScript(descriptor, { id: 'test' })
  const { code } = compile(descriptor.template.content, { mode: 'function', prefixIdentifiers: true, bindingMetadata: bindings })
  return new Function('Vue', code)(Vue)
}

// 使用 Vue 真正的 render / event handlers，以記憶體節點取代瀏覽器 DOM。
export function mountComponent(component, props = {}, source = '') {
  // Vitest 的 node 環境產生 SSR 元件；補上同份 template 的 client render 供事件測試。
  if (source) {
    component = { ...component, render: clientRender(source) }
  }
  const node = (type, text = '') => ({
    type, tagName: type.toUpperCase(), text, props: {}, children: [], parent: null, style: {}, listeners: {},
    addEventListener(event, listener) { this.listeners[event] = listener },
    removeEventListener(event) { delete this.listeners[event] },
  })
  const detach = child => {
    if (!child.parent) return
    const siblings = child.parent.children
    siblings.splice(siblings.indexOf(child), 1)
    child.parent = null
  }
  const renderer = Vue.createRenderer({
    createElement: type => node(type),
    createText: text => node('text', text),
    createComment: text => node('comment', text),
    setText: (target, text) => { target.text = text },
    setElementText: (target, text) => { target.text = text; target.children = [] },
    patchProp: (target, key, _previous, value) => { target.props[key] = value },
    insert(child, parent, anchor = null) {
      detach(child)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(child)
      else parent.children.splice(index, 0, child)
      child.parent = parent
    },
    remove: detach,
    parentNode: target => target.parent,
    nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
    querySelector: () => null,
    setScopeId() {},
  })
  const root = node('root')
  const app = renderer.createApp(component, props)
  app.provide(Vue.ssrContextKey, { modules: new Set() })
  app.mount(root)
  const findAll = (predicate, current = root) => [
    ...(predicate(current) ? [current] : []),
    ...current.children.flatMap(child => findAll(predicate, child)),
  ]
  return { root, findAll, unmount: () => app.unmount() }
}
