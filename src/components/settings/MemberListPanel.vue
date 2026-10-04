<template>
  <div class="member-panel ops-surface">
    <h2 class="sr-only">{{ t('members.heading') }}</h2>
    <div class="member-add-row">
      <input
        v-model="newMemberName"
        type="text"
        class="member-input"
        :placeholder="t('members.newPlaceholder')"
        maxlength="10"
        :aria-label="t('members.newAria')"
        @keydown.enter="addMember"
      >
      <button type="button" class="btn btn-primary member-add-btn" @click="addMember" :disabled="!newMemberName.trim()">
        <i class="fas fa-plus"></i> {{ t('members.add') }}
      </button>
    </div>

    <div class="member-list-container">
      <StatusNotice v-if="members.length === 0" :title="t('members.emptyTitle')" :description="t('members.emptyText')" />
      <TransitionGroup name="member-item" tag="div">
        <div v-for="(name, idx) in sortedMembers" :key="name" class="member-row">
          <div class="member-avatar" :style="{ background: getAvatarColor(name) }">{{ name.charAt(0) }}</div>
          <span class="member-name">{{ name }}</span>

          <!-- Admin badge -->
          <button
            v-if="adminMembers[name]"
            :class="['admin-toggle', { active: adminMembers[name]?.isAdmin }]"
            @click.stop="toggleAdmin(name)"
            :title="adminMembers[name]?.isAdmin ? t('members.demoteHint') : t('members.promoteHint')"
          >
            <i class="fas fa-shield-alt"></i>
            <span>{{ adminMembers[name]?.isAdmin ? t('members.admin') : t('members.regular') }}</span>
          </button>

          <!-- Invite status -->
          <div class="invite-status">
            <template v-if="isLoadingStatuses">
              <span class="invite-badge loading"><span class="mini-spinner mini-spinner-sm"></span></span>
            </template>
            <template v-else-if="inviteStatus[name]">
              <span v-if="inviteStatus[name].status === 'used'" class="invite-badge used">
                <i class="fas fa-check-circle"></i> {{ t('members.bound') }}
                <button class="unbind-btn" @click.stop="handleUnbind(name)" :disabled="unbindingFor === name" :title="t('members.unbindHint')">
                  <span v-if="unbindingFor === name" class="mini-spinner mini-spinner-sm"></span>
                  <i v-else class="fas fa-unlink"></i>
                </button>
              </span>
              <span v-else-if="inviteStatus[name].status === 'active'" class="invite-badge active">
                <code class="invite-code-text">{{ inviteStatus[name].code }}</code>
                <button class="copy-code-btn" @click.stop="copyCode(inviteStatus[name].code)" :title="t('members.copyCode')">
                  <i class="fas fa-copy"></i>
                </button>
                <span class="invite-expiry">{{ formatExpiry(inviteStatus[name].expiresAt) }}</span>
              </span>
              <span v-else-if="inviteStatus[name].status === 'expired'" class="invite-badge expired">
                <i class="fas fa-clock"></i> {{ t('members.expired') }}
                <button class="regen-btn" @click.stop="handleGenerateCode(name)" :disabled="generatingFor === name" :title="t('members.regenerate')" :aria-label="t('members.regenerate')">
                  <i class="fas fa-redo-alt"></i>
                </button>
              </span>
            </template>
            <template v-else>
              <button class="btn-generate" @click.stop="handleGenerateCode(name)" :disabled="generatingFor === name">
                <span v-if="generatingFor === name" class="mini-spinner"></span>
                <template v-else><i class="fas fa-ticket-alt"></i></template>
                {{ generatingFor === name ? '' : t('members.generate') }}
              </button>
            </template>
          </div>

          <span class="member-index">{{ idx + 1 }}</span>
          <button class="btn-remove-member" @click="removeMember(name)" :title="t('members.remove')" :aria-label="t('members.remove')">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      </TransitionGroup>
    </div>

    <div class="panel-footer">
      <button class="btn btn-primary footer-btn" @click="saveMembers" :disabled="isSavingMembers">
        <span v-if="isSavingMembers" class="mini-spinner"></span>
        <template v-else><i class="fas fa-save"></i></template>
        {{ isSavingMembers ? t('common.saving') : t('members.saveWithCount', { count: members.length }) }}
      </button>
      <button class="btn btn-secondary footer-btn" @click="rebuildRoster" :disabled="isRebuildingRoster" :title="t('members.rebuildHint')">
        <span v-if="isRebuildingRoster" class="mini-spinner"></span>
        <template v-else><i class="fas fa-user-friends"></i></template>
        {{ isRebuildingRoster ? t('members.rebuilding') : t('members.rebuild') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import StatusNotice from "../ui/StatusNotice.vue"
import { ref, computed, onMounted, reactive } from 'vue'
import { doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore'
import { db } from '../../firestore'
import { getAvatarColor } from '../../utils/avatar'
import { useToast } from '../../composables/useToast'
import { confirmDialog } from '../../composables/useDialog'
import { generateInviteCode, getInviteCodeForMember, deleteInviteCodesForMember } from '../../composables/useInviteCode'
import { useAuth } from '../../composables/useAuth'
import { deleteUserAccountViaFunction, setUserAdminStatusViaFunction, rebuildMemberRosterViaFunction } from '../../services/accountFunctions'
import { compareText } from '../../utils/format'
import { t, translateError } from '../../i18n'

const { showToast } = useToast()
const { userUid } = useAuth()

const members = ref([])
const newMemberName = ref('')
const isSavingMembers = ref(false)
const generatingFor = ref('')
const unbindingFor = ref('')
const isLoadingStatuses = ref(true)
const isRebuildingRoster = ref(false)
const inviteStatus = reactive({})
const adminMembers = reactive({})

const sortedMembers = computed(() => [...members.value].sort(compareText))

const loadMembers = async () => {
  try {
    const snap = await getDoc(doc(db, 'settings', 'members'))
    if (snap.exists() && snap.data().names) members.value = [...snap.data().names]
  } catch (e) {
    console.error('[Members] load failed', e)
    showToast(t('members.loadFailed'), 'error')
  }
}

const loadInviteStatuses = async () => {
  await Promise.all(members.value.map(async (name) => {
    try {
      const info = await getInviteCodeForMember(name)
      if (info) {
        if (info.status === 'used' && info.usedBy) {
          const userSnap = await getDoc(doc(db, 'users', info.usedBy))
          if (!userSnap.exists()) { await deleteInviteCodesForMember(name); return }
          if (!adminMembers[name]) {
            const userData = userSnap.data()
            adminMembers[name] = { uid: info.usedBy, email: userData.email || '', isAdmin: !!userData.isAdmin }
          }
        }
        inviteStatus[name] = info
      }
    } catch (e) { console.error('[Members] invite code load failed', name, e) }
  }))
}

const addMember = () => {
  const name = newMemberName.value.trim().replace(/\s+/g, ' ')
  if (!name) return
  const lower = name.toLowerCase()
  if (members.value.some(m => m.trim().toLowerCase() === lower)) { showToast(t('members.exists', { name })); return }
  members.value.push(name); newMemberName.value = ''
}

const removeSystemUserProfile = async (uid) => {
  if (!uid) return
  await deleteUserAccountViaFunction(uid)
}

const accountErrorMessage = (error) => translateError(error, 'members.accountFailed')

const removeMember = async (name) => {
  const adminInfo = adminMembers[name]
  const inviteInfo = inviteStatus[name]
  const uid = adminInfo?.uid || inviteInfo?.usedBy
  const confirmed = await confirmDialog({
    title: t('members.removeTitle'),
    message: t('members.removeMessage', { name }),
    detail: adminInfo?.uid ? t('members.removeDetail') : '',
    variant: 'danger',
    confirmText: t('members.removeConfirm'),
  })
  if (!confirmed) return

  try {
    if (uid) await removeSystemUserProfile(uid)
    if (inviteInfo && !uid) await deleteInviteCodesForMember(name)
    delete adminMembers[name]; delete inviteStatus[name]
    if (uid) showToast(t('members.removedAccount'), 'success')
  } catch (err) { showToast(t('members.cleanupFailed', { message: accountErrorMessage(err) }), 'error'); return }
  members.value = members.value.filter(m => m !== name)
}

const saveMembers = async () => {
  isSavingMembers.value = true
  try { await setDoc(doc(db, 'settings', 'members'), { names: members.value }); showToast(t('members.saved', { count: members.value.length })) }
  catch (err) { showToast(t('members.saveFailed', { message: translateError(err) }), 'error') }
  finally { isSavingMembers.value = false }
}

const rebuildRoster = async () => {
  isRebuildingRoster.value = true
  try {
    const res = await rebuildMemberRosterViaFunction()
    showToast(t('members.rebuilt', { count: res?.count ?? 0 }), 'success')
  } catch (err) {
    showToast(t('members.rebuildFailed', { message: accountErrorMessage(err) }), 'error')
  } finally {
    isRebuildingRoster.value = false
  }
}

const handleGenerateCode = async (memberName) => {
  generatingFor.value = memberName
  try {
    const code = await generateInviteCode(memberName)
    const info = await getInviteCodeForMember(memberName)
    if (info) inviteStatus[memberName] = info
    showToast(t('members.generated', { code }))
  } catch (err) { showToast(t('members.generateFailed', { message: translateError(err) }), 'error') }
  finally { generatingFor.value = '' }
}

const copyCode = async (code) => {
  try { await navigator.clipboard.writeText(code); showToast(t('members.copied')) }
  catch { const area = document.createElement('textarea'); area.value = code; document.body.appendChild(area); area.select(); document.execCommand('copy'); document.body.removeChild(area); showToast(t('members.copied')) }
}

const formatExpiry = (expiresAt) => {
  if (!expiresAt) return ''
  const ms = expiresAt.toMillis ? expiresAt.toMillis() : expiresAt
  const remainMs = ms - Date.now()
  if (remainMs <= 0) return t('members.expiringSoon')
  const mins = Math.ceil(remainMs / 60000)
  if (mins < 60) return t('members.expiresMinutes', { count: mins })
  const hours = Math.ceil(remainMs / 3600000)
  if (hours < 24) return t('members.expiresHours', { count: hours })
  return t('members.expiresDays', { count: Math.ceil(remainMs / 86400000) })
}

const loadAdminStatus = async () => {
  try {
    const snap = await getDocs(collection(db, 'users'))
    snap.docs.forEach(d => { const data = d.data(); if (data.memberName) adminMembers[data.memberName] = { uid: d.id, email: data.email || '', isAdmin: !!data.isAdmin } })
  } catch (e) {
    // 這裡失敗時所有人都會被當成非管理員，畫面會少掉一整排按鈕。
    // 不講的話使用者只會覺得「權限突然不見了」。
    console.error('[Members] admin status load failed', e)
    showToast(t('members.adminLoadFailed'), 'error')
  }
}

const getAdminCount = () => Object.values(adminMembers).filter(m => m.isAdmin).length

const toggleAdmin = async (memberName) => {
  const info = adminMembers[memberName]
  if (!info?.uid) { showToast(t('members.notRegistered')); return }
  const newVal = !info.isAdmin
  if (!newVal) {
    if (info.uid === userUid.value) { showToast(t('members.cannotDemoteSelf')); return }
    if (getAdminCount() <= 1) { showToast(t('members.lastAdmin')); return }
  }
  const confirmed = await confirmDialog({
    title: t(newVal ? 'members.promoteTitle' : 'members.demoteTitle'),
    message: t(newVal ? 'members.promoteMessage' : 'members.demoteMessage', { name: memberName }),
    confirmText: t('common.confirm'),
  })
  if (!confirmed) return
  try {
    await setUserAdminStatusViaFunction(info.uid, newVal)
    adminMembers[memberName].isAdmin = newVal
    showToast(t(newVal ? 'members.promoted' : 'members.demoted', { name: memberName }))
  } catch (err) { showToast(t('members.updateFailed', { message: accountErrorMessage(err) }), 'error') }
}

const handleUnbind = async (memberName) => {
  const adminInfo = adminMembers[memberName]
  const inviteInfo = inviteStatus[memberName]
  const uid = adminInfo?.uid || inviteInfo?.usedBy
  if (!uid && !inviteInfo?.id) { showToast(t('members.noAccountInfo')); return }
  const confirmed = await confirmDialog({
    title: t('members.unbindTitle'),
    message: t('members.unbindMessage', { name: memberName }),
    detail: t('members.unbindDetail'),
    variant: 'danger',
    confirmText: t('members.unbindConfirm'),
  })
  if (!confirmed) return
  unbindingFor.value = memberName
  try {
    if (uid) await removeSystemUserProfile(uid)
    if (!uid) await deleteInviteCodesForMember(memberName)
    delete adminMembers[memberName]; delete inviteStatus[memberName]
    showToast(t('members.unbound', { name: memberName }), 'success')
  } catch (err) { showToast(t('members.unbindFailed', { message: accountErrorMessage(err) }), 'error') }
  finally { unbindingFor.value = '' }
}

onMounted(async () => {
  await loadMembers()
  await Promise.all([loadAdminStatus(), loadInviteStatuses()])
  isLoadingStatuses.value = false
})
</script>

<style scoped>
/* .btn / .btn-primary 等共用按鈕樣式已移至 src/assets/components.css */
.member-add-row { display:flex; gap:8px; margin-bottom:14px; }
.member-input { flex:1; padding:10px 14px; border:1px solid var(--input-border); border-radius:var(--r-md); background:var(--input-bg); color:var(--text-primary); font-size: var(--text-body); font-weight:600; transition:border-color 0.15s, box-shadow 0.15s; }
.member-input:focus { border-color:var(--accent); box-shadow:0 0 0 3px var(--input-focus-ring); outline:none; }
.member-add-btn { margin:0; padding:10px 18px; white-space:nowrap; }

.member-list-container { overflow-y:auto; margin-bottom:20px; min-height:120px; }

.member-row { display:flex; align-items:center; gap:12px; border-bottom:1px solid var(--border); transition:background 0.15s; }
.member-row:last-child { border-bottom:none; }

.member-avatar { width:34px; height:34px; display:flex; align-items:center; justify-content:center; font-size: var(--text-label); font-weight:700; font-family:var(--font-display); flex-shrink:0; }
.member-name { font-weight:600; font-size: var(--text-body); color:var(--text-primary); }

.admin-toggle { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; font-size: var(--text-micro); font-weight:700; cursor:pointer; transition:all 0.15s; border:1px solid var(--border-strong); color:var(--muted); }
/* hover 只提一階，強調色（柿橘）保留給「已選取」，兩者才分得開 */
.admin-toggle i { font-size: var(--text-micro); }

.invite-status { flex:1; display:flex; align-items:center; justify-content:flex-end; gap:6px; }
.invite-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; font-size: var(--text-micro); }
.invite-badge.loading { background:transparent; border:none; padding:4px; }
.invite-badge.active { color:var(--text-success); gap:4px; }
.invite-badge.expired { color:var(--text-danger); }

.invite-code-text { font-family:var(--font-mono); font-size: var(--text-label); font-weight:800; letter-spacing:1.5px; color:var(--text-primary); border-radius:var(--r-sm); }
.copy-code-btn { width:24px; height:24px; border:none; background:transparent; color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; border-radius:var(--r-sm); transition:all 0.15s; font-size: var(--text-micro); }
.copy-code-btn:hover { background:var(--selection-soft); color:var(--selection); }
.invite-expiry { font-size: var(--text-micro); color:var(--muted); white-space:nowrap; }

.unbind-btn { width:22px; height:22px; border:1.5px solid var(--success); background:transparent; color:var(--text-success); cursor:pointer; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:all 0.15s; font-size: var(--text-micro); margin-left:2px; }
.unbind-btn:hover { background:var(--paprika); color:var(--paper); border-color:transparent; }
.unbind-btn:disabled { opacity:0.5; cursor:not-allowed; }

.regen-btn { width:22px; height:22px; border:1px solid var(--border-strong); background:transparent; color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:all 0.15s; font-size: var(--text-micro); margin-left:2px; }
.regen-btn:hover { background:var(--selection-soft); color:var(--selection); border-color:color-mix(in srgb, var(--selection) 35%, transparent); }

.btn-generate { padding:4px 12px; border:1px solid var(--border-strong); background:transparent; color:var(--muted); font-size: var(--text-micro); font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px; transition:all 0.15s; white-space:nowrap; }
.btn-generate:hover { border-color:var(--success); color:var(--text-success); background:var(--bg-success); }
.btn-generate:disabled { opacity:0.5; cursor:not-allowed; }

.member-index { font-size: var(--text-micro); font-weight:700; color:var(--muted); font-family:var(--font-mono); margin-right:4px; }
.btn-remove-member { width:30px; height:30px; background:transparent; color:var(--muted); font-size: var(--text-micro); cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.15s; flex-shrink:0; }
.btn-remove-member:hover { background:var(--paprika); color:var(--paper); border-color:transparent; }

.member-item-enter-active { transition:all 0.25s cubic-bezier(0.34,1.56,0.64,1); }
.member-item-leave-active { transition:all 0.18s ease; }
.member-item-enter-from { opacity:0; transform:translateX(-10px); }
.member-item-leave-to { opacity:0; transform:translateX(10px); }

.no-data { text-align:center; padding:40px; color:var(--muted); display:flex; flex-direction:column; align-items:center; gap:10px; font-size: var(--text-display); }
.no-data span { font-size: var(--text-label); font-weight:700; }

.panel-footer { display:flex; gap:10px; }
.footer-btn { margin:0; justify-content:center; }


@media (max-width: 768px) {
  .member-row { flex-wrap:wrap; gap:8px; }
  .invite-status { width:100%; justify-content:flex-start; padding-left:44px; }
}

.member-list-container { background: var(--ink-2); border: 0; border-block: 1px solid var(--line); border-radius: 0; box-shadow: none; max-height: none; overflow: visible; }
.member-row { min-height: 64px; border-color: var(--line); padding: 12px 16px; }
.member-row:hover { background: var(--ink-3); }
/* 這裡原本是 background: var(--ink-3) !important，把十二個人的頭像全壓成同一顆灰
   —— 名字旁邊那個 34px 的方塊等於只是佔位。改成讓 getAvatarColor 的色進來。 */
.member-avatar { color: var(--paper); border-radius: 4px; }
.member-name { min-width: 100px; }
.admin-toggle { border-color: transparent; border-radius: 4px; background: transparent; }
/* 深色成員列上原本是透明底＋幾乎看不見的框線，管理員與一般成員分不出來 */
.admin-toggle.active { border-color: var(--accent); background: color-mix(in srgb, var(--persimmon) 24%, transparent); color: var(--paper); }
.admin-toggle:hover { border-color: color-mix(in srgb, var(--paper) 30%, transparent); }
.invite-badge { border-radius: 4px; font-weight: 500; }
.invite-badge.used { background: var(--jade); color: var(--paper); border: 0; }
.invite-badge.used .unbind-btn { color: var(--paper); border: 0; }
.invite-badge.active, .invite-badge.expired { border: 0; background: transparent; }
.invite-code-text { border: 0; background: transparent; padding: 0 4px; }
.btn-generate { border-color: var(--line); border-radius: 4px; }
.btn-remove-member { border: 0; border-radius: 4px; }
.member-input { min-width: 0; }
.panel-footer { justify-content: flex-end; }
.footer-btn { flex: 0 1 auto; }
@media (max-width: 768px) { .member-row { gap: 8px; padding: 14px 12px; } .member-name { min-width: 70px; flex: 1; } .invite-status { order: 2; flex: 1 0 100%; flex-wrap: wrap; padding-left: 42px; } .panel-footer { flex-wrap: wrap; } .footer-btn { flex: 1 1 150px; } }
</style>
