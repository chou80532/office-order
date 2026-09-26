import { describe, expect, it } from 'vitest'
import { mealTone } from './mealPresentation'

describe('meal presentation categories', () => {
  it('uses explicit category when the meal name is ambiguous', () => {
    expect(mealTone('米香', 'drink')).toBe('var(--jade)')
    expect(mealTone('每日招牌', '飯類')).toBe('var(--gold)')
  })
  it('uses consistent categories for older records without category data', () => {
    expect(mealTone('招牌雞腿飯')).toBe('var(--gold)')
    expect(mealTone('紅燒牛肉麵')).toBe('var(--persimmon-dark)')
    expect(mealTone('玉米濃湯')).toBe('var(--persimmon-dark)')
    expect(mealTone('四季春青茶')).toBe('var(--jade)')
  })
  it('keeps unknown names neutral and does not misclassify milk noodle dishes', () => {
    expect(mealTone(null)).toBe('var(--ink-faint)')
    expect(mealTone('每日特餐')).toBe('var(--ink-faint)')
    expect(mealTone('牛奶鍋燒意麵')).toBe('var(--persimmon-dark)')
  })
})
