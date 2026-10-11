const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { setGlobalOptions } = require('firebase-functions/v2')
const admin = require('firebase-admin')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const crypto = require('crypto')

admin.initializeApp()
setGlobalOptions({ maxInstances: 3 })

const db = admin.firestore()
const MAX_ORDER_ITEMS = 100
// 金額一律以幣別的最小單位整數儲存（TWD、JPY 為元；USD、EUR 為分）。單筆餐點與儲值上限由
// settings/system.limits 設定；讀取既有帳務時改用絕對上限，避免管理員調低設定後舊單無法退款。
const ABSOLUTE_MAX_AMOUNT = 100_000_000
const MAX_WALLET_TRANSACTION = ABSOLUTE_MAX_AMOUNT
const MAX_NAME_LENGTH = 80
const MAX_STORE_NAME_LENGTH = 120
const MAX_MEAL_LENGTH = 100
const MAX_NOTE_LENGTH = 200
const MAX_CANCEL_ITEMS = 100

const roundMoney = (value) => Math.round(Number(value) || 0)
const finiteMoney = (value, { min, max, code }) => {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new HttpsError('invalid-argument', code)
  const rounded = Math.round(number)
  if ((min !== undefined && rounded < min) || (max !== undefined && rounded > max)) {
    throw new HttpsError('invalid-argument', code)
  }
  return rounded
}
const walletIdForUid = (uid) => String(uid || '').trim()
const walletRefForUid = (uid) => db.collection('wallets').doc(walletIdForUid(uid))
// 代訂公開名單：只鏡射姓名與 uid，供全體成員挑選代訂對象（不含 email／isAdmin）。
const memberRosterRef = (uid) => db.collection('member_roster').doc(String(uid || '').trim())
const walletLogRef = () => db.collection('wallet_logs').doc()
const cashPaymentRef = () => db.collection('cash_payments').doc()
const cashPaymentLogRef = () => db.collection('cash_payment_logs').doc()
const CLEANUP_CONFIRMATION = '刪除選取區間資料'
const MAX_CLEANUP_WRITES = 400

// transaction.getAll 不接受空參數，統一在這裡防守。
const getAllInTransaction = (transaction, refs) =>
  refs.length ? transaction.getAll(...refs) : Promise.resolve([])

// ==========================================
// 系統設定 settings/system。文件或欄位不存在時沿用升級前的行為（台北時區、繁體中文、新台幣、
// 錢包與現金皆可、全體成員可代訂），既有部署更新程式後不必先補設定。
// 前端 src/utils/systemSettings.js 使用相同規則，兩邊修改時需同步。
// ==========================================
const DEFAULT_TIME_ZONE = 'Asia/Taipei'
const SUPPORTED_LOCALES = ['zh-TW', 'en']
// 小數位數決定最小單位與主單位的換算倍率；新台幣實務上不使用角、分，所以是 0。
const CURRENCY_DECIMALS = {
  TWD: 0, JPY: 0, KRW: 0, IDR: 0, VND: 0,
  HKD: 2, CNY: 2, SGD: 2, MYR: 2, THB: 2, PHP: 2, INR: 2,
  USD: 2, CAD: 2, AUD: 2, NZD: 2, EUR: 2, GBP: 2, CHF: 2,
}
const PROXY_ORDERING_MODES = ['all', 'consent', 'admins', 'off']
const BRAND_ACCENTS = ['persimmon', 'indigo', 'forest', 'plum', 'teal', 'charcoal']
const MIN_RETENTION_DAYS = 30
const MAX_RETENTION_DAYS = 3650
const MAX_EMAIL_DOMAINS = 20
const MAX_BRAND_NAME_LENGTH = 40
const MIN_SETUP_TOKEN_LENGTH = 16
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const EMAIL_DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const defaultLimits = (currency) => {
  if (currency === 'IDR' || currency === 'VND') return { maxItemPrice: 1_000_000, maxTopUp: 5_000_000, lowBalance: 100_000 }
  if (currency === 'KRW') return { maxItemPrice: 100_000, maxTopUp: 500_000, lowBalance: 10_000 }
  if (currency === 'JPY') return { maxItemPrice: 10_000, maxTopUp: 50_000, lowBalance: 1_000 }
  if (CURRENCY_DECIMALS[currency] > 0) return { maxItemPrice: 10_000, maxTopUp: 50_000, lowBalance: 1_000 }
  return { maxItemPrice: 10_000, maxTopUp: 10_000, lowBalance: 100 }
}

// 回傳 IANA 標準名稱（例如 asia/taipei → Asia/Taipei）；無效時回傳空字串。
const canonicalTimeZone = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).resolvedOptions().timeZone
  } catch {
    return ''
  }
}
const normalizeEmailDomain = (value) => {
  const domain = String(value || '').trim().toLowerCase().replace(/^@/, '')
  return EMAIL_DOMAIN_PATTERN.test(domain) ? domain : ''
}
// 品牌 Logo 只接受 https，或本機 Emulator 的 http 位址。
const normalizeLogoUrl = (value) => {
  const text = String(value || '').trim()
  if (!text || text.length > 2000) return ''
  try {
    const url = new URL(text)
    if (url.protocol === 'https:') return url.href
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return url.href
  } catch { /* 無效網址 */ }
  return ''
}
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
// Keep limits aligned with src/utils/dietaryTags.js.
const normalizeDietaryTags = value => Array.isArray(value)
  ? [...new Set(value.filter(tag => typeof tag === 'string').map(tag => tag.trim())
    .filter(tag => tag && tag.length <= 24))].slice(0, 30) : []
const validDietaryTags = value => Array.isArray(value) && value.length <= 30
  && value.every(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.trim().length <= 24)
const amountOr = (value, fallback, min = 1) =>
  Number.isInteger(value) && value >= min && value <= ABSOLUTE_MAX_AMOUNT ? value : fallback

const normalizeSystemSettings = (data = {}) => {
  const currency = Object.hasOwn(CURRENCY_DECIMALS, data?.currency) ? data.currency : 'TWD'
  const limitDefaults = defaultLimits(currency)
  const retentionDays = data?.retention?.autoDeleteDays
  const domains = Array.isArray(data?.registration?.allowedEmailDomains)
    ? [...new Set(data.registration.allowedEmailDomains.map(normalizeEmailDomain).filter(Boolean))].slice(0, MAX_EMAIL_DOMAINS)
    : []
  return {
    timeZone: canonicalTimeZone(data?.timeZone) || DEFAULT_TIME_ZONE,
    locale: SUPPORTED_LOCALES.includes(data?.locale) ? data.locale : 'zh-TW',
    currency,
    limits: {
      maxItemPrice: amountOr(data?.limits?.maxItemPrice, limitDefaults.maxItemPrice),
      maxTopUp: amountOr(data?.limits?.maxTopUp, limitDefaults.maxTopUp),
      lowBalance: amountOr(data?.limits?.lowBalance, limitDefaults.lowBalance, 0),
    },
    // 兩種付款方式都停用代表「只統計訂單、不收款」。
    paymentMethods: { wallet: data?.paymentMethods?.wallet !== false, cash: data?.paymentMethods?.cash !== false },
    proxyOrdering: PROXY_ORDERING_MODES.includes(data?.proxyOrdering) ? data.proxyOrdering : 'all',
    registration: { allowedEmailDomains: domains, googleSignIn: data?.registration?.googleSignIn === true },
    subsidy: {
      monthlyAllowance: amountOr(data?.subsidy?.monthlyAllowance, 0, 0),
      effectiveFrom: MONTH_KEY_PATTERN.test(String(data?.subsidy?.effectiveFrom || '')) ? data.subsidy.effectiveFrom : '',
    },
    retention: {
      autoDeleteDays: Number.isInteger(retentionDays) && retentionDays >= MIN_RETENTION_DAYS && retentionDays <= MAX_RETENTION_DAYS
        ? retentionDays
        : 0,
    },
    branding: {
      name: String(data?.branding?.name || '').trim().slice(0, MAX_BRAND_NAME_LENGTH),
      logoUrl: normalizeLogoUrl(data?.branding?.logoUrl),
      accent: BRAND_ACCENTS.includes(data?.branding?.accent) ? data.branding.accent : 'persimmon',
    },
    ordering: {
      defaultCutoff: TIME_OF_DAY_PATTERN.test(String(data?.ordering?.defaultCutoff || '')) ? data.ordering.defaultCutoff : '',
    },
    dietary: { enabled: data?.dietary?.enabled === true, tags: normalizeDietaryTags(data?.dietary?.tags) },
  }
}

// 管理員送出的設定採嚴格驗證：格式錯誤直接拒絕，不靜默套用預設值。未提供的欄位保留原值。
const parseSystemSettingsInput = (input, current) => {
  const fail = (code) => { throw new HttpsError('invalid-argument', code) }
  if (!isPlainObject(input)) fail('INVALID_SYSTEM_SETTINGS')
  const next = JSON.parse(JSON.stringify(current))
  const section = (key, code) => {
    if (input[key] === undefined) return null
    if (!isPlainObject(input[key])) fail(code)
    return input[key]
  }

  if (input.timeZone !== undefined) next.timeZone = canonicalTimeZone(input.timeZone) || fail('INVALID_TIME_ZONE')
  if (input.locale !== undefined) {
    if (!SUPPORTED_LOCALES.includes(input.locale)) fail('INVALID_LOCALE')
    next.locale = input.locale
  }
  if (input.currency !== undefined) {
    if (!Object.hasOwn(CURRENCY_DECIMALS, input.currency)) fail('INVALID_CURRENCY')
    next.currency = input.currency
  }
  const limits = section('limits', 'INVALID_LIMITS')
  if (limits) {
    for (const [key, min] of [['maxItemPrice', 1], ['maxTopUp', 1], ['lowBalance', 0]]) {
      if (limits[key] === undefined) continue
      if (!Number.isInteger(limits[key]) || limits[key] < min || limits[key] > ABSOLUTE_MAX_AMOUNT) fail('INVALID_LIMITS')
      next.limits[key] = limits[key]
    }
  }
  if (input.paymentMethods !== undefined) {
    const { wallet, cash } = input.paymentMethods || {}
    if (typeof wallet !== 'boolean' || typeof cash !== 'boolean') fail('INVALID_PAYMENT_METHODS')
    next.paymentMethods = { wallet, cash }
  }
  if (input.proxyOrdering !== undefined) {
    if (!PROXY_ORDERING_MODES.includes(input.proxyOrdering)) fail('INVALID_PROXY_ORDERING')
    next.proxyOrdering = input.proxyOrdering
  }
  const registration = section('registration', 'INVALID_REGISTRATION')
  if (registration) {
    if (registration.allowedEmailDomains !== undefined) {
      const list = registration.allowedEmailDomains
      if (!Array.isArray(list) || list.length > MAX_EMAIL_DOMAINS) fail('INVALID_EMAIL_DOMAIN')
      const domains = list.map(normalizeEmailDomain)
      if (domains.some(domain => !domain)) fail('INVALID_EMAIL_DOMAIN')
      next.registration.allowedEmailDomains = [...new Set(domains)]
    }
    if (registration.googleSignIn !== undefined) {
      if (typeof registration.googleSignIn !== 'boolean') fail('INVALID_REGISTRATION')
      next.registration.googleSignIn = registration.googleSignIn
    }
  }
  const subsidy = section('subsidy', 'INVALID_SUBSIDY')
  if (subsidy) {
    if (subsidy.monthlyAllowance !== undefined) {
      const amount = subsidy.monthlyAllowance
      if (!Number.isInteger(amount) || amount < 0 || amount > ABSOLUTE_MAX_AMOUNT) fail('INVALID_SUBSIDY')
      next.subsidy.monthlyAllowance = amount
    }
    if (subsidy.effectiveFrom !== undefined) {
      if (subsidy.effectiveFrom !== '' && !MONTH_KEY_PATTERN.test(String(subsidy.effectiveFrom))) fail('INVALID_SUBSIDY')
      next.subsidy.effectiveFrom = subsidy.effectiveFrom
    }
  }
  const retention = section('retention', 'INVALID_RETENTION_DAYS')
  if (retention && retention.autoDeleteDays !== undefined) {
    const days = retention.autoDeleteDays
    if (!Number.isInteger(days) || (days !== 0 && (days < MIN_RETENTION_DAYS || days > MAX_RETENTION_DAYS))) fail('INVALID_RETENTION_DAYS')
    next.retention.autoDeleteDays = days
  }
  const branding = section('branding', 'INVALID_BRANDING')
  if (branding) {
    if (branding.name !== undefined) {
      if (typeof branding.name !== 'string' || branding.name.trim().length > MAX_BRAND_NAME_LENGTH) fail('INVALID_BRANDING')
      next.branding.name = branding.name.trim()
    }
    if (branding.logoUrl !== undefined) {
      const logoUrl = normalizeLogoUrl(branding.logoUrl)
      if (branding.logoUrl !== '' && !logoUrl) fail('INVALID_BRANDING')
      next.branding.logoUrl = logoUrl
    }
    if (branding.accent !== undefined) {
      if (!BRAND_ACCENTS.includes(branding.accent)) fail('INVALID_BRANDING')
      next.branding.accent = branding.accent
    }
  }
  const ordering = section('ordering', 'INVALID_CUTOFF_TIME')
  if (ordering && ordering.defaultCutoff !== undefined) {
    if (ordering.defaultCutoff !== '' && !TIME_OF_DAY_PATTERN.test(String(ordering.defaultCutoff))) fail('INVALID_CUTOFF_TIME')
    next.ordering.defaultCutoff = ordering.defaultCutoff
  }
  const dietary = section('dietary', 'INVALID_DIETARY_SETTINGS')
  if (dietary) {
    if (dietary.enabled !== undefined) {
      if (typeof dietary.enabled !== 'boolean') fail('INVALID_DIETARY_SETTINGS')
      next.dietary.enabled = dietary.enabled
    }
    if (dietary.tags !== undefined) {
      if (!validDietaryTags(dietary.tags)) fail('INVALID_DIETARY_SETTINGS')
      next.dietary.tags = normalizeDietaryTags(dietary.tags)
    }
  }
  return next
}

const systemSettingsRef = () => db.collection('settings').doc('system')
const readSystemSettings = async () => {
  const snap = await systemSettingsRef().get()
  return normalizeSystemSettings(snap.exists ? snap.data() : {})
}
// 「需本人同意」模式下一般成員仍可代訂，但對象必須自行開啟授權（建單時逐筆檢查）。
const canProxyOrder = (settings, isAdmin) =>
  ['all', 'consent'].includes(settings.proxyOrdering) || (settings.proxyOrdering === 'admins' && Boolean(isAdmin))
const trackingOnly = settings => !settings.paymentMethods.wallet && !settings.paymentMethods.cash
const paymentMethodEnabled = (settings, method) =>
  method === 'none' ? trackingOnly(settings) : Boolean(settings.paymentMethods[method])

// ==========================================
// 時區日期工具：日期 key（YYYY-MM-DD）與前端 getLocalDateKey、settings/daily 的 serviceDate 對齊。
// ==========================================
const zonedPartsFormatters = new Map()
const zonedParts = (date, timeZone) => {
  if (!zonedPartsFormatters.has(timeZone)) {
    zonedPartsFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }))
  }
  return Object.fromEntries(zonedPartsFormatters.get(timeZone).formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]))
}
const dateKeyInZone = (timeZone, date = new Date()) => {
  const { year, month, day } = zonedParts(date, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
const monthKeyInZone = (timeZone, date = new Date()) => dateKeyInZone(timeZone, date).slice(0, 7)
const shiftMonthKey = (monthKey, months) => {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 7)
}
const shiftDateKey = (dateKey, days) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}
// 指定日期與牆上時間在該時區的時間戳；修正兩次以涵蓋日光節約時間切換。
const zonedDayStartMs = (dateKey, timeZone, hour = 0, minute = 0) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute)
  const offsetAt = (timestamp) => {
    const parts = zonedParts(new Date(timestamp), timeZone)
    const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    return zonedAsUtc - Math.floor(timestamp / 1000) * 1000
  }
  return wallClockMs - offsetAt(wallClockMs - offsetAt(wallClockMs))
}

// ==========================================
// 收單截止：settings/system.ordering.defaultCutoff 為每日預設，settings/daily.cutoff
// 是管理員對「當天」的調整（{ date, time }，time 為空字串代表今天不截止）。
// ==========================================
const effectiveCutoffTime = (settings, daily, todayKey) => {
  const override = daily?.cutoff && daily.cutoff.date === todayKey ? daily.cutoff : null
  const time = override ? String(override.time || '') : settings.ordering.defaultCutoff
  return TIME_OF_DAY_PATTERN.test(time) ? time : ''
}
const cutoffTimestamp = (settings, daily, todayKey) => {
  const time = effectiveCutoffTime(settings, daily, todayKey)
  if (!time) return null
  const [hour, minute] = time.split(':').map(Number)
  return zonedDayStartMs(todayKey, settings.timeZone, hour, minute)
}
const isOrderingClosed = (settings, daily, now = Date.now()) => {
  const closesAt = cutoffTimestamp(settings, daily, dateKeyInZone(settings.timeZone, new Date(now)))
  return closesAt !== null && now >= closesAt
}
const readDaily = async (transaction = null) => {
  const ref = db.collection('settings').doc('daily')
  const snap = transaction ? await transaction.get(ref) : await ref.get()
  return snap.exists ? snap.data() : null
}

const dinerKey = (uid, name) => crypto.createHash('sha256').update(uid ? `uid:${uid}` : `name:${name}`).digest('hex')
const diningRef = (timeZone) => db.collection('dining_days').doc(dateKeyInZone(timeZone))
const readDining = async (transaction, timeZone) => {
  const ref = diningRef(timeZone)
  const snap = await transaction.get(ref)
  const data = snap.exists ? snap.data() : {}
  // 店名等資料鍵不能命中 Object 的繼承屬性。
  return { ref, data: {
    ...data,
    participants: Object.assign(Object.create(null), data.participants),
    needs: Object.assign(Object.create(null), data.needs),
    replacements: Object.assign(Object.create(null), data.replacements),
  } }
}

const normalizeMemberName = (value) => String(value || '').trim().replace(/\s+/g, ' ')
const memberNameKey = (value) => crypto
  .createHash('sha256')
  .update(normalizeMemberName(value).toLocaleLowerCase('zh-TW'), 'utf8')
  .digest('hex')

