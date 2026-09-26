<script setup>
/**
 * 今日訂單與歷史訂單共用的一筆明細列。
 *
 * 版面（欄寬、字級、分隔線、金額色）全部定義在 components.css 的 .order-rows
 * 區塊，標題列 OrderRowHead 讀同一組變數，因此兩者永遠對齊，也不會再像先前
 * 那樣兩張表各寫一份而慢慢漂開。
 *
 * 兩邊行為不同的地方一律走 slot，由各自的表格提供：
 *   actions     右側操作鈕（歷史訂單只有 +1，今日訂單還有免費／編輯／刪除）
 *   edit-meal   editing 為 true 時取代餐點欄（今日訂單的就地編輯）
 *   edit-money  editing 為 true 時取代金額欄
 * 本元件不認得任何一邊的商業邏輯。
 */
import { computed } from 'vue'
import { formatMoney } from '../../utils/format'
import { getAvatarColor } from '../../utils'

const props = defineProps({
  order: { type: Object, required: true },
  // 顯示「你」標記
  isSelf: { type: Boolean, default: false },
  // 已格式化的時間字串；留空則不顯示時間欄（今日訂單不需要）
  time: { type: String, default: '' },
  // 就地編輯中：餐點與金額欄改由 edit-* slot 接手
  editing: { type: Boolean, default: false }
})

const initial = computed(() => String(props.order?.name || '?').trim().charAt(0).toUpperCase() || '?')
const amount = computed(() => Number(props.order?.price || 0).toLocaleString())
</script>

<template>
  <div class="order-row" :class="{ free: order.isFree, 'is-self': isSelf, 'is-editing': editing }">
    <span class="or-person">
      <span class="or-avatar" :style="{ background: getAvatarColor(order.name) }" aria-hidden="true">{{ initial }}</span>
      <span class="or-name">{{ order.name }}<em v-if="isSelf" class="or-self">你</em></span>
    </span>

    <span class="or-meal">
      <slot v-if="editing" name="edit-meal" />
      <template v-else>
        <span class="or-dish">{{ order.meal }}</span>
        <small v-if="order.note" class="or-note">{{ order.note }}</small>
      </template>
    </span>

    <span v-if="time" class="or-time">{{ time }}</span>

    <span class="or-money">
      <slot v-if="editing" name="edit-money" />
      <template v-else>
        {{ formatMoney(amount) }}
        <span v-if="order.isFree" class="or-flag">免費</span>
      </template>
    </span>

    <span class="or-actions"><slot name="actions" /></span>
  </div>
</template>
