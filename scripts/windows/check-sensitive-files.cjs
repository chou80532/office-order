const { readFileSync } = require('node:fs')

const forbidden = [
  /(^|\/)\.env(?:$|\.(?!example$))/i,
  /(^|\/)OPENAI_APPLICATION_DRAFT\.md$/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /(?:service[-_ ]?account|credentials?|private[-_ ]?key)/i,
  /(?:^|[/._-])(?:backup|backups|logs?)(?:$|[/._-])/i,
  /(?:production|prod)[-_ ]?(?:database|db)[-_ ]?(?:dump|backup)/i,
  /(?:database|db)[-_ ]?(?:dump|backup)/i,
  /(?:production|prod).*dump/i,
  /\.(?:sql|sqlite|db|dump|bak)$/i,
]

const matches = readFileSync(0, 'utf8').split('\0').filter(Boolean).filter((path) => {
  const normalized = path.replaceAll('\\', '/')
  return forbidden.some((pattern) => pattern.test(normalized))
})

if (matches.length) {
  console.error('[錯誤] 發現可能的敏感檔案，請人工檢查：')
  for (const path of matches) console.error(`  ${path}`)
  process.exit(1)
}
console.log('[完成] Git 檔案名稱安全檢查通過。')