// 帳號可由 Firebase Auth 建立，但只有成功兌換邀請碼後才會成為系統會員。
exports.completeInviteRegistration = onCall(async (request) => {
  const uid = requireAuth(request)
  const code = String(request.data?.inviteCode || '').trim().toUpperCase()
  if (!code || code.includes('/') || code.length > 32) {
    throw new HttpsError('invalid-argument', 'INVALID_CODE')
  }

  const codeRef = db.collection('inviteCodes').doc(code)
  const userRef = db.collection('users').doc(uid)
  const now = Timestamp.now()

  const initialCodeSnap = await codeRef.get()
  if (!initialCodeSnap.exists) throw new HttpsError('not-found', 'INVALID_CODE')
  const requestedName = normalizeMemberName(initialCodeSnap.data().memberName)
  const requestedNameKey = memberNameKey(requestedName)
  const nameKeySnap = await db.collection('member_name_keys').doc(requestedNameKey).get()
  if (nameKeySnap.exists) {
    if (nameKeySnap.data().uid !== uid) {
      const ownerSnap = await db.collection('users').doc(String(nameKeySnap.data().uid)).get()
      if (ownerSnap.exists) throw new HttpsError('already-exists', 'MEMBER_NAME_TAKEN')
    }
  } else {
    // 相容既有資料：舊會員尚未建立唯一姓名鍵時，退回全集合掃描擋下正規化後的重名。
    const existingUsers = await db.collection('users').get()
    const duplicate = existingUsers.docs.find(doc =>
      doc.id !== uid && memberNameKey(doc.data().memberName) === requestedNameKey)
    if (duplicate) throw new HttpsError('already-exists', 'MEMBER_NAME_TAKEN')
  }

  return db.runTransaction(async (transaction) => {
    const codeSnap = await transaction.get(codeRef)
    if (!codeSnap.exists) throw new HttpsError('not-found', 'INVALID_CODE')

    const codeData = codeSnap.data()
    if (codeData.used) throw new HttpsError('already-exists', 'CODE_USED')
    if (codeData.expiresAt?.toMillis?.() < now.toMillis()) {
      throw new HttpsError('deadline-exceeded', 'CODE_EXPIRED')
    }

    const name = normalizeMemberName(codeData.memberName)
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new HttpsError('failed-precondition', 'INVALID_MEMBER_NAME')
    }

    const nameRef = db.collection('member_name_keys').doc(memberNameKey(name))
    const userSnap = await transaction.get(userRef)
    const nameSnap = await transaction.get(nameRef)
    if (userSnap.exists) throw new HttpsError('already-exists', 'PROFILE_EXISTS')
    if (nameSnap.exists && nameSnap.data().uid !== uid) {
      const previousOwner = await transaction.get(db.collection('users').doc(nameSnap.data().uid))
      if (previousOwner.exists) throw new HttpsError('already-exists', 'MEMBER_NAME_TAKEN')
    }

    // 若舊帳號已由管理員移除，可安全接管其姓名鍵。
    transaction.set(nameRef, { uid, memberName: name, createdAt: now })
    transaction.create(userRef, {
      email: String(request.auth?.token?.email || ''),
      memberName: name,
      memberNameKey: nameRef.id,
      isAdmin: false,
      createdAt: now,
      lastLoginAt: now,
    })
    // 同步公開名單，讓新成員立即可被代訂。
    transaction.set(memberRosterRef(uid), { uid, name })
    transaction.update(codeRef, { used: true, usedBy: uid, usedAt: now })

    return { ok: true, memberName: name }
  })
})

// 姓名鍵尚未建立的舊會員只能用全集合掃描比對，因此在交易外先檢查一次。
const assertMemberNameAvailable = async (uid, name) => {
  const requestedNameKey = memberNameKey(name)
  const nameKeySnap = await db.collection('member_name_keys').doc(requestedNameKey).get()
  if (nameKeySnap.exists) {
    if (nameKeySnap.data().uid === uid) return
    const ownerSnap = await db.collection('users').doc(String(nameKeySnap.data().uid)).get()
    if (ownerSnap.exists) throw new HttpsError('already-exists', 'MEMBER_NAME_TAKEN')
    return
  }
  const existingUsers = await db.collection('users').get()
  const duplicate = existingUsers.docs.find(doc =>
    doc.id !== uid && memberNameKey(doc.data().memberName) === requestedNameKey)
  if (duplicate) throw new HttpsError('already-exists', 'MEMBER_NAME_TAKEN')
}

// ==========================================
// 公司信箱自助註冊：Email 網域列在 settings/system.registration.allowedEmailDomains，
// 且 Firebase Auth 已確認信箱（Google 登入，或已點過驗證信），即可自行設定姓名成為成員。
// ==========================================
const MAX_SELF_REGISTERED_NAME_LENGTH = 20

exports.completeDomainRegistration = onCall(async (request) => {
  const uid = requireAuth(request)
  const email = String(request.auth?.token?.email || '').trim().toLowerCase()
  const domain = email.includes('@') ? email.split('@').pop() : ''
  const settings = await readSystemSettings()
  if (!domain || !settings.registration.allowedEmailDomains.includes(domain)) {
    throw new HttpsError('permission-denied', 'EMAIL_DOMAIN_NOT_ALLOWED')
  }
  if (request.auth?.token?.email_verified !== true) throw new HttpsError('failed-precondition', 'EMAIL_NOT_VERIFIED')

  const name = normalizeMemberName(request.data?.memberName)
  if (!name || name.length > MAX_SELF_REGISTERED_NAME_LENGTH) throw new HttpsError('invalid-argument', 'INVALID_MEMBER_NAME')
  await assertMemberNameAvailable(uid, name)

  const userRef = db.collection('users').doc(uid)
  const nameRef = db.collection('member_name_keys').doc(memberNameKey(name))
  const now = Timestamp.now()

  return db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef)
    const nameSnap = await transaction.get(nameRef)
    if (userSnap.exists) throw new HttpsError('already-exists', 'PROFILE_EXISTS')
    if (nameSnap.exists && nameSnap.data().uid !== uid) {
      const previousOwner = await transaction.get(db.collection('users').doc(nameSnap.data().uid))
      if (previousOwner.exists) throw new HttpsError('already-exists', 'MEMBER_NAME_TAKEN')
    }

    transaction.set(nameRef, { uid, memberName: name, createdAt: now })
    transaction.create(userRef, {
      email,
      memberName: name,
      memberNameKey: nameRef.id,
      isAdmin: false,
      registeredVia: 'email_domain',
      createdAt: now,
      lastLoginAt: now,
    })
    transaction.set(memberRosterRef(uid), { uid, name })
    return { ok: true, memberName: name }
  })
})

// 成員自己的偏好設定。代訂授權同步到公開名單，購物車才能判斷可否代訂。
exports.updateMyPreferences = onCall(async (request) => {
  const uid = requireAuth(request)
  const allowProxyOrders = request.data?.allowProxyOrders
  const dietary = request.data?.dietary
  const hasConsent = allowProxyOrders !== undefined
  if ((!hasConsent && dietary === undefined) || (hasConsent && typeof allowProxyOrders !== 'boolean')) {
    throw new HttpsError('invalid-argument', 'INVALID_PREFERENCES')
  }
  const patch = hasConsent ? { allowProxyOrders } : {}
  if (dietary !== undefined) {
    if (!isPlainObject(dietary) || !validDietaryTags(dietary.preferredTags) || !validDietaryTags(dietary.avoidedTags)) {
      throw new HttpsError('invalid-argument', 'INVALID_PREFERENCES')
    }
    patch.dietary = {
      preferredTags: normalizeDietaryTags(dietary.preferredTags),
      avoidedTags: normalizeDietaryTags(dietary.avoidedTags),
    }
    if (patch.dietary.preferredTags.some(tag => patch.dietary.avoidedTags.includes(tag))) {
      throw new HttpsError('invalid-argument', 'INVALID_PREFERENCES')
    }
  }

  await db.runTransaction(async (transaction) => {
    const userRef = db.collection('users').doc(uid)
    const userSnap = await transaction.get(userRef)
    if (!userSnap.exists || userSnap.data().accountDeletionPending) {
      throw new HttpsError('permission-denied', '需要已註冊使用者權限')
    }
    if (patch.dietary) {
      const settingsSnap = await transaction.get(systemSettingsRef())
      const settings = normalizeSystemSettings(settingsSnap.exists ? settingsSnap.data() : {})
      const chosen = [...patch.dietary.preferredTags, ...patch.dietary.avoidedTags]
      if (!settings.dietary.enabled || chosen.some(tag => !settings.dietary.tags.includes(tag))) {
        throw new HttpsError('invalid-argument', 'INVALID_PREFERENCES')
      }
    }
    transaction.update(userRef, patch)
    if (hasConsent) transaction.set(memberRosterRef(uid), {
      uid, name: normalizeMemberName(userSnap.data().memberName), allowProxyOrders,
    })
  })
  return { ok: true, ...patch }
})

// 管理員調整「今天」的收單時間：time 為 'HH:MM'、'now'（立即收單）、''（今天不截止）或 null（恢復預設）。
exports.setDailyCutoff = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)
  const settings = await readSystemSettings()
  const todayKey = dateKeyInZone(settings.timeZone)
  const requested = request.data?.time
  let time = requested
  if (requested === 'now') {
    const { hour, minute } = zonedParts(new Date(), settings.timeZone)
    time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  } else if (requested !== null && requested !== '' && !TIME_OF_DAY_PATTERN.test(String(requested))) {
    throw new HttpsError('invalid-argument', 'INVALID_CUTOFF_TIME')
  }

  // 恢復預設時寫入不會等於今天的日期，effectiveCutoffTime 就會改用系統預設值。
  const cutoff = requested === null
    ? { date: '', time: '' }
    : { date: todayKey, time, updatedByUid: actorUid, updatedByName: String(profile.memberName || '') }
  await db.collection('settings').doc('daily').set({ cutoff }, { merge: true })
  return { ok: true, cutoffTime: effectiveCutoffTime(settings, { cutoff }, todayKey) }
})

// ==========================================
// 首次部署初始化：尚無任何管理員時，持有 SETUP_TOKEN 的部署者可建立第一位管理員。
// SETUP_TOKEN 由部署者寫在 functions/.env.<project-id>（已被 Git 忽略）；未設定時停用此流程。
// ==========================================
const setupMarkerRef = () => db.collection('settings').doc('setup')
const readSetupToken = () => String((typeof process !== 'undefined' && process.env?.SETUP_TOKEN) || '').trim()
const setupEnabled = () => readSetupToken().length >= MIN_SETUP_TOKEN_LENGTH
const setupTokenMatches = (candidate) => {
  const actual = String(candidate || '').trim()
  if (!setupEnabled() || !actual) return false
  // 先雜湊成等長摘要再比較，避免長度差異與逐字比較洩漏時間資訊。
  const digest = value => crypto.createHash('sha256').update(value, 'utf8').digest()
  return crypto.timingSafeEqual(digest(readSetupToken()), digest(actual))
}
const hasAnyAdmin = async (transaction = null) => {
  const adminQuery = db.collection('users').where('isAdmin', '==', true).limit(1)
  const snap = transaction ? await transaction.get(adminQuery) : await adminQuery.get()
  return !snap.empty
}

// 公開狀態查詢（不需登入）：只回傳是否需要初始化，不透露任何成員資料。
exports.getSetupStatus = onCall(async () => {
  const [markerSnap, adminExists] = await Promise.all([setupMarkerRef().get(), hasAnyAdmin()])
  const needsSetup = !markerSnap.exists && !adminExists
  return { needsSetup, setupEnabled: needsSetup && setupEnabled() }
})

// 登入前就需要的公開設定（品牌、預設語系、註冊方式），不含任何成員資料。
exports.getPublicConfig = onCall(async () => {
  const [settings, markerSnap, adminExists] = await Promise.all([readSystemSettings(), setupMarkerRef().get(), hasAnyAdmin()])
  const needsSetup = !markerSnap.exists && !adminExists
  return {
    locale: settings.locale,
    branding: settings.branding,
    registration: settings.registration,
    needsSetup,
    setupEnabled: needsSetup && setupEnabled(),
  }
})

exports.completeFirstAdminSetup = onCall(async (request) => {
  const uid = requireAuth(request)
  if (!setupEnabled()) throw new HttpsError('failed-precondition', 'SETUP_DISABLED')
  if (!setupTokenMatches(request.data?.setupToken)) throw new HttpsError('permission-denied', 'INVALID_SETUP_TOKEN')

  const name = normalizeMemberName(request.data?.memberName)
  if (!name || name.length > MAX_NAME_LENGTH) throw new HttpsError('invalid-argument', 'INVALID_MEMBER_NAME')
  const settings = request.data?.settings === undefined
    ? normalizeSystemSettings({})
    : parseSystemSettingsInput(request.data.settings, normalizeSystemSettings({}))

  const userRef = db.collection('users').doc(uid)
  const nameRef = db.collection('member_name_keys').doc(memberNameKey(name))
  const walletRef = walletRefForUid(uid)
  const now = Timestamp.now()

  await db.runTransaction(async (transaction) => {
    // 固定的標記文件讓並行的初始化請求互相衝突，只有第一個能成功。
    const markerSnap = await transaction.get(setupMarkerRef())
    if (markerSnap.exists || await hasAnyAdmin(transaction)) {
      throw new HttpsError('failed-precondition', 'SETUP_ALREADY_COMPLETED')
    }
    const userSnap = await transaction.get(userRef)
    const nameSnap = await transaction.get(nameRef)
    const walletSnap = await transaction.get(walletRef)
    if (userSnap.exists) throw new HttpsError('already-exists', 'PROFILE_EXISTS')
    if (nameSnap.exists && nameSnap.data().uid !== uid) throw new HttpsError('already-exists', 'MEMBER_NAME_TAKEN')

    transaction.set(nameRef, { uid, memberName: name, createdAt: now })
    transaction.set(userRef, {
      email: String(request.auth?.token?.email || ''),
      memberName: name,
      memberNameKey: nameRef.id,
      isAdmin: true,
      createdAt: now,
      lastLoginAt: now,
    })
    transaction.set(memberRosterRef(uid), { uid, name })
    if (!walletSnap.exists) {
      transaction.set(walletRef, {
        ownerUid: uid,
        ownerName: name,
        balance: 0,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: uid,
        lastTransactionType: 'setup',
      })
    }
    transaction.set(systemSettingsRef(), {
      ...settings,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: uid,
      updatedByName: name,
    })
    transaction.set(setupMarkerRef(), { completedAt: FieldValue.serverTimestamp(), completedByUid: uid })
  })

  return { ok: true, memberName: name, settings }
})

exports.updateSystemSettings = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)
  const operatorName = String(profile?.memberName || request.auth?.token?.email || '').trim()

  const settings = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(systemSettingsRef())
    const current = normalizeSystemSettings(snap.exists ? snap.data() : {})
    const next = parseSystemSettingsInput(request.data?.settings, current)
    // 新設定每月補助卻沒指定起始月份時，從下個月開始自動發放；本月可由管理員手動發放。
    if (next.subsidy.monthlyAllowance > 0 && !next.subsidy.effectiveFrom) {
      next.subsidy.effectiveFrom = shiftMonthKey(monthKeyInZone(next.timeZone), 1)
    }
    transaction.set(systemSettingsRef(), {
      ...next,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actorUid,
      updatedByName: operatorName,
    })
    return next
  })

  return { ok: true, settings }
})

const validateCleanupRange = (data = {}) => {
  const from = Number(data.from)
  const to = Number(data.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new HttpsError('invalid-argument', '日期時間區間不正確')
  }
  if (to - from > 31 * 24 * 60 * 60 * 1000) {
    throw new HttpsError('invalid-argument', '單次清理區間不可超過 31 天')
  }
  return { from, to }
}

const queryCleanupDocuments = async (from, to, transaction = null) => {
  const read = ref => transaction ? transaction.get(ref) : ref.get()
  const timestampFrom = Timestamp.fromMillis(from)
  const timestampTo = Timestamp.fromMillis(to)
  const [orders, cashPaymentsInRange, cashLogsInRange, walletLogsInRange, walletRequests] = await Promise.all([
    read(db.collection('orders').where('timestamp', '>=', from).where('timestamp', '<=', to)),
    read(db.collection('cash_payments').where('createdTimestamp', '>=', from).where('createdTimestamp', '<=', to)),
    read(db.collection('cash_payment_logs').where('timestamp', '>=', from).where('timestamp', '<=', to)),
    read(db.collection('wallet_logs').where('timestamp', '>=', from).where('timestamp', '<=', to)),
    read(db.collection('wallet_requests').where('createdAt', '>=', timestampFrom).where('createdAt', '<=', timestampTo)),
  ])

  const orderIds = orders.docs.map(doc => doc.id)
  const cashPaymentMap = new Map(cashPaymentsInRange.docs.map(doc => [doc.ref.path, doc]))
  const linkedCashPaymentIds = [...new Set(orders.docs
    .map(doc => String(doc.data().cashPaymentId || '').trim())
    .filter(Boolean))]
  for (let index = 0; index < linkedCashPaymentIds.length; index += 100) {
    const refs = linkedCashPaymentIds.slice(index, index + 100).map(id => db.collection('cash_payments').doc(id))
    const snaps = transaction ? await getAllInTransaction(transaction, refs) : await db.getAll(...refs)
    snaps.filter(doc => doc.exists).forEach(doc => cashPaymentMap.set(doc.ref.path, doc))
  }

  const cashLogMap = new Map(cashLogsInRange.docs.map(doc => [doc.ref.path, doc]))
  const paymentIds = [...new Set([...cashPaymentMap.values()].map(doc => doc.id))]
  for (let index = 0; index < paymentIds.length; index += 30) {
    const chunk = paymentIds.slice(index, index + 30)
    const relatedLogs = await read(db.collection('cash_payment_logs').where('cashPaymentId', 'in', chunk))
    relatedLogs.docs.forEach(doc => cashLogMap.set(doc.ref.path, doc))
  }

  const walletLogMap = new Map(walletLogsInRange.docs.map(doc => [doc.ref.path, doc]))
  for (let index = 0; index < orderIds.length; index += 30) {
    const chunk = orderIds.slice(index, index + 30)
    const [groupedLogs, singleLogs] = await Promise.all([
      read(db.collection('wallet_logs').where('orderIds', 'array-contains-any', chunk)),
      read(db.collection('wallet_logs').where('orderId', 'in', chunk)),
    ])
    groupedLogs.docs.forEach(doc => walletLogMap.set(doc.ref.path, doc))
    singleLogs.docs.forEach(doc => walletLogMap.set(doc.ref.path, doc))
  }

  const walletAdjustments = new Map()
  walletLogMap.forEach(doc => {
    const log = doc.data()
    const walletId = String(log.walletId || log.ownerUid || '').trim()
    if (!walletId) return
    const current = walletAdjustments.get(walletId) || {
      walletId,
      ownerName: String(log.ownerName || '').trim(),
      removedNetAmount: 0,
      logCount: 0,
    }
    current.removedNetAmount = roundMoney(current.removedNetAmount + (Number(log.amount) || 0))
    current.logCount += 1
    walletAdjustments.set(walletId, current)
  })

  const documents = [
    ...orders.docs,
    ...cashPaymentMap.values(),
    ...cashLogMap.values(),
    ...walletLogMap.values(),
    ...walletRequests.docs,
  ]

  return {
    documents,
    walletAdjustments: [...walletAdjustments.values()],
    counts: {
      orders: orders.size,
      cashPayments: cashPaymentMap.size,
      cashLogs: cashLogMap.size,
      walletLogs: walletLogMap.size,
      walletRequests: walletRequests.size,
    },
  }
}

