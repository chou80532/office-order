<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePendingCart } from '../../composables/usePendingCart'
import { useHomeActions } from '../../composables/useHomeActions'
import { useFirestore } from '../../composables/useFirestore'
import { useAuth } from '../../composables/useAuth'
import { useToast } from '../../composables/useToast'
import { confirmDialog } from '../../composables/useDialog'
import { cancelDiningNeedViaFunction } from '../../services/walletFunctions'
import { getAvatarColor } from '../../utils/avatar'

const { diningDay, diningLoading, diningError } = useFirestore()
const { userUid } = useAuth()
const { showToast } = useToast()
const router = useRouter()
const { activePanel, replacementSource, closePanel } = useHomeActions()
const { cartOwner, activeStoreId, submitting } = usePendingCart()
const needs = computed(() => Object.values(diningDay.value.needs || {}))
const pending = computed(() => needs.value.filter(n => n.status === 'pending'))
const pendingPeople = computed(() => new Set(pending.value.map(n => n.personKey)).size)
const busy = ref(false)
async function openStoreChange(storeName) {
  if (!userUid.value || busy.value || submitting.value) return
  const previousPanel = activePanel.value
  const previousSource = replacementSource.value
  replacementSource.value = storeName
  activePanel.value = 'store-manager'
  busy.value = true
  try {
    const failure = await router.push('/')
    if (failure) throw failure
  } catch {
    activePanel.value = previousPanel
    replacementSource.value = previousSource
    showToast('無法開啟設定店家，請再試一次', 'error')
  } finally { busy.value = false }
}
defineExpose({ openStoreChange })
async function openReorder(need) {
  if (!userUid.value || submitting.value || busy.value) return
  if (diningLoading.value || diningError.value || diningDay.value.needs?.[need.id]?.status !== 'pending') {
    showToast('補點狀態已更新，請重新確認名單', 'error')
    return
  }
  busy.value = true
  const previousPanel = activePanel.value
  const previousSource = replacementSource.value
  const previousOwner = cartOwner.value
  const previousStore = activeStoreId.value
  cartOwner.value = {
    name: need.name, uid: need.uid || '', paymentMethod: need.uid ? 'wallet' : 'cash',
    isProxy: need.uid !== userUid.value, isManual: !need.uid, hasAccount: Boolean(need.uid),
  }
  activeStoreId.value = need.targetStore
  try {
    closePanel()
    const failure = await router.push('/')
    if (failure) throw failure
    showToast(`已切換至 ${need.targetStore}，為 ${need.name} 重新點餐`)
  } catch {
    activePanel.value = previousPanel
    replacementSource.value = previousSource
    cartOwner.value = previousOwner
    activeStoreId.value = previousStore
    showToast('無法開啟點餐頁，請再試一次', 'error')
  } finally { busy.value = false }
}
async function decline(need) {
  if (!await confirmDialog({ title: '確認本次不吃了？', message: `${need.name} 將取消 ${need.targetStore} 的補點需求，系統會保留確認紀錄。` })) return
  busy.value = true
  try { await cancelDiningNeedViaFunction({ needId: need.id }); showToast('已記錄本次不吃', 'success') }
  catch (error) { showToast(error.message, 'error') }
  finally { busy.value = false }
}
</script>

<template>
  <section class="recovery" :class="{ 'has-content': diningLoading || diningError || pending.length }" aria-label="換店與重新點餐">
    <p v-if="diningLoading" role="status">正在確認今日用餐名單…</p>
    <p v-else-if="diningError" role="alert">用餐名單讀取失敗，請重新整理後再確認是否有人漏餐。</p>
    <template v-else>
      <div v-if="pending.length" class="recovery-state warning">
        <header class="recovery-heading"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><h2>待重新點餐 {{ pendingPeople }} 人</h2><span>{{ pendingPeople }} 人未完成</span></header>
        <div class="recovery-columns" aria-hidden="true"><span>成員</span><span>原訂餐點</span><span>狀態</span><span>操作</span></div>
        <article v-for="need in pending" :key="need.id" class="need-row">
          <div class="member-cell"><span class="member-avatar" :style="{ background: getAvatarColor(need.name) }">{{ need.name?.slice(0, 1) }}</span><strong>{{ need.name }}</strong></div>
          <div class="original-cell"><p>原：{{ need.originals.map(o => `${o.meal}${o.note ? `（${o.note}）` : ''}`).join('、') }}</p><p class="muted store-route">{{ need.sourceStore }} → {{ need.targetStore }}</p></div>
          <span class="pending-badge"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> 待重新點餐</span>
          <div class="row-actions">
            <button class="reorder-btn" :disabled="busy || submitting" @click="openReorder(need)">{{ need.uid === userUid ? '重新點餐' : '代點' }}</button>
            <button v-if="userUid" class="change-store-btn" :disabled="busy" @click="openStoreChange(need.targetStore)">再次更換店家</button>
            <button v-if="userUid" class="decline-btn" :disabled="busy" @click="decline(need)">本次不吃了</button>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.recovery { order: 1; min-width: 0; }
