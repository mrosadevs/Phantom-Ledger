const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const { extractTransactionsFromPdf, PdfParseError } = require("./pdfParser");
const { cleanAndNormalizeTransaction } = require("./transactionCleaner");
const { buildWorkbookBuffer } = require("./excelBuilder");

dayjs.extend(customParseFormat);

const app = express();
const port = Number(process.env.PORT) || 8787;
const maxFileMb = Number(process.env.MAX_FILE_MB) || 25;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 60,
    fileSize: maxFileMb * 1024 * 1024
  }
});

app.use(cors({
  exposedHeaders: [
    "Content-Disposition",
    "X-Phantom-Summary",
    "X-Phantom-Warnings",
    "X-Phantom-Preview",
    "X-Phantom-Files"
  ]
}));

app.post("/process", upload.array("pdfs", 60), async (req, res) => {
  const files = (req.files || []).filter((file) => /\.pdf$/i.test(file.originalname));

  if (!files.length) {
    return res.status(400).json({
      error: "Upload at least one PDF file using field name \"pdfs\".",
      summary: emptySummary(0),
      warnings: []
    });
  }

  const accountType = normalizeAccountTypeOption(req.body?.accountType);

  const rawRows = [];
  const parsedFileSummaries = [];
  const parseErrors = [];
  let processedFiles = 0;

  // Duplicate source detection (byte-identical uploads) — a January statement
  // saved twice looks like a real month to the parser and emits phantom rows.
  const duplicateFileWarnings = findDuplicateFileWarnings(files);

  for (const file of files) {
    try {
      const parsed = await extractTransactionsFromPdf(file.buffer, file.originalname, { accountType });
      processedFiles += 1;

      parsedFileSummaries.push({
        fileName: file.originalname,
        transactions: parsed.transactions,
        metadata: parsed.metadata || {},
        validation: parsed.validation || null,
        warnings: parsed.warnings || []
      });

      rawRows.push(
        ...parsed.transactions.map((row) => ({
          date: normalizeDate(row.date),
          dateValue: Number.isFinite(row.dateValue)
            ? row.dateValue
            : safeDateValue(row.date),
          description: String(row.description || "").trim(),
          amount: Number(row.amount),
          flags: Array.isArray(row.flags) ? row.flags : [],
          sourceFile: file.originalname
        }))
      );
    } catch (error) {
      parseErrors.push({
        file: file.originalname,
        error: mapErrorMessage(error)
      });
    }
  }

  rawRows.sort((a, b) => a.dateValue - b.dateValue);

  const cleanedRows = rawRows
    .filter((row) => row.date && row.description && Number.isFinite(row.amount))
    .map((row) => ({
      date: normalizeDate(row.date),
      clean: cleanAndNormalizeTransaction(row.description),
      amount: row.amount,
      original: row.description,
      dateValue: row.dateValue,
      flags: row.flags,
      sourceFile: row.sourceFile
    }));

  const allWarnings = [
    ...parseErrors.map((entry) => `${entry.file}: ${entry.error}`),
    ...duplicateFileWarnings,
    ...findStatementPeriodWarnings(parsedFileSummaries),
    ...findAccountMismatchWarnings(parsedFileSummaries),
    ...collectValidationWarnings(parsedFileSummaries)
  ];

  const allAmounts = cleanedRows.map((r) => r.amount).filter(Number.isFinite);
  const fileReports = parsedFileSummaries.map(buildFileReport);
  const summary = {
    totalFiles: files.length,
    processedFiles,
    failedFiles: parseErrors.length,
    totalTransactions: cleanedRows.length,
    dateRange: buildDateRange(cleanedRows),
    totalCredits: allAmounts.filter((a) => a > 0).reduce((s, a) => s + a, 0),
    totalDebits: allAmounts.filter((a) => a < 0).reduce((s, a) => s + a, 0),
    net: allAmounts.reduce((s, a) => s + a, 0),
    creditCount: allAmounts.filter((a) => a > 0).length,
    debitCount: allAmounts.filter((a) => a < 0).length,
    reviewCount: cleanedRows.filter((r) => r.flags.includes("sign-review")).length,
    validationPassed: summarizeValidation(fileReports)
  };
  const downloadFileName = deriveDownloadFileName(parsedFileSummaries, files);

  if (!cleanedRows.length) {
    return res.status(422).json({
      error: "No transactions were extracted from the uploaded PDFs.",
      summary,
      warnings: allWarnings
    });
  }

  const workbookBuffer = await buildWorkbookBuffer(cleanedRows, fileReports);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${downloadFileName}"`);
  setEncodedHeader(res, "X-Phantom-Summary", summary);
  setEncodedHeader(res, "X-Phantom-Warnings", allWarnings);
  setEncodedHeader(res, "X-Phantom-Preview", buildPreviewTransactions(cleanedRows, 30));
  setEncodedHeader(res, "X-Phantom-Files", fileReports);

  return res.send(Buffer.from(workbookBuffer));
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(process.cwd(), "client", "dist");
  app.use(express.static(clientDist));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: `A file exceeds the ${maxFileMb}MB upload limit.`,
        summary: emptySummary(0),
        warnings: []
      });
    }

    return res.status(400).json({
      error: error.message,
      summary: emptySummary(0),
      warnings: []
    });
  }

  return res.status(500).json({
    error: "Unexpected server error.",
    summary: emptySummary(0),
    warnings: []
  });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Accuracy Phantom Ledger server running on http://localhost:${port}`);
});