const cleanupPreview = (cleanup) => {
  const walletUpdateCount = cleanup.walletAdjustments.length
  const writeCount = cleanup.documents.length + walletUpdateCount
  return {
    counts: cleanup.counts,
    walletAdjustments: cleanup.walletAdjustments.map(item => ({
      ...item,
      balanceCorrection: roundMoney(-item.removedNetAmount),
    })),
    documentCount: cleanup.documents.length,
    writeCount,
    canDelete: writeCount <= MAX_CLEANUP_WRITES,
    maxWrites: MAX_CLEANUP_WRITES,
  }
}

// 清理後的錢包「更新時間」應代表仍保留的最後一筆流水，而不是資料清理的執行時間。
// 舊資料偶爾只有 createdAt，因此 timestamp 缺失時以它作為相容的備援。
const walletLogTimestampMs = (log = {}) => {
  const timestamp = Number(log.timestamp)
  if (Number.isFinite(timestamp) && timestamp > 0) return timestamp
  const createdAt = log.createdAt
  const createdAtMs = typeof createdAt?.toMillis === 'function'
    ? createdAt.toMillis()
    : Number(createdAt)
  return Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : null
}

// 流水說明依系統語言（serverText）產生；text 由呼叫端依當下的系統設定傳入。
const proxyOrderNote = (ownerName, actorName, text) => {
  const owner = String(ownerName || '').trim()
  const actor = String(actorName || '').trim()
  if (!owner || !actor || owner === actor) return ''
  return text.proxyNote(actor)
}

const orderDebitWalletReason = (storeName, ownerName, actorName, text) => {
  const parts = [text.orderDebit, storeName || text.unknownStore]
  const proxyNote = proxyOrderNote(ownerName, actorName, text)
  if (proxyNote) parts.push(proxyNote)
  return parts.join(text.reasonSeparator)
}

const cashReceivableReason = (storeName, ownerName, actorName, text, label = text.cashReceivable) => {
  const parts = [label, storeName || text.unknownStore]
  const proxyNote = proxyOrderNote(ownerName, actorName, text)
  if (proxyNote) parts.push(proxyNote)
  return parts.join(text.reasonSeparator)
}

const groupOrdersByStore = (orders, text) => orders.reduce((groups, order) => {
  const storeName = String(order.data?.storeName || '').trim() || text.unknownStore
  if (!groups.has(storeName)) groups.set(storeName, [])
  groups.get(storeName).push(order)
  return groups
}, new Map())

const orderItemSnapshot = (order) => ({
  meal: String(order.data?.meal ?? order.meal ?? '').trim(),
  price: roundMoney(order.data?.price ?? order.price),
  note: String(order.data?.note ?? order.note ?? '').trim(),
  storeName: String(order.data?.storeName ?? order.storeName ?? '').trim(),
})

const orderStoreName = (order) => String(order.storeName || order.data?.storeName || '').trim()

const freeOrderWalletReason = (prefix, order, text) => {
  const storeName = orderStoreName(order) || text.unknownStore
  const mealName = String(order.meal || '').trim() || text.unknownItem
  return [prefix, storeName, mealName].join(text.reasonSeparator)
}

const getUserProfile = async (uid) => {
  if (!uid) return { isAdmin: false, memberName: '', isRegistered: false }
  const snap = await db.collection('users').doc(uid).get()
  return snap.exists
    ? { ...snap.data(), isRegistered: true }
    : { isAdmin: false, memberName: '', isRegistered: false }
}

const requireAuth = (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', '請先登入')
  return uid
}

const requireAdmin = async (uid) => {
  const profile = await getUserProfile(uid)
  if (!profile?.isAdmin) {
    throw new HttpsError('permission-denied', '需要管理員權限')
  }
  return profile
}

exports.deleteUserAccount = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)

  const targetUid = String(request.data?.uid || '').trim()
  if (!targetUid || targetUid.includes('/') || targetUid.length > 128) {
    throw new HttpsError('invalid-argument', 'INVALID_USER_UID')
  }
  if (targetUid === actorUid) {
    throw new HttpsError('failed-precondition', 'CANNOT_DELETE_SELF')
  }

  const userRef = db.collection('users').doc(targetUid)
  const walletRef = walletRefForUid(targetUid)
  const profile = await db.runTransaction(async transaction => {
    const userSnap = await transaction.get(userRef)
    const walletSnap = await transaction.get(walletRef)
    const currentProfile = userSnap.exists ? userSnap.data() : null
    if (walletSnap.exists && roundMoney(walletSnap.data().balance) !== 0) {
      throw new HttpsError('failed-precondition', 'WALLET_BALANCE_NOT_ZERO')
    }
    if (currentProfile?.isAdmin) {
      const adminQuery = db.collection('users').where('isAdmin', '==', true).limit(2)
      const adminSnap = await transaction.get(adminQuery)
      if (adminSnap.size <= 1) {
        throw new HttpsError('failed-precondition', 'CANNOT_DELETE_LAST_ADMIN')
      }
    }
    if (userSnap.exists) {
      transaction.update(userRef, {
        isAdmin: false,
        accountDeletionPending: true,
        accountDeletionRequestedAt: FieldValue.serverTimestamp(),
      })
    }
    return currentProfile
  })

  try {
    await admin.auth().deleteUser(targetUid)
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      if (profile) {
        await userRef.set({
          isAdmin: Boolean(profile.isAdmin),
          accountDeletionPending: FieldValue.delete(),
          accountDeletionRequestedAt: FieldValue.delete(),
        }, { merge: true })
      }
      throw new HttpsError('internal', 'AUTH_USER_DELETE_FAILED')
    }
  }

  const memberName = normalizeMemberName(profile?.memberName)
  const [usedCodes, memberCodes] = await Promise.all([
    db.collection('inviteCodes').where('usedBy', '==', targetUid).get(),
    memberName
      ? db.collection('inviteCodes').where('memberName', '==', memberName).get()
      : Promise.resolve({ docs: [] }),
  ])

  const writer = db.bulkWriter()
  writer.delete(userRef)
  writer.delete(memberRosterRef(targetUid))
  if (profile?.memberNameKey) {
    writer.delete(db.collection('member_name_keys').doc(String(profile.memberNameKey)))
  } else if (memberName) {
    writer.delete(db.collection('member_name_keys').doc(memberNameKey(memberName)))
  }
  const inviteRefs = new Map([...usedCodes.docs, ...memberCodes.docs].map(snap => [snap.ref.path, snap.ref]))
  inviteRefs.forEach(ref => writer.delete(ref))
  const pushTokens = await pushTokensRef().where('uid', '==', targetUid).get()
  pushTokens.docs.forEach(snap => writer.delete(snap.ref))
  await writer.close()

  return { ok: true }
})

exports.setUserAdminStatus = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)
  const targetUid = String(request.data?.uid || '').trim()
  const isAdmin = Boolean(request.data?.isAdmin)
  if (!targetUid || targetUid.includes('/') || targetUid.length > 128) {
    throw new HttpsError('invalid-argument', 'INVALID_USER_UID')
  }
  if (!isAdmin && targetUid === actorUid) {
    throw new HttpsError('failed-precondition', 'CANNOT_DEMOTE_SELF')
  }

  await db.runTransaction(async transaction => {
    const userRef = db.collection('users').doc(targetUid)
    const userSnap = await transaction.get(userRef)
    if (!userSnap.exists) throw new HttpsError('not-found', 'USER_NOT_FOUND')
    const currentIsAdmin = Boolean(userSnap.data().isAdmin)
    if (currentIsAdmin === isAdmin) return
    if (currentIsAdmin && !isAdmin) {
      const adminSnap = await transaction.get(db.collection('users').where('isAdmin', '==', true).limit(2))
      if (adminSnap.size <= 1) {
        throw new HttpsError('failed-precondition', 'CANNOT_DELETE_LAST_ADMIN')
      }
    }
    transaction.update(userRef, { isAdmin })
  })

  return { ok: true }
})

// 依現有 users 重建代訂公開名單：一次性回填既有成員，並清掉已不存在的殘留。
// 平時新增／刪除成員已即時同步，此函式用於首次部署回填或修復。
exports.rebuildMemberRoster = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)

  const [usersSnap, rosterSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('member_roster').get(),
  ])

  const desired = new Map()
  usersSnap.docs.forEach(doc => {
    const name = normalizeMemberName(doc.data().memberName)
    if (name) desired.set(doc.id, { uid: doc.id, name, allowProxyOrders: doc.data().allowProxyOrders === true })
  })

  const writer = db.bulkWriter()
  desired.forEach((entry, uid) => writer.set(memberRosterRef(uid), entry))
  rosterSnap.docs.forEach(doc => {
    if (!desired.has(doc.id)) writer.delete(doc.ref)
  })
  await writer.close()

  return { ok: true, count: desired.size }
})

const getVerifiedMember = async (uid, transaction = null) => {
  const id = walletIdForUid(uid)
  if (!id) throw new HttpsError('invalid-argument', 'INVALID_OWNER_UID')
  const ref = db.collection('users').doc(id)
  const snap = transaction ? await transaction.get(ref) : await ref.get()
  const memberName = snap.exists ? String(snap.data().memberName || '').trim() : ''
  if (!memberName || snap.data().accountDeletionPending) throw new HttpsError('failed-precondition', 'OWNER_NOT_FOUND')
  return { uid: id, memberName, allowProxyOrders: snap.data().allowProxyOrders === true }
}

const writeWalletLog = (transaction, {
  walletId,
  ownerName,
  ownerUid = '',
  type,
  amount,
  beforeBalance,
  afterBalance,
  operatorName,
  operatorUid,
  reason,
  orderId = '',
  orderIds = [],
  storeName = '',
  items = [],
  itemCount = 0,
  editGroupId = '',
  editDelta = null,
}) => {
  transaction.set(walletLogRef(), {
    walletId,
    ownerName,
    ownerUid,
    type,
    amount: roundMoney(amount),
    beforeBalance: roundMoney(beforeBalance),
    afterBalance: roundMoney(afterBalance),
    operatorName: operatorName || '',
    operatorUid: operatorUid || '',
    reason: reason || '',
    orderId,
    orderIds,
    storeName,
    items,
    itemCount,
    timestamp: Date.now(),
    createdAt: FieldValue.serverTimestamp(),
    // 同一次訂單編輯產生的退款/扣款配對共用 editGroupId，前端據此合併顯示。
    ...(editGroupId ? { editGroupId, editDelta: roundMoney(editDelta) } : {}),
  })
}

const writeCashPaymentLog = (transaction, {
  cashPaymentId,
  ownerName,
  ownerUid = '',
  type,
  amount,
  beforeStatus = '',
  afterStatus = '',
  operatorName,
  operatorUid,
  reason,
  orderIds = [],
  storeName = '',
  items = [],
}) => {
  transaction.set(cashPaymentLogRef(), {
    cashPaymentId,
    ownerName,
    ownerUid,
    type,
    amount: roundMoney(amount),
    beforeStatus,
    afterStatus,
    operatorName: operatorName || '',
    operatorUid: operatorUid || '',
    reason: reason || '',
    orderIds,
    storeName,
    items,
    timestamp: Date.now(),
    createdAt: FieldValue.serverTimestamp(),
  })
}

const getWalletLedgerForOrders = async (transaction, orderIds) => {
  const logs = new Map()
  for (let index = 0; index < orderIds.length; index += 30) {
    const chunk = orderIds.slice(index, index + 30)
    const [grouped, single] = await Promise.all([
      transaction.get(db.collection('wallet_logs').where('orderIds', 'array-contains-any', chunk)),
      transaction.get(db.collection('wallet_logs').where('orderId', 'in', chunk)),
    ])
    grouped.docs.forEach(doc => logs.set(doc.id, doc.data()))
    single.docs.forEach(doc => logs.set(doc.id, doc.data()))
  }

  const debits = new Map()
  const refundedOrderIds = new Set()
  const outstandingAmounts = new Map()
  const originalOperators = new Map()
  const debitTypes = new Set(['order_debit', 'order_edit_debit', 'free_debit'])
  const refundTypes = new Set(['cancel_refund', 'free_refund', 'order_edit_refund'])
  logs.forEach(log => {
    const ids = Array.isArray(log.orderIds) && log.orderIds.length
      ? log.orderIds.map(String)
      : [String(log.orderId || '')].filter(Boolean)
    if (log.type === 'order_debit' || log.type === 'free_order') {
      ids.forEach(id => originalOperators.set(id, String(log.operatorUid || '').trim()))
    }
    if (!debitTypes.has(log.type) && !refundTypes.has(log.type)) return

    const items = Array.isArray(log.items) ? log.items : []
    ids.forEach((id, itemIndex) => {
      const timestamp = Number(log.timestamp) || 0
      const item = items[itemIndex] || {}
      const amount = finiteMoney(item.price, { min: 1, max: ABSOLUTE_MAX_AMOUNT, code: 'INVALID_ORDER_AMOUNT' })
      outstandingAmounts.set(id, (outstandingAmounts.get(id) || 0) + (debitTypes.has(log.type) ? amount : -amount))
      if (!debitTypes.has(log.type)) return
      const previous = debits.get(id)
      if (previous && timestamp < previous.timestamp) return
      debits.set(id, {
        ownerUid: String(log.ownerUid || log.walletId || '').trim(),
        ownerName: String(log.ownerName || '').trim(),
        orderedByUid: String(log.operatorUid || '').trim(),
        amount,
        storeName: String(item.storeName || log.storeName || '').trim(),
        meal: String(item.meal || '').trim(),
        note: String(item.note || '').trim(),
        timestamp,
      })
    })
  })

  // 用實際扣退款淨額判斷，免費後重新扣款不再被舊退款永久標記；亦不依賴流水回傳順序。
  debits.forEach((debit, id) => {
    const outstanding = roundMoney(outstandingAmounts.get(id))
    if (outstanding <= 0) refundedOrderIds.add(id)
    else debit.amount = outstanding
    if (originalOperators.has(id)) debit.orderedByUid = originalOperators.get(id)
  })

  return { debits, refundedOrderIds }
}
const getCashFreeAdjustedOrderIds = async (transaction, orderIds) => {
  const adjustmentTotals = new Map()
  for (let index = 0; index < orderIds.length; index += 30) {
    const chunk = orderIds.slice(index, index + 30)
    const logs = await transaction.get(
      db.collection('cash_payment_logs').where('orderIds', 'array-contains-any', chunk),
    )
    logs.docs.forEach(doc => {
      const log = doc.data()
      if (log.type !== 'cash_adjustment') return
      // 改價流水包含前後兩份快照；不可把降價誤認為免費減免。
      if (!Array.isArray(log.items) || log.items.length !== 1) return
      const ids = Array.isArray(log.orderIds) ? log.orderIds.map(String) : []
      if (ids.length !== 1) return
      const orderId = ids[0]
      // 免費期間可能改價，恢復收費的金額未必等於原減免金額。
      adjustmentTotals.set(orderId, (adjustmentTotals.get(orderId) || 0) + Math.sign(Number(log.amount) || 0))
    })
  }
  return new Set([...adjustmentTotals.entries()]
    .filter(([, total]) => total < 0)
    .map(([orderId]) => orderId))
}
const normalizeOrderItems = (items, fallbackName, selectedStoreName, maxItemPrice) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', '購物車是空的')
  }
  if (items.length > MAX_ORDER_ITEMS) {
    throw new HttpsError('invalid-argument', 'TOO_MANY_ORDER_ITEMS')
  }

  return items.map((item) => {
    const ownerName = String(item?.ownerName || item?.who || '').trim() || String(fallbackName || '').trim()
    const ownerUid = String(item?.ownerUid || '').trim()
    const paymentMethod = String(item?.paymentMethod || 'wallet').trim() || 'wallet'
    const meal = String(item?.name || '').trim()
    const amount = finiteMoney(item?.price, { min: 1, max: maxItemPrice, code: 'INVALID_ORDER_AMOUNT' })
    const storeName = String(item?.storeName || selectedStoreName || '').trim()
    const note = String(item?.note || '').trim()

    if (!['wallet', 'cash', 'none'].includes(paymentMethod)) {
      throw new HttpsError('invalid-argument', 'INVALID_PAYMENT_METHOD')
    }
    if (!ownerName || !meal || amount <= 0 || (paymentMethod === 'wallet' && !ownerUid)) {
      throw new HttpsError('invalid-argument', '訂單資料不完整')
    }
    if (
      ownerName.length > MAX_NAME_LENGTH ||
      meal.length > MAX_MEAL_LENGTH ||
      storeName.length > MAX_STORE_NAME_LENGTH ||
      note.length > MAX_NOTE_LENGTH
    ) {
      throw new HttpsError('invalid-argument', 'ORDER_TEXT_TOO_LONG')
    }

    return { ownerName, ownerUid, paymentMethod, meal, amount, storeName, note }
  })
}

const verifyOrderOwners = async (items, transaction) => {
  const ownerUids = [...new Set(items.map(item => item.ownerUid).filter(Boolean))]
  const verifiedOwners = new Map()
  for (const uid of ownerUids) {
    const member = await getVerifiedMember(uid, transaction)
    verifiedOwners.set(uid, member)
  }

  return items.map(item => {
    if (!item.ownerUid) return item
    const member = verifiedOwners.get(item.ownerUid)
    return { ...item, ownerName: member.memberName, allowProxyOrders: member.allowProxyOrders }
  })
}

// 付款方式與代訂權限依 settings/system 檢查；不是本人帳號的品項（含手動輸入姓名）都算代訂。
const assertOrderPolicy = (items, { settings, actorUid, isAdmin }) => {
  if (items.some(item => !paymentMethodEnabled(settings, item.paymentMethod))) {
    throw new HttpsError('failed-precondition', 'PAYMENT_METHOD_DISABLED')
  }
  if (items.some(item => item.ownerUid !== actorUid) && !canProxyOrder(settings, isAdmin)) {
    throw new HttpsError('permission-denied', 'PROXY_ORDERING_DISABLED')
  }
}

// 「需本人同意」：替其他有帳號的成員點餐時，對方必須已開啟授權；管理員與手動輸入的姓名不受限。
const assertProxyConsent = (items, { settings, actorUid, isAdmin }) => {
  if (settings.proxyOrdering !== 'consent' || isAdmin) return
  if (items.some(item => item.ownerUid && item.ownerUid !== actorUid && !item.allowProxyOrders)) {
    throw new HttpsError('permission-denied', 'PROXY_CONSENT_REQUIRED')
  }
}

