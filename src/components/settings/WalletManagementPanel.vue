<script setup>
import LoadingState from '../ui/LoadingState.vue'
import StatusNotice from "../ui/StatusNotice.vue"
const rangeEndPicker = ref(null)

import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { collection, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../firestore'
import { useAuth } from '../../composables/useAuth'
import { useFirestore } from '../../composables/useFirestore'
import { useToast } from '../../composables/useToast'
import { confirmDialog } from '../../composables/useDialog'
import AppDatePicker from '../ui/AppDatePicker.vue'
import {
  addWalletCreditViaFunction,
  adjustWalletBalanceViaFunction,
} from '../../services/walletFunctions'
import { mergeEditLogPairs, matchesLogTypeFilter, editGroupShortId, composeLogDescription, MERGED_EDIT_TYPE, walletLogTypeLabel, WALLET_LOG_TYPES } from '../../utils/walletLogs'
import { compareText, excelMoneyFormat, formatAmount, fromMinorUnits, getAppTimeZone, getFormatLocale, getTaipeiDateRangeBounds, getTaipeiMonthRange, formatMoney, formatDateRange, moneyInputStep, parseMoneyInput } from '../../utils/format'
import { getAvatarColor } from '../../utils'
import { t } from '../../i18n'

const ALL = '__all__'
const typeLabel = type => (type === 'all' ? t('wallet.allTypes') : walletLogTypeLabel(type))
// 篩選下拉只列合併後的「訂單編輯調整」，原始退款/扣款兩個子類型不列。
const typeFilterOptions = computed(() => Object.fromEntries(['all', ...WALLET_LOG_TYPES.filter(type => type !== 'order_edit_refund' && type !== 'order_edit_debit')]
  .map(type => [type, typeLabel(type)])))

const { membersWithUid, requireMemberData, releaseMemberData, systemSettings } = useFirestore()
const maxTopUp = computed(() => systemSettings.value?.limits?.maxTopUp || 10_000)
const lowBalance = computed(() => systemSettings.value?.limits?.lowBalance ?? 100)
// 快速金額：儲值上限的 1%、5%、10%，取整到 1／2／5 開頭的整數（新台幣預設為 100／500／1000）。
const niceAmount = (value) => {
  if (value <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 5, 10].find(candidate => candidate * magnitude >= value * 0.75) || 10
  return step * magnitude
}
const quickAmounts = computed(() => [...new Set([0.01, 0.05, 0.1].map(ratio => niceAmount(maxTopUp.value * ratio)).filter(Boolean))])
const largeTopUp = computed(() => niceAmount(maxTopUp.value * 0.3))
const amountText = value => formatAmount(value).replace(/,/g, '')
const { userDisplayName } = useAuth()
const { showToast } = useToast()

const wallets = ref([])
const logs = ref([])
const loading = ref(true)
const logsLoading = ref(false)
const exporting = ref(false)
let stopWallets = null
let memberDataRequested = false

function syncMemberDataRequest(needed) {
  if (needed && !memberDataRequested) {
    requireMemberData()
    memberDataRequested = true
  } else if (!needed && memberDataRequested) {
    releaseMemberData()
    memberDataRequested = false
  }
}

onActivated(() => syncMemberDataRequest(true))
onDeactivated(() => syncMemberDataRequest(false))
onUnmounted(() => syncMemberDataRequest(false))

const topUpForm = reactive({ amount: '', reason: t('walletAdmin.defaultTopUpReason') })
const adjustForm = reactive({ amount: '', reason: '' })
// 儲值／修正改成點成員卡片開視窗操作，員工由卡片決定，不再用下拉選單
const actionMember = ref(null)
const submitting = ref(false)
const topUpAmountInput = ref(null)

function openMemberActions(row) {
  actionMember.value = { uid: row.uid, name: row.name }
  topUpForm.amount = ''
  topUpForm.reason = t('walletAdmin.defaultTopUpReason')
  adjustForm.amount = ''
  adjustForm.reason = ''
  nextTick(() => topUpAmountInput.value?.focus())
}

function closeMemberActions() {
  if (submitting.value) return
  actionMember.value = null
}

function onModalKeydown(event) {
  if (event.key === 'Escape') closeMemberActions()
}

watch(actionMember, (member) => {
  if (member) document.addEventListener('keydown', onModalKeydown)
  else document.removeEventListener('keydown', onModalKeydown)
})

onUnmounted(() => document.removeEventListener('keydown', onModalKeydown))
const defaultReportRange = getTaipeiMonthRange()
const report = reactive({
  from: defaultReportRange.from,
  to: defaultReportRange.to,
  member: ALL,
  type: 'all',
})
const registeredMembers = computed(() => membersWithUid.value.filter(member => member.uid))
const walletByOwnerUid = computed(() => {
  const map = new Map()
  wallets.value.forEach((wallet) => {
    const ownerUid = wallet.ownerUid || wallet.id
    if (ownerUid) map.set(ownerUid, wallet)
  })
  return map
})

const balanceRows = computed(() => registeredMembers.value.map((member) => {
  const wallet = walletByOwnerUid.value.get(member.uid)
  return {
    uid: member.uid,
    name: member.name,
    balance: Number(wallet?.balance) || 0,
    updatedAt: wallet?.updatedAt || wallet?.lastUpdated || wallet?.createdAt || null,
  }
}).sort((a, b) => a.balance - b.balance || compareText(a.name, b.name)))

const totalWalletBalance = computed(() =>
  balanceRows.value.reduce((total, row) => total + row.balance, 0)
)

// 視窗開啟期間餘額仍跟著 wallets 即時快照走
const actionMemberBalance = computed(() =>
  actionMember.value ? Number(walletByOwnerUid.value.get(actionMember.value.uid)?.balance) || 0 : 0
)

// 原始（未合併）流水，供匯出逐筆稽核使用。
const rawFilteredLogs = computed(() => logs.value.filter(log => {
  if (report.member !== ALL && log.ownerName !== report.member) return false
  return matchesLogTypeFilter(log, report.type)
}))

// 顯示與彙總用：把訂單編輯的退款/扣款配對合併成一列淨額。
const filteredLogs = computed(() => mergeEditLogPairs(rawFilteredLogs.value))

const summary = computed(() => filteredLogs.value.reduce((acc, log) => {
  const amount = Number(log.amount) || 0
  if (log.type === 'top_up') acc.topUp += amount
  if (log.type === 'order_debit' || log.type === 'free_debit') acc.debit += Math.abs(amount)
  if (log.type === 'cancel_refund' || log.type === 'free_refund') acc.refund += amount
  // 訂單編輯的淨額獨立一欄，不再灌進扣款/退款；舊資料（未配對）仍歸入扣款/退款。
  if (log.type === MERGED_EDIT_TYPE) acc.edit += amount
  if (log.type === 'order_edit_debit') acc.debit += Math.abs(amount)
  if (log.type === 'order_edit_refund') acc.refund += amount
  if (log.type === 'admin_adjustment') acc.adjust += amount
  acc.net += amount
  return acc
}, { topUp: 0, debit: 0, refund: 0, edit: 0, adjust: 0, net: 0 }))

function formatSigned(value) {
  const num = Number(value) || 0
  return `${num > 0 ? '+' : ''}${formatAmount(num)}`
}

// 只有「訂單編輯調整」需要展開明細看退款/扣款兩筆；其餘直接在說明欄呈現。
const expandedIds = ref([])
function toggleDetail(id) {
  expandedIds.value = expandedIds.value.includes(id)
    ? expandedIds.value.filter(x => x !== id)
    : [...expandedIds.value, id]
}
function hasEditDetail(log) {
  return log.type === MERGED_EDIT_TYPE && Array.isArray(log.pairLogs) && log.pairLogs.length > 0
}
function logDescription(log) {
  if (log.type === MERGED_EDIT_TYPE) return String(log.reason || '').trim() || typeLabel(MERGED_EDIT_TYPE)
  return composeLogDescription(log, typeLabel(log.type))
}

function getTimestampMillis(ts) {
  if (!ts) return 0
  if (typeof ts === 'number') return ts
  if (typeof ts === 'string') return Number(ts) || 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

function formatDateTime(ts) {
  const millis = getTimestampMillis(ts)
  if (!millis) return '—'
  return new Date(millis).toLocaleString(getFormatLocale(), { timeZone: getAppTimeZone(), hour12: false })
}

function itemSummary(log) {
  if (!Array.isArray(log.items) || log.items.length === 0) return ''
  return log.items
    .map((item) => {
      const meal = String(item.meal || '').trim()
      const label = item.note ? t('data.mealWithNote', { meal, note: item.note }) : meal
      return `${label} ${Number(item.price || 0) ? formatMoney(item.price) : ''}`.trim()
    })
    .filter(Boolean)
    .join(t('data.itemSeparator'))
}

// 輸入框裡是主單位（美元可有小數），送出前用 parseMoneyInput 換回最小單位。
function normalizeTopUpAmount() {
  if (topUpForm.amount === '') return
  const amount = parseMoneyInput(topUpForm.amount)
  if (!Number.isFinite(amount)) return
  if (amount > maxTopUp.value) topUpForm.amount = amountText(maxTopUp.value)
  else if (amount < 0) topUpForm.amount = ''
}

function addTopUpAmount(increment) {
  const current = parseMoneyInput(topUpForm.amount)
  const safeCurrent = Number.isFinite(current) && current > 0 ? current : 0
  topUpForm.amount = amountText(Math.min(maxTopUp.value, safeCurrent + increment))
}

function addAdjustAmount(increment) {
  const current = parseMoneyInput(adjustForm.amount)
  const safeCurrent = Number.isFinite(current) ? current : 0
  adjustForm.amount = amountText(safeCurrent + increment)
}

async function submitTopUp() {
  const member = actionMember.value
  if (!member || submitting.value) return
  const amount = parseMoneyInput(topUpForm.amount)
  if (!Number.isInteger(amount) || amount <= 0) { showToast(t('walletAdmin.invalidTopUp'), 'error'); return }
  if (amount > maxTopUp.value) { showToast(t('walletAdmin.topUpLimit', { amount: formatMoney(maxTopUp.value) }), 'error'); return }
  // 視窗本身已是一次確認，只有大額儲值（上限的三成以上）再多問一次
  if (amount >= largeTopUp.value) {
    const confirmed = await confirmDialog({
      title: t('walletAdmin.largeTopUpTitle'),
      message: t('walletAdmin.largeTopUpMessage', { name: member.name, amount: formatMoney(amount) }),
      detail: t('walletAdmin.largeTopUpDetail'),
      confirmText: t('walletAdmin.confirmTopUp'),
    })
    if (!confirmed) return
  }

  submitting.value = true
  try {
    await addWalletCreditViaFunction({
      ownerUid: member.uid,
      ownerName: member.name,
      amount,
      actorName: userDisplayName.value,
      reason: topUpForm.reason || t('walletAdmin.defaultTopUpReason'),
    })
    showToast(t('walletAdmin.toppedUp', { name: member.name, amount: formatMoney(amount) }), 'success')
    submitting.value = false
    closeMemberActions()
  } catch {
    showToast(t('walletAdmin.topUpFailed'), 'error')
    submitting.value = false
  }
}

async function submitAdjustment() {
  const member = actionMember.value
  if (!member || submitting.value) return
  const amount = parseMoneyInput(adjustForm.amount)
  if (!Number.isInteger(amount) || amount === 0) { showToast(t('walletAdmin.invalidAdjust'), 'error'); return }
  if (!adjustForm.reason.trim()) { showToast(t('walletAdmin.reasonRequired'), 'error'); return }
  const confirmed = await confirmDialog({
    title: t('walletAdmin.adjustTitle'),
    message: t('walletAdmin.adjustMessage', { name: member.name, amount: formatMoney(amount) }),
    detail: t('walletAdmin.adjustDetail', { reason: adjustForm.reason }),
    confirmText: t('walletAdmin.confirmAdjust'),
    variant: 'danger',
  })
  if (!confirmed) return

  submitting.value = true
  try {
    await adjustWalletBalanceViaFunction({
      ownerUid: member.uid,
      ownerName: member.name,
      amount,
      actorName: userDisplayName.value,
      reason: adjustForm.reason.trim(),
    })
    showToast(t('walletAdmin.adjusted', { name: member.name, amount: `${amount > 0 ? '+' : ''}${formatMoney(amount)}` }), 'success')
    submitting.value = false
    closeMemberActions()
  } catch {
    showToast(t('walletAdmin.adjustFailed'), 'error')
    submitting.value = false
  }
}

async function exportExcel() {
  if (exporting.value) return
  exporting.value = true
  try {
    const { downloadXlsx } = await import('../../utils/xlsxExport')
    await downloadXlsx({
      filename: t('walletAdmin.export.fileName', { from: report.from, to: report.to }),
      sheets: [{
        name: t('walletAdmin.export.sheetName'),
        title: t('walletAdmin.export.title'),
        subtitle: t('walletAdmin.export.subtitle', {
          range: formatDateRange(report.from, report.to),
          member: report.member === ALL ? t('walletAdmin.allMembers') : report.member,
          type: typeFilterOptions.value[report.type] || report.type,
        }),
        summary: [
          { label: t('walletAdmin.export.topUp'), value: fromMinorUnits(summary.value.topUp) },
          { label: t('walletAdmin.export.debit'), value: fromMinorUnits(summary.value.debit) },
          { label: t('walletAdmin.export.refund'), value: fromMinorUnits(summary.value.refund) },
          { label: t('walletAdmin.export.edit'), value: fromMinorUnits(summary.value.edit) },
          { label: t('walletAdmin.export.adjust'), value: fromMinorUnits(summary.value.adjust) },
          { label: t('walletAdmin.export.net'), value: fromMinorUnits(summary.value.net) },
        ],
        columns: [
          { header: t('walletAdmin.export.time'), key: 'timestamp', width: 21, numFmt: 'yyyy/mm/dd hh:mm:ss' },
          { header: t('walletAdmin.export.member'), key: 'ownerName', width: 14 },
          { header: t('walletAdmin.export.type'), key: 'type', width: 16 },
          { header: t('walletAdmin.export.editGroup'), key: 'editGroup', width: 12 },
          { header: t('walletAdmin.export.amount'), key: 'amount', width: 14, numFmt: excelMoneyFormat() },
          { header: t('walletAdmin.export.before'), key: 'beforeBalance', width: 14, numFmt: excelMoneyFormat({ signed: false }) },
          { header: t('walletAdmin.export.after'), key: 'afterBalance', width: 14, numFmt: excelMoneyFormat({ signed: false }) },
          { header: t('walletAdmin.export.operator'), key: 'operatorName', width: 14 },
          { header: t('walletAdmin.export.reason'), key: 'reason', width: 36, wrapText: true },
          { header: t('walletAdmin.export.orders'), key: 'orderIds', width: 24, wrapText: true },
          { header: t('walletAdmin.export.store'), key: 'storeName', width: 20 },
          { header: t('walletAdmin.export.items'), key: 'items', width: 40, wrapText: true },
        ],
        // 匯出保留原始退款／扣款兩列，以「編輯群組」欄標示同一次編輯，便於逐筆稽核。
        rows: rawFilteredLogs.value.map(log => ({
          timestamp: Number(log.timestamp) ? new Date(Number(log.timestamp)) : '',
          ownerName: log.ownerName || '',
          type: typeLabel(log.type),
          editGroup: editGroupShortId(log),
          amount: fromMinorUnits(log.amount),
          beforeBalance: fromMinorUnits(log.beforeBalance),
          afterBalance: fromMinorUnits(log.afterBalance),
          operatorName: log.operatorName || '',
          reason: log.reason || '',
          orderIds: log.orderId || (log.orderIds || []).join(', '),
          storeName: log.storeName || '',
          items: itemSummary(log),
        })),
        signedAmountKey: 'amount',
      }],
    })
    showToast(t('walletAdmin.export.done'), 'success')
  } catch (error) {
    console.error(error)
    showToast(t('walletAdmin.export.failed'), 'error')
  } finally {
    exporting.value = false
  }
}

let walletLogRequest = 0
async function loadWalletLogs() {
  if (!report.from || !report.to || report.from > report.to) return
  const request = ++walletLogRequest
  const { startMs, endMs } = getTaipeiDateRangeBounds(report.from, report.to)
  logsLoading.value = true
  loading.value = true
  try {
    const snap = await getDocs(query(
      collection(db, 'wallet_logs'),
      where('timestamp', '>=', startMs),
      where('timestamp', '<', endMs),
      orderBy('timestamp', 'desc')
    ))
    if (request !== walletLogRequest) return
    logs.value = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (error) {
    if (request !== walletLogRequest) return
    logs.value = []
    console.error('[Firestore] wallet logs query error:', error)
    showToast(t('walletAdmin.logsFailed'), 'error')
  } finally {
    if (request === walletLogRequest) {
      loading.value = false
      logsLoading.value = false
    }
  }
}

watch(() => [report.from, report.to], () => loadWalletLogs())

onMounted(() => {
  stopWallets = onSnapshot(query(collection(db, 'wallets'), orderBy('ownerName', 'asc')), (snap) => {
    wallets.value = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  })
  loadWalletLogs()
})

onUnmounted(() => {
  stopWallets?.()
})
</script>

<template>
  <div class="wallet-admin ops-surface">
    <!-- KPI 卡列（設計稿 4：總儲值餘額綠漸層／區間儲值／區間扣款） -->
    <section class="wallet-kpis summary-strip summary-three summary-success" :aria-label="t('walletAdmin.overviewAria')">
      <div class="wkpi wkpi-total summary-cell is-primary">
        <span class="wkpi-label"><i class="fas fa-wallet" aria-hidden="true"></i>{{ t('walletAdmin.totalBalance') }}</span>
        <strong class="wkpi-value summary-money">{{ formatMoney(totalWalletBalance) }}</strong>
      </div>
      <div class="wkpi summary-cell">
        <span class="wkpi-label">{{ t('walletAdmin.periodTopUp') }}</span>
        <strong class="wkpi-value">{{ formatMoney(summary.topUp) }}</strong>
        <small class="wkpi-sub">{{ formatDateRange(report.from, report.to) }}</small>
      </div>
      <div class="wkpi summary-cell">
        <span class="wkpi-label">{{ t('walletAdmin.periodDebit') }}</span>
        <strong class="wkpi-value">{{ formatMoney(summary.debit) }}</strong>
        <small class="wkpi-sub">{{ formatDateRange(report.from, report.to) }}</small>
      </div>
    </section>

    <section class="panel balance-panel">
      <div class="report-head">
        <div>
          <h2>{{ t('walletAdmin.balancesTitle') }}</h2>
          <p>{{ t('walletAdmin.balancesDesc') }}</p>
        </div>
        <span class="count-chip">{{ t('walletAdmin.memberCount', { count: balanceRows.length }) }}</span>
      </div>
      <div class="member-grid">
        <article
          v-for="row in balanceRows"
          :key="row.uid"
          class="member-card"
          :class="{ low: row.balance < lowBalance }"
          role="button"
          tabindex="0"
          :aria-label="t('walletAdmin.memberCardAria', { name: row.name })"
          @click="openMemberActions(row)"
          @keydown.enter.prevent="openMemberActions(row)"
          @keydown.space.prevent="openMemberActions(row)"
        >
          <div class="member-card-head">
            <span class="bc-avatar" :style="{ background: getAvatarColor(row.name) }" aria-hidden="true">{{ row.name.slice(0, 1) }}</span>
            <span class="balance-name" :title="row.name">{{ row.name }}</span>
            <button type="button" class="row-topup-btn" @click.stop="openMemberActions(row)">{{ t('walletAdmin.topUp') }}</button>
          </div>
          <span class="member-balance" :class="{ low: row.balance < lowBalance, minus: row.balance < 0 }">
            <i v-if="row.balance < lowBalance" class="fas fa-circle-exclamation" aria-hidden="true" :title="t('walletAdmin.lowBalance')"></i>
            {{ formatMoney(row.balance) }}
          </span>
        </article>
        <div v-if="balanceRows.length === 0" class="empty balance-empty">{{ t('walletAdmin.noMembers') }}</div>
      </div>
    </section>

    <!-- 成員儲值 / 修正視窗：員工由點到的卡片決定，不再需要下拉選單 -->
    <Teleport to="body">
      <Transition name="wallet-modal">
        <div v-if="actionMember" class="wallet-modal-overlay" @click.self="closeMemberActions">
          <div class="wallet-modal" role="dialog" aria-modal="true" :aria-label="t('walletAdmin.dialogAria', { name: actionMember.name })">
            <div class="wm-head">
              <span class="bc-avatar" :style="{ background: getAvatarColor(actionMember.name) }" aria-hidden="true">{{ actionMember.name.slice(0, 1) }}</span>
              <div class="wm-head-text">
                <h3>{{ actionMember.name }}</h3>
                <p>{{ t('walletAdmin.currentBalance') }} <strong>{{ formatMoney(actionMemberBalance) }}</strong></p>
              </div>
              <button type="button" class="wm-close" :aria-label="t('common.close')" @click="closeMemberActions"><i class="fas fa-times" aria-hidden="true"></i></button>
            </div>

            <div class="wm-body">
              <form class="wm-col top-up" @submit.prevent="submitTopUp">
                <h4>{{ t('walletAdmin.topUp') }}</h4>
                <label class="field">
                  <span>{{ t('walletAdmin.topUpAmount', { amount: formatMoney(maxTopUp) }) }}</span>
                  <input
                    ref="topUpAmountInput"
                    v-model="topUpForm.amount"
                    type="number"
                    :min="moneyInputStep()"
                    :max="fromMinorUnits(maxTopUp)"
                    :step="moneyInputStep()"
                    :placeholder="t('walletAdmin.topUpPlaceholder', { amount: amountText(quickAmounts[1] || quickAmounts[0] || 0) })"
                    @input="normalizeTopUpAmount"
                  />
                </label>
                <div class="quick-amounts" :aria-label="t('walletAdmin.quickTopUpAria')">
                  <button v-for="amount in quickAmounts" :key="amount" type="button" @click="addTopUpAmount(amount)">
                    +{{ formatMoney(amount) }}
                  </button>
                </div>
                <label class="field">
                  <span>{{ t('walletAdmin.reasonNote') }}</span>
                  <input v-model="topUpForm.reason" maxlength="60" :placeholder="t('walletAdmin.defaultTopUpReason')" />
                </label>
                <div class="wm-actions">
                  <button type="button" class="cancel-btn" :disabled="submitting" @click="closeMemberActions">{{ t('common.cancel') }}</button>
                  <button type="submit" class="primary-btn" :disabled="submitting">{{ t('walletAdmin.confirmTopUp') }}</button>
                </div>
              </form>

              <form class="wm-col adjust" @submit.prevent="submitAdjustment">
                <h4>{{ t('walletAdmin.adjustHeading') }}</h4>
                <label class="field">
                  <span>{{ t('walletAdmin.adjustAmount') }}</span>
                  <input v-model="adjustForm.amount" type="number" :step="moneyInputStep()" :placeholder="t('walletAdmin.adjustPlaceholder', { big: amountText(largeTopUp), small: amountText(quickAmounts[0] || 0) })" />
                </label>
                <div class="quick-amounts adjustment-amounts" :aria-label="t('walletAdmin.quickAdjustAria')">
                  <button v-for="amount in quickAmounts" :key="amount" type="button" @click="addAdjustAmount(-amount)">
                    -{{ formatMoney(amount) }}
                  </button>
                </div>
                <label class="field">
                  <span>{{ t('walletAdmin.adjustReason') }}</span>
                  <input v-model="adjustForm.reason" maxlength="80" :placeholder="t('walletAdmin.adjustReasonPlaceholder')" />
                </label>
                <div class="wm-actions">
                  <button type="button" class="cancel-btn" :disabled="submitting" @click="closeMemberActions">{{ t('common.cancel') }}</button>
                  <button type="submit" class="danger-btn" :disabled="submitting">{{ t('walletAdmin.confirmAdjust') }}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <section class="panel">
      <div class="report-head">
        <div>
          <h2>{{ t('walletAdmin.ledgerTitle') }}</h2>
          <p>{{ t('walletAdmin.ledgerDesc') }}</p>
        </div>
        <div class="head-actions">
          <span class="count-chip">{{ t('walletAdmin.logCount', { count: filteredLogs.length }) }}</span>
          <button class="export-btn" :disabled="exporting" @click="exportExcel">
            {{ exporting ? t('wallet.exporting') : t('wallet.exportXlsx') }}
          </button>
        </div>
      </div>

      <div class="filters">
        <AppDatePicker v-model="report.from" @change="rangeEndPicker?.openPicker()" :max="report.to" :aria-label="t('walletAdmin.startAria')" />
        <AppDatePicker ref="rangeEndPicker" v-model="report.to" :min="report.from" :aria-label="t('walletAdmin.endAria')" />
        <select v-model="report.member" :aria-label="t('walletAdmin.memberFilterAria')">
          <option :value="ALL">{{ t('walletAdmin.allMembers') }}</option>
          <option v-for="member in registeredMembers" :key="member.uid" :value="member.name">{{ member.name }}</option>
        </select>
        <select v-model="report.type" :aria-label="t('walletAdmin.typeFilterAria')">
          <option v-for="(label, type) in typeFilterOptions" :key="type" :value="type">{{ label }}</option>
        </select>
        <button class="query-btn" :disabled="logsLoading" @click="loadWalletLogs">
          {{ logsLoading ? t('walletAdmin.refreshing') : t('walletAdmin.refresh') }}
        </button>
      </div>

      <div class="summary-panel" :aria-label="t('walletAdmin.summaryAria')">
        <div class="summary-row">
          <div class="metric top-up"><span>{{ t('walletAdmin.periodTopUp') }}</span><strong>{{ formatMoney(summary.topUp) }}</strong></div>
          <div class="metric debit"><span>{{ t('walletAdmin.periodDebit') }}</span><strong>{{ formatMoney(summary.debit) }}</strong></div>
          <div class="metric net"><span>{{ t('walletAdmin.periodNet') }}</span><strong>{{ formatMoney(summary.net) }}</strong></div>
        </div>
        <!-- 退款／編輯調整／修正很少發生，僅在非 0 時以附註顯示（XLSX 匯出仍含完整六項） -->
        <p v-if="summary.refund || summary.edit || summary.adjust" class="summary-minor">
          <span v-if="summary.refund">{{ t('walletAdmin.periodRefundAmount', { amount: formatMoney(summary.refund) }) }}</span>
          <span v-if="summary.edit">{{ t('walletAdmin.editNetAmount', { amount: formatMoney(summary.edit) }) }}</span>
          <span v-if="summary.adjust">{{ t('walletAdmin.adjustNetAmount', { amount: formatMoney(summary.adjust) }) }}</span>
        </p>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('walletAdmin.export.time') }}</th>
              <th>{{ t('walletAdmin.export.member') }}</th>
              <th>{{ t('wallet.description') }}</th>
              <th class="right">{{ t('walletAdmin.export.amount') }}</th>
              <th class="right">{{ t('walletAdmin.export.before') }}</th>
              <th class="right">{{ t('walletAdmin.export.after') }}</th>
              <th>{{ t('walletAdmin.export.operator') }}</th>
              <th class="detail-col" :aria-label="t('wallet.detail')"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="8"><LoadingState :title="t('walletAdmin.loadingTitle')" :description="t('walletAdmin.loadingText')" /></td>
            </tr>
            <tr v-else-if="filteredLogs.length === 0">
              <td colspan="8"><StatusNotice :title="t('walletAdmin.emptyTitle')" :description="t('walletAdmin.emptyText')" /></td>
            </tr>
            <template v-for="log in filteredLogs" :key="log.id">
              <tr
                class="log-tr"
                :class="{ expandable: hasEditDetail(log), expanded: expandedIds.includes(log.id) }"
                @click="hasEditDetail(log) && toggleDetail(log.id)"
              >
                <td class="mono nowrap">{{ formatDateTime(log.timestamp) }}</td>
                <td>{{ log.ownerName }}</td>
                <td class="reason-cell" :title="logDescription(log)">{{ logDescription(log) }}</td>
                <td class="right mono" :class="{ plus: Number(log.amount) > 0, minus: Number(log.amount) < 0 }">
                  {{ Number(log.amount) > 0 ? '+' : '' }}{{ formatMoney(log.amount) }}
                </td>
                <td class="right mono">{{ formatMoney(log.beforeBalance) }}</td>
                <td class="right mono">{{ formatMoney(log.afterBalance) }}</td>
                <td>{{ log.operatorName || '—' }}</td>
                <td class="detail-col">
                  <button v-if="hasEditDetail(log)" type="button" class="detail-toggle">
                    {{ expandedIds.includes(log.id) ? t('wallet.collapse') : t('wallet.detail') }}
                  </button>
                </td>
              </tr>
              <template v-if="hasEditDetail(log) && expandedIds.includes(log.id)">
                <tr v-for="pair in log.pairLogs" :key="pair.id" class="edit-sub-tr">
                  <td></td>
                  <td class="edit-sub-label">{{ typeLabel(pair.type) }}</td>
                  <td class="edit-sub-meal reason-cell">{{ pair.items && pair.items[0] ? pair.items[0].meal : '' }}<template v-if="pair.items && pair.items[0] && pair.items[0].note">・{{ pair.items[0].note }}</template></td>
                  <td class="right mono" :class="{ plus: Number(pair.amount) > 0, minus: Number(pair.amount) < 0 }">{{ formatSigned(pair.amount) }}</td>
                  <td class="right mono">{{ formatMoney(pair.beforeBalance) }}</td>
                  <td class="right mono">{{ formatMoney(pair.afterBalance) }}</td>
                  <td></td>
                  <td></td>
                </tr>
                <tr :key="`${log.id}-net`" class="edit-sub-tr net">
                  <td></td>
                  <td class="edit-sub-label">{{ t('wallet.net') }}</td>
                  <td></td>
                  <td class="right mono" :class="{ plus: Number(log.amount) > 0, minus: Number(log.amount) < 0 }">{{ formatSigned(log.amount) }}</td>
                  <td class="right mono">{{ formatMoney(log.beforeBalance) }}</td>
                  <td class="right mono">{{ formatMoney(log.afterBalance) }}</td>
                  <td></td>
                  <td></td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* --wallet-* 色票定義在 tokens.css 的 :root（Teleport 出去的視窗也拿得到） */
.wallet-admin {
  display: flex;
  flex-direction: column;
}

.report-head {
  border-bottom: 1px solid var(--muted-line2);
}

.report-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.count-chip {
  border-radius: 999px;
  padding: 6px 10px;
  background: var(--bg-page);
  color: var(--text-muted);
  font-size: var(--text-micro);
  font-weight: 900;
  white-space: nowrap;
}

/* ── KPI 卡列（設計稿 4） ── */
.wallet-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.wkpi {
  min-width: 0;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.wkpi-total { border: none; }

.wkpi-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-label);
}
/* 這一格原本要畫成實色綠卡片，但 components.css 的
   `:root .summary-strip > .summary-cell { background: transparent }` 權重比
   scoped 樣式高，底色從來沒畫出來過；活下來的只有「文字改成米白」那兩條，
   米白字寫在米白紙上，整格看起來就是空白的。
   改成跟旁邊兩格同一張紙，主次交給淡色底與深色數字。 */
