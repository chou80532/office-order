// Labels are operator-defined data; they are never inferred from dish names.
export const MAX_DIETARY_TAGS = 30
export const MAX_DIETARY_TAG_LENGTH = 24

export const normalizeDietaryTags = value => Array.isArray(value)
  ? [...new Set(value.filter(tag => typeof tag === 'string').map(tag => tag.trim())
    .filter(tag => tag && tag.length <= MAX_DIETARY_TAG_LENGTH))].slice(0, MAX_DIETARY_TAGS)
  : []

export const normalizeDietaryPreferences = value => ({
  preferredTags: normalizeDietaryTags(value?.preferredTags),
  avoidedTags: normalizeDietaryTags(value?.avoidedTags),
})

export const hasDietaryPreferences = preferences =>
  !!(preferences?.preferredTags?.length || preferences?.avoidedTags?.length)

export function matchesDietaryPreferences(item, preferences) {
  const { preferredTags, avoidedTags } = normalizeDietaryPreferences(preferences)
  if (!hasDietaryPreferences({ preferredTags, avoidedTags })) return true
  const tags = normalizeDietaryTags(item?.tags)
  // Missing labels are unknown, including when only an avoidance is selected.
  return tags.length > 0 && preferredTags.every(tag => tags.includes(tag))
    && !avoidedTags.some(tag => tags.includes(tag))
}

export function commonDishTags(item) {
  const variants = item?._variants || [item]
  return normalizeDietaryTags(variants[0]?.tags)
    .filter(tag => variants.every(variant => normalizeDietaryTags(variant?.tags).includes(tag)))
}

export const stringifyDietaryTags = tags => {
  const normalized = normalizeDietaryTags(tags)
  return normalized.length ? [`@tags ${JSON.stringify(normalized)}`] : []
}
