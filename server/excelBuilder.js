const ExcelJS = require("exceljs");

async function buildWorkbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Transactions", {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  worksheet.columns = [
    { header: "Date", key: "date" },
    { header: "clean transactions", key: "clean" },
    { header: "amount", key: "amount" },
    { header: "orginal transactons", key: "original" }
  ];

  for (const row of rows) {
    worksheet.addRow({
      date: row.date,
      clean: row.clean,
      amount: Number.isFinite(row.amount) ? row.amount : row.amountRaw,
      original: row.original
    });
  }

  worksheet.autoFilter = { from: "A1", to: "D1" };
  worksheet.getColumn(3).numFmt = "#,##0.00;-#,##0.00";

  worksheet.eachRow((excelRow, rowNumber) => {
    excelRow.font = {
      name: "Arial",
      size: 10,
      bold: rowNumber === 1
    };

    excelRow.alignment = {
      vertical: "top"
    };
  });

  autosizeColumns(worksheet, 4);

  return workbook.xlsx.writeBuffer();
}

function autosizeColumns(worksheet, count) {
  for (let columnIndex = 1; columnIndex <= count; columnIndex += 1) {
    let maxLength = 10;

    worksheet.getColumn(columnIndex).eachCell({ includeEmpty: true }, (cell) => {
      const text = cell?.value == null ? "" : String(cell.value);
      maxLength = Math.max(maxLength, Math.min(120, text.length + 2));
    });

    worksheet.getColumn(columnIndex).width = maxLength;
  }
}

module.exports = {
  buildWorkbookBuffer
};
