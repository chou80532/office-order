import { describe, it, expect } from 'vitest'
import {
  normalizeOptionGroups,
  serializeOptionGroups,
  initialOptionSelections,
  toggleOptionChoice,
  optionSelectionsComplete,
  missingRequiredOptionLabels,
  optionSelectionsPrice,
  optionSelectionsLabel,
  compactOptionSelections,
  optionGroupIssues,
  parseOptionGroupLine,
  looksLikeOptionGroupLine,
  stringifyOptionGroups,
} from './dishOptionGroups'

const 蛋包飯 = [
  { label: '口味', required: true, choices: ['原味', '咖哩', '墨西哥'] },
  { label: '肉類', required: true, choices: ['牛肉', '羊肉', '蝦仁'] },
  { label: '加點', multiple: true, choices: [{ name: '另加肉類', price: 20 }, { name: '加鳳梨類', price: 15 }] },
]

describe('選項群組整理', () => {
  it('丟掉壞資料並補齊預設值', () => {
    const groups = normalizeOptionGroups([
      { label: '口味', required: true, choices: ['原味', '咖哩', '咖哩', ''] },
      { label: '口味', choices: ['重複的軸'] },
      { label: '', choices: ['沒有名稱'] },
      { label: '沒有選項', choices: [] },
      null,
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].choices.map(c => c.name)).toEqual(['原味', '咖哩'])
    expect(groups[0]).toMatchObject({ required: true, multiple: false })
    expect(groups[0].choices[0].price).toBe(0)
  })

  it('加價轉成 0–9999 的整數', () => {
    const [group] = normalizeOptionGroups([{ label: '加點', choices: [
      { name: '字串價', price: '20' }, { name: '負數', price: -5 }, { name: '爆表', price: 99999 }, { name: '空的' },
    ] }])
    expect(group.choices.map(c => c.price)).toEqual([20, 0, 9999, 0])
  })

  it('serialize 之後可以安全寫進 Firestore', () => {
    const serialized = serializeOptionGroups(蛋包飯)
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized)
    expect(serialized[2].choices[0]).toEqual({ name: '另加肉類', price: 20 })
  })
})

describe('點餐時的選擇', () => {
  const groups = normalizeOptionGroups(蛋包飯)

  it('必選軸沒選完就不算完成', () => {
    const empty = initialOptionSelections(groups)
    expect(optionSelectionsComplete(groups, empty)).toBe(false)
    expect(missingRequiredOptionLabels(groups, empty)).toEqual(['口味', '肉類'])

    const 選口味 = toggleOptionChoice(empty, groups[0], groups[0].choices[1])
    const 選肉類 = toggleOptionChoice(選口味, groups[1], groups[1].choices[0])
    expect(optionSelectionsComplete(groups, 選肉類)).toBe(true)
    expect(optionSelectionsLabel(選肉類)).toBe('咖哩 · 牛肉')
  })

  it('單選軸再點一次是換選項，不會變成兩個', () => {
    let selections = initialOptionSelections(groups)
    selections = toggleOptionChoice(selections, groups[0], groups[0].choices[0])
    selections = toggleOptionChoice(selections, groups[0], groups[0].choices[2])
    expect(selections[0].choices.map(c => c.name)).toEqual(['墨西哥'])
  })

  it('必選的單選軸不能點到變空的', () => {
    let selections = initialOptionSelections(groups)
    selections = toggleOptionChoice(selections, groups[0], groups[0].choices[0])
    selections = toggleOptionChoice(selections, groups[0], groups[0].choices[0])
    expect(selections[0].choices).toHaveLength(1)
  })

  it('複選軸可以開關並累加價格', () => {
    let selections = initialOptionSelections(groups)
    selections = toggleOptionChoice(selections, groups[2], groups[2].choices[0])
    selections = toggleOptionChoice(selections, groups[2], groups[2].choices[1])
    expect(optionSelectionsPrice(selections)).toBe(35)
    selections = toggleOptionChoice(selections, groups[2], groups[2].choices[0])
    expect(optionSelectionsPrice(selections)).toBe(15)
  })

  it('只有一個選項的必選軸直接選好', () => {
    const single = normalizeOptionGroups([{ label: '飯量', required: true, choices: ['正常'] }])
    expect(initialOptionSelections(single)[0].choices).toHaveLength(1)
  })

  it('回填舊選擇時會濾掉菜單上已經不存在的選項', () => {
    const restored = initialOptionSelections(groups, [
      { label: '口味', choices: [{ name: '咖哩' }] },
      { label: '肉類', choices: [{ name: '已下架的肉' }] },
    ])
    expect(restored[0].choices.map(c => c.name)).toEqual(['咖哩'])
    expect(restored[1].choices).toHaveLength(0)
  })

  it('存進購物車時只留有選到的軸', () => {
    let selections = initialOptionSelections(groups)
    selections = toggleOptionChoice(selections, groups[0], groups[0].choices[1])
    expect(compactOptionSelections(selections)).toEqual([{ label: '口味', choices: [{ name: '咖哩', price: 0 }] }])
  })
})

