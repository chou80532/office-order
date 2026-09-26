<script setup>
import LoadingState from '../ui/LoadingState.vue'
import { computed, ref, watch } from 'vue'
import { useScrollLock } from '../../composables/useScrollLock'
import { useModalA11y } from '../../composables/useModalA11y'

const props = defineProps({
  store: { type: Object, required: true }
})

// 父層以 v-if 掛載，掛著就等於開啟。圖片檢視有 pinch/pan 手勢（touch-action: none），
// 背景若還能捲動，手勢會跟頁面捲動打架。
useScrollLock(ref(true))

const emit = defineEmits(['close'])

// 圖片燈箱原本連 Escape 都沒有，關掉之後焦點也回不到剛才點的那張縮圖。
const modalRoot = ref(null)
useModalA11y(modalRoot, { onEscape: () => emit('close') })

const imageIndex = ref(0)
const scale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const dragging = ref(false)
const imageLoading = ref(true)
const imageError = ref(false)
const imageRetryKey = ref(0)
let touchDist = 0
let touchCenter = { x: 0, y: 0 }
let touchPanning = false
let lastPanPos = { x: 0, y: 0 }
let mouseDragging = false
let lastMousePos = { x: 0, y: 0 }

const images = computed(() => (props.store?.images || []).filter(image => image.url && image.url.trim() !== ''))
const currentImage = computed(() => images.value[imageIndex.value] || null)
const imageStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  cursor: dragging.value ? 'grabbing' : scale.value > 1 ? 'grab' : 'default',
  transition: touchPanning || dragging.value ? 'none' : 'transform 0.15s ease',
  willChange: 'transform',
  touchAction: 'none',
  userSelect: 'none'
}))

function clampScale(value) {
  return Math.min(Math.max(value, 0.3), 5)
}

function resetZoom() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
  dragging.value = false
  mouseDragging = false
  touchPanning = false
}

function zoomIn() {
  scale.value = clampScale(scale.value + 0.2)
}

function zoomOut() {
  scale.value = clampScale(scale.value - 0.2)
  if (scale.value <= 1) {
    translateX.value = 0
    translateY.value = 0
  }
}

function handleWheelZoom(event) {
  scale.value = clampScale(scale.value + (event.deltaY < 0 ? 0.15 : -0.15))
  if (scale.value <= 1) {
    translateX.value = 0
    translateY.value = 0
  }
}

function selectAdjacentImage(offset) {
  if (images.value.length < 2) return
  imageIndex.value = (imageIndex.value + offset + images.value.length) % images.value.length
  resetZoom()
}

function preloadNextImage() {
  if (images.value.length < 2) return
  const nextIndex = (imageIndex.value + 1) % images.value.length
  const nextUrl = images.value[nextIndex]?.url
  if (!nextUrl) return
  const preload = new Image()
  preload.src = nextUrl
}

function handleImageLoad() {
  imageLoading.value = false
  imageError.value = false
  preloadNextImage()
}

function handleImageError() {
  imageLoading.value = false
  imageError.value = true
}

function retryImage() {
  imageLoading.value = true
  imageError.value = false
  imageRetryKey.value += 1
}

function getTouchDist(t1, t2) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
}

function getTouchCenter(t1, t2) {
  return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 }
}

function onTouchStart(event) {
  if (event.touches.length === 2) {
    touchPanning = true
    touchDist = getTouchDist(event.touches[0], event.touches[1])
    touchCenter = getTouchCenter(event.touches[0], event.touches[1])
  } else if (event.touches.length === 1 && scale.value > 1) {
    touchPanning = true
    lastPanPos = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }
}

function onTouchMove(event) {
  if (event.touches.length === 2) {
    const newDist = getTouchDist(event.touches[0], event.touches[1])
    scale.value = clampScale(scale.value * (newDist / touchDist))
    touchDist = newDist
    const newCenter = getTouchCenter(event.touches[0], event.touches[1])
    translateX.value += newCenter.x - touchCenter.x
    translateY.value += newCenter.y - touchCenter.y
    touchCenter = newCenter
  } else if (event.touches.length === 1 && scale.value > 1) {
    translateX.value += event.touches[0].clientX - lastPanPos.x
    translateY.value += event.touches[0].clientY - lastPanPos.y
    lastPanPos = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }
}

