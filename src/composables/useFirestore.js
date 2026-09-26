// ==========================================
// useFirestore — 統一 Firestore 即時監聽
// ==========================================
import { ref, computed, provide, inject } from 'vue'
import { DEFAULT_NOTE_GROUPS } from '../constants'
import { getLocalDateKey, getTodayBounds } from '../utils/format'

const FIRESTORE_KEY = Symbol('firestore')
let firestoreContextPromise

const getFirestoreContext = () => {
  firestoreContextPromise ||= Promise.all([
    import('firebase/firestore'),
    import('../firestore'),
  ]).then(([firestoreApi, { db }]) => ({ firestoreApi, db }))
  return firestoreContextPromise
}

const normalizeStoreName = (name) => String(name || '').trim()
const getStoreCreatedAt = (record) => {
  // 舊資料沒有 createdAt 時才使用 timestamp，避免更新菜單被視為新店家。
  for (const value of [record.createdAt, record.timestamp]) {
    if (value == null || value === '') continue
    const timestamp = typeof value?.toMillis === 'function'
      ? value.toMillis()
      : value instanceof Date ? value.getTime() : Number(value)
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp
  }
  return null
}
const compareZh = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-TW')
const isMenuItem = (item) => item && typeof item.name === 'string' && item.name.trim()
const normalizeStoreNames = (names) => Array.isArray(names)
  ? names.map(name => normalizeStoreName(name)).filter(Boolean)
  : []
const chunkList = (items, size = 30) => {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
const stopMany = (listeners) => {
  listeners.forEach(unsub => unsub())
  listeners.length = 0
}
const sortByTimestampAsc = (records) => [...records].sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))

/**
 * 在 App.vue 中呼叫，建立所有 Firestore 即時監聽並 provide
 */
