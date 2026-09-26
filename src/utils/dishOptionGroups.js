// 多軸選項（選項群組）
//
// 一筆品項可以掛數個「軸」，例如蛋包飯同時要選口味與肉類。沒有這個機制時
// 只能把組合窮舉成一筆一筆的品項（10 口味 × 5 肉類 = 50 筆），改價、加口味
// 都要一次改幾十筆，點餐頁也會變成一整片名字只差兩個字的卡片。
//
// 資料形狀（存在 menu_images.menuItems[].options）：
//   [{ label: '口味', required: true, multiple: false,
//      choices: [{ name: '原味', price: 0 }, { name: '咖哩', price: 0 }] }]
//
// 選擇結果（存在購物車品項的 optionSelections）：
//   [{ label: '口味', choices: [{ name: '咖哩', price: 0 }] }]
// 存的是當下的名稱與價格快照，之後店家改菜單也不會回頭改到已成立的訂單。

export const MAX_OPTION_GROUPS = 6
export const MAX_OPTION_CHOICES = 40
export const MAX_OPTION_LABEL_LENGTH = 12
export const MAX_OPTION_NAME_LENGTH = 20
export const MAX_OPTION_PRICE = 9999

const text = (value, max) => String(value ?? '').trim().slice(0, max)
const money = (value) => {
  const price = Math.round(Number(value) || 0)
  if (!Number.isFinite(price)) return 0
  return Math.max(0, Math.min(MAX_OPTION_PRICE, price))
}

/** 從資料庫或編輯器讀進來的原始值整理成乾淨的軸陣列；壞資料一律丟掉而不是拋錯 */
export function normalizeOptionGroups(raw) {
  if (!Array.isArray(raw)) return []
  const groups = []
  const usedLabels = new Set()
  for (const group of raw) {
    if (!group || typeof group !== 'object') continue
    const label = text(group.label, MAX_OPTION_LABEL_LENGTH)
    if (!label || usedLabels.has(label)) continue
    const choices = []
    const usedNames = new Set()
    for (const choice of Array.isArray(group.choices) ? group.choices : []) {
      const name = typeof choice === 'string' ? text(choice, MAX_OPTION_NAME_LENGTH) : text(choice?.name, MAX_OPTION_NAME_LENGTH)
      if (!name || usedNames.has(name)) continue
      usedNames.add(name)
      choices.push({ name, price: typeof choice === 'string' ? 0 : money(choice?.price) })
      if (choices.length >= MAX_OPTION_CHOICES) break
    }
    if (!choices.length) continue
    usedLabels.add(label)
    groups.push({
      label,
      required: group.required === true,
      multiple: group.multiple === true,
      choices,
    })
    if (groups.length >= MAX_OPTION_GROUPS) break
  }
  return groups
}

/** 存回 Firestore 前用：拿掉 undefined，複選軸不會同時是必選以外的奇怪組合 */
export function serializeOptionGroups(raw) {
  return normalizeOptionGroups(raw).map(group => ({
    label: group.label,
    required: !!group.required,
    multiple: !!group.multiple,
    choices: group.choices.map(choice => ({ name: choice.name, price: choice.price })),
  }))
}

export function hasOptionGroups(item) {
  return normalizeOptionGroups(item?.options).length > 0
}

/** 建立空的選擇結果，並把「只有一個選項的必選軸」直接選好，少按一次 */
export function initialOptionSelections(groups, previous = []) {
  const prior = new Map((Array.isArray(previous) ? previous : []).map(entry => [String(entry?.label || ''), entry]))
  return normalizeOptionGroups(groups).map((group) => {
    const restored = prior.get(group.label)
    const names = new Set((restored?.choices || []).map(choice => String(choice?.name || '')))
    let choices = group.choices.filter(choice => names.has(choice.name))
    if (!group.multiple && choices.length > 1) choices = choices.slice(0, 1)
    if (!choices.length && group.required && !group.multiple && group.choices.length === 1) choices = [group.choices[0]]
    return { label: group.label, choices: choices.map(choice => ({ ...choice })) }
  })
}

export function isOptionChosen(selections, label, choiceName) {
  const entry = (selections || []).find(item => item.label === label)
  return !!entry?.choices?.some(choice => choice.name === choiceName)
}

/** 單選軸點第二次＝換選項；必選軸不允許取消成空的，複選軸可自由開關 */
export function toggleOptionChoice(selections, group, choice) {
  return (selections || []).map((entry) => {
    if (entry.label !== group.label) return entry
    const chosen = entry.choices.some(item => item.name === choice.name)
    if (group.multiple) {
      return { ...entry, choices: chosen ? entry.choices.filter(item => item.name !== choice.name) : [...entry.choices, { ...choice }] }
    }
    if (chosen) return group.required ? entry : { ...entry, choices: [] }
    return { ...entry, choices: [{ ...choice }] }
  })
}

/** 必選軸都選了才算完成；沒有軸的品項永遠算完成 */
export function optionSelectionsComplete(groups, selections) {
  return normalizeOptionGroups(groups).every((group) => {
    if (!group.required) return true
    const entry = (selections || []).find(item => item.label === group.label)
    return !!entry?.choices?.length
  })
}

export function missingRequiredOptionLabels(groups, selections) {
  return normalizeOptionGroups(groups)
    .filter((group) => {
      if (!group.required) return false
      const entry = (selections || []).find(item => item.label === group.label)
      return !entry?.choices?.length
    })
    .map(group => group.label)
}