function onTouchEnd(event) {
  if (event.touches.length < 2) {
    touchPanning = false
    if (scale.value < 0.5) resetZoom()
    if (scale.value <= 1) {
      translateX.value = 0
      translateY.value = 0
    }
  }
}

function onMouseDown(event) {
  if (scale.value <= 1) return
  dragging.value = true
  mouseDragging = true
  lastMousePos = { x: event.clientX, y: event.clientY }
  event.preventDefault()
}

function onMouseMove(event) {
  if (!mouseDragging) return
  translateX.value += event.clientX - lastMousePos.x
  translateY.value += event.clientY - lastMousePos.y
  lastMousePos = { x: event.clientX, y: event.clientY }
}

function onMouseUp() {
  mouseDragging = false
  setTimeout(() => { dragging.value = false }, 0)
}

watch(() => props.store?.name, () => {
  imageIndex.value = 0
  resetZoom()
})

watch(() => currentImage.value?.url, () => {
  imageLoading.value = true
  imageError.value = false
  imageRetryKey.value = 0
}, { immediate: true })
</script>

<template>
  <div class="menu-preview-overlay" @click.self="emit('close')">
    <div ref="modalRoot" class="menu-preview-modal" role="dialog" aria-modal="true" :aria-label="`${store.name} 菜單圖片`">
      <div class="menu-preview-header">
        <div>
          <strong>{{ store.name }}</strong>
          <span v-if="images.length > 1">第 {{ imageIndex + 1 }} / {{ images.length }} 張</span>
        </div>
        <button type="button" class="menu-preview-close" aria-label="關閉菜單圖片" @click="emit('close')">×</button>
      </div>
      <div
        class="menu-preview-body"
        @wheel.prevent="handleWheelZoom"
        @mousedown="onMouseDown"
        @mousemove="onMouseMove"
        @mouseup="onMouseUp"
        @mouseleave="onMouseUp"
        @touchstart.prevent="onTouchStart"
        @touchmove.prevent="onTouchMove"
        @touchend="onTouchEnd"
      >
        <button v-if="images.length > 1" type="button" class="menu-nav-btn prev" aria-label="上一張菜單" @click="selectAdjacentImage(-1)">‹</button>
        <img
          v-if="currentImage"
          :key="`${currentImage.url}-${imageRetryKey}`"
          :src="currentImage.url"
          :alt="`${store.name} 菜單圖片`"
          :style="imageStyle"
          class="menu-preview-image"
          :class="{ loaded: !imageLoading && !imageError }"
          loading="eager"
          decoding="async"
          fetchpriority="high"
          draggable="false"
          @load="handleImageLoad"
          @error="handleImageError"
        />
        <LoadingState v-if="imageLoading" class="menu-preview-status" title="正在載入菜單…" compact />
        <div v-else-if="imageError" class="menu-preview-status menu-preview-error" role="alert">
          <i class="fas fa-image" aria-hidden="true"></i>
          <span>菜單圖片載入失敗</span>
          <button type="button" @click.stop="retryImage">重新載入</button>
        </div>
        <div v-if="currentImage && !imageError" class="menu-preview-zoom-bar" aria-label="菜單圖片縮放控制">
          <button type="button" class="menu-preview-glass-btn" title="縮小" aria-label="縮小菜單圖片" @click.stop="zoomOut"><i class="fas fa-search-minus"></i></button>
          <span class="menu-preview-zoom-level">{{ Math.round(scale * 100) }}%</span>
          <button type="button" class="menu-preview-glass-btn" title="放大" aria-label="放大菜單圖片" @click.stop="zoomIn"><i class="fas fa-search-plus"></i></button>
          <div class="menu-preview-divider"></div>
          <button type="button" class="menu-preview-glass-btn" title="整頁" aria-label="整頁顯示菜單圖片" @click.stop="resetZoom"><i class="fas fa-expand"></i></button>
        </div>
        <button v-if="images.length > 1" type="button" class="menu-nav-btn next" aria-label="下一張菜單" @click="selectAdjacentImage(1)">›</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-preview-overlay { position:fixed; inset:0; z-index:var(--z-modal); display:flex; align-items:center; justify-content:center; padding:24px; background:var(--overlay); }
