// ==========================================
// 全域常數
// ==========================================

// 時間相關（毫秒）
export const ORDERS_QUERY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000   // 14 天
export const CLEANUP_CUTOFF_MS = 30 * 24 * 60 * 60 * 1000        // 30 天
export const LAST_ORDER_HINT_MS = 30 * 60 * 1000                  // 30 分鐘
export const STATS_TIMEOUT_MS = 15000                              // 15 秒
export const TOAST_DURATION_MS = 3000                              // 3 秒
export const UNDO_DURATION_MS = 8000                               // 撤銷視窗（刪除）
export const SUBMIT_UNDO_DURATION_MS = 30000                       // 撤銷視窗（送出）
export const HEADER_TIME_INTERVAL_MS = 60000                       // 1 分鐘
export const LOW_WALLET_BALANCE = 100                              // 低額提醒水位
export const MAX_WALLET_TOP_UP = 10000                             // 單次儲值上限

// 輸入限制
export const MAX_NAME_LENGTH = 20
export const MAX_MEAL_LENGTH = 100
export const MAX_PRICE = 10000
export const MAX_NOTE_LENGTH = 200
export const MAX_ANNOUNCEMENT_LENGTH = 120
export const MAX_MEMBER_NAME_LENGTH = 10
export const MAX_GROUP_NAME_LENGTH = 10
export const MAX_MENU_ITEM_NAME_LENGTH = 50
export const MAX_MENU_ITEM_PRICE = 9999
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024                 // 2MB

// Confetti 預設
export const CONFETTI_SUBMIT = { particleCount: 150, spread: 90, origin: { y: 0.65 } }
export const CONFETTI_RANDOM = { particleCount: 80, spread: 70, origin: { y: 0.6 } }

// 頭像色盤
//
// 頭像上的首字是 --paper（米白），所以每個色都必須是「米白字讀得清楚」的深色。
// 舊的十色對比只有 1.94–4.15，一個都沒過 AA —— 每一顆頭像的字都是糊的。
// 而且含 #4A7FB5、#3D96B8、#7C5CBF 這類鮮豔的藍／青／紫，完全在米紙／墨／
// 柿紅／青瓷／金這套色系之外。
//
// 這一組把飽和度壓到 26–46%、亮度壓到能過 4.5 的深度，色相仍然繞滿一圈
// （十個人要能一眼分辨，這是功能需求，不能只用品牌的四個色相）。
// 實測：對 --paper 的對比 4.85–6.65，彼此最小 ΔE 14.9。
// 補記：第一版把飽和度壓到 26–46% 才過對比，結果十個人在深色底上看起來
// 都是同一種深褐色。這一版把對比條件維持不變（米白字 ≥4.5），改成在那個
// 前提下把彩度拉到 43 左右 —— 品牌色的彩度是柿紅 62、金 54、紫 32、青瓷 21，
// 所以 43 正好落在自家色系的中段，不會像螢光色那樣跳出去。
// 實測：對比 4.80–6.13，彼此最小 ΔE 17.0（前一版 14.9）。
export const AVATAR_COLORS = [
  '#913C27', '#875A17', '#6C6613', '#386115', '#177345',
  '#176E78', '#1E5FA9', '#534B95', '#864F96', '#913061'
]

// 快捷備註預設分組
export const DEFAULT_NOTE_GROUPS = [
  { label: '冰量', icon: 'snowflake', notes: ['正常冰', '少冰', '微冰', '去冰'] },
  { label: '甜度', icon: 'candy-cane', notes: ['正常糖', '半糖', '微糖', '無糖'] },
  { label: '溫度', icon: 'temperature-high', notes: ['溫的', '熱的'] },
  { label: '其他', icon: 'comment-dots', notes: ['不要豆芽菜', '不加蔥', '不加香菜'] }
]

// 邀請碼
export const INVITE_CODE_LENGTH = 6
export const INVITE_CODE_EXPIRY_MS = 60 * 60 * 1000  // 1 小時

// 快速表情符號
export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😡', '👏', '🎉']
