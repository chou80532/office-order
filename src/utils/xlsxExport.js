const colors = {
  navy: 'FF24324A',
  blue: 'FF3F6F8F',
  header: 'FFE8EEF5',
  border: 'FFD7DEE8',
  text: 'FF253247',
  muted: 'FF6B7688',
  positive: 'FF2E8B67',
  negative: 'FFD9534F',
}

let excelJsPromise = null

async function loadExcelJS() {
  excelJsPromise ||= import('exceljs')
  const module = await excelJsPromise
  return module.default || module
}

const thinBorder = {
  top: { style: 'thin', color: { argb: colors.border } },
  left: { style: 'thin', color: { argb: colors.border } },
  bottom: { style: 'thin', color: { argb: colors.border } },
  right: { style: 'thin', color: { argb: colors.border } },
}

function styleSheet(sheet, config) {
  const { columns, rows, title, subtitle = '', summary = [], signedAmountKey = '' } = config
  const lastColumn = Math.max(columns.length, 1)

  sheet.mergeCells(1, 1, 1, lastColumn)
  const titleCell = sheet.getCell(1, 1)
  titleCell.value = title
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getRow(1).height = 28

  sheet.mergeCells(2, 1, 2, lastColumn)
  const subtitleCell = sheet.getCell(2, 1)
  subtitleCell.value = subtitle
  subtitleCell.font = { size: 10, color: { argb: colors.muted } }
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getRow(2).height = 20

  summary.forEach((item, index) => {
    const labelColumn = index * 2 + 1
    if (labelColumn > lastColumn) return
    const valueColumn = Math.min(labelColumn + 1, lastColumn)
    const labelCell = sheet.getCell(4, labelColumn)
    const valueCell = sheet.getCell(4, valueColumn)
    labelCell.value = item.label
    valueCell.value = Number(item.value) || 0
    labelCell.font = { bold: true, color: { argb: colors.muted } }
    valueCell.font = { bold: true, color: { argb: colors.text } }
    valueCell.numFmt = '#,##0;[Red]-#,##0;0'
    labelCell.fill = valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F7FA' } }
    labelCell.border = valueCell.border = thinBorder
  })

  const headerRowNumber = 6
  const headerRow = sheet.getRow(headerRowNumber)
  headerRow.values = columns.map(column => column.header)
  headerRow.height = 22
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: colors.text } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } }
    cell.border = thinBorder
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  rows.forEach(record => {
    const row = sheet.addRow(columns.map(column => record[column.key] ?? ''))
    row.eachCell((cell, columnNumber) => {
      const column = columns[columnNumber - 1]
      cell.border = thinBorder
      cell.alignment = {
        vertical: 'top',
        horizontal: column.align || (column.numFmt ? 'right' : 'left'),
        wrapText: Boolean(column.wrapText),
      }
      if (column.numFmt) cell.numFmt = column.numFmt
    })

    if (signedAmountKey) {
      const amountColumn = columns.findIndex(column => column.key === signedAmountKey) + 1
      const amount = Number(record[signedAmountKey]) || 0
      if (amountColumn > 0 && amount !== 0) {
        row.getCell(amountColumn).font = {
          bold: true,
          color: { argb: amount > 0 ? colors.positive : colors.negative },
        }
      }
    }
  })

  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width || 14
  })

  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: lastColumn },
  }
  sheet.views = [{
    state: 'frozen',
    ySplit: headerRowNumber,
    activeCell: `A${headerRowNumber + 1}`,
    showGridLines: false,
  }]
  sheet.properties.defaultRowHeight = 18
}

export async function buildXlsxBuffer({ sheets }) {
  const ExcelJS = await loadExcelJS()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Office Order'
  workbook.created = new Date()
  workbook.modified = new Date()

  sheets.forEach(config => {
    const sheet = workbook.addWorksheet(config.name, {
      properties: { defaultRowHeight: 18 },
      views: [{ showGridLines: false }],
    })
    styleSheet(sheet, config)
  })

  return workbook.xlsx.writeBuffer()
}

export async function downloadXlsx({ filename, sheets }) {
  const buffer = await buildXlsxBuffer({ sheets })
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
