// 僅供本機 Emulator 使用。此檔不會由 Cloud Functions 載入或部署。
const crypto = require('crypto')

const projectId = process.env.GCLOUD_PROJECT || 'demo-office-lunch'
if (projectId !== 'demo-office-lunch') throw new Error('Demo data seeding is restricted to demo-office-lunch.')

const setLocalEmulator = (name, port) => {
  const value = String(process.env[name] || '').trim().toLowerCase()
  const allowed = new Set(['', `127.0.0.1:${port}`, `localhost:${port}`])
  if (!allowed.has(value)) throw new Error(`${name} must use the local emulator; demo seeding was stopped.`)
  process.env[name] = `127.0.0.1:${port}`
}

setLocalEmulator('FIREBASE_AUTH_EMULATOR_HOST', 9099)
setLocalEmulator('FIRESTORE_EMULATOR_HOST', 8080)
setLocalEmulator('FIREBASE_STORAGE_EMULATOR_HOST', 9199)
process.env.GCLOUD_PROJECT = projectId

const admin = require('firebase-admin')
const password = crypto.randomBytes(18).toString('base64url')

admin.initializeApp({ projectId })

const db = admin.firestore()
const now = () => admin.firestore.Timestamp.now()
const memberNameKey = (name) => crypto
  .createHash('sha256')
  .update(String(name).trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-TW'), 'utf8')
  .digest('hex')

const accounts = [
  { email: 'admin@example.test', name: '本機測試管理員', isAdmin: true, balance: 3000 },
  { email: 'member1@example.test', name: '測試成員一', isAdmin: false, balance: 1200 },
  { email: 'member2@example.test', name: '測試成員二', isAdmin: false, balance: 500 },
  { email: 'member3@example.test', name: '測試成員三', isAdmin: false, balance: 80 },
]

const stores = [
  {
    id: 'local_test_store_lunch_1',
    name: '示範店家 A',
    phone: '',
    address: 'Example City, Sample Street',
    category: 'lunch',
    menuItems: [
      { type: 'main', category: '便當', name: '招牌雞腿便當', price: 120 },
      { type: 'main', category: '便當', name: '古早味排骨便當', price: 110 },
      { type: 'main', category: '便當', name: '香煎鯖魚便當', price: 130 },
      { type: 'main', category: '便當', name: '蔬食便當', price: 95 },
      { type: 'addon', category: '加點', name: '荷包蛋', price: 15 },
      { type: 'addon', category: '加點', name: '白飯加量', price: 10 },
    ],
  },
  {
    id: 'local_test_store_lunch_2',
    name: '示範店家 B',
    phone: '',
    address: 'Example City, Sample Street',
    category: 'lunch',
    menuItems: [
      { type: 'main', category: '麵類', name: '紅燒牛肉麵', price: 160 },
      { type: 'main', category: '麵類', name: '餛飩乾麵', price: 90 },
      { type: 'main', category: '飯類', name: '滷肉飯', price: 45 },
      { type: 'main', category: '湯品', name: '貢丸湯', price: 40 },
      { type: 'addon', category: '加點', name: '滷蛋', price: 15 },
      { type: 'addon', category: '加點', name: '燙青菜', price: 45 },
    ],
  },
  {
    id: 'local_test_store_drink_1',
    name: '示範店家 C',
    phone: '',
    address: 'Example City, Sample Street',
    category: 'drink',
    menuItems: [
      { type: 'main', category: '茶類', name: '四季春青茶', price: 35 },
      { type: 'main', category: '茶類', name: '熟成紅茶', price: 35 },
      { type: 'main', category: '奶茶', name: '珍珠奶茶', price: 55 },
      { type: 'main', category: '果汁', name: '鮮榨檸檬綠', price: 60 },
      { type: 'addon', category: '加點', name: '珍珠', price: 10 },
      { type: 'addon', category: '加點', name: '椰果', price: 10 },
    ],
  },
]

async function ensureAuthUser(account) {
  let user
  try {
    user = await admin.auth().getUserByEmail(account.email)
    user = await admin.auth().updateUser(user.uid, {
      password,
      emailVerified: true,
      displayName: account.name,
    })
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    user = await admin.auth().createUser({
      email: account.email,
      password,
      emailVerified: true,
      displayName: account.name,
    })
  }
  return user
}

async function seedAccount(account) {
  const user = await ensureAuthUser(account)
  const timestamp = now()
  const nameKey = memberNameKey(account.name)
  const batch = db.batch()

  batch.set(db.collection('users').doc(user.uid), {
    email: account.email,
    memberName: account.name,
    memberNameKey: nameKey,
    isAdmin: account.isAdmin,
    createdAt: timestamp,
    lastLoginAt: timestamp,
  }, { merge: true })
  batch.set(db.collection('member_name_keys').doc(nameKey), {
    uid: user.uid,
    memberName: account.name,
    createdAt: timestamp,
  }, { merge: true })
  batch.set(db.collection('member_roster').doc(user.uid), {
    uid: user.uid,
    name: account.name,
  })
  batch.set(db.collection('wallets').doc(user.uid), {
    ownerUid: user.uid,
    ownerName: account.name,
    balance: account.balance,
    updatedAt: timestamp,
    updatedBy: '本機測試資料',
    updatedByUid: user.uid,
    lastTransactionType: 'top_up',
  })
  batch.set(db.collection('wallet_logs').doc(`local_seed_${user.uid}`), {
    walletId: user.uid,
    ownerUid: user.uid,
    ownerName: account.name,
    type: 'top_up',
    amount: account.balance,
    beforeBalance: 0,
    afterBalance: account.balance,
    operatorName: '本機測試資料',
    operatorUid: user.uid,
    reason: '安全測試環境初始儲值',
    orderId: '',
    orderIds: [],
    storeName: '',
    items: [],
    itemCount: 0,
    timestamp: Date.now(),
    createdAt: timestamp,
  })

  await batch.commit()
  return user
}

const taipeiDateKey = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

async function seedStoresAndSettings() {
  const timestamp = now()
  const timestampMs = Date.now()
  const batch = db.batch()

  stores.forEach((store, index) => {
    batch.set(db.collection('menu_images').doc(store.id), {
      storeName: store.name,
      phone: store.phone,
      address: store.address,
      category: store.category,
      url: '',
      storagePath: '',
      menuItems: store.menuItems,
      timestamp: timestampMs + index,
      createdAt: timestampMs + index,
      menuUpdatedAt: timestampMs,
      localTestData: true,
    })
  })

  batch.set(db.collection('settings').doc('members'), {
    names: accounts.map(account => account.name),
  })
  batch.set(db.collection('settings').doc('daily'), {
    serviceDate: taipeiDateKey(),
    activeStores: stores.map(store => store.name),
    freeStores: [],
    updatedAt: timestamp,
    localTestData: true,
  })

  await batch.commit()
}

async function seed() {
  const users = []
  for (const account of accounts) users.push(await seedAccount(account))
  await seedStoresAndSettings()

  console.log('')
  console.log('已建立本機安全測試資料：')
  console.log(`- ${stores.length} 間店家、${stores.reduce((total, store) => total + store.menuItems.length, 0)} 項餐點`)
  console.log(`- ${accounts.length} 位成員與測試錢包`)
  accounts.forEach((account) => {
    console.log(`  ${account.name}：${account.email} / ${password}，餘額 NT$ ${account.balance}`)
  })
  console.log(`- 今日已開放：${stores.map(store => store.name).join('、')}`)
  console.log(`- 專案：${projectId}（Auth UID 共 ${users.length} 筆）`)
}

seed().catch((error) => {
  console.error('建立本機安全測試資料失敗：', error.message)
  process.exitCode = 1
})

