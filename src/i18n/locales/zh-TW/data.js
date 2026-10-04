// 工具函式產生、會顯示或存進資料的文字。
export default {
  unknownStore: '未知店家',
  unnamedMeal: '未命名餐點',
  unnamed: '未命名',
  portions: '{count}份',
  legacyNotesGroup: '備註',
  walletEditReason: '訂單編輯調整',
  walletEditReasonDetail: '訂單編輯調整｜{change}',
  popularity: {
    popular: { label: '熱門', description: '大家最近最常訂' },
    regular: { label: '常選', description: '平常也常有人選' },
    explore: { label: '探索', description: '換換口味、找新店' },
  },
  history: {
    invalidRange: '請選擇有效的起訖日期',
    pastOnly: '請選擇今天以前的完整日期區間',
    loadFailed: '歷史訂單未能完整載入，請確認網路後重試。',
  },
  firestore: {
    timeout: '連線逾時，請確認網路後重新整理',
    dailyFailed: '讀取今日店家設定失敗',
    initFailed: '資料庫初始化失敗',
  },
  notSignedIn: '尚未登入',
  descriptionSeparator: '｜',
  mealWithNote: '{meal}（{note}）',
  itemSeparator: '；',
}
