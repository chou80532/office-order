// 未取得確定結果前，重送同一份不可變的內容與 requestId。
export function prepareSubmission(previous, { items, fallbackName, selectedStoreName, fingerprint, requestId }) {
  if (previous?.items) return previous
  return { items: JSON.parse(JSON.stringify(items)), fallbackName, selectedStoreName, fingerprint, requestId }
}

export function remainingCartItems(items, submitted) {
  const snapshots = new Map(submitted.map(item => [item._key, JSON.stringify(item)]))
  return items.filter(item => snapshots.get(item._key) !== JSON.stringify(item))
}

export const submissionDefinitelyRejected = error => /(?:^|\/)(invalid-argument|failed-precondition|permission-denied|unauthenticated|not-found|out-of-range)$/.test(error?.code || '')
