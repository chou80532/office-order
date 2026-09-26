export function periodBuckets(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return []
  const dayMs = 86400000
  const step = Math.max(1, Math.ceil((endMs - startMs) / dayMs / 6)) * dayMs
  const buckets = []
  for (let start = startMs; start < endMs; start += step) {
    buckets.push({ start, end: Math.min(endMs, start + step), amount: 0 })
  }
  return buckets
}