.summary-strip .wkpi-total .wkpi-label.wkpi-label { color: var(--ink-faint); }
.summary-strip .wkpi-total .wkpi-label i { color: var(--jade); }

.wkpi-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 總額用最重的墨色，左右兩格才是「進來的綠、出去的紅」 */
.summary-strip .wkpi-total .wkpi-value.summary-money { color: var(--jade); font-weight: 700; }

.wkpi-sub {
  color: var(--text-muted);
  font-size: var(--text-micro);
  font-weight: 600;
}

h2 {
  margin: 0 0 5px;
  font-size: var(--text-lead);
  font-weight: 800;
  color: var(--text-primary);
}

p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-label);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field span, .field > label {
  font-size: var(--text-micro);
  font-weight: 800;
  color: var(--text-muted);
}

.quick-amounts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.quick-amounts button {
  padding: 7px 8px;
  border: 1.5px solid var(--wallet-credit-color);
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--wallet-credit-color) 10%, var(--bg-card));
  color: var(--wallet-credit-color);
  font-size: var(--text-label);
  font-weight: 900;
}

.quick-amounts button:hover {
  background: var(--wallet-credit-color);
  color: var(--text-on-success);
}

.adjustment-amounts button {
  border-color: var(--wallet-debit-color);
  background: color-mix(in srgb, var(--wallet-debit-color) 10%, var(--bg-card));
  color: var(--wallet-debit-color);
}

