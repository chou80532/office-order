import { createApp } from 'vue'
import router from './router'
import App from './App.vue'
import './assets/tokens.css'
import './assets/components.css'


const app = createApp(App)
app.use(router)

app.directive('click-outside', {
  mounted(el, binding) {
    el._co = (e) => { if (!el.contains(e.target)) binding.value(e) }
    document.addEventListener('mousedown', el._co)
  },
  unmounted(el) { document.removeEventListener('mousedown', el._co) }
})

app.mount('#app')

// Service Worker 只在正式站註冊：開發時註冊會讓 Vite 的熱更新拿到舊檔。
// 註冊失敗不影響任何功能，所以靜靜吞掉就好。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
