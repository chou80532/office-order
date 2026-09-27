import { expect, it } from 'vitest'
import { escapeCSV } from './csv'

it('preserves zero and false values in exported cells', () => {
  expect(escapeCSV(0)).toBe('"0"')
  expect(escapeCSV(false)).toBe('"false"')
  expect(escapeCSV(null)).toBe('""')
  expect(escapeCSV(undefined)).toBe('""')
})

it('escapes quotes and prevents formula interpretation', () => {
  expect(escapeCSV('a"b')).toBe('"a""b"')
  expect(escapeCSV('=1+1')).toBe('"\'=1+1"')
})