.adjustment-amounts button:hover {
  background: var(--wallet-debit-color);
  color: var(--paper);
}

input, select {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--input-border);
  border-radius: var(--r-md);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 700;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

input:focus, select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--input-focus-ring);
}

input[type='number']::-webkit-outer-spin-button, input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input[type='number'] {
  appearance: textfield;
  -moz-appearance: textfield;
}

.primary-btn {
  padding: 10px 14px;
  border-radius: var(--r-md);
  font-size: var(--text-label);
  font-weight: 700;
  transition: opacity 0.15s;
}

.danger-btn {
  padding: 10px 14px;
  border-radius: var(--r-md);
  color: var(--paper);
  font-size: var(--text-label);
  font-weight: 700;
  transition: opacity 0.15s;
}

.primary-btn { background: var(--wallet-credit-color); color: var(--text-on-success); }
.danger-btn { background: var(--danger); }
.primary-btn:hover:not(:disabled), .danger-btn:hover:not(:disabled) { opacity: 0.88; }
.primary-btn:disabled, .danger-btn:disabled, .cancel-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.cancel-btn {
  padding: 10px 14px;
  border-radius: var(--r-md);
  background: var(--bg-inset);
  color: var(--text-muted);
  font-size: var(--text-label);
  font-weight: 700;
  transition: background 0.15s, color 0.15s;
}
.cancel-btn:hover:not(:disabled) { background: var(--border); color: var(--text-primary); }

