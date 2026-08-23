const ExcelJS = require("exceljs");

async function buildWorkbookBuffer(rows, fileReports = []) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Transactions", {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  // The first four columns are the established batch-entry paste format —
  // do not rename or reorder them.  New columns are appended to the right.
  worksheet.columns = [
    { header: "Date", key: "date" },
    { header: "clean transactions", key: "clean" },
    { header: "amount", key: "amount" },
    { header: "orginal transactons", key: "original" },
    { header: "source file", key: "sourceFile" },
    { header: "flags", key: "flags" }
  ];

  for (const row of rows) {
    const parsedDate = parseUsDate(row.date);
    const flags = Array.isArray(row.flags) ? row.flags : [];
    const excelRow = worksheet.addRow({
      date: parsedDate || row.date,
      clean: row.clean,
      amount: Number.isFinite(row.amount) ? row.amount : row.amountRaw,
      original: row.original,
      sourceFile: row.sourceFile || "",
      flags: flags.join(", ")
    });

    if (flags.includes("sign-review")) {
      excelRow.getCell(3).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF2CC" }
      };
    }
  }

  worksheet.autoFilter = { from: "A1", to: "F1" };
  worksheet.getColumn(1).numFmt = "m/d/yyyy";
  worksheet.getColumn(3).numFmt = "0.##;-0.##";

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

  autosizeColumns(worksheet, 6);

  if (fileReports.length) {
    addValidationSheet(workbook, fileReports);
  }

  return workbook.xlsx.writeBuffer();
}

// Per-statement validation results (METHOD.md §7.1): every uploaded statement
// gets a ✓/✗ against its own printed totals and balance chain, so a silently
// wrong export never looks like a correct one.
function addValidationSheet(workbook, fileReports) {
  const sheet = workbook.addWorksheet("Validation", {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  sheet.columns = [
    { header: "Source file", key: "file" },
    { header: "Check", key: "check" },
    { header: "Printed on statement", key: "printed" },
    { header: "Extracted", key: "extracted" },
    { header: "Difference", key: "delta" },
    { header: "Result", key: "result" }
  ];

  for (const report of fileReports) {
    const validation = report.validation;
    if (!validation || validation.passed === null) {
      sheet.addRow({
        file: report.fileName,
        check: "No printed totals recognized",
        result: "NOT VALIDATED"
      });
      continue;
    }

    for (const check of validation.sectionChecks || []) {
      sheet.addRow({
        file: report.fileName,
        check: check.label,
        printed: check.printed,
        extracted: check.extracted,
        delta: check.delta,
        result: check.pass ? "OK" : "FAILED"
      });
    }

    const balance = validation.balanceCheck;
    if (balance) {
      sheet.addRow({
        file: report.fileName,
        check: `Balance chain (${balance.beginning} -> ${balance.ending})`,
        printed: balance.expectedNet,
        extracted: balance.net,
        delta: balance.delta,
        result: balance.pass ? "OK" : "FAILED"
      });
    }
  }

  for (const columnIndex of [3, 4, 5]) {
    sheet.getColumn(columnIndex).numFmt = "#,##0.00;-#,##0.00";
  }

  sheet.eachRow((excelRow, rowNumber) => {
    excelRow.font = { name: "Arial", size: 10, bold: rowNumber === 1 };
    const result = String(excelRow.getCell(6).value || "");
    if (result === "FAILED") {
      excelRow.getCell(6).font = { name: "Arial", size: 10, bold: true, color: { argb: "FF9C0006" } };
    }
  });

  autosizeColumns(sheet, 6);
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
