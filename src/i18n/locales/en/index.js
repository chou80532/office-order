// 每個檔案是一個區塊（例如 cart.js → t('cart.*')），新增檔案會自動合併進來。
const modules = import.meta.glob(['./*.js', '!./index.js'], { eager: true, import: 'default' })

export default Object.fromEntries(Object.entries(modules)
  .map(([path, messages]) => [path.replace(/^\.\/|\.js$/g, ''), messages]))