/* ── 成員儲值 / 修正視窗 ── */
.wallet-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal); /* 低於 --z-dialog，二次確認才會蓋在上面 */
  background: var(--overlay);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow-y: auto;
}

.wallet-modal {
  width: 100%;
  max-width: 640px;
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.wm-head {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--muted-line2);
}

.wm-head-text { min-width: 0; flex: 1; }

.wm-head h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-lead);
  font-weight: 800;
  color: var(--text-primary);
}

.wm-head p { margin: 2px 0 0; font-size: var(--text-label); color: var(--text-muted); }
.wm-head p strong { color: var(--text-primary); font-weight: 800; }

.wm-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  background: var(--bg-inset);
  color: var(--text-muted);
}
.wm-close:hover { background: var(--border); color: var(--text-primary); }

.wm-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
}

.wm-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px 18px;
  border-top: 3px solid transparent;
}
.wm-col.top-up { border-top-color: var(--wallet-credit-color); }
.wm-col.adjust {
  border-top-color: var(--wallet-debit-color);
  border-left: 1px solid var(--muted-line2);
}

.wm-col h4 {
  margin: 0;
  font-size: var(--text-label);
  font-weight: 800;
  color: var(--text-primary);
}
.wm-col.top-up h4 { color: var(--wallet-credit-color); }
.wm-col.adjust h4 { color: var(--wallet-debit-color); }

