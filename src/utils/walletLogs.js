// ==========================================
// 錢包流水顯示工具
// 訂單編輯在資料層是「退款＋重新扣款」兩筆總額紀錄（帳務正確、可逐筆稽核），
// 顯示層依 editGroupId 把配對收合成一列淨額，避免使用者誤讀。
// ==========================================

export const EDIT_LOG_TYPES = new Set(['order_edit_refund', 'order_edit_debit'])

export const MERGED_EDIT_TYPE = 'order_edit'

/**
 * 類型篩選：選「order_edit」時同時命中合併列與尚未配對的原始編輯列。
 */
export const matchesLogTypeFilter = (log, selectedType) => {
  if (selectedType === 'all') return true
  if (selectedType === MERGED_EDIT_TYPE) {
    return log.type === MERGED_EDIT_TYPE || EDIT_LOG_TYPES.has(log.type)
  }
  return log.type === selectedType
}

const firstMealOf = (log) => String(log?.items?.[0]?.meal || '').trim()

/**
 * 把共用 editGroupId 的「退款/扣款」配對合併成一列淨額顯示列。
 * - 只在同一組剛好兩筆（一退一扣）時合併；缺一半或舊資料（無 editGroupId）維持原樣。
 * - 合併列 type 為 'order_edit'，amount 為兩筆加總（淨額），
 *   beforeBalance 取退款前、afterBalance 取扣款後，餘額鏈完整。
 * - 原始兩筆保留在 pairLogs，供展開明細與匯出使用。
 */
export const mergeEditLogPairs = (logs) => {
  const groups = new Map()
  logs.forEach(log => {
    const groupId = String(log?.editGroupId || '')
    if (!groupId || !EDIT_LOG_TYPES.has(log?.type)) return
    if (!groups.has(groupId)) groups.set(groupId, [])
    groups.get(groupId).push(log)
  })

  const consumed = new Set()
  const merged = []
  logs.forEach(log => {
    if (consumed.has(log.id)) return
    const groupId = String(log?.editGroupId || '')
    const pair = groupId ? groups.get(groupId) : null
    const canMerge = Array.isArray(pair)
      && pair.length === 2
      && pair.some(entry => entry.type === 'order_edit_refund')
      && pair.some(entry => entry.type === 'order_edit_debit')

    if (!canMerge || !EDIT_LOG_TYPES.has(log?.type)) {
      merged.push(log)
      return
    }

    pair.forEach(entry => consumed.add(entry.id))
    const refund = pair.find(entry => entry.type === 'order_edit_refund')
    const debit = pair.find(entry => entry.type === 'order_edit_debit')
    const previousMeal = firstMealOf(refund)
    const nextMeal = firstMealOf(debit)
    const mealChangeText = previousMeal && nextMeal && previousMeal !== nextMeal
      ? `${previousMeal} → ${nextMeal}`
      : (nextMeal || previousMeal)

    merged.push({
      id: `edit_${groupId}`,
      type: MERGED_EDIT_TYPE,
      merged: true,
      editGroupId: groupId,
      amount: (Number(refund.amount) || 0) + (Number(debit.amount) || 0),
      beforeBalance: refund.beforeBalance,
      afterBalance: debit.afterBalance,
      timestamp: Number(debit.timestamp) || Number(refund.timestamp) || 0,
      ownerName: debit.ownerName || refund.ownerName || '',
      ownerUid: debit.ownerUid || refund.ownerUid || '',
      operatorName: debit.operatorName || refund.operatorName || '',
      storeName: debit.storeName || refund.storeName || '',
      reason: mealChangeText ? `訂單編輯調整｜${mealChangeText}` : '訂單編輯調整',
      orderId: debit.orderId || refund.orderId || '',
      orderIds: debit.orderIds || refund.orderIds || [],
      items: Array.isArray(debit.items) ? debit.items : [],
      previousItems: Array.isArray(refund.items) ? refund.items : [],
      itemCount: debit.itemCount || 0,
      pairLogs: [refund, debit],
    })
  })

  return merged
}

/** 匯出用的編輯群組短碼，同組兩筆會顯示相同代號。 */
export const editGroupShortId = (log) => {
  const groupId = String(log?.editGroupId || '')
  return groupId ? groupId.slice(0, 8) : ''
}

/**
 * 組出交易紀錄的說明文字「動作｜店家｜品項」。
 * - 有店家或品項（點餐扣款、退款、免費…）：動作｜店家｜品項1、品項2
 * - 無店家也無品項（儲值、管理員修正…）：顯示該筆自訂原因，退而求其次用動作名稱
 */
export const composeLogDescription = (log, actionLabel = '') => {
  const action = String(actionLabel || '').trim()
  const store = String(log?.storeName || '').trim()
  const items = Array.isArray(log?.items) ? log.items : []
  const meals = items
    .map(item => {
      const meal = String(item?.meal || '').trim()
      if (!meal) return ''
      const note = String(item?.note || '').trim()
      return note ? `${meal}（${note}）` : meal
    })
    .filter(Boolean)

  if (!store && !meals.length) {
    return String(log?.reason || '').trim() || action || '—'
  }

  const parts = []
  if (action) parts.push(action)
  if (store) parts.push(store)
  if (meals.length) parts.push(meals.join('、'))
  return parts.join('｜')
}
