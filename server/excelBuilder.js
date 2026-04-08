const ExcelJS = require("exceljs");

async function buildWorkbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Transactions", {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  // Include GL columns only if at least one row was matched
  const hasGL = rows.some((r) => r.glAccount);

  worksheet.columns = [
    { header: "Date", key: "date" },
    { header: "clean transactions", key: "clean" },
    { header: "amount", key: "amount" },
    { header: "orginal transactons", key: "original" },
    ...(hasGL ? [
      { header: "GL Account", key: "glAccount" },
      { header: "GL Vendor", key: "glVendor" },
    ] : []),
  ];

  for (const row of rows) {
    const parsedDate = parseUsDate(row.date);
    const dataRow = {
      date: parsedDate || row.date,
      clean: row.clean,
      amount: Number.isFinite(row.amount) ? row.amount : row.amountRaw,
      original: row.original,
    };
    if (hasGL) {
      dataRow.glAccount = row.glAccount || "";
      dataRow.glVendor = row.glVendor || "";
    }
    worksheet.addRow(dataRow);
  }

  const colCount = hasGL ? 6 : 4;
  const lastCol = hasGL ? "F" : "D";
  worksheet.autoFilter = { from: "A1", to: `${lastCol}1` };
  worksheet.getColumn(1).numFmt = "m/d/yyyy";
  worksheet.getColumn(3).numFmt = "0.##;-0.##";

  // Light green fill for GL Account column header to signal it's auto-filled
  if (hasGL) {
    const glAccountHeader = worksheet.getRow(1).getCell(5);
    glAccountHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
    const glVendorHeader = worksheet.getRow(1).getCell(6);
    glVendorHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
  }

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

  autosizeColumns(worksheet, colCount);

  return workbook.xlsx.writeBuffer();
}

function parseUsDate(input) {
  const match = String(input || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || !Number.isInteger(year)) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
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
