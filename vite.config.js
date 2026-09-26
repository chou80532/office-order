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
          if (moduleId.includes('/firebase/') || moduleId.includes('/@firebase/')) return 'firebase-app'
          if (moduleId.includes('/vue-router/') || moduleId.includes('/vue/')) return 'vue-vendor'
        }
      }
    }
  }
})