export const createFirestore = (_authState = null) => {
  let db
  let collection
  let onSnapshot
  let doc
  let query
  let where
  let orderBy
  let listenersRequested = false
  let listenersStarting = false
  let dailySettingsTimeout = null
  let ordersUnsubscribe = null
  let diningUnsubscribe = null
  let ordersDateKey = ''

  const prepareFirestore = async () => {
    if (db) return
    const context = await getFirestoreContext()
    db = context.db
    ;({ collection, onSnapshot, doc, query, where, orderBy } = context.firestoreApi)
  }

  const todayOrders = ref([])
  const diningDay = ref({ participants: {}, needs: {}, replacements: {} })
  const diningLoading = ref(true)
  const diningError = ref('')
  const rawMenuData = ref([])
  const dailyStores = ref([])
  const dailyFreeStores = ref([])
  const dailyStoresConfigured = ref(false)
  const dailyStoresLoading = ref(true)
  const dailyStoresReady = computed(() => !dailyStoresLoading.value)
  const dailySettingsExists = ref(false)
  const dailyStoreDateMatched = ref(false)
  const dailyStoreServiceDate = ref('')
  const dailyStoreLegacyDate = ref('')
  const dailyStoreTodayKey = ref(getLocalDateKey())
  const dailyActiveStoreCount = ref(0)
  const dailyStoresError = ref('')
  const members = ref([])
  const membersReady = ref(false)
  const userProfiles = ref([])
  const noteGroups = ref(structuredClone(DEFAULT_NOTE_GROUPS))
  const ordersLoading = ref(false)
  const menuLoading = ref(true)
  const firestoreError = ref(null)
  let dailySettingsCache = null
  // 是否已收到 settings/daily 的伺服器回應（非離線快取）。一旦為 true 就不再變回 false。
  let dailySettingsSettled = false
  let fullMenuConsumerCount = 0
  let memberConsumerCount = 0
  let noteConsumerCount = 0
  let membersUnsubscribe = null
  let userProfilesUnsubscribe = null
  let quickNotesUnsubscribe = null
  const menuUnsubscribes = []
  let menuScopeKey = null
  const scopedMenuSnapshots = new Map()

  // unsubscribe 函式陣列
  const unsubscribes = []

  // 計算屬性：店家列表
  // 已註冊會員直接以 users 文件 ID（Auth UID）為關聯；姓名只作顯示用途。
  const membersWithUid = computed(() => {
    const registered = userProfiles.value.map(profile => ({
      name: profile.memberName,
      uid: profile.uid,
      hasAccount: true,
      email: profile.email || '',
    }))
    const registeredNames = new Set(registered.map(member => member.name.toLocaleLowerCase('zh-TW')))
    const pending = members.value
      .filter(name => !registeredNames.has(String(name).trim().toLocaleLowerCase('zh-TW')))
      .map(name => ({ name, uid: '', hasAccount: false, email: '' }))
    return [...registered, ...pending]
  })

  const allStores = computed(() => {
    const storeMap = {}
    rawMenuData.value.forEach(d => {
      const storeName = normalizeStoreName(d.storeName)
      if (!storeName) return

      if (!storeMap[storeName]) {
        storeMap[storeName] = {
          name: storeName, phone: d.phone || '', address: d.address || '',
          category: d.category || 'lunch', images: [], menuItems: [],
          createdAtTs: null
        }
      }
      if (d.phone) storeMap[storeName].phone = d.phone
      if (d.address) storeMap[storeName].address = d.address
      if (d.category) storeMap[storeName].category = d.category
      const currentTs = getStoreCreatedAt(d)
      if (currentTs != null) {
        const knownTs = storeMap[storeName].createdAtTs
        storeMap[storeName].createdAtTs = (knownTs == null) ? currentTs : Math.min(knownTs, currentTs)
      }
      if (d.url) storeMap[storeName].images.push({ id: d.id, url: d.url })
      if (d.menuItems && Array.isArray(d.menuItems) && d.menuItems.length > 0) {
        storeMap[storeName].menuItems = d.menuItems.filter(isMenuItem)
      }
    })
    return Object.values(storeMap).sort((a, b) => compareZh(a.name, b.name))
  })

  // settled=false 代表這份資料來自本地離線快取，尚未經伺服器確認。此時仍會更新畫面資料，
  // 但不解除載入狀態 —— 快取通常是「昨天」的 settings/daily，一放行就會先閃一次
  // 「今日尚未設定店家」，等伺服器回應後再跳成真正的店家列表。
  const applyDailySettings = (exists, data, { settled = true } = {}) => {
    const todayKey = getLocalDateKey()
    const serviceDate = String(data?.serviceDate || '').trim()
    const legacyDate = String(data?.date || '').trim()
    const isToday = serviceDate === todayKey || legacyDate === todayKey
    const stores = normalizeStoreNames(data?.activeStores)
    const storeSet = new Set(stores)
    const freeStores = normalizeStoreNames(data?.freeStores).filter(name => storeSet.has(name))

    dailySettingsExists.value = exists
    dailyStoreTodayKey.value = todayKey
    dailyStoreServiceDate.value = serviceDate
    dailyStoreLegacyDate.value = legacyDate
    dailyStoreDateMatched.value = !!data && isToday
    dailyActiveStoreCount.value = stores.length
    dailyStoresConfigured.value = !!data && isToday && stores.length > 0
    dailyStores.value = dailyStoresConfigured.value ? stores : []
    dailyFreeStores.value = dailyStoresConfigured.value ? freeStores : []
    dailyStoresError.value = ''
    if (settled) dailyStoresLoading.value = false
  }

  const refreshDailyStoreDate = () => {
    if (!dailySettingsCache) return
    applyDailySettings(dailySettingsCache.exists, dailySettingsCache.data, { settled: dailySettingsCache.settled })
    syncMenuListener()
  }

  const mergeSnapshotMap = (snapshotMap) => {
    const merged = new Map()
    snapshotMap.forEach(records => {
      records.forEach(record => merged.set(record.id, record))
    })
    return [...merged.values()]
  }

  const setScopedMenuSnapshot = (key, snapshot) => {
    scopedMenuSnapshots.set(key, snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
    rawMenuData.value = sortByTimestampAsc(mergeSnapshotMap(scopedMenuSnapshots))
    menuLoading.value = false
  }

  const startFullMenuListener = () => {
    scopedMenuSnapshots.clear()
    stopMany(menuUnsubscribes)
    menuLoading.value = true
    // 不用 orderBy：Firestore 的 orderBy 會排除缺少 timestamp 欄位的文件，改由 client 端排序。
    menuUnsubscribes.push(onSnapshot(
      collection(db, 'menu_images'),
      (snapshot) => {
        rawMenuData.value = sortByTimestampAsc(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
        menuLoading.value = false
      },
      (error) => {
        console.error('[Firestore] menu_images error:', error)
        menuLoading.value = false
      }
    ))
  }

  const startScopedMenuListener = () => {
    scopedMenuSnapshots.clear()
    stopMany(menuUnsubscribes)

    const stores = normalizeStoreNames(dailyStores.value)
    if (!dailyStoresConfigured.value || stores.length === 0) {
      rawMenuData.value = []
      menuLoading.value = false
      return
    }

    menuLoading.value = true
    chunkList(stores).forEach((chunk, index) => {
      const key = `menu-${index}`
      menuUnsubscribes.push(onSnapshot(
        query(collection(db, 'menu_images'), where('storeName', 'in', chunk)),
        (snapshot) => setScopedMenuSnapshot(key, snapshot),
        (error) => {
          console.error('[Firestore] scoped menu_images error:', error)
          menuLoading.value = false
        }
      ))
    })
  }

  const syncMenuListener = () => {
    if (unsubscribes.length === 0) return
    // 每日設定與 metadata 更新不代表菜單查詢範圍改變；重啟會把店家列表切成 loading。
    const nextScopeKey = fullMenuConsumerCount > 0
      ? 'full'
      : JSON.stringify([...new Set(normalizeStoreNames(dailyStores.value))].sort())
    if (menuScopeKey === nextScopeKey) return
    menuScopeKey = nextScopeKey
    if (fullMenuConsumerCount > 0) {
      startFullMenuListener()
      return
    }
    startScopedMenuListener()
  }

  const requireFullMenuData = () => {
    fullMenuConsumerCount += 1
    syncMenuListener()
  }

  const releaseFullMenuData = () => {
    fullMenuConsumerCount = Math.max(0, fullMenuConsumerCount - 1)
    syncMenuListener()
  }

  const syncUserProfilesListener = () => {
    if (unsubscribes.length === 0) return
    userProfilesUnsubscribe?.()
    userProfilesUnsubscribe = null
    userProfiles.value = []

    // 代訂已對全體開放，只要有需要成員清單的消費者（購物車）就載入，不再限管理員。
    // 只讀 member_roster（姓名+uid 公開名單），不觸及 users 的 email／isAdmin。
    if (memberConsumerCount === 0) return

    userProfilesUnsubscribe = onSnapshot(
      collection(db, 'member_roster'),
      (snapshot) => {
        userProfiles.value = snapshot.docs
          .map(d => ({
            uid: d.id,
            memberName: String(d.data().name || '').trim(),
            email: '',
          }))
          .filter(user => user.memberName)
      },
      (error) => { console.error('[Firestore] member_roster error:', error) }
    )
  }

  const syncMembersListener = () => {
    if (unsubscribes.length === 0) return
    membersUnsubscribe?.()
    membersUnsubscribe = null
    members.value = []
    membersReady.value = false

    if (memberConsumerCount === 0) {
      syncUserProfilesListener()
      return
    }

    membersUnsubscribe = onSnapshot(
      doc(db, 'settings', 'members'),
      (snap) => {
        if (snap.exists() && snap.data().names) {
          members.value = [...snap.data().names]
            .map(name => String(name || '').trim())
            .filter(Boolean)
            .sort(compareZh)
        } else {
          members.value = []
        }
        membersReady.value = true
      },
      (error) => {
        console.error('[Firestore] members error:', error)
        membersReady.value = true
      }
    )
    syncUserProfilesListener()
  }

  const requireMemberData = () => {
    memberConsumerCount += 1
    syncMembersListener()
  }

  const releaseMemberData = () => {
    memberConsumerCount = Math.max(0, memberConsumerCount - 1)
    syncMembersListener()
  }

  const syncQuickNotesListener = () => {
    if (unsubscribes.length === 0) return
    // Retain the last loaded notes between dialogs; logout still resets session data.
    if (noteConsumerCount === 0) {
      quickNotesUnsubscribe?.()
      quickNotesUnsubscribe = null
      return
    }
    // Opening another consumer must not restart an already active subscription.
    if (quickNotesUnsubscribe) return

    quickNotesUnsubscribe = onSnapshot(
      doc(db, 'settings', 'quickNotes'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data()
          if (Array.isArray(data.groups) && data.groups.length > 0) {
            noteGroups.value = data.groups
          } else if (Array.isArray(data.notes) && data.notes.length > 0) {
            noteGroups.value = [{ label: '備註', icon: 'comment-dots', notes: data.notes }]
          } else {
            noteGroups.value = structuredClone(DEFAULT_NOTE_GROUPS)
          }
        } else {
          noteGroups.value = structuredClone(DEFAULT_NOTE_GROUPS)
        }
      },
      (error) => { console.error('[Firestore] quickNotes error:', error) }
    )
  }

  const requireQuickNotes = () => {
    noteConsumerCount += 1
    syncQuickNotesListener()
  }

  const releaseQuickNotes = () => {
    noteConsumerCount = Math.max(0, noteConsumerCount - 1)
    syncQuickNotesListener()
  }

  // 今日訂單的查詢範圍會跨日失效，因此獨立管理，避免午夜時重啟所有監聽。
  const refreshTodayOrdersListener = () => {
    if (!listenersRequested || !db) return

    const nextDateKey = getLocalDateKey()
    if (ordersUnsubscribe && ordersDateKey === nextDateKey && !diningError.value) return

    ordersUnsubscribe?.()
    ordersUnsubscribe = null
    ordersDateKey = nextDateKey
    diningUnsubscribe?.()
    diningDay.value = { participants: {}, needs: {}, replacements: {} }
    diningLoading.value = true
    diningError.value = ''
    diningUnsubscribe = onSnapshot(doc(db, 'dining_days', nextDateKey), snap => {
      diningDay.value = snap.exists() ? snap.data() : { participants: {}, needs: {}, replacements: {} }
      diningError.value = ''
      diningLoading.value = false
    }, error => {
      diningError.value = error.message
      diningLoading.value = false
    })
    ordersLoading.value = true

    const { startMs, endMs } = getTodayBounds()
    const ordersQuery = query(
      collection(db, 'orders'),
      where('timestamp', '>=', startMs),
      where('timestamp', '<', endMs),
      orderBy('timestamp', 'desc')
    )

    ordersUnsubscribe = onSnapshot(
      ordersQuery,
      (snapshot) => {
        todayOrders.value = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => b.timestamp - a.timestamp)
        ordersLoading.value = false
      },
      (error) => {
        console.error('[Firestore] orders snapshot error:', error)
        firestoreError.value = error.message
        ordersLoading.value = false
      }
    )
  }

  // 啟動所有監聽
  const startListeners = async () => {
    listenersRequested = true
    if (unsubscribes.length > 0 || listenersStarting) return
    listenersStarting = true

    ordersLoading.value = true
    menuLoading.value = true
    dailyStoresLoading.value = true
    dailySettingsSettled = false
    dailyStoreTodayKey.value = getLocalDateKey()
    dailyStoresError.value = ''
    firestoreError.value = null

    try {
      await prepareFirestore()
      if (!listenersRequested || unsubscribes.length > 0) return

      // 今日訂單：只保留即時監聽今天需要的資料，歷史資料由各功能按需 getDocs。
      refreshTodayOrdersListener()

      // 每日店家
      clearTimeout(dailySettingsTimeout)
      dailySettingsTimeout = window.setTimeout(() => {
        if (!dailyStoresLoading.value) return
        // 逾時仍未收到伺服器回應：手上有離線快取就先放行（總比一直卡在載入畫面好），
        // 完全沒有快取才視為連線失敗。
        if (dailySettingsCache) {
          dailySettingsSettled = true
          dailySettingsCache.settled = true
          applyDailySettings(dailySettingsCache.exists, dailySettingsCache.data, { settled: true })
          syncMenuListener()
          return
        }
        dailyStoresError.value = '連線逾時，請確認網路後重新整理'
        dailyStoresLoading.value = false
        menuLoading.value = false
      }, 8_000)

      // includeMetadataChanges：快取與伺服器內容相同時，預設不會再觸發第二次回呼，
      // 就無從得知伺服器已回應。開啟後才能靠 metadata.fromCache 分辨兩者。
      unsubscribes.push(onSnapshot(
        doc(db, 'settings', 'daily'),
        { includeMetadataChanges: true },
        (docSnap) => {
          // 只認第一次「非快取」回應，之後就永遠視為已確認：中途離線會讓 snapshot
          // 退回 fromCache=true，不能因此把載入畫面重新蓋回使用者眼前。
          if (!docSnap.metadata.fromCache && !dailySettingsSettled) {
            dailySettingsSettled = true
            clearTimeout(dailySettingsTimeout)
          }
          const data = docSnap.exists() ? docSnap.data() : null
          dailySettingsCache = { exists: docSnap.exists(), data, settled: dailySettingsSettled }
          applyDailySettings(dailySettingsCache.exists, data, { settled: dailySettingsSettled })
          syncMenuListener()
        },
        (error) => {
          clearTimeout(dailySettingsTimeout)
          console.error('[Firestore] daily settings error:', error)
          dailySettingsCache = null
          dailySettingsSettled = true
          dailySettingsExists.value = false
          dailyStoreDateMatched.value = false
          dailyStoresConfigured.value = false
          dailyStores.value = []
          dailyFreeStores.value = []
          dailyActiveStoreCount.value = 0
          dailyStoreLegacyDate.value = ''
          dailyStoresError.value = error.message || '讀取今日店家設定失敗'
          dailyStoresLoading.value = false
          syncMenuListener()
        }
      ))

      syncMembersListener()
      syncQuickNotesListener()
    } catch (error) {
      console.error('[Firestore] initialization error:', error)
      firestoreError.value = error.message || '資料庫初始化失敗'
      dailyStoresError.value = firestoreError.value
      ordersLoading.value = false
      menuLoading.value = false
      dailyStoresLoading.value = false
    } finally {
      listenersStarting = false
    }
  }

  // 停止所有監聽
  const stopListeners = ({ clearData = true } = {}) => {
    listenersRequested = false
    clearTimeout(dailySettingsTimeout)
    dailySettingsTimeout = null
    ordersUnsubscribe?.()
    ordersUnsubscribe = null
    ordersDateKey = ''
    diningUnsubscribe?.()
    diningUnsubscribe = null
    diningDay.value = { participants: {}, needs: {}, replacements: {} }
    diningLoading.value = false
    diningError.value = ''
    unsubscribes.forEach(unsub => unsub())
    unsubscribes.length = 0
    stopMany(menuUnsubscribes)
    menuScopeKey = null
    scopedMenuSnapshots.clear()
    membersUnsubscribe?.()
    membersUnsubscribe = null
    userProfilesUnsubscribe?.()
    userProfilesUnsubscribe = null
    quickNotesUnsubscribe?.()
    quickNotesUnsubscribe = null
    if (!clearData) return
    // 清空資料
    todayOrders.value = []
    rawMenuData.value = []
    dailyStores.value = []
    dailyFreeStores.value = []
    dailyStoresConfigured.value = false
    dailyStoresLoading.value = true
    dailySettingsExists.value = false
    dailyStoreDateMatched.value = false
    dailyStoreServiceDate.value = ''
    dailyStoreLegacyDate.value = ''
    dailyStoreTodayKey.value = getLocalDateKey()
    dailyActiveStoreCount.value = 0
    dailyStoresError.value = ''
    dailySettingsCache = null
    dailySettingsSettled = false
    members.value = []
    membersReady.value = false
    userProfiles.value = []
    noteGroups.value = structuredClone(DEFAULT_NOTE_GROUPS)
    ordersLoading.value = false
    menuLoading.value = true
    fullMenuConsumerCount = 0
    memberConsumerCount = 0
    noteConsumerCount = 0
  }

  const state = {
    diningDay, diningLoading, diningError,
    todayOrders, rawMenuData, dailyStores, dailyFreeStores, dailyStoresConfigured, dailyStoresLoading, dailyStoresReady,
    dailySettingsExists, dailyStoreDateMatched, dailyStoreServiceDate, dailyStoreLegacyDate, dailyStoreTodayKey,
    dailyActiveStoreCount, dailyStoresError, members, membersReady, membersWithUid, userProfiles, noteGroups, allStores,
    ordersLoading, menuLoading, firestoreError,
    startListeners, stopListeners, refreshDailyStoreDate, refreshTodayOrdersListener, requireFullMenuData, releaseFullMenuData,
    requireMemberData, releaseMemberData, requireQuickNotes, releaseQuickNotes
  }
  provide(FIRESTORE_KEY, state)

  return state
}

