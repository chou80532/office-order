// ==========================================
// 頭像顏色產生器（統一版本）
// ==========================================
import { AVATAR_COLORS } from '../constants'

const cache = {}

/**
 * 根據名字產生一致的頭像顏色
 */
export const getAvatarColor = (name) => {
  if (!name) return AVATAR_COLORS[0]
  if (!cache[name]) {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }
    cache[name] = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
  }
  return cache[name]
}
