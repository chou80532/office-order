// Remove declarations superseded by the same selector in the same CSS scope.
// Keep surviving rules in place: moving them can change precedence against
// other selectors or responsive rules. Run with --write to apply the cleanup.
const fs = require('node:fs')
const path = require('node:path')
const postcss = require('postcss')
const { parse } = require('@vue/compiler-sfc')

const write = process.argv.includes('--write')
const files = fs.readdirSync('src', { recursive: true })
  .filter(file => /\.(vue|css)$/.test(file))
  .map(file => path.join('src', file))
let total = 0
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const styles = file.endsWith('.vue') ? parse(source).descriptor.styles : []
  if (styles.some(style => style.lang || style.src || style.module)) continue
  if (styles.length > 1 && !styles.every(style => style.scoped === styles[0].scoped)) continue
  const css = styles.length ? styles.map(style => style.content).join('\n') : source
  if (file.endsWith('.vue') && !styles.length) continue
  const root = postcss.parse(css)
  let removed = 0
  function prune(container) {
    const seen = new Map()
    for (const rule of [...(container.nodes || [])].reverse()) {
      if (rule.type === 'atrule') { prune(rule); continue }
      if (rule.type !== 'rule' || rule.nodes.some(node => !['decl', 'comment'].includes(node.type))) continue
      const variants = new Map()
      for (const selector of rule.selectors) {
        const key = selector.trim().replace(/\s+/g, ' ')
        let properties = seen.get(key)
        if (!properties) { properties = new Map(); seen.set(key, properties) }
        const kept = new Set()
        for (let i = rule.nodes.length - 1; i >= 0; i--) {
          const decl = rule.nodes[i]
          if (decl.type !== 'decl') { kept.add(i); continue }
          const property = decl.prop.startsWith('--') ? decl.prop : decl.prop.toLowerCase()
          const later = properties.get(property)
          if (later && (later.important || !decl.important)) {
            removed++
          } else {
            properties.set(property, decl)
            kept.add(i)
          }
        }
        const signature = [...kept].sort((a, b) => a - b).join(',')
        if (!variants.has(signature)) variants.set(signature, { selectors: [], kept })
        variants.get(signature).selectors.push(selector)
      }
      if (variants.size === 1 && [...variants.values()][0].kept.size === rule.nodes.length) continue
      for (const { selectors, kept } of variants.values()) {
        if (![...kept].some(i => rule.nodes[i].type === 'decl')) continue
        const replacement = rule.clone({ selector: selectors.join(', ') })
        replacement.removeAll()
        rule.nodes.forEach((node, i) => { if (kept.has(i)) replacement.append(node.clone()) })
        rule.before(replacement)
      }
      rule.remove()
    }
  }
  prune(root)
  // Historical redesign markers no longer describe distinct design layers.
  root.walkComments(comment => {
    if (/^(Menu board presentation|Operational layout: grouped rows and restrained surfaces\.|Operational content: one dark workspace, grouped rows, paper only for summaries\.)$/.test(comment.text.trim())) comment.remove()
  })
  const cleaned = root.toString().replace(/\n(?:[\t ]*\r?\n){2,}/g, '\n\n')
  let result = cleaned
  if (styles.length) {
    result = source
    for (let i = styles.length - 1; i >= 0; i--) {
      const style = styles[i]
      if (i === 0) result = result.slice(0, style.loc.start.offset) + '\n' + cleaned.trim() + '\n' + result.slice(style.loc.end.offset)
      else {
        const start = source.lastIndexOf('<style', style.loc.start.offset)
        const end = source.indexOf('</style>', style.loc.end.offset) + '</style>'.length
        result = result.slice(0, start) + result.slice(end)
      }
    }
  }
  result = result.trimEnd() + '\n'
  if (result !== source && write) fs.writeFileSync(file, result)
  if (removed || styles.length > 1) console.log(`${file}: ${removed} superseded declarations; ${styles.length || 1} style blocks`)
  total += removed
}
console.log(`${write ? 'Removed' : 'Found'} ${total} superseded declarations.`)
if (!write && total > 0) process.exitCode = 1