/**
 * 在任何子元件中呼叫
 */
export const useFirestore = () => {
  const injected = inject(FIRESTORE_KEY, null)
  if (!injected) {
    console.warn('[useFirestore] 未找到 provider，請確認 App.vue 已呼叫 createFirestore()')
    return {
      diningDay: ref({ participants: {}, needs: {}, replacements: {} }), diningLoading: ref(false), diningError: ref(''),
      todayOrders: ref([]), rawMenuData: ref([]), dailyStores: ref([]), dailyFreeStores: ref([]), dailyStoresConfigured: ref(false),
      dailyStoresLoading: ref(false), dailyStoresReady: ref(true), dailySettingsExists: ref(false),
      dailyStoreDateMatched: ref(false), dailyStoreServiceDate: ref(''), dailyStoreLegacyDate: ref(''), dailyStoreTodayKey: ref(getLocalDateKey()),
      dailyActiveStoreCount: ref(0), dailyStoresError: ref(''),
      members: ref([]), membersReady: ref(false), membersWithUid: computed(() => []), userProfiles: ref([]), noteGroups: ref(DEFAULT_NOTE_GROUPS),
      allStores: computed(() => []),
      ordersLoading: ref(false), menuLoading: ref(false), firestoreError: ref(null),
      startListeners: () => {}, stopListeners: () => {}, refreshDailyStoreDate: () => {}, refreshTodayOrdersListener: () => {},
      requireFullMenuData: () => {}, releaseFullMenuData: () => {},
      requireMemberData: () => {}, releaseMemberData: () => {}, requireQuickNotes: () => {}, releaseQuickNotes: () => {}
    }
  }
  return injected
}