function normalizeAccountTypeOption(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "credit_card" || normalized === "creditcard" || normalized === "credit-card") {
    return "credit_card";
  }
  if (normalized === "bank") {
    return "bank";
  }
  return "auto";
}

// METHOD.md §7.4 — hash the input files and warn on byte-identical uploads.
function findDuplicateFileWarnings(files) {
  const byHash = new Map();
  for (const file of files) {
    const hash = crypto.createHash("sha256").update(file.buffer).digest("hex");
    if (byHash.has(hash)) {
      byHash.get(hash).push(file.originalname);
    } else {
      byHash.set(hash, [file.originalname]);
    }
  }

  const warnings = [];
  for (const names of byHash.values()) {
    if (names.length > 1) {
      warnings.push(
        `Duplicate upload detected: ${names.join(" and ")} are byte-identical — the same statement was uploaded ${names.length} times (its transactions would otherwise be double-counted, and the month it displaced is missing).`
      );
    }
  }
  return warnings;
}

// METHOD.md §7.4 — warn on duplicate statement periods and gaps in the
// monthly sequence (a month saved twice usually means another month is missing).
function findStatementPeriodWarnings(parsedFiles) {
  const withPeriod = [];
  for (const file of parsedFiles) {
    const period = file?.metadata?.statementPeriod;
    const endDate = period?.end ? dayjs(period.end, "MM/DD/YYYY", true) : null;
    if (endDate && endDate.isValid()) {
      withPeriod.push({ fileName: file.fileName, end: endDate });
    }
  }

  if (withPeriod.length <= 1) {
    return [];
  }

  const warnings = [];
  const byMonth = new Map();
  for (const entry of withPeriod) {
    const key = entry.end.format("YYYY-MM");
    if (!byMonth.has(key)) {
      byMonth.set(key, []);
    }
    byMonth.get(key).push(entry.fileName);
  }

  for (const [month, names] of byMonth.entries()) {
    if (names.length > 1) {
      warnings.push(
        `Statement period ${month} appears in ${names.length} files (${names.join(", ")}) — check for a duplicate download.`
      );
    }
  }

  const months = Array.from(byMonth.keys()).sort();
  for (let i = 1; i < months.length; i += 1) {
    const prev = dayjs(`${months[i - 1]}-01`, "YYYY-MM-DD", true);
    const curr = dayjs(`${months[i]}-01`, "YYYY-MM-DD", true);
    const gap = curr.diff(prev, "month");
    if (gap > 1) {
      const missing = [];
      for (let step = 1; step < gap; step += 1) {
        missing.push(prev.add(step, "month").format("YYYY-MM"));
      }
      warnings.push(
        `Possible missing statement(s): no file covers ${missing.join(", ")} between ${months[i - 1]} and ${months[i]}.`
      );
    }
  }

  return warnings;
}