exports.createOrdersWithWalletDebit = onCall(async (request) => {
  const actorUid = requireAuth(request)

  const {
    items,
    fallbackName,
    actorName,
    selectedStoreName,
    requestId,
  } = request.data || {}

  const idempotencyKey = String(requestId || '').trim()
  if (!idempotencyKey || idempotencyKey.includes('/') || idempotencyKey.length > 500) {
    throw new HttpsError('invalid-argument', 'INVALID_REQUEST_ID')
  }

  const profile = await getUserProfile(actorUid)
  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  if (!profile.isRegistered) throw new HttpsError('permission-denied', '需要已註冊使用者權限')
  // 誰可以代訂由 settings/system.proxyOrdering 決定（預設全體成員，含直接扣對方錢包）。
  // verifyOrderOwners 已逐筆驗證 ownerUid 對應真實成員並校正姓名，避免代訂到不存在的錢包。
  const systemSettings = await readSystemSettings()
  const { timeZone } = systemSettings
  const text = serverText(systemSettings)
  const requestRef = db.collection('wallet_requests').doc(`${actorUid}_${idempotencyKey}`)
  const now = Date.now()

  try {
    return await db.runTransaction(async (transaction) => {
      const requestSnap = await transaction.get(requestRef)
      if (requestSnap.exists) {
        return {
          ok: true,
          orderIds: requestSnap.data().orderIds || [],
          duplicate: true,
        }
      }

      // 已成功的請求先回傳原結果；新請求才驗證對象，並納入交易以避免帳號刪除競爭。
      const requestedItems = normalizeOrderItems(items, fallbackName, selectedStoreName, systemSettings.limits.maxItemPrice)
      assertOrderPolicy(requestedItems, { settings: systemSettings, actorUid, isAdmin: profile.isAdmin })
      const normalizedItems = await verifyOrderOwners(requestedItems, transaction)
      assertProxyConsent(normalizedItems, { settings: systemSettings, actorUid, isAdmin: profile.isAdmin })

      // 免費店家以後端交易當下的今日設定為準，不信任前端傳來的狀態。
      const dailySnap = await transaction.get(db.collection('settings').doc('daily'))
      const daily = dailySnap.exists ? dailySnap.data() : null
      const todayKey = dateKeyInZone(timeZone)
      const dailyIsToday = Boolean(daily)
        && (String(daily.serviceDate || '').trim() === todayKey || String(daily.date || '').trim() === todayKey)
      const activeStoreSet = new Set(dailyIsToday && Array.isArray(daily.activeStores)
        ? daily.activeStores.map(name => String(name || '').trim()).filter(Boolean)
        : [])
      const freeStoreSet = new Set(dailyIsToday && Array.isArray(daily.freeStores)
        ? daily.freeStores.map(name => String(name || '').trim()).filter(name => activeStoreSet.has(name))
        : [])
      const isFreeStoreToday = (storeName) => freeStoreSet.has(String(storeName || '').trim())
      const dining = await readDining(transaction, timeZone)
      if (normalizedItems.some(item => dining.data.replacements[item.storeName])) {
        throw new HttpsError('failed-precondition', '店家已更換，請重新選擇餐點')
      }
      const needId = String(request.data?.reorderNeedId || '')
      const need = needId ? dining.data.needs[needId] : null
      if (needId && (!need || need.status !== 'pending' || normalizedItems.some(item =>
        dinerKey(item.ownerUid, item.ownerName) !== need.personKey || item.storeName !== need.targetStore))) {
        throw new HttpsError('failed-precondition', '補點狀態已更新，請重新整理名單')
      }
      if (need && !activeStoreSet.has(need.targetStore)) throw new HttpsError('failed-precondition', '補點店家尚未開放')
      // 收單後一般成員不可再下單；換店後的補點不受限，避免被換店的人沒飯吃。
      if (!profile.isAdmin && !need && isOrderingClosed(systemSettings, daily, now)) {
        throw new HttpsError('failed-precondition', 'ORDERING_CLOSED')
      }

      const cashGroups = new Map()
      normalizedItems.forEach((item) => {
        if (item.paymentMethod !== 'cash' || isFreeStoreToday(item.storeName)) return
        const key = item.ownerName
        if (!cashGroups.has(key)) {
          const ref = cashPaymentRef()
          cashGroups.set(key, {
            ref,
            id: ref.id,
            ownerName: item.ownerName,
            ownerUid: item.ownerUid || '',
            items: [],
          })
        }
        cashGroups.get(key).items.push(item)
      })

      const preparedOrders = normalizedItems.map((item, index) => {
        const orderRef = db.collection('orders').doc()
        const proxyNote = proxyOrderNote(item.ownerName, operatorName, text)
        const isWalletPayment = item.paymentMethod === 'wallet'
        const isCashPayment = item.paymentMethod === 'cash'
        const freeToday = isFreeStoreToday(item.storeName)
        const cashGroup = isCashPayment && !freeToday ? cashGroups.get(item.ownerName) : null
        return {
          ref: orderRef,
          ownerName: item.ownerName,
          ownerUid: item.ownerUid,
          paymentMethod: item.paymentMethod,
          isFreeToday: freeToday,
          cashPaymentId: cashGroup?.id || '',
          amount: item.amount,
          data: {
            storeName: item.storeName,
            name: item.ownerName,
            uid: isWalletPayment ? item.ownerUid : actorUid,
            ownerName: item.ownerName,
            ownerUid: item.ownerUid,
            orderedByName: operatorName,
            orderedByUid: actorUid,
            isProxyOrder: Boolean(proxyNote),
            proxyOrderedByName: proxyNote ? operatorName : '',
            meal: item.meal,
            price: item.amount,
            note: item.note,
            // 「只統計不收款」的訂單沒有應付款項，視同已結。
            paid: freeToday || !isCashPayment,
            paymentMethod: item.paymentMethod,
            paidByWallet: freeToday ? false : isWalletPayment,
            paidAt: !freeToday && isWalletPayment ? FieldValue.serverTimestamp() : null,
            isFree: freeToday,
            freeSource: freeToday ? 'daily_store_setting' : '',
            freeAppliedAt: freeToday ? FieldValue.serverTimestamp() : null,
            freeStoreName: freeToday ? item.storeName : '',
            originalPrice: item.amount,
            walletDebited: freeToday ? false : isWalletPayment,
            walletOwnerUid: isWalletPayment ? item.ownerUid : '',
            walletOwnerName: isWalletPayment ? item.ownerName : '',
            walletAmount: !freeToday && isWalletPayment ? item.amount : 0,
            walletRefunded: false,
            cashPaymentId: cashGroup?.id || '',
            cashStatus: isCashPayment && !freeToday ? 'pending' : '',
            cashCollectedAt: null,
            cashCollectedByUid: '',
            cashCollectedByName: '',
            timestamp: now + index,
            createdAt: FieldValue.serverTimestamp(),
          },
        }
      })

      const walletOrders = preparedOrders.filter(order => order.paymentMethod === 'wallet' && !order.isFreeToday)
      const freeWalletOrders = preparedOrders.filter(order => order.paymentMethod === 'wallet' && order.isFreeToday)
      const totalsByWallet = walletOrders.reduce((map, order) => {
        const current = map.get(order.ownerUid) || { ownerUid: order.ownerUid, ownerName: order.ownerName, total: 0 }
        current.total = roundMoney(current.total + order.amount)
        map.set(order.ownerUid, current)
        return map
      }, new Map())

      // 免費單不扣款也不驗餘額，但仍讀取餘額供 0 元流水記錄 before/after。
      const walletOwners = new Map()
      totalsByWallet.forEach(({ ownerUid, ownerName }) => walletOwners.set(ownerUid, { ownerUid, ownerName }))
      freeWalletOrders.forEach(({ ownerUid, ownerName }) => {
        if (!walletOwners.has(ownerUid)) walletOwners.set(ownerUid, { ownerUid, ownerName })
      })

      const walletMap = new Map()
      const walletEntries = [...walletOwners.values()]
      const walletRefs = walletEntries.map(({ ownerUid }) => walletRefForUid(ownerUid))
      const walletSnaps = await getAllInTransaction(transaction, walletRefs)
      walletEntries.forEach(({ ownerUid, ownerName }, index) => {
        walletMap.set(ownerUid, {
          ref: walletRefs[index],
          ownerName,
          balance: roundMoney(walletSnaps[index].exists ? walletSnaps[index].data().balance : 0),
        })
      })

      for (const { ownerUid, total } of totalsByWallet.values()) {
        const wallet = walletMap.get(ownerUid)
        if (wallet.balance < total) {
          throw new HttpsError('failed-precondition', 'INSUFFICIENT_WALLET_BALANCE')
        }
      }

      for (const { ownerUid, ownerName, total } of totalsByWallet.values()) {
        const wallet = walletMap.get(ownerUid)
        const relatedOrders = walletOrders.filter(order => order.ownerUid === ownerUid)
        const afterBalance = roundMoney(wallet.balance - total)
        const walletId = walletIdForUid(ownerUid)

        transaction.set(wallet.ref, {
          ownerUid,
          ownerName,
          balance: afterBalance,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: operatorName,
          updatedByUid: actorUid,
          lastTransactionType: 'order_debit',
        }, { merge: true })

        let runningBalance = wallet.balance
        for (const [storeName, storeOrders] of groupOrdersByStore(relatedOrders, text).entries()) {
          const storeTotal = roundMoney(storeOrders.reduce((sum, order) => sum + order.amount, 0))
          const nextBalance = roundMoney(runningBalance - storeTotal)
          writeWalletLog(transaction, {
            walletId,
            ownerUid,
            ownerName,
            type: 'order_debit',
            amount: -storeTotal,
            beforeBalance: runningBalance,
            afterBalance: nextBalance,
            operatorName,
            operatorUid: actorUid,
            reason: orderDebitWalletReason(storeName, ownerName, operatorName, text),
            orderId: storeOrders.length === 1 ? storeOrders[0].ref.id : '',
            orderIds: storeOrders.map(order => order.ref.id),
            storeName,
            items: storeOrders.map(orderItemSnapshot),
            itemCount: storeOrders.length,
          })
          runningBalance = nextBalance
        }
      }

      // 免費店家的錢包單：不扣款，但寫一筆 0 元流水讓對帳看得到「有下單、因免費未扣款」。
      for (const { ownerUid, ownerName } of walletOwners.values()) {
        const relatedOrders = freeWalletOrders.filter(order => order.ownerUid === ownerUid)
        if (!relatedOrders.length) continue
        const wallet = walletMap.get(ownerUid)
        const debitTotal = totalsByWallet.get(ownerUid)?.total || 0
        const balance = roundMoney(wallet.balance - debitTotal)
        const walletId = walletIdForUid(ownerUid)
        for (const [storeName, storeOrders] of groupOrdersByStore(relatedOrders, text).entries()) {
          writeWalletLog(transaction, {
            walletId,
            ownerUid,
            ownerName,
            type: 'free_order',
            amount: 0,
            beforeBalance: balance,
            afterBalance: balance,
            operatorName,
            operatorUid: actorUid,
            reason: [text.freeStoreToday, storeName].join(text.reasonSeparator),
            orderId: storeOrders.length === 1 ? storeOrders[0].ref.id : '',
            orderIds: storeOrders.map(order => order.ref.id),
            storeName,
            items: storeOrders.map(orderItemSnapshot),
            itemCount: storeOrders.length,
          })
        }
      }

      preparedOrders.forEach(order => {
        transaction.set(order.ref, {
          ...order.data,
          walletId: order.paymentMethod === 'wallet' ? walletIdForUid(order.ownerUid) : '',
        })
      })

      normalizedItems.forEach(item => {
        dining.data.participants[dinerKey(item.ownerUid, item.ownerName)] = { name: item.ownerName, uid: item.ownerUid }
      })
      Object.values(dining.data.needs).filter(n => ['pending', 'completed'].includes(n.status)).forEach(n => {
        const matching = preparedOrders.filter(order =>
          dinerKey(order.ownerUid, order.ownerName) === n.personKey && order.data.storeName === n.targetStore)
        if (matching.length) Object.assign(n, { status: 'completed', orderIds: [...new Set([...(n.orderIds || []), ...matching.map(order => order.ref.id)])], resolvedBy: actorUid, resolvedAt: now })
      })
      transaction.set(dining.ref, dining.data)

      for (const cashGroup of cashGroups.values()) {
        const relatedOrders = preparedOrders.filter(order => order.cashPaymentId === cashGroup.id)
        const amount = roundMoney(relatedOrders.reduce((sum, order) => sum + order.amount, 0))
        const storeNames = [...new Set(relatedOrders.map(order => order.data.storeName).filter(Boolean))]
        const items = relatedOrders.map(order => ({
          orderId: order.ref.id,
          storeName: order.data.storeName,
          meal: order.data.meal,
          price: order.data.price,
          note: order.data.note,
        }))
        const orderIds = relatedOrders.map(order => order.ref.id)
        transaction.set(cashGroup.ref, {
          cashPaymentId: cashGroup.id,
          ownerName: cashGroup.ownerName,
          ownerUid: cashGroup.ownerUid,
          payerType: cashGroup.ownerUid ? 'member_without_wallet' : 'manual',
          amount,
          collectedAmount: 0,
          remainingAmount: amount,
          status: 'pending',
          paymentMethod: 'cash',
          orderIds,
          storeNames,
          items,
          orderedByUid: actorUid,
          orderedByName: operatorName,
          collectedByUid: '',
          collectedByName: '',
          collectedAt: null,
          cancelledByUid: '',
          cancelledByName: '',
          cancelledAt: null,
          cancelReason: '',
          createdAt: FieldValue.serverTimestamp(),
          createdTimestamp: now,
          updatedAt: FieldValue.serverTimestamp(),
          updatedTimestamp: now,
        })
        writeCashPaymentLog(transaction, {
          cashPaymentId: cashGroup.id,
          ownerName: cashGroup.ownerName,
          ownerUid: cashGroup.ownerUid,
          type: 'cash_order_created',
          amount,
          beforeStatus: '',
          afterStatus: 'pending',
          operatorName,
          operatorUid: actorUid,
          reason: cashReceivableReason(storeNames.join(text.listSeparator), cashGroup.ownerName, operatorName, text),
          orderIds,
          storeName: storeNames.join('、'),
          items,
        })
      }

      const orderIds = preparedOrders.map(order => order.ref.id)
      transaction.set(requestRef, {
        actorUid,
        actorName: operatorName,
        orderIds,
        createdAt: FieldValue.serverTimestamp(),
      })

      return { ok: true, orderIds, duplicate: false }
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', error?.message || '送出失敗')
  }
})

exports.cancelOrdersWithWalletRefund = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const {
    orderIds,
    actorName,
    reason: requestedReason,
  } = request.data || {}

  let ids = [...new Set((Array.isArray(orderIds) ? orderIds : [])
    .map(id => String(id).trim())
    .filter(id => id && !id.includes('/') && id.length <= 1500))]
  const settings = request.data?.dailyStoreSettings
  const replacements = request.data?.storeReplacements ?? (request.data?.storeReplacement ? [request.data.storeReplacement] : [])
  if (!Array.isArray(replacements) || replacements.length > 100) throw new HttpsError('invalid-argument', '換店設定格式錯誤')
  const replacementMap = new Map()
  for (const entry of replacements) {
    const source = String(entry?.source || '').trim()
    const target = String(entry?.target || '').trim()
    if (!source || !target || source === target || source.length > MAX_STORE_NAME_LENGTH || target.length > MAX_STORE_NAME_LENGTH || replacementMap.has(source)) throw new HttpsError('invalid-argument', '請選擇不同的新店家')
    replacementMap.set(source, target)
  }
  const changingStores = replacementMap.size > 0 || Boolean(settings)
  if (!ids.length && !changingStores) throw new HttpsError('invalid-argument', '缺少訂單')
  if (ids.length > MAX_CANCEL_ITEMS) throw new HttpsError('invalid-argument', 'TOO_MANY_ORDERS')
  if (changingStores && ids.length) throw new HttpsError('invalid-argument', '換店不可指定個別訂單')
  const storeList = value => {
    if (!Array.isArray(value) || value.length > 100 || value.some(name => typeof name !== 'string' || !name.trim() || name.length > MAX_STORE_NAME_LENGTH)) throw new HttpsError('invalid-argument', '店家設定格式錯誤')
    return [...new Set(value.map(name => name.trim()))]
  }
  const desiredStores = settings ? storeList(settings.activeStores) : null
  const desiredFree = settings ? storeList(settings.freeStores) : null
  const expectedStores = settings ? storeList(settings.expectedActiveStores) : null
  const expectedFree = settings ? storeList(settings.expectedFreeStores) : null
  if (settings && desiredFree.some(name => !desiredStores.includes(name))) throw new HttpsError('invalid-argument', '免費店家必須是今日店家')

  const profile = await getUserProfile(actorUid)
  const isAdmin = Boolean(profile?.isAdmin)
  if (!profile?.isRegistered) throw new HttpsError('permission-denied', '需要已註冊使用者權限')
  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  const systemSettings = await readSystemSettings()
  const { timeZone } = systemSettings
  const text = serverText(systemSettings)
  const reason = String(requestedReason || '').trim().slice(0, MAX_NOTE_LENGTH) || text.cancelRefund

  try {
    await db.runTransaction(async (transaction) => {
      // 收單後一般成員不可再取消、退款或換店；管理員不受限。
      if (!isAdmin && isOrderingClosed(systemSettings, await readDaily(transaction))) {
        throw new HttpsError('failed-precondition', 'ORDERING_CLOSED')
      }
      const dining = await readDining(transaction, timeZone)
      let dailyRef, daily, nextStores, nextFree
      if (changingStores) {
        const todayKey = dateKeyInZone(timeZone)
        dailyRef = db.collection('settings').doc('daily')
        const dailySnap = await transaction.get(dailyRef)
        daily = dailySnap.exists ? dailySnap.data() : {}
        const dailyIsToday = [daily.serviceDate, daily.date].includes(todayKey)
        const currentStores = dailyIsToday ? (daily.activeStores || []) : []
        const currentFree = dailyIsToday ? (daily.freeStores || []).filter(name => currentStores.includes(name)) : []
        if (settings) {
          const sameSet = (a, b) => a.length === b.length && a.every(name => b.includes(name))
          if (settings.serviceDate !== todayKey || !sameSet(currentStores, expectedStores) || !sameSet(currentFree, expectedFree)) throw new HttpsError('failed-precondition', '今日店家已更新，請重新開啟設定後再試')
          nextStores = desiredStores
          nextFree = desiredFree
        } else {
          if (!dailyIsToday) throw new HttpsError('failed-precondition', '今日店家尚未設定')
          nextStores = [...new Set([...currentStores.filter(name => !replacementMap.has(name)), ...replacementMap.values()])]
          nextFree = currentFree.filter(name => nextStores.includes(name))
        }
        // 免費店家會改變伺服器端訂單金額，與 settings/daily 規則一致只允許管理員變更；
        // 一般成員換店時，只能讓被移除店家的免費設定隨之失效。
        if (!isAdmin) {
          const keptFree = new Set(currentFree.filter(name => nextStores.includes(name)))
          const requestedFree = new Set(nextFree)
          if (requestedFree.size !== keptFree.size || [...requestedFree].some(name => !keptFree.has(name))) throw new HttpsError('permission-denied', '只有管理員可以設定免費店家')
        }
        if (nextStores.some(name => dining.data.replacements[name])) throw new HttpsError('failed-precondition', '不可選擇今日已停用店家')
        for (const [source, target] of replacementMap) {
          if (dining.data.replacements[source]) throw new HttpsError('failed-precondition', '此店家已更換，請重新整理')
          if (!currentStores.includes(source) || nextStores.includes(source) || !nextStores.includes(target) || replacementMap.has(target)) throw new HttpsError('invalid-argument', '換店與今日店家設定不一致')
        }
        for (const name of nextStores.filter(name => !currentStores.includes(name))) {
          const menu = await transaction.get(db.collection('menu_images').where('storeName', '==', name))
          if (menu.empty) throw new HttpsError('not-found', '新店家不存在')
        }
        const start = zonedDayStartMs(todayKey, timeZone)
        const end = zonedDayStartMs(shiftDateKey(todayKey, 1), timeZone)
        const today = await transaction.get(db.collection('orders').where('timestamp', '>=', start).where('timestamp', '<', end))
        const protectedStores = new Set([
          ...today.docs.map(doc => doc.data().storeName),
          ...Object.values(dining.data.needs).filter(need => need.status === 'pending').map(need => need.targetStore),
        ])
        if (currentStores.some(name => !nextStores.includes(name) && protectedStores.has(name) && !replacementMap.has(name))) throw new HttpsError('failed-precondition', '移除的店家已有訂單或待補點人員，請重新確認接替店家')
        ids = today.docs.filter(doc => replacementMap.has(doc.data().storeName)).map(doc => doc.id)
        if (ids.length > MAX_CANCEL_ITEMS) throw new HttpsError('failed-precondition', '換店訂單超過單次上限 100 筆')
        if (!settings && [...replacementMap.keys()].some(name => !protectedStores.has(name))) throw new HttpsError('failed-precondition', '沒有需要換店的訂單或補點人員')
      }
      const orderRefs = ids.map(id => db.collection('orders').doc(id))
      const orderSnaps = await getAllInTransaction(transaction, orderRefs)

      const orders = orderSnaps
        .map((snap, index) => snap.exists ? { id: ids[index], ref: orderRefs[index], ...snap.data() } : null)
        .filter(Boolean)

      if (orders.length !== ids.length) throw new HttpsError('not-found', 'ORDER_NOT_FOUND')
      const walletLedger = await getWalletLedgerForOrders(transaction, ids)
      const cashFreeAdjustedOrderIds = await getCashFreeAdjustedOrderIds(transaction, ids)

      const referencedCashPaymentIds = [...new Set(orders
        .map(order => String(order.cashPaymentId || '').trim())
        .filter(Boolean))]
      const cashPaymentMap = new Map()
      const cashPaymentRefs = referencedCashPaymentIds.map(id => db.collection('cash_payments').doc(id))
      const cashPaymentSnaps = await getAllInTransaction(transaction, cashPaymentRefs)
      cashPaymentSnaps.forEach((paymentSnap, index) => {
        if (paymentSnap.exists) {
          cashPaymentMap.set(referencedCashPaymentIds[index], { ref: cashPaymentRefs[index], ...paymentSnap.data() })
        }
      })

      if (!isAdmin && !changingStores && orders.some(order => {
        const debit = walletLedger.debits.get(order.id)
        if (debit) return ![debit.ownerUid, debit.orderedByUid].includes(actorUid)
        const cashPaymentId = String(order.cashPaymentId || '').trim()
        if (!cashPaymentId) {
          // 免費店家等無金流連結的訂單：本人或代點人可取消。
          return ![order.ownerUid, order.uid, order.orderedByUid].map(String).includes(String(actorUid))
        }
        const cashPayment = cashPaymentMap.get(cashPaymentId)
        const linkedOrderIds = Array.isArray(cashPayment?.orderIds) ? cashPayment.orderIds.map(String) : []
        const isLinkedCashOrder = linkedOrderIds.includes(order.id)
        return !isLinkedCashOrder || ![cashPayment.ownerUid, cashPayment.orderedByUid].map(String).includes(actorUid)
      })) {
        throw new HttpsError('permission-denied', 'ORDER_CANCEL_NOT_ALLOWED')
      }
      if ([...cashPaymentMap.values()].some(payment => payment.status === 'collected')) {
        throw new HttpsError('failed-precondition', 'CASH_PAYMENT_ALREADY_COLLECTED')
      }

      const refundOrders = orders
        .filter(order => walletLedger.debits.has(order.id) && !walletLedger.refundedOrderIds.has(order.id))
        .map(order => {
          const debit = walletLedger.debits.get(order.id)
          // 金額一律以扣款流水為準；描述文字（店家/品項/備註）優先取訂單文件的最新內容，
          // 因為「金額沒變的編輯」不會寫流水，流水上的描述可能是舊的。
          return {
            ...order,
            walletOwnerUid: debit.ownerUid,
            walletOwnerName: debit.ownerName,
            walletAmount: debit.amount,
            storeName: String(order.storeName || debit.storeName || '').trim(),
            meal: String(order.meal ?? debit.meal ?? '').trim(),
            note: String(order.note ?? debit.note ?? '').trim(),
            price: debit.amount,
          }
        })
      const totalsByWallet = refundOrders.reduce((map, order) => {
        const ownerUid = String(order.walletOwnerUid || '').trim()
        const ownerName = String(order.walletOwnerName || '').trim()
        const amount = finiteMoney(order.walletAmount, { min: 1, max: ABSOLUTE_MAX_AMOUNT, code: 'INVALID_ORDER_AMOUNT' })
        if (!ownerUid || !ownerName) return map
        const current = map.get(ownerUid) || { ownerUid, ownerName, total: 0 }
        current.total = roundMoney(current.total + amount)
        map.set(ownerUid, current)
        return map
      }, new Map())
      const walletMap = new Map()
      const walletEntries = [...totalsByWallet.values()]
      const walletRefs = walletEntries.map(({ ownerUid }) => walletRefForUid(ownerUid))
      const walletSnaps = await getAllInTransaction(transaction, walletRefs)
      walletEntries.forEach(({ ownerUid, ownerName }, index) => {
        walletMap.set(ownerUid, {
          ref: walletRefs[index],
          ownerName,
          balance: roundMoney(walletSnaps[index].exists ? walletSnaps[index].data().balance : 0),
        })
      })

      const cashCancelGroups = orders.reduce((map, order) => {
        const cashPaymentId = String(order.cashPaymentId || '').trim()
        const payment = cashPaymentMap.get(cashPaymentId)
        const paymentItems = Array.isArray(payment?.items) ? payment.items : []
        const trustedItem = paymentItems.find(item => String(item?.orderId || '') === order.id)
        if (!payment || !trustedItem || payment.status === 'cancelled') return map
        if (!map.has(cashPaymentId)) map.set(cashPaymentId, [])
        map.get(cashPaymentId).push({
          ...order,
          price: cashFreeAdjustedOrderIds.has(order.id)
            ? 0
            : finiteMoney(trustedItem.price, { min: 1, max: ABSOLUTE_MAX_AMOUNT, code: 'INVALID_CASH_AMOUNT' }),
          storeName: String(trustedItem.storeName || '').trim(),
          meal: String(trustedItem.meal || '').trim(),
          note: String(trustedItem.note || '').trim(),
        })
        return map
      }, new Map())

      for (const { ownerUid, ownerName, total } of totalsByWallet.values()) {
        const wallet = walletMap.get(ownerUid)
        const afterBalance = roundMoney(wallet.balance + total)
        const relatedOrders = refundOrders.filter(order => String(order.walletOwnerUid || order.uid || '').trim() === ownerUid)
        const walletId = walletIdForUid(ownerUid)

        transaction.set(wallet.ref, {
          ownerUid,
          ownerName,
          balance: afterBalance,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: operatorName,
          updatedByUid: actorUid,
          lastTransactionType: 'cancel_refund',
        }, { merge: true })

        let runningBalance = wallet.balance
        for (const [storeName, storeOrders] of groupOrdersByStore(relatedOrders.map(order => ({ ...order, data: order })), text).entries()) {
          const storeTotal = roundMoney(storeOrders.reduce((sum, order) => sum + (Number(order.walletAmount ?? order.price) || 0), 0))
          const nextBalance = roundMoney(runningBalance + storeTotal)
          writeWalletLog(transaction, {
            walletId,
            ownerUid,
            ownerName,
            type: 'cancel_refund',
            amount: storeTotal,
            beforeBalance: runningBalance,
            afterBalance: nextBalance,
            operatorName,
            operatorUid: actorUid,
            reason: [reason, storeName].join(text.reasonSeparator),
            orderId: storeOrders.length === 1 ? storeOrders[0].id : '',
            orderIds: storeOrders.map(order => order.id),
            storeName,
            items: storeOrders.map(orderItemSnapshot),
            itemCount: storeOrders.length,
          })
          runningBalance = nextBalance
        }
      }

      for (const [cashPaymentId, cashOrders] of cashCancelGroups.entries()) {
        const payment = cashPaymentMap.get(cashPaymentId)
        if (!payment) continue
        const cancelAmount = roundMoney(cashOrders.reduce((sum, order) => sum + (Number(order.price) || 0), 0))
        const beforeStatus = payment.status || 'pending'
        const currentRemaining = roundMoney(Number(payment.remainingAmount ?? payment.amount) || 0)
        const nextRemaining = Math.max(0, roundMoney(currentRemaining - cancelAmount))
        const nextAmount = Math.max(0, roundMoney((Number(payment.amount) || 0) - cancelAmount))
        const nextStatus = nextRemaining <= 0 && beforeStatus !== 'collected' ? 'cancelled' : beforeStatus
        const storeNames = [...new Set(cashOrders.map(order => order.storeName).filter(Boolean))]
        const cancelledOrderIds = new Set(cashOrders.map(order => String(order.id)))
        const remainingOrderIds = (Array.isArray(payment.orderIds) ? payment.orderIds : [])
          .map(String)
          .filter(orderId => !cancelledOrderIds.has(orderId))
        const remainingItems = (Array.isArray(payment.items) ? payment.items : [])
          .filter(item => !cancelledOrderIds.has(String(item?.orderId || '')))
        const remainingStoreNames = [...new Set(remainingItems.map(item => item?.storeName).filter(Boolean))]
        const items = cashOrders.map(order => ({
          orderId: order.id,
          storeName: order.storeName || '',
          meal: order.meal || '',
          price: Number(order.price) || 0,
          note: order.note || '',
        }))

        transaction.update(payment.ref, {
          amount: nextAmount,
          remainingAmount: nextRemaining,
          status: nextStatus,
          orderIds: remainingOrderIds,
          items: remainingItems,
          storeNames: remainingStoreNames,
          cancelledByUid: nextStatus === 'cancelled' ? actorUid : (payment.cancelledByUid || ''),
          cancelledByName: nextStatus === 'cancelled' ? operatorName : (payment.cancelledByName || ''),
          cancelledAt: nextStatus === 'cancelled' ? FieldValue.serverTimestamp() : (payment.cancelledAt || null),
          cancelReason: nextStatus === 'cancelled' ? reason : (payment.cancelReason || ''),
          updatedAt: FieldValue.serverTimestamp(),
          updatedTimestamp: Date.now(),
        })
        writeCashPaymentLog(transaction, {
          cashPaymentId,
          ownerName: payment.ownerName || '',
          ownerUid: payment.ownerUid || '',
          type: 'cash_cancelled',
          amount: cancelAmount,
          beforeStatus,
          afterStatus: nextStatus,
          operatorName,
          operatorUid: actorUid,
          reason,
          orderIds: cashOrders.map(order => order.id),
          storeName: storeNames.join('、'),
          items,
        })
      }

      // 保留用餐人員及原餐點；刪除有效訂單僅發生於同一筆退款交易。
      const removed = new Set(ids)
      const currentDateKey = dateKeyInZone(timeZone)
      orders.filter(order => Number.isFinite(Number(order.timestamp)) && dateKeyInZone(timeZone, new Date(Number(order.timestamp))) === currentDateKey).forEach(order => {
        const uid = String(order.ownerUid || order.walletOwnerUid || '')
        const name = String(order.name || order.ownerName || '')
        dining.data.participants[dinerKey(uid, name)] = { uid, name }
      })
      Object.values(dining.data.needs).forEach(need => {
        if (need.status === 'completed' && need.orderIds?.some(id => removed.has(id))) {
          need.orderIds = need.orderIds.filter(id => !removed.has(id))
          if (!need.orderIds.length) need.status = 'pending'
        }
      })
      for (const [source, target] of replacementMap) {
        const eventId = crypto.randomUUID()
        for (const order of orders.filter(order => order.storeName === source)) {
          const uid = String(order.ownerUid || order.walletOwnerUid || '')
          const name = String(order.name || order.ownerName || '')
          const personKey = dinerKey(uid, name)
          dining.data.participants[personKey] = { uid, name }
          let need = Object.values(dining.data.needs).find(n => n.personKey === personKey && n.status === 'pending' && n.targetStore === source)
          if (!need) {
            const id = `${eventId}_${personKey}`
            need = dining.data.needs[id] = { id, personKey, uid, name, sourceStore: source, targetStore: source, status: 'pending', originals: [], orderIds: [], createdAt: Date.now() }
          }
          need.originals.push({ storeName: source, meal: order.meal || '', note: order.note || '', price: Number(order.price) || 0, orderId: order.id })
        }
        Object.values(dining.data.needs).forEach(need => {
          if (need.status === 'pending' && need.targetStore === source) need.targetStore = target
        })
        dining.data.replacements[source] = { target, actorUid, timestamp: Date.now() }

      }
      if (changingStores) transaction.set(dailyRef, { ...daily, activeStores: nextStores, freeStores: nextFree, date: currentDateKey, serviceDate: currentDateKey, updatedAt: FieldValue.serverTimestamp() })
      transaction.set(dining.ref, dining.data)
      orders.forEach(order => transaction.delete(order.ref))
    })

    await notifyStoreReplacements(systemSettings, replacementMap)
    return { ok: true }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', error?.message || '取消失敗')
  }
})

