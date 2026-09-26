const getStorage = () => {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

export const readStorage = (key, fallback = '') => {
  try {
    return getStorage()?.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export const writeStorage = (key, value) => {
  try {
    const storage = getStorage()
    if (!storage) return false
    storage.setItem(key, String(value))
    return true
  } catch {
    return false
  }
}

export const removeStorage = (key) => {
  try {
    const storage = getStorage()
    if (!storage) return false
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}
