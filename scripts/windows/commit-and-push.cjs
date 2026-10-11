// 04_測試提交並推送.bat 的實際流程。批次檔只保留 ASCII 內容：CMD 在 chcp 65001 下讀取含中文的
// 批次檔時，goto 之後可能從錯誤的位元組位置繼續執行，把半行中文當成指令。
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

const root = path.resolve(__dirname, '..', '..')
const checker = path.join(__dirname, 'check-sensitive-files.cjs')

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options })
}

// --no-pager：檔案清單超過一個畫面時，git 會開啟分頁器停在「:」等待按鍵，看起來像卡住。
function git(...args) {
  return run('git', ['--no-pager', '-c', 'core.quotepath=false', ...args])
}

function gitOutput(...args) {
  const result = run('git', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function fail(message, { unstage = false } = {}) {
  if (unstage) git('reset', '-q')
  console.error(message)
  process.exit(1)
}

function sensitiveFilesFound() {
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { stdio: ['ignore', 'pipe', 'inherit'] })
  if (files.status !== 0) return true
  return run(process.execPath, [checker], { input: files.stdout, stdio: ['pipe', 'inherit', 'inherit'] }).status !== 0
}

function runScript(name) {
  const scripts = require(path.join(root, 'package.json')).scripts || {}
  if (typeof scripts[name] !== 'string') {
    console.log(`[略過] ${name} script 不存在`)
    return true
  }
  console.log(`[執行] npm run ${name}`)
  // npm 在 Windows 是 .cmd，必須經由 shell 啟動。
  return run(`npm run ${name}`, [], { shell: true }).status === 0
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer) }))
}

function nowStamp() {
  const d = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function remoteBranchExists(branch) {
  return run('git', ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`]).status === 0
}

async function main() {
  if (!existsSync(path.join(root, 'package.json'))) fail('[錯誤] 找不到 repository root 或 package.json。')
  if (gitOutput('rev-parse', '--show-toplevel') === null) fail('[錯誤] 目前目錄不是 Git repository。')
  git('status')
  const branch = gitOutput('branch', '--show-current')
  if (!branch) fail('[錯誤] 目前不是有效的 Git branch。')
  if (gitOutput('remote', 'get-url', 'origin') === null) fail('[錯誤] 找不到 origin remote。')
  if (git('fetch', 'origin').status !== 0) fail('[錯誤] Git fetch 失敗。')
  if (remoteBranchExists(branch) && run('git', ['merge-base', '--is-ancestor', `refs/remotes/origin/${branch}`, 'HEAD']).status !== 0) {
    console.error(`[錯誤] 遠端分支有本機尚未包含的 Commit，請先人工同步，未提交也未推送：`)
    git('log', '--oneline', `HEAD..origin/${branch}`)
    fail('工作目錄乾淨時可執行 01_同步GitHub.bat；有未提交修改時，請先合併遠端變更再重新執行 04。')
  }

  for (const name of ['lint', 'test', 'build']) {
    if (!runScript(name)) fail('[錯誤] 檢查未通過，未提交也未推送。')
  }
  if (sensitiveFilesFound()) fail('[錯誤] 發現可能的敏感檔案，未暫存任何新變更。')

  console.log('[檢查] 目前可提交變更：')
  git('status', '--short')
  console.log(`即將暫存、提交目前 Git 可提交變更，並推送到 origin/${branch}。`)
  if (git('add', '-A').status !== 0) fail('[錯誤] Git 暫存失敗。')
  if (sensitiveFilesFound()) fail('[錯誤] 暫存後發現可能的敏感檔案，已取消暫存。', { unstage: true })
  git('diff', '--cached', '--name-only')
  if (run('git', ['diff', '--cached', '--quiet']).status === 0) fail('[錯誤] 沒有可提交的變更。', { unstage: true })
  git('status')

  const defaultMessage = nowStamp()
  console.log('輸入變更紀錄後按 Enter 將提交並推送；直接 Enter 使用預設日期時間。')
  const message = (await ask(`Commit Message [${defaultMessage}]：`)).trim() || defaultMessage
  if (git('commit', '-m', message).status !== 0) fail('[錯誤] Commit 失敗，未推送。')

  if (git('fetch', 'origin').status !== 0) fail('[錯誤] Commit 已保留在本機；再次 fetch 失敗，未推送。')
  if (remoteBranchExists(branch)) {
    if (git('pull', '--ff-only', 'origin', branch).status !== 0) fail('[錯誤] Commit 已保留在本機；無法 fast-forward，未推送。')
    if (git('push', 'origin', branch).status !== 0) fail('[錯誤] Push 失敗，Commit 已保留在本機。')
  } else if (git('push', '-u', 'origin', branch).status !== 0) {
    fail('[錯誤] Push 失敗，Commit 已保留在本機。')
  }

  console.log(`目前 Branch: ${branch}`)
  console.log(`Remote URL: ${gitOutput('remote', 'get-url', 'origin')}`)
  console.log(`Commit Hash: ${gitOutput('rev-parse', '--short', 'HEAD')}`)
  console.log(`最新 Commit Message: ${gitOutput('log', '-1', '--pretty=format:%s')}`)
  console.log('[完成] Commit 與 Push 已完成。')
}

main().catch(error => fail(`[錯誤] ${error.message}`))