function collectValidationWarnings(parsedFiles) {
  const warnings = [];
  for (const file of parsedFiles) {
    for (const warning of file.warnings || []) {
      if (/^validation|^no printed control totals|flagged for sign review/i.test(warning)) {
        warnings.push(`${file.fileName}: ${warning}`);
      }
    }
  }
  return warnings;
}

function buildFileReport(file) {
  const validation = file.validation || null;
  return {
    fileName: file.fileName,
    transactions: (file.transactions || []).length,
    accountType: file.metadata?.accountType || "bank",
    statementPeriod: file.metadata?.statementPeriod || null,
    validation: validation
      ? {
        passed: validation.passed,
        checksRun: validation.checksRun,
        sectionChecks: validation.sectionChecks,
        balanceCheck: validation.balanceCheck
      }
      : null
  };
}

// true = every validated file tied to the cent; false = at least one failed;
// null = nothing could be validated.
function summarizeValidation(fileReports) {
  const validated = fileReports.filter((f) => f.validation && f.validation.passed !== null);
  if (!validated.length) {
    return null;
  }
  return validated.every((f) => f.validation.passed === true);
}

function emptySummary(totalFiles) {
  return {
    totalFiles,
    processedFiles: 0,
    failedFiles: 0,
    totalTransactions: 0,
    dateRange: null
  };
}

function mapErrorMessage(error) {
  if (error instanceof PdfParseError) {
    return error.message;
  }

  return error?.message || "Failed to parse PDF.";
}

function buildDateRange(rows) {
  if (!rows.length) {
    return null;
  }

  return {
    start: rows[0].date,
    end: rows[rows.length - 1].date
  };
}

function safeDateValue(input) {
  const parsed = dayjs(input, [
    "MM/DD/YYYY",
    "M/D/YYYY",
    "MM-DD-YYYY",
    "M-D-YYYY",
    "YYYY-MM-DD"
  ], true);

  if (parsed.isValid()) {
    return parsed.valueOf();
  }

  return Number.MAX_SAFE_INTEGER;
}

function normalizeDate(input) {
  const parsed = dayjs(input, [
    "MM/DD/YYYY",
    "M/D/YYYY",
    "MM-DD-YYYY",
    "M-D-YYYY",
    "YYYY-MM-DD",
    "MM/DD/YY",
    "M/D/YY"
  ], true);

  if (!parsed.isValid()) {
    return String(input || "").trim();
  }

  return parsed.format("MM/DD/YYYY");
}

function buildPreviewTransactions(rows, maxRows) {
  const limit = Number.isInteger(maxRows) && maxRows > 0 ? maxRows : 30;
  return (rows || []).slice(0, limit).map((row) => ({
    date: row.date,
    amount: Number(row.amount),
    description: String(row.original || row.description || ""),
    sourceFile: row.sourceFile || "",
    flags: Array.isArray(row.flags) ? row.flags : []
  }));
}

function setEncodedHeader(res, key, value) {
  const encoded = encodeHeader(value);

  if (encoded.length <= 7000) {
    res.setHeader(key, encoded);
    return;
  }

  res.setHeader(key, encodeHeader([]));
}

function encodeHeader(value) {
  return Buffer.from(JSON.stringify(value || null)).toString("base64");
}

