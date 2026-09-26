import { expect, it } from 'vitest'
import { sortBySize } from './sizeOrder'
import { groupDishOptions, sizeLabel } from './dishOptions'

it('orders Chinese sizes without changing prices or source data', () => {
  const items = [{ name: '牛肉麵(大)', price: 100 }, { name: '牛肉麵(小)', price: 80 }]
  expect(sortBySize(items, sizeLabel)).toEqual([items[1], items[0]])
  expect(items[0].price).toBe(100)
})
it('recognizes and groups letter sizes from smallest to largest', () => {
  const items = ['XL', 'S', 'XXL', 'M', 'XS', 'L'].map(size => ({ name: `紅茶(${size})`, price: 30 }))
  const [group] = groupDishOptions(items)
  expect(sortBySize(group._variants, sizeLabel).map(sizeLabel)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL'])
})
it('sorts size choices while preserving unrelated choices and equal-size order', () => {
  const choices = ['大杯', '原味', '小杯', '中杯', '小份']
  expect(sortBySize(choices, name => name)).toEqual(['小杯', '原味', '小份', '中杯', '大杯'])
  expect(sortBySize(['辣', '不辣'], name => name)).toEqual(['辣', '不辣'])
})