.wm-actions {
  margin-top: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.export-btn {
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--mint);
  color: var(--text-on-success);
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
.export-btn:hover:not(:disabled) { filter: brightness(0.94); }
.export-btn:disabled { cursor: wait; opacity: 0.65; }

.query-btn {
  padding: 9px 14px;
  border-radius: var(--r-md);
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 700;
  white-space: nowrap;
}

.query-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.query-btn:disabled {
  cursor: wait;
  opacity: 0.65;
}

/* ── 成員餘額小卡（避免條列式過長） ── */

.member-card {
  min-width: 0;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.12s;
}

.member-card:hover, .member-card:focus-visible {
  border-color: var(--accent);

}

.member-card.low {
  border-color: color-mix(in srgb, var(--wallet-debit-color) 58%, var(--border-strong));
}

.member-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.bc-avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  color: var(--paper);
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--text-label);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.balance-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: var(--text-label);
  font-weight: 700;
}

.member-balance {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  flex-shrink: 0;
  min-width: 72px; /* 抓 4 位數金額（如 $9,999）的寬度，讓每列「儲值」按鈕位置對齊 */
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.member-balance i { font-size: var(--text-label); }

.row-topup-btn {
  flex-shrink: 0;
  padding: 4px 11px;
  font-size: var(--text-label);
  font-weight: 700;
  transition: background 0.15s, color 0.15s;
}
.row-topup-btn:hover { background: var(--accent-solid); border-color: var(--accent); color: var(--text-on-accent); }

.balance-empty { padding: 24px; grid-column: 1 / -1; }

.summary-panel {
  border-bottom: 1px solid var(--muted-line2);
}

.summary-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.summary-minor {
  margin: 10px 2px 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  color: var(--text-muted);
  font-size: var(--text-label);
  font-weight: 700;
}

.metric {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow: hidden;
}

.metric::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--wallet-net-color);
}

