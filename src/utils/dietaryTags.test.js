import { expect, it } from 'vitest'
import { commonDishTags, matchesDietaryPreferences, normalizeDietaryTags } from './dietaryTags'

it('never treats unlabelled meals as matching a saved preference', () => {
  expect(matchesDietaryPreferences({}, { preferredTags: [], avoidedTags: ['Milk'] })).toBe(false)
  expect(matchesDietaryPreferences({}, {})).toBe(true)
  expect(matchesDietaryPreferences({ tags: ['Vegan'] }, { preferredTags: ['Vegan'], avoidedTags: ['Milk'] })).toBe(true)
  expect(matchesDietaryPreferences({ tags: ['Vegan', 'Milk'] }, { avoidedTags: ['Milk'] })).toBe(false)
  expect(matchesDietaryPreferences({ tags: ['Vegan'] }, { preferredTags: ['Vegan', 'Mild'] })).toBe(false)
})

it('displays only labels shared by every variant', () => {
  expect(commonDishTags({ _variants: [{ tags: ['Vegetarian', 'Milk'] }, { tags: ['Vegetarian'] }] })).toEqual(['Vegetarian'])
  expect(commonDishTags({ _variants: [{ tags: ['Vegan'] }, {}] })).toEqual([])
})

it('bounds and deduplicates labels without coercing unknown data', () => {
  expect(normalizeDietaryTags([' Vegan ', 'Vegan', '', null, 123, 'x'.repeat(25)])).toEqual(['Vegan'])
  expect(normalizeDietaryTags(Array.from({ length: 31 }, (_, i) => `Tag ${i}`))).toHaveLength(30)
})