exports.cancelDiningNeed = onCall(async (request) => {
  const uid = requireAuth(request)
  const profile = await getUserProfile(uid)
  if (!profile?.isRegistered) throw new HttpsError('permission-denied', '需要已註冊使用者權限')
  const { timeZone } = await readSystemSettings()
  return db.runTransaction(async transaction => {
    const dining = await readDining(transaction, timeZone)
    const need = dining.data.needs[String(request.data?.needId || '')]
    if (!need || need.status !== 'pending') throw new HttpsError('failed-precondition', '補點狀態已更新')
    Object.assign(need, { status: 'declined', resolvedBy: uid, resolvedAt: Date.now() })
    transaction.set(dining.ref, dining.data)
    return { ok: true }
  })
})

exports.setOrderFreeStatusWithWalletAdjustment = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)

  const { orderId, isFree, actorName } = request.data || {}
  if (!orderId) throw new HttpsError('invalid-argument', '缺少訂單')

  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  const text = serverText(await readSystemSettings())

  try {
    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection('orders').doc(String(orderId))
      const orderSnap = await transaction.get(orderRef)
      if (!orderSnap.exists) throw new HttpsError('not-found', 'ORDER_NOT_FOUND')

      const order = { id: String(orderId), ref: orderRef, ...orderSnap.data() }
      const nextIsFree = Boolean(isFree)
      if (Boolean(order.isFree) === nextIsFree) return

      const ownerUid = String(order.walletOwnerUid || order.ownerUid || order.uid || '').trim()
      const ownerName = String(order.walletOwnerName || order.name || '').trim()
      const amountSource = nextIsFree && order.walletDebited ? (order.walletAmount ?? order.price) : order.price
      const amount = finiteMoney(amountSource, { min: 1, max: ABSOLUTE_MAX_AMOUNT, code: 'INVALID_ORDER_AMOUNT' })
      const isWalletOrder = order.paymentMethod === 'wallet' || (!order.paymentMethod && order.walletDebited)
      const shouldAdjustWallet = isWalletOrder && ownerUid && ownerName && amount > 0
      if (isWalletOrder && !shouldAdjustWallet) throw new HttpsError('failed-precondition', 'ORDER_WALLET_OWNER_MISSING')
      const shouldAdjustCash = order.paymentMethod === 'cash' && order.cashPaymentId && amount > 0
      let wallet = null
      if (shouldAdjustWallet) {
        const walletRef = walletRefForUid(ownerUid)
        const walletSnap = await transaction.get(walletRef)
        wallet = {
          ref: walletRef,
          balance: roundMoney(walletSnap.exists ? walletSnap.data().balance : 0),
        }
      }
      let cashPayment = null
      if (shouldAdjustCash) {
        const cashRef = db.collection('cash_payments').doc(String(order.cashPaymentId))
        const cashSnap = await transaction.get(cashRef)
        if (cashSnap.exists) cashPayment = { ref: cashRef, ...cashSnap.data() }
      }
      if (shouldAdjustCash && (order.cashStatus === 'collected' || cashPayment?.status === 'collected')) {
        throw new HttpsError('failed-precondition', 'CASH_PAYMENT_ALREADY_COLLECTED')
      }
      const walletId = ownerUid ? walletIdForUid(ownerUid) : ''

      if (nextIsFree) {
        if (shouldAdjustWallet && order.walletDebited && !order.walletRefunded) {
          const afterBalance = roundMoney(wallet.balance + amount)
          transaction.set(wallet.ref, {
            ownerUid,
            ownerName,
            balance: afterBalance,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: operatorName,
            updatedByUid: actorUid,
            lastTransactionType: 'free_refund',
          }, { merge: true })
          writeWalletLog(transaction, {
            walletId,
            ownerUid,
            ownerName,
            type: 'free_refund',
            amount,
            beforeBalance: wallet.balance,
            afterBalance,
            operatorName,
            operatorUid: actorUid,
            reason: freeOrderWalletReason(text.freeRefund, order, text),
            orderId: order.id,
            orderIds: [order.id],
            storeName: orderStoreName(order) || text.unknownStore,
            items: [orderItemSnapshot(order)],
            itemCount: 1,
          })
        }

        if (shouldAdjustCash && cashPayment && !order.cashFreeAdjusted) {
          const beforeStatus = cashPayment.status || 'pending'
          const nextAmount = Math.max(0, roundMoney((Number(cashPayment.amount) || 0) - amount))
          const nextRemaining = Math.max(0, roundMoney((Number(cashPayment.remainingAmount ?? cashPayment.amount) || 0) - amount))
          const nextStatus = nextRemaining <= 0 && beforeStatus !== 'collected' ? 'cancelled' : beforeStatus
          transaction.update(cashPayment.ref, {
            amount: nextAmount,
            remainingAmount: nextRemaining,
            status: nextStatus,
            updatedAt: FieldValue.serverTimestamp(),
            updatedTimestamp: Date.now(),
          })
          writeCashPaymentLog(transaction, {
            cashPaymentId: String(order.cashPaymentId),
            ownerName,
            ownerUid,
            type: 'cash_adjustment',
            amount: -amount,
            beforeStatus,
            afterStatus: nextStatus,
            operatorName,
            operatorUid: actorUid,
            reason: freeOrderWalletReason(text.freeCashDeduct, order, text),
            orderIds: [order.id],
            storeName: orderStoreName(order) || text.unknownStore,
            items: [orderItemSnapshot(order)],
          })
        }

        transaction.update(order.ref, {
          isFree: true,
          freeMarkedAt: FieldValue.serverTimestamp(),
          freeMarkedBy: operatorName,
          freeMarkedByUid: actorUid,
          walletRefunded: shouldAdjustWallet ? true : Boolean(order.walletRefunded),
          cashFreeAdjusted: shouldAdjustCash ? true : Boolean(order.cashFreeAdjusted),
        })
        return
      }

      if (shouldAdjustWallet && (order.walletRefunded || !order.walletDebited)) {
        if (wallet.balance < amount) throw new HttpsError('failed-precondition', 'INSUFFICIENT_WALLET_BALANCE')

        const afterBalance = roundMoney(wallet.balance - amount)
        transaction.set(wallet.ref, {
          ownerUid,
          ownerName,
          balance: afterBalance,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: operatorName,
          updatedByUid: actorUid,
          lastTransactionType: 'free_debit',
        }, { merge: true })
        writeWalletLog(transaction, {
          walletId,
          ownerUid,
          ownerName,
          type: 'free_debit',
          amount: -amount,
          beforeBalance: wallet.balance,
          afterBalance,
          operatorName,
          operatorUid: actorUid,
          reason: freeOrderWalletReason(text.unfreeDebit, order, text),
          orderId: order.id,
          orderIds: [order.id],
          storeName: orderStoreName(order) || text.unknownStore,
          items: [orderItemSnapshot(order)],
          itemCount: 1,
        })
      }

      if (shouldAdjustCash && cashPayment && order.cashFreeAdjusted) {
        const beforeStatus = cashPayment.status || 'pending'
        const nextAmount = roundMoney((Number(cashPayment.amount) || 0) + amount)
        const nextRemaining = roundMoney((Number(cashPayment.remainingAmount) || 0) + amount)
        const nextStatus = beforeStatus === 'cancelled' ? 'pending' : beforeStatus
        transaction.update(cashPayment.ref, {
          amount: nextAmount,
          remainingAmount: nextRemaining,
          status: nextStatus,
          items: (cashPayment.items || []).map(item => String(item.orderId) === order.id
            ? { ...item, ...orderItemSnapshot(order) } : item),
          updatedAt: FieldValue.serverTimestamp(),
          updatedTimestamp: Date.now(),
        })
        writeCashPaymentLog(transaction, {
          cashPaymentId: String(order.cashPaymentId),
          ownerName,
          ownerUid,
          type: 'cash_adjustment',
          amount,
          beforeStatus,
          afterStatus: nextStatus,
          operatorName,
          operatorUid: actorUid,
          reason: freeOrderWalletReason(text.unfreeCashRestore, order, text),
          orderIds: [order.id],
          storeName: orderStoreName(order) || text.unknownStore,
          items: [orderItemSnapshot(order)],
        })
      }

      // 今日免費的現金單建單時沒有應收款；恢復收費時一併建立，供總務收款。
      const newCashPayment = !nextIsFree && order.paymentMethod === 'cash' && !order.cashPaymentId
        ? cashPaymentRef()
        : null
      if (newCashPayment) {
        const now = Date.now()
        const items = [{ orderId: order.id, ...orderItemSnapshot(order) }]
        transaction.set(newCashPayment, {
          cashPaymentId: newCashPayment.id,
          ownerName: order.ownerName || order.name || '',
          ownerUid: order.ownerUid || '',
          payerType: order.ownerUid ? 'member_without_wallet' : 'manual',
          amount,
          collectedAmount: 0,
          remainingAmount: amount,
          status: 'pending',
          paymentMethod: 'cash',
          orderIds: [order.id],
          storeNames: [orderStoreName(order)].filter(Boolean),
          items,
          orderedByUid: order.orderedByUid || order.uid || '',
          orderedByName: order.orderedByName || '',
          collectedByUid: '',
          collectedByName: '',
          collectedAt: null,
          cancelledByUid: '',
          cancelledByName: '',
          cancelledAt: null,
          cancelReason: '',
          createdAt: FieldValue.serverTimestamp(),
          createdTimestamp: now,
          updatedAt: FieldValue.serverTimestamp(),
          updatedTimestamp: now,
        })
        writeCashPaymentLog(transaction, {
          cashPaymentId: newCashPayment.id,
          ownerName: order.ownerName || order.name || '',
          ownerUid: order.ownerUid || '',
          type: 'cash_order_created',
          amount,
          afterStatus: 'pending',
          operatorName,
          operatorUid: actorUid,
          reason: freeOrderWalletReason(text.unfreeCashCreate, order, text),
          orderIds: [order.id],
          storeName: orderStoreName(order),
          items,
        })
      }

      transaction.update(order.ref, {
        isFree: false,
        freeMarkedAt: null,
        freeMarkedBy: '',
        freeMarkedByUid: '',
        walletRefunded: shouldAdjustWallet ? false : Boolean(order.walletRefunded),
        ...(shouldAdjustWallet ? {
          walletDebited: true,
          walletAmount: amount,
          walletId,
          walletOwnerUid: ownerUid,
          walletOwnerName: ownerName,
          paid: true,
          paidByWallet: true,
          paidAt: FieldValue.serverTimestamp(),
        } : {}),
        ...(newCashPayment ? { cashPaymentId: newCashPayment.id } : {}),
        ...(order.paymentMethod === 'cash' && (newCashPayment || shouldAdjustCash) ? {
          paid: false,
          paidByWallet: false,
          cashStatus: 'pending',
        } : {}),
        cashFreeAdjusted: shouldAdjustCash ? false : Boolean(order.cashFreeAdjusted),
      })
    })

    return { ok: true }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', error?.message || '免費操作失敗')
  }
})

