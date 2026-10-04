// ==========================================
// 目前要顯示的品牌：登入後以即時的 settings/system 為準，登入前使用公開設定。
// ==========================================
import { computed } from 'vue'
import { useAuth } from './useAuth'
import { useFirestore } from './useFirestore'
import { usePublicConfig } from './usePublicConfig'
import { brandLogo, brandName } from '../utils/branding'

export const useBranding = () => {
  const { isLoggedIn } = useAuth()
  const { systemSettings } = useFirestore()
  const { publicConfig } = usePublicConfig()
  const branding = computed(() => (isLoggedIn?.value ? systemSettings.value.branding : publicConfig.value.branding))
  return {
    branding,
    brandName: computed(() => brandName(branding.value)),
    brandLogo: computed(() => brandLogo(branding.value)),
  }
}
