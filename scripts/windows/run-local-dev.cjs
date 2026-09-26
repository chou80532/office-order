const { spawn, spawnSync } = require('node:child_process')
const { cpSync, existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const net = require('node:net')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const emulatorsOnly = process.argv.includes('--emulators-only')
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const dataDir = path.join(root, '.local', 'emulator-data')
const manifest = path.join(dataDir, 'firebase-export-metadata.json')

function findFirebaseCli() {
  const candidates = [path.join(root, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js')]
  if (process.platform === 'win32') {
    const located = spawnSync('where.exe', ['firebase.cmd'], { encoding: 'utf8', windowsHide: true })
    if (located.status === 0) {
      for (const command of located.stdout.split(/\r?\n/).filter(Boolean)) {
        candidates.push(path.join(path.dirname(command.trim()), 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'))
      }
    }
    const script = candidates.find(existsSync)
    return script && { command: process.execPath, prefix: [script] }
  }
  const script = candidates.find(existsSync)
  if (script) return { command: process.execPath, prefix: [script] }
  const located = spawnSync('which', ['firebase'], { encoding: 'utf8' })
  if (located.status === 0) return { command: located.stdout.trim().split(/\r?\n/)[0], prefix: [] }
  return null
}

const firebaseCli = findFirebaseCli()
if (!firebaseCli || (!emulatorsOnly && !existsSync(viteCli))) {
  console.error('[錯誤] 找不到 Firebase CLI 或 Vite。請先安裝 Firebase CLI，並執行 npm ci。')
  process.exit(1)
}

const env = {
  ...process.env,
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_PROJECT_ID: 'demo-office-lunch',
  VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1',
}
mkdirSync(path.dirname(dataDir), { recursive: true })
const emulatorArgs = [...firebaseCli.prefix, 'emulators:start', '--project', 'demo-office-lunch', '--only', 'auth,firestore,storage,functions,hosting']
if (existsSync(manifest)) {
  emulatorArgs.push('--import', dataDir)
  console.log(`[載入] 本機測試資料：${dataDir}`)
} else {
  console.log('[提示] 尚無保存的測試資料；模擬器就緒後請執行 03 建立示範帳號。')
}
const services = [['Firebase 模擬器', firebaseCli.command, emulatorArgs]]
if (!emulatorsOnly) services.push(['Vite 本地預覽', process.execPath, [viteCli]])
if (emulatorsOnly) console.log('[提示] 輸入 q 並按 Enter，會先保存資料再停止模擬器；Ctrl+C 可能中斷保存。')
const children = []
let stopping = false
let exporting = false

function stop(code) {
  if (stopping) return
  stopping = true
  process.stdin.pause()
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5000,
      })
      if (result.error || result.status !== 0) {
        console.error(`[錯誤] 無法完整停止程序 ${child.pid}，請檢查本機服務。`)
        child.kill()
      }
    } else {
      child.kill('SIGINT')
    }
  }
  process.exitCode = code
}

function hubIsReady() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 4400 })
    socket.setTimeout(1000)
    socket.once('connect', () => { socket.end(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
  })
}

function exportData() {
  return new Promise((resolve) => {
    const token = randomUUID()
    const exportTarget = path.join(root, '.local', `emulator-export-${token}`)
    const stage = path.join(root, '.local', `emulator-stage-${token}`)
    const backup = path.join(root, '.local', `emulator-backup-${token}`)
    const before = new Set(readdirSync(root).filter((name) => /^firebase-export-\d+[A-Za-z0-9]+$/.test(name)))
    let exportOutput = ''
    const child = spawn(firebaseCli.command, [...firebaseCli.prefix, 'emulators:export', exportTarget, '--project', 'demo-office-lunch', '--force'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => { exportOutput = (exportOutput + chunk.toString()).slice(-65536) })
    }
    child.once('error', (error) => {
      console.error(`[錯誤] 無法啟動 Firebase 匯出：${error.message}`)
      resolve(false)
    })
    child.once('exit', (code) => {
      // Firebase CLI can fail to rename its completed export on Windows while
      // Firestore still has a handle open. Copy the finished export instead.
      let backedUp = false
      try {
        const exported = code === 0 && existsSync(path.join(exportTarget, 'firebase-export-metadata.json'))
          ? exportTarget
          : readdirSync(root)
            .filter((name) => /^firebase-export-\d+[A-Za-z0-9]+$/.test(name) && !before.has(name))
            .map((name) => path.join(root, name))
            .find((candidate) => existsSync(path.join(candidate, 'firebase-export-metadata.json')))
        if (!exported) {
          console.error(exportOutput.trim() || '[錯誤] Firebase 未產生完整匯出資料。')
          resolve(false)
          return
        }
        cpSync(exported, stage, { recursive: true })
        if (!existsSync(path.join(stage, 'firebase-export-metadata.json'))) throw new Error('匯出資料不完整')
        if (existsSync(dataDir)) {
          cpSync(dataDir, backup, { recursive: true })
          backedUp = true
          rmSync(dataDir, { recursive: true, force: true })
        }
        cpSync(stage, dataDir, { recursive: true })
        if (!existsSync(manifest)) throw new Error('儲存後找不到匯出資訊')
        if (code !== 0) console.log('[完成] 已從完整匯出資料恢復 Windows 搬移錯誤。')
        for (const directory of new Set([exported, exportTarget, stage, backup])) {
          try { rmSync(directory, { recursive: true, force: true }) } catch { /* Saved data is already in place. */ }
        }
        resolve(true)
      } catch (error) {
        if (exportOutput.trim()) console.error(exportOutput.trim())
        console.error(`[錯誤] 無法保存 Firebase 匯出資料：${error.message}`)
        if (backedUp) {
          try {
            rmSync(dataDir, { recursive: true, force: true })
            cpSync(backup, dataDir, { recursive: true })
            console.log('[恢復] 已保留上次保存的本機資料。')
          } catch (restoreError) {
            console.error(`[錯誤] 自動恢復失敗，舊資料仍在 ${backup}：${restoreError.message}`)
          }
        }
        resolve(false)
      }
    })
  })
}

async function saveAndStop() {
  if (stopping || exporting) return
  exporting = true
  if (!(await hubIsReady())) {
    console.log('[略過] 模擬器尚未就緒，沒有可保存的資料。')
    stop(0)
    return
  }
  console.log(`[儲存] 正在保存本機測試資料至 ${dataDir}`)
  if (!(await exportData())) {
    console.error('[錯誤] 保存失敗；本機服務仍在執行。請檢查上方訊息後再輸入 q。')
    exporting = false
    return
  }
  console.log('[完成] 本機測試資料已保存，下次啟動會自動載入。')
  stop(0)
}

process.on('SIGINT', () => {
  console.log('\n[儲存] 正在停止本機服務。')
  void saveAndStop()
})
process.on('SIGTERM', () => { void saveAndStop() })
process.stdin.setEncoding('utf8')
process.stdin.on('data', (input) => {
  if (input.trim().toLowerCase() !== 'q') return
  void saveAndStop()
})
process.stdin.resume()

for (const [name, command, args] of services) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  })
  children.push(child)
  child.on('error', (error) => {
    console.error(`[錯誤] ${name} 無法啟動：${error.message}`)
    stop(1)
  })
  child.on('exit', (code, signal) => {
    if (stopping) return
    if (code === 0 || signal === 'SIGINT') {
      console.log(`[完成] ${name} 已停止。`)
      stop(0)
      return
    }
    console.error(`[錯誤] ${name} 意外結束（代碼 ${code ?? signal}）。`)
    stop(1)
  })
}
