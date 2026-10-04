import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  // vue-i18n 只使用 Composition API；關閉 legacy API 與正式版 devtools 以縮小 bundle。
  define: {
    __VUE_I18N_FULL_INSTALL__: false,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          const moduleId = id.replaceAll('\\', '/')
          if (moduleId.includes('/exceljs/')) return 'exceljs-vendor'
          if (moduleId.includes('/firebase/auth/') || moduleId.includes('/@firebase/auth/')) return 'firebase-auth'
          if (moduleId.includes('/firebase/firestore/') || moduleId.includes('/@firebase/firestore/')) return 'firebase-firestore'
          if (moduleId.includes('/firebase/functions/') || moduleId.includes('/@firebase/functions/')) return 'firebase-functions'
          if (moduleId.includes('/firebase/storage/') || moduleId.includes('/@firebase/storage/')) return 'firebase-storage'
          // 推播只在使用者開啟通知時才載入，不要併進每頁都會載入的 firebase-app。
          if (/\/@?firebase\/(messaging|installations)\//.test(moduleId)) return 'firebase-messaging'
          if (moduleId.includes('/firebase/') || moduleId.includes('/@firebase/')) return 'firebase-app'
          if (moduleId.includes('/vue-i18n/') || moduleId.includes('/@intlify/')) return 'i18n-vendor'
          if (moduleId.includes('/vue-router/') || moduleId.includes('/vue/')) return 'vue-vendor'
        }
      }
    }
  }
})
