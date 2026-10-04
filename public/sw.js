const CACHE_NAME = 'office-lunch-shell-v2'
const APP_SHELL = ['/', '/manifest.webmanifest', '/office-lunch.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')))
  }
})

// ── 推播（Firebase Cloud Messaging）──────────────────────────────────
// 推播由 Cloud Functions 透過 FCM 送出；這個 service worker 負責顯示通知與處理點擊。
self.addEventListener('push', (event) => {
  let payload
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { notification: { body: event.data ? event.data.text() : '' } }
  }
  const notification = payload.notification || {}
  const data = payload.data || {}
  const title = notification.title || data.title || 'Office Order'
  const link = (payload.fcmOptions && payload.fcmOptions.link) || notification.click_action || data.link || '/'
  event.waitUntil(self.registration.showNotification(title, {
    body: notification.body || data.body || '',
    icon: notification.icon || '/office-lunch.svg',
    data: { link },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.link) || '/', self.location.origin)
  // 只開啟本站的頁面，不跟著通知內容跳到其他網站。
  if (target.origin !== self.location.origin) return
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === target.origin)
    if (existing) return existing.focus().then((client) => (client && client.navigate ? client.navigate(target.href) : client))
    return self.clients.openWindow(target.href)
  }))
})
