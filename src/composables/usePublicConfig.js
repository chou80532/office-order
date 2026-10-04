// ==========================================
// 登入前就需要的公開設定：品牌、預設語言、註冊方式與首次設定狀態。
// 先用上次的快取立即顯示，再向 Cloud Functions 取最新值；失敗時沿用快取。
// ==========================================
import { ref } from 'vue'
import { getPublicConfigViaFunction } from '../services/accountFunctions'
import { readStorage, writeStorage } from '../utils/storage'
import { normalizeSystemSettings } from '../utils/systemSettings'
import { setSystemLocale } from '../i18n'

const CACHE_KEY = 'cachedPublicConfig'

export const normalizePublicConfig = (data = {}) => {
  const settings = normalizeSystemSettings({ locale: data?.locale, branding: data?.branding, registration: data?.registration })
  return {
    locale: settings.locale,
    branding: settings.branding,
    registration: settings.registration,
    needsSetup: data?.needsSetup === true,
    setupEnabled: data?.setupEnabled === true,
  }
}

const readCache = () => {
  try {
    return normalizePublicConfig(JSON.parse(readStorage(CACHE_KEY, 'null')) || {})
  } catch {
    return normalizePublicConfig()
  }
}

const publicConfig = ref(readCache())
const loaded = ref(false)
// 登入前就以上次的系統預設語言顯示；登入後由 settings/system 接手。
setSystemLocale(publicConfig.value.locale)
let pending = null

export const loadPublicConfig = () => {
  pending ||= getPublicConfigViaFunction()
    .then((result) => {
      publicConfig.value = normalizePublicConfig(result)
      writeStorage(CACHE_KEY, JSON.stringify({ ...publicConfig.value, needsSetup: false, setupEnabled: false }))
      setSystemLocale(publicConfig.value.locale)
      loaded.value = true
      return publicConfig.value
    })
    .catch(() => publicConfig.value)
    .finally(() => { pending = null })
  return pending
}

export const usePublicConfig = () => ({ publicConfig, publicConfigLoaded: loaded, loadPublicConfig })
