<script setup>
// 品牌三點跳動載入動畫。App.vue 的開場畫面與點餐頁的等待畫面共用同一個元件，
// 兩段等待銜接時才不會換一種動畫、讓使用者以為「又重跳了一次」。
</script>

<template>
  <div class="loading-dots" aria-hidden="true">
    <span></span>
    <span></span>
    <span></span>
  </div>
</template>

<style scoped>
.loading-dots {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 28px;
}

.loading-dots span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--paprika);
  animation: loading-dots-bounce 0.9s ease-in-out infinite;
}

.loading-dots span:nth-child(2) {
  background: var(--gold);
  animation-delay: 0.12s;
}

.loading-dots span:nth-child(3) {
  background: var(--mint);
  animation-delay: 0.24s;
}

@keyframes loading-dots-bounce {
  0%, 80%, 100% {
    transform: translateY(0);
    opacity: 0.55;
  }

  40% {
    transform: translateY(-8px);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .loading-dots span {
    animation: none;
  }
}
</style>