exports.updateOrderWithPaymentAdjustment = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await getUserProfile(actorUid)
  if (!profile.isRegistered) throw new HttpsError('permission-denied', '需要已註冊使用者權限')
  const isAdmin = Boolean(profile?.isAdmin)
  const { orderId, meal, note = '', price, actorName } = request.data || {}
  const id = String(orderId || '').trim()
  const nextMeal = String(meal || '').trim()
  const nextNote = String(note || '').trim()
  const nextPrice = finiteMoney(price, { min: 1, max: ABSOLUTE_MAX_AMOUNT, code: 'INVALID_ORDER_AMOUNT' })
  if (!id || id.includes('/') || id.length > 1500 || !nextMeal) {
    throw new HttpsError('invalid-argument', '訂單資料不完整')
  }
  if (nextMeal.length > MAX_MEAL_LENGTH || nextNote.length > MAX_NOTE_LENGTH) {
    throw new HttpsError('invalid-argument', 'ORDER_TEXT_TOO_LONG')
  }
  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  const systemSettings = await readSystemSettings()
  const text = serverText(systemSettings)

  try {
    await db.runTransaction(async transaction => {
      const daily = await readDaily(transaction)
      if (!isAdmin && isOrderingClosed(systemSettings, daily)) throw new HttpsError('failed-precondition', 'ORDERING_CLOSED')
      const orderRef = db.collection('orders').doc(id)
      const orderSnap = await transaction.get(orderRef)
      if (!orderSnap.exists) throw new HttpsError('not-found', 'ORDER_NOT_FOUND')
      const order = { id, ref: orderRef, ...orderSnap.data() }

      const walletLedger = await getWalletLedgerForOrders(transaction, [id])
      const debit = walletLedger.debits.get(id)
      const cashPaymentId = String(order.cashPaymentId || '').trim()
      let cashPayment = null
      let cashItem = null
      if (cashPaymentId) {
        const paymentRef = db.collection('cash_payments').doc(cashPaymentId)
        const paymentSnap = await transaction.get(paymentRef)
        if (paymentSnap.exists) {
          cashPayment = { ref: paymentRef, ...paymentSnap.data() }
          cashItem = (Array.isArray(cashPayment.items) ? cashPayment.items : [])
            .find(item => String(item?.orderId || '') === id) || null
        }
      }

      const permittedUids = debit
        ? [debit.ownerUid, debit.orderedByUid]
        : cashItem
          ? [cashPayment.ownerUid, cashPayment.orderedByUid]
          : [order.ownerUid, order.uid, order.orderedByUid]
      if (!isAdmin && !permittedUids.map(String).includes(actorUid)) {
        throw new HttpsError('permission-denied', 'ORDER_EDIT_NOT_ALLOWED')
      }

      const previousPrice = finiteMoney(
        order.isFree ? order.price : (debit?.amount ?? cashItem?.price ?? order.price),
        { min: 1, max: ABSOLUTE_MAX_AMOUNT, code: 'INVALID_ORDER_AMOUNT' },
      )
      const previousSnapshot = {
        meal: String(order.meal ?? debit?.meal ?? cashItem?.meal ?? '').trim(),
        price: previousPrice,
        note: String(order.note ?? debit?.note ?? cashItem?.note ?? '').trim(),
        storeName: String(debit?.storeName ?? cashItem?.storeName ?? order.storeName ?? '').trim(),
      }
      // 只在改價時套用目前的單筆上限，管理員調低上限後仍可修改舊單的備註。
      if (nextPrice !== previousPrice && nextPrice > systemSettings.limits.maxItemPrice) {
        throw new HttpsError('invalid-argument', 'INVALID_ORDER_AMOUNT')
      }
      const menuSelectionChanged = nextMeal !== previousSnapshot.meal || nextPrice !== previousPrice
      if (!isAdmin && menuSelectionChanged) {
        const storeName = previousSnapshot.storeName
        if (!storeName) throw new HttpsError('failed-precondition', 'MENU_ITEM_PRICE_MISMATCH')
        const menuSnap = await transaction.get(
          db.collection('menu_images').where('storeName', '==', storeName),
        )
        const isVerifiedMenuSelection = menuSnap.docs.some(doc => {
          const menuItems = Array.isArray(doc.data().menuItems) ? doc.data().menuItems : []
          return menuItems.some(item => {
            const isAddon = item?.type === 'addon' || String(item?.category || '').trim() === '加點'
            return !isAddon
              && String(item?.name || '').trim() === nextMeal
              && roundMoney(item?.price) === nextPrice
          })
        })
        if (!isVerifiedMenuSelection) {
          throw new HttpsError('failed-precondition', 'MENU_ITEM_PRICE_MISMATCH')
        }
      }
      const nextSnapshot = {
        meal: nextMeal,
        price: nextPrice,
        note: nextNote,
        storeName: String(order.storeName || previousSnapshot.storeName || '').trim(),
      }
      const editedTimestamp = Date.now()
      const updates = {
        meal: nextMeal,
        note: nextNote,
        price: nextPrice,
        editedAtTimestamp: editedTimestamp,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: actorUid,
        updatedByName: operatorName,
      }

      if (debit) updates.walletAmount = nextPrice
      const isRefunded = walletLedger.refundedOrderIds.has(id)
      // 金額沒變（只改品名或備註）就不動錢包：沒有錢移動就不該有流水，
      // 訂單文件本身已更新，取消退款的明細描述也改由訂單文件取得最新內容。
      const priceChanged = nextPrice !== previousPrice
      const shouldAdjustWallet = Boolean(debit) && !isRefunded && !order.isFree && priceChanged
      if (shouldAdjustWallet) {
        const ownerUid = String(debit.ownerUid || '').trim()
        const ownerName = String(debit.ownerName || '').trim()
        if (!ownerUid || !ownerName) throw new HttpsError('failed-precondition', 'ORDER_WALLET_OWNER_MISSING')
        const walletRef = walletRefForUid(ownerUid)
        const walletSnap = await transaction.get(walletRef)
        const beforeBalance = roundMoney(walletSnap.exists ? walletSnap.data().balance : 0)
        const afterRefundBalance = roundMoney(beforeBalance + previousPrice)
        const afterDebitBalance = roundMoney(afterRefundBalance - nextPrice)
        if (afterDebitBalance < 0) throw new HttpsError('failed-precondition', 'INSUFFICIENT_WALLET_BALANCE')
        const editGroupId = crypto.randomUUID()
        const editDelta = roundMoney(previousPrice - nextPrice)
        transaction.set(walletRef, {
          ownerUid,
          ownerName,
          balance: afterDebitBalance,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: operatorName,
          updatedByUid: actorUid,
          lastTransactionType: 'order_edit_debit',
        }, { merge: true })
        writeWalletLog(transaction, {
          walletId: walletIdForUid(ownerUid),
          ownerUid,
          ownerName,
          type: 'order_edit_refund',
          amount: previousPrice,
          beforeBalance,
          afterBalance: afterRefundBalance,
          operatorName,
          operatorUid: actorUid,
          reason: [text.editRefund, previousSnapshot.storeName || text.unknownStore, previousSnapshot.meal].join(text.reasonSeparator),
          orderId: id,
          orderIds: [id],
          storeName: previousSnapshot.storeName || text.unknownStore,
          items: [previousSnapshot],
          itemCount: 1,
          editGroupId,
          editDelta,
        })
        writeWalletLog(transaction, {
          walletId: walletIdForUid(ownerUid),
          ownerUid,
          ownerName,
          type: 'order_edit_debit',
          amount: -nextPrice,
          beforeBalance: afterRefundBalance,
          afterBalance: afterDebitBalance,
          operatorName,
          operatorUid: actorUid,
          reason: [text.editDebit, nextSnapshot.storeName || text.unknownStore, nextMeal].join(text.reasonSeparator),
          orderId: id,
          orderIds: [id],
          storeName: nextSnapshot.storeName || text.unknownStore,
          items: [nextSnapshot],
          itemCount: 1,
          editGroupId,
          editDelta,
        })
      }

      if (cashPayment && cashItem && !order.isFree) {
        const delta = roundMoney(nextPrice - previousPrice)
        if (cashPayment.status === 'collected' && delta !== 0) {
          throw new HttpsError('failed-precondition', 'CASH_PAYMENT_ALREADY_COLLECTED')
        }
        if (cashPayment.status === 'cancelled') {
          throw new HttpsError('failed-precondition', 'CASH_PAYMENT_CANCELLED')
        }
        const nextAmount = Math.max(0, roundMoney((Number(cashPayment.amount) || 0) + delta))
        const nextRemaining = Math.max(0, roundMoney((Number(cashPayment.remainingAmount ?? cashPayment.amount) || 0) + delta))
        const items = cashPayment.items.map(item => String(item?.orderId || '') === id
          ? { ...item, ...nextSnapshot }
          : item)
        transaction.update(cashPayment.ref, {
          amount: nextAmount,
          remainingAmount: nextRemaining,
          items,
          updatedAt: FieldValue.serverTimestamp(),
          updatedTimestamp: Date.now(),
        })
        if (delta !== 0) {
          writeCashPaymentLog(transaction, {
            cashPaymentId,
            ownerName: cashPayment.ownerName || '',
            ownerUid: cashPayment.ownerUid || '',
            type: 'cash_adjustment',
            amount: delta,
            beforeStatus: cashPayment.status || 'pending',
            afterStatus: cashPayment.status || 'pending',
            operatorName,
            operatorUid: actorUid,
            reason: [text.editAdjust, nextSnapshot.storeName || text.unknownStore, `${previousSnapshot.meal} → ${nextMeal}`].join(text.reasonSeparator),
            orderIds: [id],
            storeName: nextSnapshot.storeName,
            items: [previousSnapshot, nextSnapshot],
          })
        }
      }

      transaction.update(orderRef, updates)
    })
    return { ok: true }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', error?.message || '訂單更新失敗')
  }
})

exports.addWalletCredit = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)

  const { ownerUid, amount, actorName, reason } = request.data || {}
  const uid = walletIdForUid(ownerUid)
  const member = await getVerifiedMember(uid)
  const name = member.memberName
  const settings = await readSystemSettings()
  const { limits } = settings
  const credit = finiteMoney(amount, { min: 1, max: limits.maxTopUp, code: 'INVALID_WALLET_TRANSACTION' })
  const memo = String(reason || '').trim() || serverText(settings).manualTopUp
  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  if (memo.length > MAX_NOTE_LENGTH) throw new HttpsError('invalid-argument', 'INVALID_WALLET_TRANSACTION')

  await db.runTransaction(async (transaction) => {
    const walletRef = walletRefForUid(uid)
    const snap = await transaction.get(walletRef)
    const beforeBalance = roundMoney(snap.exists ? snap.data().balance : 0)
    const afterBalance = roundMoney(beforeBalance + credit)
    const walletId = walletIdForUid(uid)

    transaction.set(walletRef, {
      ownerUid: uid,
      ownerName: name,
      balance: afterBalance,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: operatorName,
      updatedByUid: actorUid,
      lastTransactionType: 'top_up',
    }, { merge: true })

    writeWalletLog(transaction, {
      walletId,
      ownerUid: uid,
      ownerName: name,
      type: 'top_up',
      amount: credit,
      beforeBalance,
      afterBalance,
      operatorName,
      operatorUid: actorUid,
      reason: memo,
    })
  })

  return { ok: true }
})

exports.adjustWalletBalance = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)

  const { ownerUid, amount, actorName, reason } = request.data || {}
  const uid = walletIdForUid(ownerUid)
  const member = await getVerifiedMember(uid)
  const name = member.memberName
  const delta = finiteMoney(amount, { min: -MAX_WALLET_TRANSACTION, max: MAX_WALLET_TRANSACTION, code: 'INVALID_WALLET_TRANSACTION' })
  const memo = String(reason || '').trim()
  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  if (delta === 0 || !memo || memo.length > MAX_NOTE_LENGTH) throw new HttpsError('invalid-argument', 'INVALID_WALLET_TRANSACTION')

  await db.runTransaction(async (transaction) => {
    const walletRef = walletRefForUid(uid)
    const snap = await transaction.get(walletRef)
    const beforeBalance = roundMoney(snap.exists ? snap.data().balance : 0)
    const afterBalance = roundMoney(beforeBalance + delta)
    const walletId = walletIdForUid(uid)

    transaction.set(walletRef, {
      ownerUid: uid,
      ownerName: name,
      balance: afterBalance,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: operatorName,
      updatedByUid: actorUid,
      lastTransactionType: 'admin_adjustment',
    }, { merge: true })

    writeWalletLog(transaction, {
      walletId,
      ownerUid: uid,
      ownerName: name,
      type: 'admin_adjustment',
      amount: delta,
      beforeBalance,
      afterBalance,
      operatorName,
      operatorUid: actorUid,
      reason: memo,
    })
  })

  return { ok: true }
})