.metric.top-up::before { background: var(--wallet-credit-color); }
.metric.debit::before { background: var(--wallet-debit-color); }
.metric.net::before { background: var(--wallet-net-color); }

.metric span {
  color: var(--text-muted);
  font-size: var(--text-micro);
}

.metric strong {
  color: var(--text-primary);
  font-size: var(--text-lead);
}

.filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
  gap: 10px;
  border-bottom: 1px solid var(--muted-line2);
}

.table-wrap {
  max-height: min(58vh, 620px);
  overflow-x: auto;
  overflow-y: auto;
}

table {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  font-size: var(--text-label);
}

th {
  padding: 10px 12px;
  border-bottom: 1px dashed var(--muted-line2);
  text-align: left;
}

td {
  padding: 10px 12px;
  border-bottom: 1px dashed var(--muted-line2);
  text-align: left;
  color: var(--text-primary);
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--text-muted);
  font-size: var(--text-micro);
  font-weight: 700;
}

tbody tr:nth-child(even) td {
  background: color-mix(in srgb, var(--text-primary) 3.5%, transparent);
}

tbody tr:hover td {
  background: color-mix(in srgb, var(--selection) 8%, var(--bg-card));
}

.right { text-align: right; }
.nowrap { white-space: nowrap; }
.reason-cell {
  min-width: 220px;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-tr.expandable { cursor: pointer; }
.log-tr.expanded td { background: color-mix(in srgb, var(--selection) 6%, var(--bg-card)); }

.detail-col { width: 1%; white-space: nowrap; text-align: right; }
.detail-toggle {
  padding: 2px 9px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--text-primary) 8%, transparent);
  color: var(--text-muted);
  font-size: var(--text-micro);
  font-weight: 800;
  white-space: nowrap;
}

