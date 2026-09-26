// ==========================================
// useInviteCode — 邀請碼產生與驗證
// ==========================================
import { doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../firestore'
import { INVITE_CODE_LENGTH, INVITE_CODE_EXPIRY_MS } from '../constants'

// 排除容易混淆的字元：0O1IL
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * 產生隨機邀請碼
 */
const generateCode = () => {
  let code = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length))
  }
  return code
}

/**
 * 為指定成員產生邀請碼
 * @param {string} memberName - 成員名字
 * @returns {Promise<string>} 產生的邀請碼
 */
export const generateInviteCode = async (memberName) => {
  // 確保碼不重複
  let code, exists = true
  while (exists) {
    code = generateCode()
    const snap = await getDoc(doc(db, 'inviteCodes', code))
    exists = snap.exists()
  }

  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_CODE_EXPIRY_MS)

  await setDoc(doc(db, 'inviteCodes', code), {
    code,
    memberName,
    createdAt: serverTimestamp(),
    expiresAt,
    used: false,
    usedBy: null,
    usedAt: null
  })

  return code
}

/**
 * 取得指定成員的邀請碼狀態
 * @param {string} memberName - 成員名字
 * @returns {Promise<object|null>} 邀請碼資料或 null
 */
export const getInviteCodeForMember = async (memberName) => {
  const q = query(
    collection(db, 'inviteCodes'),
    where('memberName', '==', memberName)
  )
  const snapshot = await getDocs(q)

  if (snapshot.empty) return null

  // 取最新的一個
  const codes = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
  codes.sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() || 0
    const bTime = b.createdAt?.toMillis?.() || 0
    return bTime - aTime
  })

  const latest = codes[0]
  const now = Date.now()
  const expired = latest.expiresAt && latest.expiresAt.toMillis() < now

  return {
    ...latest,
    expired,
    status: latest.used ? 'used' : expired ? 'expired' : 'active'
  }
}

/**
 * 刪除指定成員的所有邀請碼
 * @param {string} memberName - 成員名字
 */
export const deleteInviteCodesForMember = async (memberName) => {
  const q = query(
    collection(db, 'inviteCodes'),
    where('memberName', '==', memberName)
  )
  const snapshot = await getDocs(q)
  const deletes = snapshot.docs.map(d => deleteDoc(doc(db, 'inviteCodes', d.id)))
  await Promise.all(deletes)
}

/**
 * 取得所有邀請碼（管理員用）
 * @returns {Promise<Array>}
 */
export const getAllInviteCodes = async () => {
  const snapshot = await getDocs(collection(db, 'inviteCodes'))
  return snapshot.docs
    .map(d => {
      const data = { id: d.id, ...d.data() }
      const now = Date.now()
      const expired = data.expiresAt && data.expiresAt.toMillis() < now
      data.status = data.used ? 'used' : expired ? 'expired' : 'active'
      data.expired = expired
      return data
    })
    .sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() || 0
      const bTime = b.createdAt?.toMillis?.() || 0
      return bTime - aTime
    })
}