.menu-preview-modal { width:min(92vw,920px); max-height:min(90dvh,860px); display:flex; flex-direction:column; border:1px solid var(--border); border-radius:var(--r-xl); background:var(--paper); box-shadow:var(--shadow-modal); overflow:hidden; }
.menu-preview-header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border); background:var(--cream); }
.menu-preview-header div { display:flex; align-items:baseline; gap:8px; min-width:0; }
.menu-preview-header strong { color:var(--ink); font-size: var(--text-body); font-weight:800; }
.menu-preview-header span { color:var(--muted); font-size: var(--text-label); font-weight:600; }
.menu-preview-close { width:32px; height:32px; border-radius:999px; color:var(--muted); font-size: var(--text-title); line-height:1; }
.menu-preview-close:hover { background:var(--bg-danger); color:var(--text-danger); }
.menu-preview-body { position:relative; display:flex; align-items:center; justify-content:center; min-height:320px; padding:14px; overflow:hidden; background:var(--image-viewer-bg); touch-action:none; }
.menu-preview-image { display:block; max-width:100%; max-height:74dvh; object-fit:contain; border-radius:var(--r-sm); transform-origin:center center; opacity:0; }
.menu-preview-image.loaded { opacity:1; }
.menu-preview-status { position:absolute; inset:0; z-index:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:color-mix(in srgb, var(--paper) 78%, transparent); font-size: var(--text-label); font-weight:700; pointer-events:none; }
.menu-preview-spinner { width:30px; height:30px; border:3px solid color-mix(in srgb, var(--paper) 20%, transparent); border-top-color:var(--paper); border-radius:50%; animation:menu-preview-spin 0.8s linear infinite; }
.menu-preview-error i { font-size: var(--text-display); color:color-mix(in srgb, var(--paper) 48%, transparent); }
.menu-preview-error button { padding:7px 12px; border:1px solid color-mix(in srgb, var(--paper) 28.000000000000004%, transparent); border-radius:999px; background:color-mix(in srgb, var(--paper) 10%, transparent); color:var(--paper); font-size: var(--text-label); font-weight:700; pointer-events:auto; }
.menu-preview-error button:hover { background:color-mix(in srgb, var(--paper) 20%, transparent); }
@keyframes menu-preview-spin { to { transform:rotate(360deg); } }
.menu-preview-zoom-bar { position:absolute; bottom:16px; left:50%; z-index:2; display:flex; align-items:center; gap:6px; padding:6px 10px; border:1px solid color-mix(in srgb, var(--paper) 10%, transparent); border-radius:999px; background:var(--image-control-bg); backdrop-filter:blur(8px); transform:translateX(-50%); }
.menu-preview-glass-btn { width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:50%; background:color-mix(in srgb, var(--paper) 8%, transparent); color:var(--image-control-icon); font-size: var(--text-micro); transition:background 0.15s; }
.menu-preview-glass-btn:hover, .menu-preview-glass-btn:focus-visible { background:color-mix(in srgb, var(--paper) 18%, transparent); }
.menu-preview-zoom-level { min-width:42px; color:var(--paper); font-family:var(--font-mono); font-size: var(--text-micro); font-weight:700; text-align:center; }
.menu-preview-divider { width:1px; height:18px; margin:0 2px; background:color-mix(in srgb, var(--paper) 15%, transparent); }
.menu-nav-btn { position:absolute; top:50%; z-index:1; width:40px; height:56px; border-radius:999px; background:color-mix(in srgb, var(--ink) 68%, transparent); color:var(--paper); font-size: var(--text-display); line-height:1; transform:translateY(-50%); }
.menu-nav-btn:hover { background:color-mix(in srgb, var(--ink) 90%, transparent); }
.menu-nav-btn.prev { left:18px; }
.menu-nav-btn.next { right:18px; }

/* 手機上這是主要的看菜單方式，不該只佔中間一小塊；
   高度全部用 dvh，網址列展開收合時才不會被切到。 */
@media (max-width: 768px) {
  .menu-preview-overlay { padding:0; }
  .menu-preview-modal { width:100%; max-width:none; height:100dvh; max-height:100dvh; border:0; border-radius:0; }
  .menu-preview-body { min-height:0; flex:1; }
  .menu-preview-image { max-height:none; }
  .menu-nav-btn { width:34px; height:48px; }
  .menu-nav-btn.prev { left:8px; }
  .menu-nav-btn.next { right:8px; }
}
</style>
