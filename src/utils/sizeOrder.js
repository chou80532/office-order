const ranks = new Map([
  ['XXS', -2], ['XS', -1], ['特小', -1], ['S', 0], ['小', 0],
  ['M', 1], ['中', 1], ['L', 2], ['大', 2], ['XL', 3], ['特大', 3],
  ['XXL', 4], ['2XL', 4], ['超大', 4], ['XXXL', 5], ['3XL', 5], ['4XL', 6],
])

export function sizeRank(label) {
  const parts = String(label || '').normalize('NFKC').toUpperCase().split(/\s*[·/、]\s*/)
  for (const part of parts) {
    const rank = ranks.get(part.trim().replace(/(?:份|杯|碗|號|尺寸)$/, ''))
    if (rank !== undefined) return rank
  }
  return null
}

// Only reorder recognized sizes, leaving unrelated options in their original slots.
export function sortBySize(items, labelOf) {
  const sized = items.filter(item => sizeRank(labelOf(item)) !== null)
    .sort((a, b) => sizeRank(labelOf(a)) - sizeRank(labelOf(b)))
  let index = 0
  return items.map(item => sizeRank(labelOf(item)) === null ? item : sized[index++])
}
