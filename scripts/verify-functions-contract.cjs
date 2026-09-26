const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const serviceFiles = [
  'src/services/walletFunctions.js',
  'src/services/cashFunctions.js',
  'src/services/adminFunctions.js',
  'src/services/accountFunctions.js',
]
const services = serviceFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n')
const calledFunctions = [...services.matchAll(/callFunction\('([^']+)'/g)].map(match => match[1])
const exportedFunctions = require(path.join(root, 'functions/index.js'))

for (const name of calledFunctions) {
  assert.equal(typeof exportedFunctions[name], 'function', `Missing callable export: ${name}`)
}
for (const forbidden of ['firebase/firestore', 'runTransaction', 'writeBatch']) {
  assert.equal(services.includes(forbidden), false, `Sensitive client service still contains: ${forbidden}`)
}

const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'))
assert.equal(firebaseConfig.functions?.[0]?.source, 'functions', 'firebase.json does not include the Functions source')

const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
for (const collectionName of ['wallets', 'wallet_logs', 'cash_payments', 'cash_payment_logs', 'wallet_requests', 'orders']) {
  const start = rules.indexOf(`match /${collectionName}/`)
  assert.notEqual(start, -1, `Missing rules block: ${collectionName}`)
  const block = rules.slice(start, rules.indexOf('\n    }', start) + 6)
  assert.match(block, /allow create, update, delete: if false;/, `${collectionName} still permits client writes`)
}
const menuRulesStart = rules.indexOf('match /menu_images/')
const menuRulesBlock = rules.slice(menuRulesStart, rules.indexOf('\n    }', menuRulesStart) + 6)
assert.match(menuRulesBlock, /allow write: if isAdmin\(\);/, 'Menu prices are not restricted to admins')
assert.equal(rules.includes('match /surveyResponses/'), false, 'Removed survey rules are still present')
assert.equal(rules.includes('match /feedback/'), false, 'Removed feedback rules are still present')
const reactionRulesStart = rules.indexOf('match /dish_reactions/')
const reactionRulesBlock = rules.slice(reactionRulesStart, rules.indexOf('\n    }', reactionRulesStart) + 6)
assert.match(reactionRulesBlock, /allow read, write: if false;/, 'Dish reactions (removed feature) must deny all access')

const storageRules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8')
assert.match(storageRules, /match \/menu_images\/{allPaths=\*\*}/, 'Menu image Storage rules are missing')
assert.match(storageRules, /allow create, update: if isAdmin\(\)/, 'Menu image uploads are not restricted to admins')

console.log(`Verified ${calledFunctions.length} client callable contracts and protected Firestore writes.`)
process.exit(0)
