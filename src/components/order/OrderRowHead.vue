<script setup>
/**
 * OrderRow 的欄位標題列。欄寬讀 .order-rows 上的同一組變數，所以標題必然
 * 對齊下方的內容列。列表本身不是語意表格，標題純為視覺對齊，故對輔助技術隱藏。
 */
defineProps({
  // 與 OrderRow 的 time prop 對應：有時間欄才顯示「時間」
  showTime: { type: Boolean, default: false }
})
</script>

<template>
  <div class="order-row-head" aria-hidden="true">
    <span class="or-person">姓名</span>
    <span class="or-meal">餐點</span>
    <span v-if="showTime" class="or-time">時間</span>
    <span class="or-money">金額</span>
    <span class="or-actions"></span>
  </div>
</template>
