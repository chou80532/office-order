// ==========================================
// 今天的收單時間：settings/daily.cutoff（管理員對當天的調整）優先，否則用系統預設值。
// 規則與後端 effectiveCutoffTime 相同；前端只用來顯示與停用按鈕，伺服器端會再檢查。
// ==========================================
import { computed, onScopeDispose, ref } from 'vue'
import { useFirestore } from './useFirestore'
import { getLocalDateKey, getTaipeiDateTimeMs } from '../utils/format'
import { isTimeOfDay } from '../utils/systemSettings'

const TICK_MS = 15_000

export function useOrderingCutoff() {
  const { systemSettings, dailyCutoff } = useFirestore()
  const now = ref(Date.now())
  const timer = setInterval(() => { now.value = Date.now() }, TICK_MS)
  onScopeDispose(() => clearInterval(timer))

  const todayKey = computed(() => getLocalDateKey(new Date(now.value)))
  const override = computed(() => {
    const cutoff = dailyCutoff?.value
    return cutoff && cutoff.date === todayKey.value ? cutoff : null
  })
  const cutoffTime = computed(() => {
    const time = override.value ? String(override.value.time || '') : systemSettings.value.ordering?.defaultCutoff
    return isTimeOfDay(time) ? time : ''
  })
  const closesAt = computed(() => (cutoffTime.value ? getTaipeiDateTimeMs(`${todayKey.value}T${cutoffTime.value}`) : null))
  const closed = computed(() => closesAt.value !== null && now.value >= closesAt.value)
  const minutesLeft = computed(() => (closesAt.value === null || closed.value ? null : Math.max(1, Math.ceil((closesAt.value - now.value) / 60_000))))

  return { cutoffTime, closesAt, closed, minutesLeft, isOverride: computed(() => Boolean(override.value)), refreshNow: () => { now.value = Date.now() } }
}
