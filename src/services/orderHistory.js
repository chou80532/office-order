import { collection, getDocsFromServer, query, where, orderBy, limit, startAfter } from 'firebase/firestore'
import { db } from '../firestore'

const PAGE_SIZE = 200

// 所選區間自動讀完全部頁，僅在完整成功後回傳，避免將部分資料當成完整報表。
export async function fetchOrdersInRange(startMs, endMs, isCurrent = () => true) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    throw new Error('請選擇有效的起訖日期')
  }
  const records = new Map()
  let cursor = null
  while (isCurrent()) {
    const constraints = [
      where('timestamp', '>=', startMs),
      where('timestamp', '<', endMs),
      orderBy('timestamp', 'desc'),
      limit(PAGE_SIZE),
    ]
    if (cursor) constraints.push(startAfter(cursor))
    const snapshot = await getDocsFromServer(query(collection(db, 'orders'), ...constraints))
    if (!isCurrent()) return []
    snapshot.docs.forEach(doc => records.set(doc.id, { ...doc.data(), id: doc.id }))
    if (snapshot.size < PAGE_SIZE) return [...records.values()]
    cursor = snapshot.docs.at(-1)
  }
  return []
}