exports.createMissingCashPayment = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)
  const { orderId, actorName } = request.data || {}
  const id = String(orderId || '').trim()
  if (!id) throw new HttpsError('invalid-argument', '缺少訂單')

  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()
  const newCashRef = cashPaymentRef()
  const text = serverText(await readSystemSettings())

  return db.runTransaction(async (transaction) => {
    const orderRef = db.collection('orders').doc(id)
    const orderSnap = await transaction.get(orderRef)
    if (!orderSnap.exists) throw new HttpsError('not-found', 'ORDER_NOT_FOUND')

    const order = { id, ...orderSnap.data() }
    const isCashOrder = order.paymentMethod === 'cash' || (!order.paymentMethod && !order.paid && !order.walletDebited)
    if (!isCashOrder || order.isFree || order.cashStatus === 'cancelled') {
      throw new HttpsError('failed-precondition', 'ORDER_IS_NOT_PENDING_CASH')
    }

    const existingCashPaymentId = String(order.cashPaymentId || '').trim()
    if (existingCashPaymentId) {
      const existingRef = db.collection('cash_payments').doc(existingCashPaymentId)
      const existingSnap = await transaction.get(existingRef)
      if (existingSnap.exists) return { ok: true, cashPaymentId: existingCashPaymentId, duplicate: true }
    }

    const amount = finiteMoney(order.price, { min: 1, max: ABSOLUTE_MAX_AMOUNT, code: 'INVALID_CASH_AMOUNT' })

    const ownerName = String(order.ownerName || order.name || '').trim()
    const ownerUid = String(order.ownerUid || '').trim()
    const storeName = String(order.storeName || '').trim()
    const orderedByName = String(order.orderedByName || operatorName).trim()
    const createdTimestamp = Number(order.timestamp) || Date.now()
    const item = {
      orderId: id,
      storeName,
      meal: String(order.meal || '').trim(),
      price: amount,
      note: String(order.note || '').trim(),
    }

    transaction.set(newCashRef, {
      cashPaymentId: newCashRef.id,
      ownerName,
      ownerUid,
      payerType: ownerUid ? 'member_without_wallet' : 'manual',
      amount,
      collectedAmount: 0,
      remainingAmount: amount,
      status: 'pending',
      paymentMethod: 'cash',
      orderIds: [id],
      storeNames: storeName ? [storeName] : [],
      items: [item],
      orderedByUid: String(order.orderedByUid || actorUid),
      orderedByName,
      collectedByUid: '',
      collectedByName: '',
      collectedAt: null,
      cancelledByUid: '',
      cancelledByName: '',
      cancelledAt: null,
      cancelReason: '',
      createdAt: FieldValue.serverTimestamp(),
      createdTimestamp,
      updatedAt: FieldValue.serverTimestamp(),
      updatedTimestamp: Date.now(),
      repairedAt: FieldValue.serverTimestamp(),
      repairedByUid: actorUid,
      repairedByName: operatorName,
    })

    transaction.update(orderRef, {
      cashPaymentId: newCashRef.id,
      cashStatus: 'pending',
      paymentMethod: 'cash',
      paidByWallet: false,
      paid: false,
    })

    writeCashPaymentLog(transaction, {
      cashPaymentId: newCashRef.id,
      ownerName,
      ownerUid,
      type: 'cash_order_created',
      amount,
      beforeStatus: '',
      afterStatus: 'pending',
      operatorName,
      operatorUid: actorUid,
      reason: cashReceivableReason(storeName, ownerName, orderedByName, text, text.cashReceivableRepair),
      orderIds: [id],
      storeName,
      items: [item],
    })

    return { ok: true, cashPaymentId: newCashRef.id, duplicate: false }
  })
})

exports.getCashPaymentAdminData = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)

  const fromTimestamp = Number(request.data?.fromTimestamp)
  const toTimestamp = Number(request.data?.toTimestamp)
  const hasRange = Number.isFinite(fromTimestamp) && Number.isFinite(toTimestamp)
  if (hasRange && fromTimestamp > toTimestamp) {
    throw new HttpsError('invalid-argument', 'INVALID_CASH_EXPORT_RANGE')
  }

  const paymentQuery = hasRange
    ? db.collection('cash_payments')
      .where('createdTimestamp', '>=', fromTimestamp)
      .where('createdTimestamp', '<=', toTimestamp)
      .orderBy('createdTimestamp', 'desc')
    : db.collection('cash_payments').orderBy('createdTimestamp', 'desc').limit(500)
  const logQuery = hasRange
    ? db.collection('cash_payment_logs')
      .where('timestamp', '>=', fromTimestamp)
      .where('timestamp', '<=', toTimestamp)
      .orderBy('timestamp', 'desc')
    : db.collection('cash_payment_logs').orderBy('timestamp', 'desc').limit(1000)

  const [paymentSnap, logSnap] = await Promise.all([
    paymentQuery.get(),
    logQuery.get(),
  ])

  const serializeValue = (value) => {
    if (typeof value?.toMillis === 'function') return value.toMillis()
    if (Array.isArray(value)) return value.map(serializeValue)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serializeValue(nested)]))
    }
    return value
  }
  const serializeDoc = (snap) => ({ id: snap.id, ...serializeValue(snap.data()) })

  return {
    payments: paymentSnap.docs.map(serializeDoc),
    logs: logSnap.docs.map(serializeDoc),
  }
})

exports.markCashPaymentCollected = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)
  const { cashPaymentId, actorName } = request.data || {}
  const id = String(cashPaymentId || '').trim()
  if (!id) throw new HttpsError('invalid-argument', '缺少現金單')
  const reason = String(request.data?.reason || '').trim().slice(0, MAX_NOTE_LENGTH) || serverText(await readSystemSettings()).cashCollected

  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()

  await db.runTransaction(async (transaction) => {
    const paymentRef = db.collection('cash_payments').doc(id)
    const paymentSnap = await transaction.get(paymentRef)
    if (!paymentSnap.exists) throw new HttpsError('not-found', 'CASH_PAYMENT_NOT_FOUND')

    const payment = { id, ref: paymentRef, ...paymentSnap.data() }
    if (payment.status === 'collected') return
    if (payment.status === 'cancelled') throw new HttpsError('failed-precondition', 'CASH_PAYMENT_CANCELLED')

    const amount = roundMoney(Number(payment.remainingAmount ?? payment.amount) || 0)
    const orderIds = Array.isArray(payment.orderIds) ? payment.orderIds : []
    const orderRefs = orderIds.map(orderId => db.collection('orders').doc(String(orderId)))
    const orderSnaps = await getAllInTransaction(transaction, orderRefs)
    const existingOrderRefs = orderRefs.filter((_, index) => orderSnaps[index].exists)
    const existingOrderIds = existingOrderRefs.map(orderRef => orderRef.id)

    transaction.update(paymentRef, {
      status: 'collected',
      collectedAmount: roundMoney(Number(payment.collectedAmount || 0) + amount),
      remainingAmount: 0,
      orderIds: existingOrderIds,
      collectedByUid: actorUid,
      collectedByName: operatorName,
      collectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedTimestamp: Date.now(),
    })

    existingOrderRefs.forEach(orderRef => transaction.update(orderRef, {
      paid: true,
      cashStatus: 'collected',
      cashCollectedAt: FieldValue.serverTimestamp(),
      cashCollectedByUid: actorUid,
      cashCollectedByName: operatorName,
    }))

    writeCashPaymentLog(transaction, {
      cashPaymentId: id,
      ownerName: payment.ownerName || '',
      ownerUid: payment.ownerUid || '',
      type: 'cash_collected',
      amount,
      beforeStatus: payment.status || 'pending',
      afterStatus: 'collected',
      operatorName,
      operatorUid: actorUid,
      reason,
      orderIds: existingOrderIds,
      storeName: Array.isArray(payment.storeNames) ? payment.storeNames.join('、') : '',
      items: Array.isArray(payment.items) ? payment.items : [],
    })
  })

  return { ok: true }
})

exports.cancelCashPayment = onCall(async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)
  const { cashPaymentId, actorName } = request.data || {}
  const id = String(cashPaymentId || '').trim()
  const memo = request.data?.reason === undefined
    ? serverText(await readSystemSettings()).cashCancelled
    : String(request.data.reason || '').trim()
  if (!id || !memo) throw new HttpsError('invalid-argument', '缺少現金單或原因')

  const operatorName = String(profile?.memberName || actorName || request.auth?.token?.name || request.auth?.token?.email || '').trim()

  await db.runTransaction(async (transaction) => {
    const paymentRef = db.collection('cash_payments').doc(id)
    const paymentSnap = await transaction.get(paymentRef)
    if (!paymentSnap.exists) throw new HttpsError('not-found', 'CASH_PAYMENT_NOT_FOUND')

    const payment = { id, ref: paymentRef, ...paymentSnap.data() }
    if (payment.status === 'cancelled') return
    if (payment.status === 'collected') throw new HttpsError('failed-precondition', 'CASH_PAYMENT_ALREADY_COLLECTED')

    const amount = roundMoney(Number(payment.remainingAmount ?? payment.amount) || 0)
    const orderIds = Array.isArray(payment.orderIds) ? payment.orderIds : []
    const orderRefs = orderIds.map(orderId => db.collection('orders').doc(String(orderId)))
    const orderSnaps = await getAllInTransaction(transaction, orderRefs)
    const existingOrderRefs = orderRefs.filter((_, index) => orderSnaps[index].exists)
    const existingOrderIds = existingOrderRefs.map(orderRef => orderRef.id)

    transaction.update(paymentRef, {
      status: 'cancelled',
      remainingAmount: 0,
      orderIds: existingOrderIds,
      cancelledByUid: actorUid,
      cancelledByName: operatorName,
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: memo,
      updatedAt: FieldValue.serverTimestamp(),
      updatedTimestamp: Date.now(),
    })

    existingOrderRefs.forEach(orderRef => transaction.update(orderRef, {
      paid: false,
      cashStatus: 'cancelled',
    }))

    writeCashPaymentLog(transaction, {
      cashPaymentId: id,
      ownerName: payment.ownerName || '',
      ownerUid: payment.ownerUid || '',
      type: 'cash_cancelled',
      amount,
      beforeStatus: payment.status || 'pending',
      afterStatus: 'cancelled',
      operatorName,
      operatorUid: actorUid,
      reason: memo,
      orderIds: existingOrderIds,
      storeName: Array.isArray(payment.storeNames) ? payment.storeNames.join('、') : '',
      items: Array.isArray(payment.items) ? payment.items : [],
    })
  })

  return { ok: true }
})

exports.previewTimeRangeCleanup = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)
  const { from, to } = validateCleanupRange(request.data)
  const cleanup = await queryCleanupDocuments(from, to)
  return cleanupPreview(cleanup)
})

exports.deleteUnlinkedOrders = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)
  const orderIds = [...new Set((Array.isArray(request.data?.orderIds) ? request.data.orderIds : [])
    .map(id => String(id).trim())
    .filter(id => id && !id.includes('/') && id.length <= 1500))]
  if (!orderIds.length) throw new HttpsError('invalid-argument', '缺少訂單')
  if (orderIds.length > 400) throw new HttpsError('invalid-argument', 'TOO_MANY_ORDERS')

  return db.runTransaction(async transaction => {
    const orderRefs = orderIds.map(id => db.collection('orders').doc(id))
    const orderSnaps = await getAllInTransaction(transaction, orderRefs)
    const existingOrders = orderSnaps.filter(snap => snap.exists)
    const walletLedger = await getWalletLedgerForOrders(transaction, orderIds)
    const linkedCashLogs = []
    for (let index = 0; index < orderIds.length; index += 30) {
      const chunk = orderIds.slice(index, index + 30)
      const logs = await transaction.get(
        db.collection('cash_payment_logs').where('orderIds', 'array-contains-any', chunk),
      )
      linkedCashLogs.push(...logs.docs)
    }
    const hasFinancialLink = existingOrders.some(snap => {
      const order = snap.data()
      return Boolean(order.walletDebited || order.cashPaymentId || order.paymentMethod === 'wallet' || order.paymentMethod === 'cash')
    }) || walletLedger.debits.size > 0 || linkedCashLogs.length > 0
    if (hasFinancialLink) {
      throw new HttpsError('failed-precondition', 'FINANCIAL_ORDERS_REQUIRE_LINKED_CLEANUP')
    }
    existingOrders.forEach(snap => transaction.delete(snap.ref))
    return { ok: true, deletedCount: existingOrders.length }
  })
})

exports.deleteTimeRangeData = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)
  const { from, to } = validateCleanupRange(request.data)
  if (String(request.data?.confirmation || '').trim() !== CLEANUP_CONFIRMATION) {
    throw new HttpsError('invalid-argument', '確認文字不正確')
  }

  return db.runTransaction(async transaction => {
    // 交易重試時重新查詢，避免重複清理或並行編輯造成重複調整餘額。
    const cleanup = await queryCleanupDocuments(from, to, transaction)
    const preview = cleanupPreview(cleanup)
    if (!preview.canDelete) {
      throw new HttpsError('resource-exhausted', `資料量超過 ${MAX_CLEANUP_WRITES} 筆，請縮小區間`)
    }
    if (preview.documentCount === 0) return { ok: true, ...preview }

    // 一筆合併流水可能對應區間外的訂單，不可刪掉仍保留訂單的帳務依據。
    const selectedOrderIds = new Set(cleanup.documents.filter(doc => doc.ref.parent.id === 'orders').map(doc => doc.id))
    const linkedOrderIds = new Set(cleanup.documents.flatMap(doc => {
      const data = doc.data()
      return [...(Array.isArray(data.orderIds) ? data.orderIds : []), data.orderId].filter(Boolean).map(String)
    }))
    const retainedOrderRefs = [...linkedOrderIds].filter(id => !selectedOrderIds.has(id)).map(id => db.collection('orders').doc(id))
    const retainedOrders = await getAllInTransaction(transaction, retainedOrderRefs)
    if (retainedOrders.some(doc => doc.exists)) {
      throw new HttpsError('failed-precondition', '清理區間未涵蓋關聯訂單，請調整區間後重新預覽')
    }
    const walletRefs = cleanup.walletAdjustments.map(item => walletRefForUid(item.walletId))
    const walletSnaps = await getAllInTransaction(transaction, walletRefs)
    const deletedWalletLogPaths = new Set(cleanup.documents
      .filter(doc => doc.ref.parent.id === 'wallet_logs')
      .map(doc => doc.ref.path))

    // 所有讀取必須在 transaction 寫入前完成；同時相容僅以 ownerUid 留存的舊流水。
    const retainedWalletLogs = await Promise.all(cleanup.walletAdjustments.map(async item => {
      const [byWalletId, byOwnerUid] = await Promise.all([
        transaction.get(db.collection('wallet_logs').where('walletId', '==', item.walletId)),
        transaction.get(db.collection('wallet_logs').where('ownerUid', '==', item.walletId)),
      ])
      const uniqueLogs = new Map()
      ;[...byWalletId.docs, ...byOwnerUid.docs].forEach(doc => {
        if (!deletedWalletLogPaths.has(doc.ref.path)) uniqueLogs.set(doc.ref.path, doc)
      })
      return [...uniqueLogs.values()]
    }))

    cleanup.walletAdjustments.forEach((item, index) => {
      const walletSnap = walletSnaps[index]
      if (!walletSnap.exists) return
      const currentBalance = Number(walletSnap.data().balance) || 0
      const lastRetainedLogMs = retainedWalletLogs[index].reduce((latest, log) => {
        const timestamp = walletLogTimestampMs(log.data())
        return timestamp && (!latest || timestamp > latest) ? timestamp : latest
      }, null)
      const walletUpdate = {
        balance: roundMoney(currentBalance - item.removedNetAmount),
        updatedByUid: actorUid,
        lastTransactionType: 'time_range_cleanup',
      }
      // 沒有保留流水時，維持錢包原有 updatedAt，避免以清理當下時間覆寫它。
      if (lastRetainedLogMs) {
        walletUpdate.updatedAt = Timestamp.fromMillis(lastRetainedLogMs)
      }
      transaction.update(walletSnap.ref, walletUpdate)
    })

    cleanup.documents.forEach(doc => transaction.delete(doc.ref))
    return { ok: true, ...preview }
  })
})

// ==========================================
// 伺服器端產生、會存進資料或送出通知的文字，依 settings/system.locale 決定語言。
// ==========================================
const SERVER_TEXT = {
  'zh-TW': {
    listSeparator: '、',
    systemOperator: '系統',
    allowanceReason: month => `每月補助｜${month}`,
    storesOpenedTitle: '今日點餐已開放',
    storesOpenedBody: (stores, cutoff) => `今日店家：${stores}${cutoff ? `，${cutoff} 收單` : ''}。`,
    cutoffReminderTitle: '即將收單',
    cutoffReminderBody: (minutes, time) => `再 ${minutes} 分鐘（${time}）收單，還沒點餐的人請盡快。`,
    orderingClosedTitle: '已收單',
    orderingClosedBody: (count, summary) => count ? `今日共 ${count} 份：${summary}。` : '今日沒有訂單。',
    storeCount: (store, count) => `${store} ${count} 份`,
    storeReplacedTitle: '店家已更換',
    storeReplacedBody: pairs => `${pairs}。原本點這些店家的人請重新點餐。`,
    testTitle: '測試通知',
    testBody: '如果你看到這則訊息，代表通知設定成功。',
    // 錢包與現金流水的說明（存進資料庫，前端直接顯示）
    reasonSeparator: '｜',
    unknownStore: '未指定店家',
    unknownItem: '未指定品項',
    proxyNote: actor => `由 ${actor} 代點`,
    orderDebit: '點餐扣款',
    cashReceivable: '點餐應收款',
    cashReceivableRepair: '補建點餐應收款',
    freeStoreToday: '今日店家免費',
    freeRefund: '免費訂單退款',
    freeCashDeduct: '免費訂單現金扣除',
    unfreeDebit: '取消免費訂單扣回',
    unfreeCashRestore: '取消免費訂單現金加回',
    unfreeCashCreate: '取消免費訂單建立現金應收',
    editRefund: '訂單編輯退款',
    editDebit: '訂單編輯扣款',
    editAdjust: '訂單編輯調整',
    cancelRefund: '取消訂單退款',
    manualTopUp: '後台人工儲值',
    cashCollected: '管理員標記現金已收',
    cashCancelled: '現金單取消',
  },
  en: {
    listSeparator: ', ',
    systemOperator: 'System',
    allowanceReason: month => `Monthly allowance | ${month}`,
    storesOpenedTitle: 'Ordering is open',
    storesOpenedBody: (stores, cutoff) => `Today's stores: ${stores}${cutoff ? `. Orders close at ${cutoff}` : ''}.`,
    cutoffReminderTitle: 'Ordering closes soon',
    cutoffReminderBody: (minutes, time) => `Orders close in ${minutes} min (${time}). Place your order now.`,
    orderingClosedTitle: 'Ordering closed',
    orderingClosedBody: (count, summary) => count ? `${count} items today: ${summary}.` : 'No orders today.',
    storeCount: (store, count) => `${store} × ${count}`,
    storeReplacedTitle: 'Store changed',
    storeReplacedBody: pairs => `${pairs}. Anyone who ordered from these stores needs to order again.`,
    testTitle: 'Test notification',
    testBody: 'If you can read this, notifications are working.',
    reasonSeparator: ' – ',
    unknownStore: 'Unspecified store',
    unknownItem: 'Unspecified item',
    proxyNote: actor => `ordered by ${actor}`,
    orderDebit: 'Order charge',
    cashReceivable: 'Cash due',
    cashReceivableRepair: 'Cash due (recreated)',
    freeStoreToday: 'Free store today',
    freeRefund: 'Free order refund',
    freeCashDeduct: 'Free order – cash removed',
    unfreeDebit: 'Free status removed',
    unfreeCashRestore: 'Free status removed – cash restored',
    unfreeCashCreate: 'Free status removed – cash due created',
    editRefund: 'Order edit refund',
    editDebit: 'Order edit charge',
    editAdjust: 'Order edited',
    cancelRefund: 'Order cancellation refund',
    manualTopUp: 'Manual top-up',
    cashCollected: 'Cash marked as collected',
    cashCancelled: 'Cash order cancelled',
  },
}
const serverText = settings => SERVER_TEXT[settings.locale] || SERVER_TEXT['zh-TW']