/* 展開的退款/扣款/淨額子列，欄位對齊主表格 */
.edit-sub-tr td {
  background: color-mix(in srgb, var(--text-primary) 3.5%, transparent);
  border-bottom: none;
  padding-top: 6px;
  padding-bottom: 6px;
  font-size: var(--text-micro);
}
.edit-sub-tr:last-of-type td { padding-bottom: 10px; }
.edit-sub-tr.net td { font-weight: 900; }
.edit-sub-tr.net td:not(:empty) { border-top: 1px dashed var(--border-strong); }
.edit-sub-label { color: var(--text-muted); font-weight: 800; white-space: nowrap; }
.edit-sub-meal { color: var(--text-muted); }

.plus { font-weight: 800; font-family: var(--font-display); }
/* 支出金額用中性色：橘色留給品牌／互動，入帳綠色才會一眼跳出 */
.minus { font-weight: 800; font-family: var(--font-display); }
.empty {
  text-align: center;
  color: var(--text-muted);
  padding: 30px;
}

.wallet-modal-enter-active, .wallet-modal-leave-active { transition: opacity 0.18s ease; }
.wallet-modal-enter-from, .wallet-modal-leave-to { opacity: 0; }
.wallet-modal-enter-active .wallet-modal { animation: walletModalIn 0.24s cubic-bezier(0.34, 1.4, 0.64, 1); }