.recovery:not(.has-content) { display: none; }
.recovery.has-content { margin-bottom: 16px; }
/* 這張卡在 Dashboard 的主欄裡，而主欄的寬度是「視窗寬 − 側欄 92 − 頁邊 80
   − 右欄 320 − gap 16」，也就是視窗寬再減 508。以前靠 @media 猜視窗寬，猜錯了：
   四欄版最小需要 839px，等於視窗要 1347px 才裝得下，卻從 1000px 就開始套用；
   三欄版最小 586px，需要視窗 1094px，卻從 601px 就開始套用。中間整段都溢出，
   而且這個元件沒有捲動容器，是直接被擠爆。
   改用 container query 直接量「自己有多寬」，就不必再回頭算視窗。 */
.recovery-state { container-type: inline-size; border: 1px solid color-mix(in srgb, var(--accent) 65%, var(--border)); border-radius: var(--r-lg); background: var(--paper); }
.recovery-heading { display: flex; align-items: center; gap: 12px; padding: 12px 18px; color: var(--accent); background: linear-gradient(100deg, color-mix(in srgb, var(--accent) 17%, transparent), color-mix(in srgb, var(--accent) 5%, transparent)); border-radius: var(--r-lg) var(--r-lg) 0 0; }
.recovery-heading > i { font-size: var(--text-title); }
.recovery-heading h2 { margin: 0; font-size: var(--text-body); font-weight: 800; }
.recovery-heading > span { font-size: var(--text-label); }
.recovery-columns, .need-row { display: grid; grid-template-columns: minmax(130px, 1fr) minmax(160px, 2fr) 145px minmax(320px, auto); align-items: center; gap: 16px; padding: 9px 18px; }
.recovery-columns { color: var(--muted); font-size: var(--text-label); padding-top: 8px; padding-bottom: 8px; }
.need-row { border-top: 1px solid var(--border); }
.member-cell { display: flex; align-items: center; gap: 12px; min-width: 0; font-size: var(--text-body); }
.member-avatar { display: grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; border-radius: 10px; color: var(--paper); font-weight: 800; }
.original-cell { min-width: 0; overflow-wrap: anywhere; }
p { font-size: var(--text-label); line-height: 1.6; }
.muted { color: var(--muted); }
.store-route { font-size: var(--text-micro); margin-top: 2px; }
.pending-badge { display: inline-flex; align-items: center; gap: 7px; justify-self: start; padding: 5px 10px; border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); border-radius: 999px; background: var(--bg-accent); color: var(--accent); font-size: var(--text-micro); font-weight: 700; white-space: nowrap; }
.row-actions { display: flex; gap: 8px; align-items: center; flex-wrap: nowrap; }
button { padding: 9px 14px; border-radius: var(--r-md); background: var(--accent-solid); color: var(--text-on-accent); font-weight: 700; }
button:disabled { opacity: .5; cursor: not-allowed; }
.row-actions button { flex-shrink: 0; min-height: 34px; padding: 7px 12px; font-size: var(--text-label); white-space: nowrap; }
.reorder-btn { min-width: 80px; }
.change-store-btn { color: var(--accent); background: transparent; border: 1px solid color-mix(in srgb, var(--accent) 60%, var(--border)); }
.change-store-btn:hover { background: var(--bg-accent); }
.decline-btn { color: var(--text-danger); background: var(--bg-danger); border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent); }
.decline-btn:hover { color: var(--paper); background: var(--danger); }
/* 四欄需要 839px，低於就收掉「狀態」欄改三欄（最小 586px） */
@container (max-width: 860px) {
  .recovery-columns, .need-row { grid-template-columns: minmax(110px, 1fr) minmax(140px, 2fr) minmax(280px, auto); gap: 10px; }
  .recovery-columns > :nth-child(3), .pending-badge { display: none; }
}
/* 三欄需要 586px，低於就整列堆疊 */
@container (max-width: 600px) {
  .recovery-columns { display: none; }
  .need-row { grid-template-columns: 1fr; padding: 12px; }
  .member-cell { grid-column: 1; }
  .original-cell { grid-column: 1; grid-row: 2; padding-left: 48px; }
  .row-actions { grid-column: 1; grid-row: 3; justify-content: flex-end; flex-wrap: wrap; }
  .recovery-heading { padding: 12px; gap: 8px; }
  .recovery-heading h2 { font-size: var(--text-body); }
}
</style>
