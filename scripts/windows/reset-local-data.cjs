const { existsSync, lstatSync, readFileSync, realpathSync, rmSync } = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const readline = require('node:readline')

const root = realpathSync(path.resolve(__dirname, '..', '..'))
const localDir = path.resolve(root, '.local')
const dataDir = path.resolve(localDir, 'emulator-data')
const ports = [4400, 9099, 8080, 9199, 5001, 5000, 4000]

function isWithinRoot(target) {
  const relative = path.relative(root, target)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function checkPaths() {
  const packageFile = path.join(root, 'package.json')
  const firebaseFile = path.join(root, 'firebase.json')
  if (!existsSync(packageFile) || !existsSync(firebaseFile)) throw new Error('找不到開源專案的 package.json 或 firebase.json。')
  const packageInfo = JSON.parse(readFileSync(packageFile, 'utf8'))
  if (packageInfo.name !== 'office-order') throw new Error('目前目錄不是 Office Order 開源專案。')
  if (path.dirname(localDir) !== root || path.dirname(dataDir) !== localDir || !isWithinRoot(dataDir)) {
    throw new Error('本機資料路徑不在開源專案內。')
  }
  if (existsSync(localDir)) {
    if (lstatSync(localDir).isSymbolicLink() || !isWithinRoot(realpathSync(localDir))) {
      throw new Error('.local 不能是指向其他位置的連結。')
    }
  }
  if (existsSync(dataDir)) {
    const info = lstatSync(dataDir)
    if (!info.isDirectory() || info.isSymbolicLink() || !isWithinRoot(realpathSync(dataDir))) {
      throw new Error('Emulator 資料目錄不安全，已停止重建。')
    }
  }
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.setTimeout(800)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
  })
}

async function ensureEmulatorsStopped() {
  const results = await Promise.all(ports.map(portIsOpen))
  const active = ports.filter((_, index) => results[index])
  if (active.length) throw new Error(`本機服務仍在執行（連接埠 ${active.join(', ')}）。請先在 02 輸入 q 關閉。`)
}

function askConfirmation() {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    input.question('確定只刪除上述本機測試資料，請輸入 RESET：', (answer) => {
      input.close()
      resolve(answer === 'RESET')
    })
  })
}

async function main() {
  checkPaths()
  await ensureEmulatorsStopped()
  console.log('Office Order - 重建本機測試資料')
  console.log(`只會刪除：${dataDir}`)
  console.log('公開 Git、私人正式版與正式 Firebase 不會被修改。')
  if (!existsSync(dataDir)) {
    console.log('[資訊] 目前沒有保存的 Emulator 測試資料。')
  } else if (!(await askConfirmation())) {
    console.log('[取消] 本機測試資料未修改。')
    return
  } else {
    checkPaths()
    await ensureEmulatorsStopped()
    rmSync(dataDir, { recursive: true, force: true })
    console.log('[完成] 已清除本機 Emulator 測試資料。')
  }
  console.log('下一步：啟動 02，待模擬器就緒後執行 03 建立新的示範帳號與菜單。')
}

main().catch((error) => {
  console.error(`[錯誤] ${error.message}`)
  process.exitCode = 1
})