@keyframes walletModalIn {
  from { transform: scale(0.94) translateY(8px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}

@media (max-width: 900px) {
  .summary-row, .filters {
    grid-template-columns: 1fr;
  }

  .wm-body { grid-template-columns: 1fr; }
  .wm-col.adjust { border-left: none; border-top: 1px solid var(--muted-line2); box-shadow: inset 0 3px 0 var(--wallet-debit-color); }

  .report-head {
    align-items: stretch;
    flex-direction: column;
  }

  .head-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .count-chip {
    text-align: center;
  }

  .wallet-kpis { grid-template-columns: 1fr; gap: 10px; }
  .member-updated { display: none; }
}

.wallet-admin { gap: 28px; }
.panel { background: transparent; border: 0; border-radius: 0; box-shadow: none; overflow: visible; }
.report-head { padding: 0 0 16px; border: 0; }
.report-head h2 { font-weight: 600; }
.report-head p { font-weight: 400; }
.member-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 20px; padding: 0; background: var(--ink-2); border-block: 1px solid var(--line); }
.member-card, .member-card.low { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: transparent; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; box-shadow: none; padding: 14px 16px; }
.member-card:hover { background: var(--ink-3); }
.member-card { flex-direction: row; }
.member-card-head { flex: 1; min-width: 0; }
.member-balance { font-family: var(--font-sans); font-size: var(--text-lead); color: var(--paper); white-space: nowrap; }
.member-balance.low, .member-balance.minus { color: var(--gold); }
.row-topup-btn { background: transparent; border: 0; border-radius: 4px; color: var(--paper); }
.bc-avatar { border-radius: 4px; }
.summary-panel { padding: 16px 0; border-block: 1px solid var(--line); }
.metric { background: transparent; border: 0; border-radius: 0; padding: 4px 16px; }
.metric + .metric { border-left: 1px solid var(--line); }
.metric::before { display: none; }
.metric strong { font-family: var(--font-sans); font-weight: 600; }
.metric span { font-weight: 400; }
.filters { padding: 12px 0; }
.table-wrap { background: var(--ink-2); border-radius: 0; }
th { background: var(--ink-3); }
td { border-bottom-style: solid; }
.plus, .minus { color: var(--paper); }
.wm-col { background: transparent; border: 0; border-radius: 0; box-shadow: none; }
.wm-col + .wm-col { border-left: 1px solid var(--paper-2); }
@media (max-width: 768px) { .member-grid { grid-template-columns: minmax(0, 1fr); } .member-card { padding: 14px 12px; } .metric { padding: 4px 8px; } .wm-col + .wm-col { border-left: 0; border-top: 1px solid var(--paper-2); } }
</style>