function findAccountMismatchWarnings(parsedFiles) {
  if (!Array.isArray(parsedFiles) || parsedFiles.length <= 1) {
    return [];
  }

  const contexts = parsedFiles.map(buildAccountMatchContext);
  const withAccount = contexts.filter((context) => context.accountKeys.length > 0);

  if (withAccount.length <= 1) {
    return [];
  }

  const accountPresence = new Map();
  for (const context of withAccount) {
    for (const key of context.accountKeys) {
      accountPresence.set(key, (accountPresence.get(key) || 0) + 1);
    }
  }

  const expectedAccountKey = pickMajorityCountKey(accountPresence);
  if (!expectedAccountKey) {
    return [];
  }

  const mismatched = withAccount.filter((context) => !context.accountKeys.includes(expectedAccountKey));
  if (!mismatched.length) {
    return [];
  }

  const rawExpectedLabel = pickBestAccountLabel(
    withAccount
      .filter((context) => context.accountKeys.includes(expectedAccountKey))
      .map((context) => context.accountLabelByKey.get(expectedAccountKey))
  ) || expectedAccountKey.replace(/^LAST4:/, "");

  const expectedAccountLabel = maskAccountNumber(rawExpectedLabel);

  const mismatchDetails = mismatched.map((context) => {
    const labels = context.accountKeys
      .map((key) => maskAccountNumber(context.accountLabelByKey.get(key) || key.replace(/^LAST4:/, "")))
      .join("/");
    return `${labels} \u2192 ${context.fileName}`;
  });

  return [
    `Account mismatch detected across uploaded statements. Expected ****${expectedAccountLabel}; found ${mismatchDetails.join(" | ")}.`
  ];
}

function buildAccountMatchContext(file) {
  const accountValues = gatherAccountValues(file?.metadata?.accountCandidates, file?.transactions);
  const accountLabelByKey = new Map();

  for (const value of accountValues) {
    const key = deriveAccountMatchKey(value);
    if (!key) {
      continue;
    }

    const existingLabel = accountLabelByKey.get(key);
    if (!existingLabel || scoreAccountIdentifier(value) > scoreAccountIdentifier(existingLabel)) {
      accountLabelByKey.set(key, value);
    }
  }

  return {
    fileName: file?.fileName || "unknown.pdf",
    accountKeys: Array.from(accountLabelByKey.keys()),
    accountLabelByKey
  };
}

function gatherAccountValues(candidates, transactions) {
  const values = new Set();

  for (const value of candidates || []) {
    const normalized = normalizeIdentifierValue(value);
    if (normalized) {
      values.add(normalized);
    }
  }

  for (const transaction of transactions || []) {
    const normalized = normalizeIdentifierValue(transaction?.account);
    if (normalized) {
      values.add(normalized);
    }
  }

  return Array.from(values);
}

function normalizeIdentifierValue(value) {
  const normalized = String(value || "").trim();
  return normalized.length ? normalized : null;
}

function deriveAccountMatchKey(account) {
  const compact = String(account || "").replace(/[^A-Za-z0-9]/g, "");
  if (!compact) {
    return null;
  }

  const digits = compact.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `LAST4:${digits.slice(-4)}`;
  }

  return compact.toUpperCase();
}

function pickBestAccountLabel(values) {
  const options = Array.from(new Set((values || []).map(normalizeIdentifierValue).filter(Boolean)));
  if (!options.length) {
    return null;
  }

  options.sort((a, b) => {
    const scoreDiff = scoreAccountIdentifier(b) - scoreAccountIdentifier(a);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return a.localeCompare(b);
  });

  return options[0];
}

function scoreAccountIdentifier(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return -9999;
  }

  const digits = (normalized.match(/\d/g) || []).length;
  const masks = (normalized.match(/[xX*]/g) || []).length;
  const letters = (normalized.match(/[A-WYZa-wyz]/g) || []).length;
  const onlyDigits = /^[0-9]+$/.test(normalized);

  let score = 0;
  score += digits * 4;
  score -= masks * 3;
  score -= letters * 2;
  score += Math.min(normalized.length, 20);

  if (onlyDigits) {
    score += 20;
  }

  return score;
}

function pickMajorityCountKey(countMap) {
  let selectedKey = null;
  let selectedCount = -1;

  for (const [key, count] of countMap.entries()) {
    if (count > selectedCount) {
      selectedKey = key;
      selectedCount = count;
    }
  }

  return selectedKey;
}

function deriveDownloadFileName() {
  return "AccuracyPhantomLedgerExport.xlsx";
}

function maskAccountNumber(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 5) {
    return digits.slice(-4);
  }
  // If 4 or fewer digits, it's already short enough
  return raw;
}

function normalizeDisplayName(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return normalized.replace(/\s+(statement|monthly summary|account summary).*$/i, "").trim();
}

function toSafeFileName(value) {
  const safe = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  return safe || "accuracy-phantom-ledger";
}