/** 每一份的選項加價總和（乘份數由呼叫端處理，跟加料同一套邏輯） */
export function optionSelectionsPrice(selections) {
  return (selections || []).reduce(
    (sum, entry) => sum + (entry?.choices || []).reduce((inner, choice) => inner + (Number(choice?.price) || 0), 0),
    0,
  )
}

/** 顯示用：「咖哩 · 牛肉」。軸的順序就是菜單上的順序，不另外排序 */
export function optionSelectionsLabel(selections) {
  return (selections || [])
    .flatMap(entry => (entry?.choices || []).map(choice => choice?.name).filter(Boolean))
    .join(' · ')
}

/** 只保留有選到東西的軸，存進購物車品項 */
export function compactOptionSelections(selections) {
  return (selections || [])
    .filter(entry => entry?.choices?.length)
    .map(entry => ({
      label: entry.label,
      choices: entry.choices.map(choice => ({ name: choice.name, price: Number(choice.price) || 0 })),
    }))
}

/** 編輯器用的檢查，回傳訊息陣列 */
export function optionGroupIssues(rawGroups) {
  const errors = []
  const warnings = []
  const groups = Array.isArray(rawGroups) ? rawGroups : []
  if (!groups.length) return { errors, warnings }
  if (groups.length > MAX_OPTION_GROUPS) errors.push(`選項群組最多 ${MAX_OPTION_GROUPS} 組`)
  const labels = groups.map(group => String(group?.label || '').trim())
  labels.forEach((label, index) => {
    if (!label) errors.push(`第 ${index + 1} 組缺少名稱`)
    else if (labels.indexOf(label) !== index) errors.push(`選項群組「${label}」重複`)
  })
  groups.forEach((group) => {
    const label = String(group?.label || '').trim() || '未命名'
    const choices = Array.isArray(group?.choices) ? group.choices : []
    const names = choices.map(choice => String(choice?.name || '').trim()).filter(Boolean)
    if (!names.length) errors.push(`「${label}」至少要有一個選項`)
    if (new Set(names).size !== names.length) errors.push(`「${label}」裡有重複的選項`)
    if (group?.required && group?.multiple) warnings.push(`「${label}」同時是必選與可複選，點餐時至少要選一項`)
    choices.forEach((choice) => {
      const price = Number(choice?.price)
      if (choice?.price !== '' && choice?.price != null && (!Number.isInteger(price) || price < 0 || price > MAX_OPTION_PRICE)) {
        errors.push(`「${label}」的「${String(choice?.name || '').trim() || '未命名'}」加價需為 0–${MAX_OPTION_PRICE} 的整數`)
      }
    })
  })
  return { errors, warnings }
}

// ── 貼上文字的格式 ────────────────────────────────────────────────
// 品項下面縮排一行就是一個軸：
//   創意蛋包飯 100
//     口味* 原味/咖哩/墨西哥
//     加點 另加肉類+20/加鳳梨類+15
// 星號＝必選，驚嘆號＝可複選，兩個都寫＝必選且可複選。
const GROUP_LINE = /^([^\s*!＊！+/／:：]{1,12})\s*([*!＊！]{0,2})\s*(?:[:：]\s*|\s+)(.+)$/

/**
 * 這一行「看起來就是」選項軸嗎？
 *
 * 縮排很容易在複製貼上、從聊天視窗搬過來的時候被吃掉，所以不能只靠縮排判斷。
 * 只要行內帶著明確的記號就算數：`*` 必選、`!` 可複選，或選項後面的 `+加價`。
 * 一般品項行（`雞腿便當 110`）不會有這些記號，所以兩者分得開。
 */
export function looksLikeOptionGroupLine(line) {
  const raw = String(line || '').trim()
  if (!raw) return false
  if (/^[+＋#＃[【]/.test(raw)) return false // 共用加點與分類行優先
  const match = raw.match(GROUP_LINE)
  if (!match) return false
  const [, , flags, body] = match
  if (flags) return true
  return /[+＋]\s*\d{1,4}(?:\s*[/／、,，]|\s*$)/.test(body)
}

/** 解析一行縮排的軸定義，格式不對就回 null 讓呼叫端當成一般品項 */
export function parseOptionGroupLine(line) {
  const raw = String(line || '').trim()
  if (!raw) return null
  const match = raw.match(GROUP_LINE)
  if (!match) return null
  const [, label, flags, body] = match
  const choices = body
    .split(/[/／、,，]+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map((part) => {
      const priced = part.match(/^(.*?)\s*[+＋]\s*(\d{1,4})$/)
      if (priced) return { name: priced[1].trim().slice(0, MAX_OPTION_NAME_LENGTH), price: money(priced[2]) }
      return { name: part.slice(0, MAX_OPTION_NAME_LENGTH), price: 0 }
    })
    .filter(choice => choice.name)
  if (!choices.length) return null
  return {
    label: label.trim().slice(0, MAX_OPTION_LABEL_LENGTH),
    required: /[*＊]/.test(flags),
    multiple: /[!！]/.test(flags),
    choices,
  }
}

/** 把軸寫回文字格式（編輯器的「複製成文字」與測試用） */
export function stringifyOptionGroups(groups) {
  return normalizeOptionGroups(groups).map((group) => {
    const flags = `${group.required ? '*' : ''}${group.multiple ? '!' : ''}`
    const body = group.choices.map(choice => (choice.price ? `${choice.name}+${choice.price}` : choice.name)).join('/')
    return `  ${group.label}${flags} ${body}`
  })
}