describe('編輯器檢查', () => {
  it('沒有選項群組時不報任何問題', () => {
    expect(optionGroupIssues([])).toEqual({ errors: [], warnings: [] })
  })

  it('抓出缺名稱、重複與空選項', () => {
    const { errors } = optionGroupIssues([
      { label: '', choices: [{ name: '甲' }] },
      { label: '口味', choices: [{ name: '甲' }, { name: '甲' }] },
      { label: '口味', choices: [{ name: '乙' }] },
      { label: '肉類', choices: [] },
    ])
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('缺少名稱'),
      expect.stringContaining('重複的選項'),
      expect.stringContaining('重複'),
      expect.stringContaining('至少要有一個選項'),
    ]))
  })

  it('必選又複選只給提醒，不擋儲存', () => {
    const { errors, warnings } = optionGroupIssues([{ label: '配菜', required: true, multiple: true, choices: [{ name: '甲' }] }])
    expect(errors).toHaveLength(0)
    expect(warnings).toHaveLength(1)
  })

  it('加價不是整數時擋下來', () => {
    const { errors } = optionGroupIssues([{ label: '加點', choices: [{ name: '甲', price: 1.5 }] }])
    expect(errors).toHaveLength(1)
  })
})

describe('貼上文字的軸格式', () => {
  it('星號是必選、驚嘆號是複選', () => {
    expect(parseOptionGroupLine('口味* 原味/咖哩/墨西哥')).toMatchObject({ label: '口味', required: true, multiple: false })
    expect(parseOptionGroupLine('加點! 另加肉類+20')).toMatchObject({ label: '加點', required: false, multiple: true })
    expect(parseOptionGroupLine('配菜*! 甲/乙')).toMatchObject({ required: true, multiple: true })
  })

  it('全形符號、冒號與頓號都吃得下', () => {
    const group = parseOptionGroupLine('肉類＊：牛肉、羊肉，豬肉')
    expect(group.required).toBe(true)
    expect(group.choices.map(c => c.name)).toEqual(['牛肉', '羊肉', '豬肉'])
  })

  it('選項後面的 +數字 是加價', () => {
    const group = parseOptionGroupLine('加點 另加肉類+20/加鳳梨類 + 15/免費的')
    expect(group.choices).toEqual([
      { name: '另加肉類', price: 20 },
      { name: '加鳳梨類', price: 15 },
      { name: '免費的', price: 0 },
    ])
  })

  it('格式不符時回 null，讓呼叫端當成一般品項', () => {
    expect(parseOptionGroupLine('')).toBeNull()
    expect(parseOptionGroupLine('沒有選項的軸')).toBeNull()
  })

  it('有 * ! 或 +加價 的行，就算沒縮排也認得出是軸', () => {
    expect(looksLikeOptionGroupLine('大小* 小/大+20')).toBe(true)
    expect(looksLikeOptionGroupLine('口味＊ 原味、咖哩')).toBe(true)
    expect(looksLikeOptionGroupLine('加點! 加蛋+15')).toBe(true)
    expect(looksLikeOptionGroupLine('加點 另加肉類+20/加鳳梨+15')).toBe(true)
  })

  it('一般品項行不會被誤認成軸', () => {
    expect(looksLikeOptionGroupLine('雞腿便當 110')).toBe(false)
    expect(looksLikeOptionGroupLine('水餃 5/顆')).toBe(false)
    expect(looksLikeOptionGroupLine('雙人套餐A+B 250')).toBe(false)
    expect(looksLikeOptionGroupLine('# 便當')).toBe(false)
    expect(looksLikeOptionGroupLine('+滷蛋 15')).toBe(false)
    expect(looksLikeOptionGroupLine('口味 原味/咖哩')).toBe(false) // 沒記號，得靠縮排
  })

  it('寫回文字後再解析得到同一組軸', () => {
    const groups = normalizeOptionGroups(蛋包飯)
    const reparsed = stringifyOptionGroups(groups).map(line => parseOptionGroupLine(line.trim()))
    expect(normalizeOptionGroups(reparsed)).toEqual(groups)
  })
})