// ==========================================
// 通知：通用 outgoing webhook（送出 JSON）與 Web Push（Firebase Cloud Messaging）。
// 設定存在 settings/notifications，只有管理員能讀：webhook 網址本身通常就是密鑰。
// ==========================================
const NOTIFICATION_EVENTS = ['storesOpened', 'cutoffReminder', 'orderingClosed', 'storeReplaced']
const STALE_PUSH_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
])
const notificationSettingsRef = () => db.collection('settings').doc('notifications')
const pushTokensRef = () => db.collection('push_tokens')
const pushTokenId = token => crypto.createHash('sha256').update(token, 'utf8').digest('hex')

// 只送往 https；本機 Emulator 測試時允許 http://localhost、127.0.0.1。
const normalizeWebhookUrl = (value) => {
  const text = String(value || '').trim()
  if (!text || text.length > 2000) return ''
  try {
    const url = new URL(text)
    if (url.protocol === 'https:') return url.href
    if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return url.href
  } catch { /* 無效網址 */ }
  return ''
}
const normalizeNotificationSettings = (data = {}) => ({
  webhookUrl: normalizeWebhookUrl(data?.webhookUrl),
  events: Object.fromEntries(NOTIFICATION_EVENTS.map(event => [event, data?.events?.[event] !== false])),
  reminderMinutes: Number.isInteger(data?.reminderMinutes) && data.reminderMinutes >= 5 && data.reminderMinutes <= 180
    ? data.reminderMinutes
    : 15,
})
const readNotificationSettings = async () => {
  const snap = await notificationSettingsRef().get()
  return normalizeNotificationSettings(snap.exists ? snap.data() : {})
}

const sendWebhook = async (url, payload) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`WEBHOOK_HTTP_${response.status}`)
}

const sendPush = async ({ title, body }) => {
  const snap = await pushTokensRef().get()
  const docs = snap.docs.filter(doc => doc.data().token)
  let sent = 0
  for (let index = 0; index < docs.length; index += 500) {
    const chunk = docs.slice(index, index + 500)
    const result = await getMessaging().sendEachForMulticast({
      tokens: chunk.map(doc => doc.data().token),
      webpush: { notification: { title, body, icon: '/office-lunch.svg' }, fcmOptions: { link: '/' } },
    })
    sent += result.successCount || 0
    // 已失效的裝置 token 直接移除，下次就不再嘗試。
    const stale = result.responses
      .map((response, position) => !response.success && STALE_PUSH_TOKEN_ERRORS.has(response.error?.code) ? chunk[position].ref : null)
      .filter(Boolean)
    await Promise.all(stale.map(ref => ref.delete()))
  }
  return sent
}

// 通知一律盡力而為：失敗只記錄，不影響點餐、換店等主要流程。
const dispatchNotification = async (event, { title, body, data = {} }, { force = false } = {}) => {
  const config = await readNotificationSettings()
  const result = { webhook: 'skipped', push: 0 }
  if (!force && !config.events[event]) return result
  if (config.webhookUrl) {
    try {
      // text 給 Slack、Telegram、Teams 舊版 connector；content 給 Discord。其他服務可用 data 自行轉換。
      await sendWebhook(config.webhookUrl, {
        event,
        title,
        body,
        text: `${title}\n${body}`,
        content: `**${title}**\n${body}`,
        data,
        timestamp: new Date().toISOString(),
      })
      result.webhook = 'sent'
    } catch (error) {
      console.error('[notifications] webhook failed', error?.message || error)
      result.webhook = 'failed'
    }
  }
  try {
    result.push = await sendPush({ title, body })
  } catch (error) {
    console.error('[notifications] push failed', error?.message || error)
  }
  return result
}

const parseNotificationSettingsInput = (input, current) => {
  const fail = (code) => { throw new HttpsError('invalid-argument', code) }
  if (!isPlainObject(input)) fail('INVALID_NOTIFICATION_SETTINGS')
  const next = JSON.parse(JSON.stringify(current))
  if (input.webhookUrl !== undefined) {
    const url = normalizeWebhookUrl(input.webhookUrl)
    if (input.webhookUrl !== '' && !url) fail('INVALID_WEBHOOK_URL')
    next.webhookUrl = url
  }
  if (input.events !== undefined) {
    if (!isPlainObject(input.events)) fail('INVALID_NOTIFICATION_SETTINGS')
    for (const [event, enabled] of Object.entries(input.events)) {
      if (!NOTIFICATION_EVENTS.includes(event) || typeof enabled !== 'boolean') fail('INVALID_NOTIFICATION_SETTINGS')
      next.events[event] = enabled
    }
  }
  if (input.reminderMinutes !== undefined) {
    const minutes = input.reminderMinutes
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180) fail('INVALID_NOTIFICATION_SETTINGS')
    next.reminderMinutes = minutes
  }
  return next
}

exports.updateNotificationSettings = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)
  const current = await readNotificationSettings()
  const next = parseNotificationSettingsInput(request.data?.settings, current)
  await notificationSettingsRef().set({ ...next, updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid })
  return { ok: true, settings: next }
})

exports.sendTestNotification = onCall(async (request) => {
  const actorUid = requireAuth(request)
  await requireAdmin(actorUid)
  const text = serverText(await readSystemSettings())
  const result = await dispatchNotification('test', { title: text.testTitle, body: text.testBody }, { force: true })
  return { ok: true, ...result }
})

exports.registerPushToken = onCall(async (request) => {
  const uid = requireAuth(request)
  const profile = await getUserProfile(uid)
  if (!profile.isRegistered) throw new HttpsError('permission-denied', '需要已註冊使用者權限')
  const token = String(request.data?.token || '').trim()
  if (!token || token.length > 4096) throw new HttpsError('invalid-argument', 'INVALID_PUSH_TOKEN')
  await pushTokensRef().doc(pushTokenId(token)).set({ uid, token, updatedAt: FieldValue.serverTimestamp() })
  return { ok: true }
})

exports.unregisterPushToken = onCall(async (request) => {
  const uid = requireAuth(request)
  const token = String(request.data?.token || '').trim()
  if (!token || token.length > 4096) throw new HttpsError('invalid-argument', 'INVALID_PUSH_TOKEN')
  const ref = pushTokensRef().doc(pushTokenId(token))
  const snap = await ref.get()
  if (snap.exists && snap.data().uid === uid) await ref.delete()
  return { ok: true }
})

const todaysStores = (daily, todayKey) => daily && [daily.serviceDate, daily.date].includes(todayKey) && Array.isArray(daily.activeStores)
  ? daily.activeStores.map(name => String(name || '').trim()).filter(Boolean)
  : []
const notificationStateRef = dateKey => db.collection('notification_state').doc(dateKey)
// 以交易標記「已送出」，避免排程重試或並行觸發造成重複通知。
const claimNotification = (dateKey, key) => db.runTransaction(async (transaction) => {
  const ref = notificationStateRef(dateKey)
  const snap = await transaction.get(ref)
  if (snap.exists && snap.data()[key]) return false
  transaction.set(ref, { [key]: Date.now() }, { merge: true })
  return true
})

// 今天第一次有店家開放時通知；之後增減店家不重複通知。
exports.notifyStoresOpened = onDocumentWritten('settings/daily', async (event) => {
  const settings = await readSystemSettings()
  const todayKey = dateKeyInZone(settings.timeZone)
  const after = event.data?.after?.exists ? event.data.after.data() : null
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const stores = todaysStores(after, todayKey)
  if (todaysStores(before, todayKey).length || !stores.length) return
  if (!await claimNotification(todayKey, 'storesOpened')) return
  const text = serverText(settings)
  const cutoff = effectiveCutoffTime(settings, after, todayKey)
  await dispatchNotification('storesOpened', {
    title: text.storesOpenedTitle,
    body: text.storesOpenedBody(stores.join(text.listSeparator), cutoff),
    data: { stores, cutoff },
  })
})

const notifyStoreReplacements = async (settings, replacementMap) => {
  if (!replacementMap.size) return
  const text = serverText(settings)
  const pairs = [...replacementMap].map(([source, target]) => `${source} → ${target}`)
  await dispatchNotification('storeReplaced', {
    title: text.storeReplacedTitle,
    body: text.storeReplacedBody(pairs.join(text.listSeparator)),
    data: { replacements: Object.fromEntries(replacementMap) },
  })
}

const runOrderingNotifications = async (now = Date.now()) => {
  const settings = await readSystemSettings()
  const daily = await readDaily()
  const todayKey = dateKeyInZone(settings.timeZone, new Date(now))
  if (!todaysStores(daily, todayKey).length) return 'no-stores'
  const closesAt = cutoffTimestamp(settings, daily, todayKey)
  if (closesAt === null) return 'no-cutoff'
  const time = effectiveCutoffTime(settings, daily, todayKey)
  const config = await readNotificationSettings()
  const text = serverText(settings)

  if (now < closesAt && now >= closesAt - config.reminderMinutes * 60_000) {
    if (!await claimNotification(todayKey, `reminder_${time}`)) return 'already-reminded'
    await dispatchNotification('cutoffReminder', {
      title: text.cutoffReminderTitle,
      body: text.cutoffReminderBody(Math.max(1, Math.ceil((closesAt - now) / 60_000)), time),
      data: { cutoff: time },
    })
    return 'reminded'
  }
  // 只在收單後 30 分鐘內補發，避免管理員事後才開啟通知時收到過期訊息。
  if (now >= closesAt && now - closesAt <= 30 * 60_000) {
    if (!await claimNotification(todayKey, `closed_${time}`)) return 'already-closed'
    const start = zonedDayStartMs(todayKey, settings.timeZone)
    const end = zonedDayStartMs(shiftDateKey(todayKey, 1), settings.timeZone)
    const orders = await db.collection('orders').where('timestamp', '>=', start).where('timestamp', '<', end).get()
    const byStore = new Map()
    orders.docs.forEach(doc => {
      const store = String(doc.data().storeName || '').trim() || '-'
      byStore.set(store, (byStore.get(store) || 0) + 1)
    })
    const summary = [...byStore].map(([store, count]) => text.storeCount(store, count)).join(text.listSeparator)
    await dispatchNotification('orderingClosed', {
      title: text.orderingClosedTitle,
      body: text.orderingClosedBody(orders.size, summary),
      data: { cutoff: time, orderCount: orders.size, stores: Object.fromEntries(byStore) },
    })
    return 'closed'
  }
  return 'idle'
}

exports.orderingNotificationScheduler = onSchedule('every 5 minutes', () => runOrderingNotifications())

// ==========================================
// 每月補助：依 settings/system.subsidy.monthlyAllowance 撥入每位成員的錢包。
// allowance_grants/{月份}_{uid} 確保同一個月每人只撥一次；排程與管理員手動發放共用。
// ==========================================
const allowanceRunRef = month => db.collection('allowance_runs').doc(month)

const grantAllowance = async ({ settings, month, actorUid = '', actorName = '' }) => {
  const amount = settings.subsidy.monthlyAllowance
  const text = serverText(settings)
  const operatorName = actorName || text.systemOperator
  const users = await db.collection('users').get()
  let granted = 0
  let skipped = 0
  for (const userDoc of users.docs) {
    const profile = userDoc.data()
    const ownerName = normalizeMemberName(profile.memberName)
    if (!ownerName || profile.accountDeletionPending) { skipped += 1; continue }
    const ownerUid = userDoc.id
    const grantRef = db.collection('allowance_grants').doc(`${month}_${ownerUid}`)
    const walletRef = walletRefForUid(ownerUid)
    const didGrant = await db.runTransaction(async (transaction) => {
      const grantSnap = await transaction.get(grantRef)
      const walletSnap = await transaction.get(walletRef)
      if (grantSnap.exists) return false
      const beforeBalance = roundMoney(walletSnap.exists ? walletSnap.data().balance : 0)
      const afterBalance = roundMoney(beforeBalance + amount)
      transaction.set(walletRef, {
        ownerUid,
        ownerName,
        balance: afterBalance,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: operatorName,
        updatedByUid: actorUid,
        lastTransactionType: 'allowance_credit',
      }, { merge: true })
      writeWalletLog(transaction, {
        walletId: walletIdForUid(ownerUid),
        ownerUid,
        ownerName,
        type: 'allowance_credit',
        amount,
        beforeBalance,
        afterBalance,
        operatorName,
        operatorUid: actorUid,
        reason: text.allowanceReason(month),
      })
      transaction.set(grantRef, { uid: ownerUid, month, amount, createdAt: FieldValue.serverTimestamp() })
      return true
    })
    if (didGrant) granted += 1
    else skipped += 1
  }
  await allowanceRunRef(month).set({
    month,
    amount,
    granted,
    skipped,
    triggeredByUid: actorUid,
    completedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { month, amount, granted, skipped }
}

exports.grantMonthlyAllowance = onCall({ timeoutSeconds: 300 }, async (request) => {
  const actorUid = requireAuth(request)
  const profile = await requireAdmin(actorUid)
  const settings = await readSystemSettings()
  if (!settings.paymentMethods.wallet) throw new HttpsError('failed-precondition', 'WALLET_DISABLED')
  if (settings.subsidy.monthlyAllowance <= 0) throw new HttpsError('failed-precondition', 'ALLOWANCE_NOT_CONFIGURED')
  const result = await grantAllowance({
    settings,
    month: monthKeyInZone(settings.timeZone),
    actorUid,
    actorName: String(profile.memberName || ''),
  })
  return { ok: true, ...result }
})

const runMonthlyAllowance = async () => {
  const settings = await readSystemSettings()
  const { monthlyAllowance, effectiveFrom } = settings.subsidy
  if (!settings.paymentMethods.wallet || monthlyAllowance <= 0 || !effectiveFrom) return null
  const month = monthKeyInZone(settings.timeZone)
  if (month < effectiveFrom) return null
  if ((await allowanceRunRef(month).get()).exists) return null
  return grantAllowance({ settings, month })
}

// 每小時檢查一次：月初第一次執行時發放，失敗也會在下一個小時接續（每人只會撥一次）。
exports.monthlyAllowanceScheduler = onSchedule({ schedule: 'every 60 minutes', timeoutSeconds: 300 }, () => runMonthlyAllowance())

// ==========================================
// 資料保留：settings/system.retention.autoDeleteDays 大於 0 時，每天刪除超過天數的訂單與流水。
// 與「舊檔清理」不同，這裡只刪紀錄、不回沖錢包餘額；尚未收款的現金單與其訂單會保留。
// ==========================================
const RETENTION_BATCH_LIMIT = 2000

const purgeExpiredData = async (settings, now = Date.now()) => {
  const days = settings.retention.autoDeleteDays
  if (!days) return null
  const todayKey = dateKeyInZone(settings.timeZone, new Date(now))
  const cutoffKey = shiftDateKey(todayKey, -days)
  const cutoffMs = zonedDayStartMs(cutoffKey, settings.timeZone)
  const cutoffTimestampValue = Timestamp.fromMillis(cutoffMs)
  const older = (collection, field, value) => db.collection(collection).where(field, '<', value).limit(RETENTION_BATCH_LIMIT).get()

  const pendingCash = await db.collection('cash_payments').where('status', '==', 'pending').get()
  const keepPaymentIds = new Set(pendingCash.docs.map(doc => doc.id))
  const keepOrderIds = new Set(pendingCash.docs.flatMap(doc => Array.isArray(doc.data().orderIds) ? doc.data().orderIds : []).map(String))

  const [orders, cashPayments, cashLogs, walletLogs, walletRequests, inviteCodes, diningDays] = await Promise.all([
    older('orders', 'timestamp', cutoffMs),
    older('cash_payments', 'createdTimestamp', cutoffMs),
    older('cash_payment_logs', 'timestamp', cutoffMs),
    older('wallet_logs', 'timestamp', cutoffMs),
    older('wallet_requests', 'createdAt', cutoffTimestampValue),
    older('inviteCodes', 'expiresAt', cutoffTimestampValue),
    db.collection('dining_days').get(),
  ])

  const targets = {
    orders: orders.docs.filter(doc => !keepOrderIds.has(doc.id)),
    cashPayments: cashPayments.docs.filter(doc => !keepPaymentIds.has(doc.id)),
    cashLogs: cashLogs.docs.filter(doc => !keepPaymentIds.has(String(doc.data().cashPaymentId || ''))),
    walletLogs: walletLogs.docs,
    walletRequests: walletRequests.docs,
    inviteCodes: inviteCodes.docs,
    diningDays: diningDays.docs.filter(doc => doc.id < cutoffKey),
  }
  const writer = db.bulkWriter()
  Object.values(targets).flat().forEach(doc => writer.delete(doc.ref))
  await writer.close()

  const counts = Object.fromEntries(Object.entries(targets).map(([key, docs]) => [key, docs.length]))
  await db.collection('retention_runs').doc(todayKey).set({ ...counts, cutoffDate: cutoffKey, completedAt: FieldValue.serverTimestamp() })
  return { cutoffDate: cutoffKey, ...counts }
}

exports.retentionScheduler = onSchedule({ schedule: 'every 24 hours', timeoutSeconds: 540, memory: '512MiB' }, async () =>
  purgeExpiredData(await readSystemSettings()))
