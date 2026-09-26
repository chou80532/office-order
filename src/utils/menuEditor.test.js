import { describe, it, expect } from 'vitest'
import { menuIssues } from './menuEditor'

describe('菜單儲存檢查', () => {
  it('區分阻擋錯誤與需要確認的零元及重複品項', () => {
    const issues = menuIssues([{ name: '', price: '' }, { name: '茶', price: 0 }, { name: '茶', price: 20 }])
    expect(issues[0].errors).toHaveLength(2)
    expect(issues[1].warnings).toHaveLength(2)
    expect(issues[2].warnings).toHaveLength(1)
    expect(menuIssues([{ name: '茶', price: -1 }])[0].errors).toHaveLength(1)
  })
})
