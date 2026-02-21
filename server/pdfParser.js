const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

dayjs.extend(customParseFormat);

const AMOUNT_TOKEN_SOURCE = "\\(?-?\\$?\\s*\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})\\)?\\s*(?:CR|DR)?";
const AMOUNT_TOKEN_REGEX = new RegExp(AMOUNT_TOKEN_SOURCE, "gi");
const AMOUNT_LOOKUP_REGEX = new RegExp(`^${AMOUNT_TOKEN_SOURCE}$`, "i");
const AMOUNT_SEARCH_REGEX = new RegExp(AMOUNT_TOKEN_SOURCE, "i");
const TRAILING_AMOUNTS_REGEX = new RegExp(`(?:\\s*${AMOUNT_TOKEN_SOURCE})+$`, "i");
const DATE_PATTERNS = [
  /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/,
  /^\d{1,2}[/-]\d{1,2}(?![/-]\d)/,
  /^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}/,
  /^\d{8}/
];
const INLINE_DATE_PATTERN = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g;
const FOOTER_PATTERNS = [
  /ending balance/i,
  /beginning balance/i,
  /account summary/i,
  /daily balance/i,
  /total (?:debits|credits|fees|withdrawals|deposits|payments)/i,
  /page\s+\d+(?:\s+of\s+\d+)?/i,
  /continued on (?:the )?next page/i,
  /member fdic/i,
  /^§?\s*page\s+\d+\s+of\s+\d+/i,
  /account security you can see/i,
  /security meter level/i,
  /to learn more, visit/i,
  /message and data rates may apply/i,
  /monthly service fee summary/i
];
const NON_TRANSACTION_DESCRIPTION_PATTERNS = [
  /prfd?\s+rwds\s+for\s+bus-?wire\s+fee\s+waiver/i
];

class PdfParseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PdfParseError";
    this.code = code;
  }
}

async function extractTransactionsFromPdf(buffer, fileName) {
  if (!buffer || !buffer.length) {
    throw new PdfParseError("EMPTY_FILE", "File is empty.");
  }

  let document;
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
      stopAtErrors: false
    });
    document = await loadingTask.promise;
  } catch (error) {
    if (isPasswordError(error)) {
      throw new PdfParseError(
        "PASSWORD_PROTECTED",
        "Password-protected PDF cannot be processed."
      );
    }
    throw new PdfParseError("OPEN_FAILED", `Could not read PDF (${fileName}).`);
  }

  let totalTextCharacters = 0;
  let currentAccount = null;
  const pageCollection = [];
  const parsedRows = [];
  const warnings = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const lines = await extractPageLines(page, pageNumber);

    if (!lines.length) {
      continue;
    }

    totalTextCharacters += lines.reduce((sum, line) => sum + line.text.length, 0);
    pageCollection.push(lines);
  }

  const dateContext = inferDateContext(pageCollection.flat());

  for (let index = 0; index < pageCollection.length; index += 1) {
    const lines = pageCollection[index];
    const pageNumber = index + 1;

    for (const line of lines) {
      const accountLabel = detectAccountLabel(line.text);
      if (accountLabel) {
        currentAccount = accountLabel;
      }
      line.account = currentAccount;
    }

    const pageResult = parsePageTransactions(lines, { dateContext });
    if (!pageResult.rows.length && lines.length) {
      warnings.push(`Page ${pageNumber}: no transactions recognized.`);
    }

    parsedRows.push(...pageResult.rows);
  }

  if (totalTextCharacters < 40) {
    throw new PdfParseError(
      "IMAGE_BASED",
      "No extractable text found. The PDF appears image-based and requires OCR."
    );
  }

  if (!parsedRows.length) {
    warnings.push("No transactions were detected in this statement.");
  }

  const metadata = collectDocumentMetadata(pageCollection, parsedRows);

  return { transactions: parsedRows, warnings, metadata };
}

async function extractPageLines(page, pageNumber) {
  const content = await page.getTextContent({
    normalizeWhitespace: true,
    disableCombineTextItems: false
  });

  const rawItems = (content.items || [])
    .map((item) => {
      const text = String(item.str || "").trim();
      if (!text) {
        return null;
      }

      return {
        str: text,
        x: item.transform[4],
        y: item.transform[5],
        width: Number(item.width) || 0
      };
    })
    .filter(Boolean);

  if (!rawItems.length) {
    return [];
  }

  rawItems.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 1) {
      return b.y - a.y;
    }
    return a.x - b.x;
  });

  const lineTolerance = 2.4;
  const grouped = [];

  for (const item of rawItems) {
    let target = grouped.find((line) => Math.abs(line.y - item.y) <= lineTolerance);
    if (!target) {
      target = { y: item.y, chunks: [] };
      grouped.push(target);
    }
    target.chunks.push(item);
  }

  grouped.sort((a, b) => b.y - a.y);

  return grouped
    .map((line) => {
      line.chunks.sort((a, b) => a.x - b.x);
      return {
        pageNumber,
        y: line.y,
        chunks: line.chunks,
        text: joinLineChunks(line.chunks)
      };
    })
    .filter((line) => line.text.length > 0);
}

function joinLineChunks(chunks) {
  let output = "";
  let previousRightEdge = null;

  for (const chunk of chunks) {
    if (!chunk?.str) {
      continue;
    }

    if (previousRightEdge !== null && chunk.x - previousRightEdge > 2.5) {
      output += " ";
    }

    if (output && !output.endsWith(" ")) {
      output += " ";
    }

    output += chunk.str;
    previousRightEdge = chunk.x + Math.max(chunk.width, chunk.str.length * 2.4);
  }

  return normalizeSpaces(output);
}

function parsePageTransactions(lines, context) {
  const rows = [];
  let capture = false;
  let pending = null;
  let sectionSign = 0;
  let headerHints = createHeaderHints();

  for (const line of lines) {
    const text = normalizeSpaces(line.text);
    const lower = text.toLowerCase();
    const inferredSectionSign = inferSectionSign(text);
    if (inferredSectionSign !== null) {
      sectionSign = inferredSectionSign;
    }

    if (isHeaderLine(lower)) {
      capture = true;
      headerHints = mergeHeaderHints(headerHints, inferHeaderHints(line));
      const headerSectionSign = inferSectionSign(text);
      if (headerSectionSign !== null) {
        sectionSign = headerSectionSign;
      }
      if (pending) {
        pushPendingRow(rows, pending);
        pending = null;
      }
      continue;
    }

    if (isFooterLine(lower)) {
      capture = false;
      if (pending) {
        pushPendingRow(rows, pending);
        pending = null;
      }
      continue;
    }

    const dateToken = extractLeadingDate(text);
    const hasAmount = lineHasAmountToken(line);
    const dateCount = countDateTokens(text);
    const canUseFallbackWithoutHeader = !capture
      && hasAmount
      && dateCount === 1
      && !isLikelySummaryLine(text);

    if (dateToken && (capture || canUseFallbackWithoutHeader)) {
      if (pending) {
        pushPendingRow(rows, pending);
      }

      pending = parseTransactionLine(line, dateToken, headerHints, context, sectionSign);
      continue;
    }

    if (pending && shouldAppendDescription(line, capture, headerHints)) {
      pending.description = normalizeSpaces(`${pending.description} ${text}`);
    }
  }

  if (pending) {
    pushPendingRow(rows, pending);
  }

  return {
    rows: rows.filter(
      (row) => row && row.date && row.description && Number.isFinite(row.amount)
    )
  };
}

function parseTransactionLine(line, dateToken, headerHints, context, sectionSign) {
  const normalizedDate = normalizeDate(dateToken.raw, context?.dateContext);
  if (!normalizedDate) {
    return null;
  }

  const startIndex = line.text.indexOf(dateToken.raw);
  let rawRemainder = line.text.slice(startIndex + dateToken.raw.length).trim();
  rawRemainder = stripRepeatedLeadingDate(rawRemainder, normalizedDate.normalized, context?.dateContext);
  if (!rawRemainder) {
    return null;
  }

  const amountResult = extractAmount(line, rawRemainder, headerHints);
  if (!Number.isFinite(amountResult.amount)) {
    return null;
  }

  let description = rawRemainder.replace(TRAILING_AMOUNTS_REGEX, "").trim();
  if (!description) {
    description = rawRemainder.replace(amountResult.rawToken || "", "").trim();
  }
  description = description
    .replace(/^\d{1,2}[/-]\d{1,2}\s+/, "")
    .trim();

  description = normalizeSpaces(description);
  if (!description) {
    return null;
  }

  let finalAmount = amountResult.amount;
  if (!amountResult.explicitSign) {
    finalAmount = applySectionSign(finalAmount, description, sectionSign);
  }

  description = sanitizeTransactionDescription(description, finalAmount);
  if (!description) {
    return null;
  }

  if (isNonTransactionDescription(description, finalAmount)) {
    return null;
  }

  return {
    date: normalizedDate.normalized,
    dateValue: normalizedDate.value,
    description,
    amount: finalAmount,
    account: line.account || null
  };
}

function pushPendingRow(rows, row) {
  if (!row) {
    return;
  }

  const description = sanitizeTransactionDescription(row.description, row.amount);
  if (!description) {
    return;
  }

  if (isNonTransactionDescription(description, row.amount)) {
    return;
  }

  rows.push({
    ...row,
    description
  });
}

function extractAmount(line, remainderText, headerHints) {
  const byColumns = headerHints.hasBalance
    ? null
    : extractAmountFromColumns(line, headerHints);
  if (byColumns) {
    return byColumns;
  }

  const amountTokens = getAmountTokens(remainderText);
  if (!amountTokens.length) {
    return { amount: Number.NaN, rawToken: null, explicitSign: false };
  }

  const parsedTokens = amountTokens.map((rawToken) => ({
    rawToken,
    naturalValue: parseAmountToken(rawToken)
  }));

  if (headerHints.hasDebitCredit) {
    let workingTokens = parsedTokens;
    if (headerHints.hasBalance && workingTokens.length > 1) {
      workingTokens = workingTokens.slice(0, -1);
    }

    if (workingTokens.length >= 2) {
      const debitToken = workingTokens[0];
      const creditToken = workingTokens[1];
      const debitValue = parseAmountToken(debitToken.rawToken, "debit");
      const creditValue = parseAmountToken(creditToken.rawToken, "credit");
      const debitIsZero = almostZero(debitValue);
      const creditIsZero = almostZero(creditValue);

      if (!debitIsZero && creditIsZero) {
        return { amount: debitValue, rawToken: debitToken.rawToken, explicitSign: true };
      }
      if (debitIsZero && !creditIsZero) {
        return { amount: creditValue, rawToken: creditToken.rawToken, explicitSign: true };
      }

      return { amount: debitValue, rawToken: debitToken.rawToken, explicitSign: true };
    }
  }

  if (headerHints.hasBalance && parsedTokens.length >= 2) {
    const candidate = parsedTokens[parsedTokens.length - 2];
    return {
      amount: candidate.naturalValue,
      rawToken: candidate.rawToken,
      explicitSign: tokenHasExplicitSign(candidate.rawToken)
    };
  }

  const lastToken = parsedTokens[parsedTokens.length - 1];
  return {
    amount: lastToken.naturalValue,
    rawToken: lastToken.rawToken,
    explicitSign: tokenHasExplicitSign(lastToken.rawToken)
  };
}

function extractAmountFromColumns(line, headerHints) {
  if (!line?.chunks?.length) {
    return null;
  }

  const amountChunks = line.chunks.filter((chunk) => AMOUNT_LOOKUP_REGEX.test(chunk.str));
  if (!amountChunks.length) {
    return null;
  }

  if (headerHints.debitX !== null || headerHints.creditX !== null) {
    const debitMatch = headerHints.debitX !== null
      ? nearestChunk(amountChunks, headerHints.debitX)
      : null;
    const creditMatch = headerHints.creditX !== null
      ? nearestChunk(amountChunks, headerHints.creditX)
      : null;

    const threshold = 64;
    const debitWithin = debitMatch && Math.abs(debitMatch.x - headerHints.debitX) <= threshold;
    const creditWithin = creditMatch && Math.abs(creditMatch.x - headerHints.creditX) <= threshold;

    if (debitWithin && !creditWithin) {
      return {
        amount: parseAmountToken(debitMatch.str, "debit"),
        rawToken: debitMatch.str,
        explicitSign: true
      };
    }

    if (creditWithin && !debitWithin) {
      return {
        amount: parseAmountToken(creditMatch.str, "credit"),
        rawToken: creditMatch.str,
        explicitSign: true
      };
    }

    if (debitWithin && creditWithin) {
      const debitDistance = Math.abs(debitMatch.x - headerHints.debitX);
      const creditDistance = Math.abs(creditMatch.x - headerHints.creditX);

      if (debitMatch === creditMatch && Math.abs(debitDistance - creditDistance) < 8) {
        return null;
      }

      if (debitDistance < creditDistance) {
        return {
          amount: parseAmountToken(debitMatch.str, "debit"),
          rawToken: debitMatch.str,
          explicitSign: true
        };
      }

      if (creditDistance < debitDistance) {
        return {
          amount: parseAmountToken(creditMatch.str, "credit"),
          rawToken: creditMatch.str,
          explicitSign: true
        };
      }

      const debitValue = parseAmountToken(debitMatch.str, "debit");
      const creditValue = parseAmountToken(creditMatch.str, "credit");

      if (!almostZero(debitValue) && almostZero(creditValue)) {
        return { amount: debitValue, rawToken: debitMatch.str, explicitSign: true };
      }
      if (almostZero(debitValue) && !almostZero(creditValue)) {
        return { amount: creditValue, rawToken: creditMatch.str, explicitSign: true };
      }

      return { amount: debitValue, rawToken: debitMatch.str, explicitSign: true };
    }
  }

  if (headerHints.amountX !== null) {
    const amountMatch = nearestChunk(amountChunks, headerHints.amountX);
    if (amountMatch && Math.abs(amountMatch.x - headerHints.amountX) <= 90) {
      return {
        amount: parseAmountToken(amountMatch.str),
        rawToken: amountMatch.str,
        explicitSign: tokenHasExplicitSign(amountMatch.str)
      };
    }
  }

  return null;
}

function nearestChunk(chunks, targetX) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const chunk of chunks) {
    const distance = Math.abs(chunk.x - targetX);
    if (distance < bestDistance) {
      best = chunk;
      bestDistance = distance;
    }
  }

  return best;
}

function parseAmountToken(rawToken, forceSign) {
  if (!rawToken) {
    return Number.NaN;
  }

  const token = String(rawToken).trim();
  if (!token) {
    return Number.NaN;
  }

  const hasDr = /DR/i.test(token);
  const hasParentheses = token.includes("(") && token.includes(")");
  const hasMinus = /^\s*-/.test(token);
  const isNegative = hasDr || hasParentheses || hasMinus;

  const cleaned = token
    .replace(/CR|DR/gi, "")
    .replace(/[\s$,()]/g, "")
    .replace(/,/g, "");

  const absolute = Number.parseFloat(cleaned);
  if (!Number.isFinite(absolute)) {
    return Number.NaN;
  }

  if (forceSign === "debit") {
    return -Math.abs(absolute);
  }

  if (forceSign === "credit") {
    return Math.abs(absolute);
  }

  return isNegative ? -Math.abs(absolute) : Math.abs(absolute);
}

function normalizeDate(dateText, dateContext) {
  const raw = String(dateText || "").trim();
  if (!raw) {
    return null;
  }

  if (/^\d{1,2}[/-]\d{1,2}$/.test(raw)) {
    const inferredDate = parseDateWithoutYear(raw, dateContext);
    if (!inferredDate) {
      return null;
    }

    return {
      normalized: inferredDate.format("MM/DD/YYYY"),
      value: inferredDate.valueOf()
    };
  }

  let parsed = dayjs(raw, [
    "MM/DD/YYYY",
    "M/D/YYYY",
    "MM/DD/YY",
    "M/D/YY",
    "MM-DD-YYYY",
    "M-D-YYYY",
    "MM-DD-YY",
    "M-D-YY",
    "MMM D, YYYY",
    "MMMM D, YYYY",
    "YYYYMMDD"
  ], true);

  if (!parsed.isValid() && /^\d{8}$/.test(raw)) {
    parsed = dayjs(raw, "YYYYMMDD", true);
  }

  if (!parsed.isValid()) {
    return null;
  }

  return {
    normalized: parsed.format("MM/DD/YYYY"),
    value: parsed.valueOf()
  };
}

function extractLeadingDate(lineText) {
  const trimmed = String(lineText || "").trimStart();
  for (const pattern of DATE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { raw: match[0] };
    }
  }
  return null;
}

function lineHasAmountToken(line) {
  return AMOUNT_SEARCH_REGEX.test(line.text);
}

function shouldAppendDescription(line, capture, headerHints) {
  if (!capture) {
    return false;
  }

  const text = normalizeSpaces(line.text);
  if (!text) {
    return false;
  }

  if (extractLeadingDate(text)) {
    return false;
  }

  if (isHeaderLine(text.toLowerCase()) || isFooterLine(text.toLowerCase())) {
    return false;
  }

  if (lineHasAmountToken(line)) {
    return false;
  }

  if (isLikelyNoiseLine(text)) {
    return false;
  }

  if (headerHints.descriptionX !== null) {
    const firstX = line.chunks?.[0]?.x ?? 0;
    if (firstX < headerHints.descriptionX - 15) {
      return false;
    }
  }

  if (/^(?:total|subtotal|balance|page\s+\d+)/i.test(text)) {
    return false;
  }

  return true;
}

function isHeaderLine(lowerText) {
  if (!lowerText || lowerText.length > 150) {
    return false;
  }

  const compact = compactLetters(lowerText);
  const hasDate = /\bdate\b/.test(lowerText) || compact.includes("date");
  const hasDescription = /(description|memo|transaction|details|narrative|activity)/.test(lowerText)
    || compact.includes("description")
    || compact.includes("transactionhistory");
  const hasAmount = /(amount|debit|credit|withdrawal|deposit|balance)/.test(lowerText)
    || compact.includes("amount")
    || compact.includes("debit")
    || compact.includes("credit")
    || compact.includes("balance");

  return hasDate && hasDescription && hasAmount;
}

function isFooterLine(lowerText) {
  return FOOTER_PATTERNS.some((pattern) => pattern.test(lowerText));
}

function detectAccountLabel(lineText) {
  const explicitMatch = lineText.match(/(?:account|acct)\s*(?:number|no\.?|#)?\s*[:\-]?\s*([Xx*\d\-]{4,})/i);
  if (explicitMatch) {
    const normalized = normalizeAccountToken(explicitMatch[1]);
    if (normalized) {
      return normalized;
    }
  }

  const typedMatch = lineText.match(
    /\b(?:checking|savings|business\s+checking|money\s*market)\b.*?([Xx*\d\-]{4,})/i
  );
  if (typedMatch) {
    const normalized = normalizeAccountToken(typedMatch[1]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function inferHeaderHints(line) {
  const hints = createHeaderHints();
  const lower = normalizeSpaces(line.text.toLowerCase());
  const compact = compactLetters(lower);

  hints.hasDebitCredit = /(debit|withdrawal)/.test(lower) && /(credit|deposit)/.test(lower);
  if (!hints.hasDebitCredit && compact.includes("creditsdebits")) {
    hints.hasDebitCredit = true;
  }
  hints.hasBalance = /\bbalance\b/.test(lower);
  if (!hints.hasBalance && compact.includes("balance")) {
    hints.hasBalance = true;
  }

  for (const chunk of line.chunks || []) {
    const text = normalizeSpaces(chunk.str.toLowerCase());
    const textCompact = compactLetters(text);

    if (hints.dateX === null && (/\bdate\b/.test(text) || textCompact.includes("date"))) {
      hints.dateX = chunk.x;
    }
    if (
      hints.descriptionX === null
      && (
        /(description|memo|transaction|details|narrative|activity)/.test(text)
        || textCompact.includes("description")
      )
    ) {
      hints.descriptionX = chunk.x;
    }
    if (hints.debitX === null && (/(debit|withdrawal)/.test(text) || textCompact.includes("debit"))) {
      hints.debitX = chunk.x;
    }
    if (hints.creditX === null && (/(credit|deposit)/.test(text) || textCompact.includes("credit"))) {
      hints.creditX = chunk.x;
    }
    if (hints.amountX === null && (/\bamount\b/.test(text) || textCompact.includes("amount"))) {
      hints.amountX = chunk.x;
    }
    if (hints.balanceX === null && (/\bbalance\b/.test(text) || textCompact.includes("balance"))) {
      hints.balanceX = chunk.x;
    }
  }

  return hints;
}

function createHeaderHints() {
  return {
    hasDebitCredit: false,
    hasBalance: false,
    dateX: null,
    descriptionX: null,
    debitX: null,
    creditX: null,
    amountX: null,
    balanceX: null
  };
}

function mergeHeaderHints(base, incoming) {
  return {
    hasDebitCredit: base.hasDebitCredit || incoming.hasDebitCredit,
    hasBalance: base.hasBalance || incoming.hasBalance,
    dateX: base.dateX ?? incoming.dateX,
    descriptionX: base.descriptionX ?? incoming.descriptionX,
    debitX: base.debitX ?? incoming.debitX,
    creditX: base.creditX ?? incoming.creditX,
    amountX: base.amountX ?? incoming.amountX,
    balanceX: base.balanceX ?? incoming.balanceX
  };
}

function normalizeSpaces(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getAmountTokens(text) {
  const regex = new RegExp(AMOUNT_TOKEN_SOURCE, "gi");
  return Array.from(String(text || "").matchAll(regex)).map((match) => match[0]);
}

function tokenHasExplicitSign(rawToken) {
  const token = String(rawToken || "");
  return /\b(?:CR|DR)\b/i.test(token)
    || token.includes("(")
    || token.includes(")")
    || /^\s*-/.test(token);
}

function parseDateWithoutYear(rawDate, dateContext) {
  const match = String(rawDate || "").match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  let year = dateContext?.anchorYear || dayjs().year();
  if (dateContext?.anchorMonth) {
    if (month - dateContext.anchorMonth > 6) {
      year -= 1;
    } else if (dateContext.anchorMonth - month > 6) {
      year += 1;
    }
  }

  const parsed = dayjs(`${month}/${day}/${year}`, "M/D/YYYY", true);
  return parsed.isValid() ? parsed : null;
}

function inferDateContext(lines) {
  const yearHints = [];

  for (const line of lines || []) {
    const text = normalizeSpaces(line.text || "");
    const matches = text.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g) || [];
    for (const match of matches) {
      const normalized = normalizeDate(match);
      if (normalized) {
        yearHints.push(dayjs(normalized.normalized, "MM/DD/YYYY", true));
      }
    }

    const longMatches = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\s+\d{1,2},\s+\d{4}\b/g) || [];
    for (const match of longMatches) {
      const normalized = normalizeDate(match);
      if (normalized) {
        yearHints.push(dayjs(normalized.normalized, "MM/DD/YYYY", true));
      }
    }
  }

  if (!yearHints.length) {
    const now = dayjs();
    return { anchorYear: now.year(), anchorMonth: now.month() + 1 };
  }

  yearHints.sort((a, b) => a.valueOf() - b.valueOf());
  const anchor = yearHints[yearHints.length - 1];
  return {
    anchorYear: anchor.year(),
    anchorMonth: anchor.month() + 1
  };
}

function stripRepeatedLeadingDate(text, normalizedDate, dateContext) {
  const remainder = normalizeSpaces(text);
  const leadingDate = extractLeadingDate(remainder);
  if (!leadingDate) {
    return remainder;
  }

  const normalizedLeading = normalizeDate(leadingDate.raw, dateContext);
  if (!normalizedLeading) {
    return remainder;
  }

  if (normalizedLeading.normalized !== normalizedDate) {
    return remainder;
  }

  return normalizeSpaces(remainder.slice(leadingDate.raw.length));
}

function countDateTokens(text) {
  return (String(text || "").match(INLINE_DATE_PATTERN) || []).length;
}

function isLikelySummaryLine(text) {
  return /(daily balance|ending daily|balance summary|beginning balance|new balance|account summary)/i.test(text);
}

function inferSectionSign(text) {
  const normalized = normalizeSpaces(text).toLowerCase();
  if (!normalized || extractLeadingDate(normalized)) {
    return null;
  }

  const hasDepositKeyword = /(deposit|credit|addition|interest payment|interest earned)/i.test(normalized);
  const hasDebitKeyword = /(withdrawal|debit|fee|service charge|payment to|wire out)/i.test(normalized);

  if (hasDepositKeyword && hasDebitKeyword) {
    return 0;
  }

  if (
    /(atm\s*&\s*debit\s*card\s*withdrawals|electronic withdrawals|other withdrawals, debits and service charges|fees(?: section)?|service charges)/i.test(
      normalized
    )
  ) {
    return -1;
  }

  if (/(deposits and additions|deposits, credits and interest|deposits and credits)/i.test(normalized)) {
    return 1;
  }

  if (!hasDepositKeyword && !hasDebitKeyword) {
    return null;
  }

  if (hasDebitKeyword) {
    return -1;
  }

  return 1;
}

function applySectionSign(amount, description, sectionSign) {
  if (!Number.isFinite(amount)) {
    return amount;
  }

  const normalizedDescription = normalizeSpaces(description).toLowerCase();
  if (isStrongPositiveDescription(normalizedDescription)) {
    return Math.abs(amount);
  }

  if (isStrongNegativeDescription(normalizedDescription)) {
    return -Math.abs(amount);
  }

  if (!sectionSign) {
    return amount;
  }

  return sectionSign < 0 ? -Math.abs(amount) : Math.abs(amount);
}

function isStrongPositiveDescription(description) {
  return /(return|reverse|reversal|deposit|credit|payment from|transfer from|online transfer from|zelle from|wire in|interest)/i.test(description);
}

function isStrongNegativeDescription(description) {
  return /(payment to|transfer to|online transfer to|zelle to|withdrawal|debit|fee|purchase|wire out|service charge|overdraft|irs usataxpymt|taxpymt|harland clarke|^\d{3,6}\s+check\b|\bcheck\b)/i.test(description);
}

function isNonTransactionDescription(description, amount) {
  const normalizedDescription = normalizeSpaces(description);
  if (!almostZero(amount)) {
    return false;
  }

  return NON_TRANSACTION_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(normalizedDescription));
}

function normalizeAccountToken(rawAccount) {
  const compact = String(rawAccount || "").replace(/[^A-Za-z0-9*]/g, "");
  if (compact.length < 4) {
    return null;
  }

  if (!/\d/.test(compact) && !compact.includes("*")) {
    return null;
  }

  return compact;
}

function isLikelyNoiseLine(text) {
  const normalized = normalizeSpaces(text).toLowerCase();
  if (!normalized) {
    return true;
  }

  if (/^(\*start\*|\*end\*)/.test(normalized)) {
    return true;
  }

  if (/^(?:c\s*o\s*n\s*t\s*i\s*n\s*u\s*e\s*d|continued)$/i.test(normalized)) {
    return true;
  }

  return /(account security you can see|security meter level|message and data rates may apply)/i.test(normalized);
}

function compactLetters(text) {
  return String(text || "").toLowerCase().replace(/[^a-z]/g, "");
}

function sanitizeTransactionDescription(description, amount) {
  let cleaned = normalizeSpaces(description);
  if (!cleaned) {
    return "";
  }

  cleaned = cleaned
    .replace(/\s+CHECKING ACCOUNT MONTHLY SUMMARY.*$/i, "")
    .replace(/\s+SAVINGS ACCOUNT MONTHLY SUMMARY.*$/i, "")
    .replace(/\b(ACCTVERIFY\s+[A-Z0-9]+)\s+\1\b/i, "$1")
    .replace(/\s+\.\s*$/, "")
    .replace(/\bR\s+on\b/g, " on")
    .replace(/\s+R$/g, "")
    .trim();

  cleaned = removeTrailingRepeatedAmount(cleaned, amount);
  cleaned = normalizeSpaces(cleaned);
  return cleaned;
}

function collectDocumentMetadata(pageCollection, transactions) {
  const lines = Array.isArray(pageCollection)
    ? pageCollection.flat().map((line) => normalizeSpaces(line.text))
    : [];

  const accountCandidates = collectAccountCandidates(lines, transactions);
  const businessNumberCandidates = collectBusinessNumberCandidates(lines);
  const businessNameCandidates = collectBusinessNameCandidates(lines);
  const statementPeriod = detectStatementPeriod(lines);

  return {
    accountCandidates,
    businessNumberCandidates,
    businessNameCandidates,
    statementPeriod,
    primaryAccount: accountCandidates[0] || null,
    primaryBusinessNumber: businessNumberCandidates[0] || null,
    primaryBusinessName: businessNameCandidates[0] || null
  };
}

function collectAccountCandidates(lines, transactions) {
  const counts = new Map();

  const directLabelPattern = /(?:account|acct)\s*(?:number|no\.?|#)?\s*[:\-]?\s*([Xx*\d\-]{4,})/gi;
  for (const line of lines) {
    for (const match of line.matchAll(directLabelPattern)) {
      addCandidate(counts, normalizeAccountToken(match[1]));
    }
  }

  for (const transaction of transactions || []) {
    addCandidate(counts, normalizeAccountToken(transaction?.account));
  }

  return sortCandidateCounts(counts);
}

function collectBusinessNumberCandidates(lines) {
  const counts = new Map();
  const patterns = [
    /\b(?:business|company|client|customer)\s*(?:number|no\.?|#|id)\s*[:\-]?\s*([A-Za-z0-9\-*]{4,})/gi,
    /\b(?:tax\s*id|ein|federal\s*id)\s*[:\-]?\s*([A-Za-z0-9\-]{4,})/gi
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        const normalized = normalizeBusinessNumber(match[1]);
        addCandidate(counts, normalized);
      }
    }
  }

  return sortCandidateCounts(counts);
}

function collectBusinessNameCandidates(lines) {
  const counts = new Map();
  const patterns = [
    /\b(?:business|company)\s*name\s*[:\-]?\s*([A-Za-z0-9&.,'\/\-\s]{3,80})/gi,
    /\bstatement\s+for\s+([A-Za-z0-9&.,'\/\-\s]{3,80})/gi
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        const normalized = normalizeBusinessName(match[1]);
        addCandidate(counts, normalized);
      }
    }
  }

  return sortCandidateCounts(counts);
}

function detectStatementPeriod(lines) {
  const periodPatterns = [
    /\bstatement\s+period\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(?:to|-|through|thru)\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /\bfrom\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(?:to|-|through|thru)\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i
  ];

  for (const line of lines) {
    for (const pattern of periodPatterns) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }

      const start = normalizeDate(match[1]);
      const end = normalizeDate(match[2]);
      if (start && end) {
        return {
          start: start.normalized,
          end: end.normalized
        };
      }
    }
  }

  return null;
}

function addCandidate(map, candidate) {
  if (!candidate) {
    return;
  }

  map.set(candidate, (map.get(candidate) || 0) + 1);
}

function sortCandidateCounts(countMap) {
  return Array.from(countMap.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .map(([value]) => value);
}

function normalizeBusinessNumber(value) {
  const raw = String(value || "").replace(/[^A-Za-z0-9*]/g, "");
  if (raw.length < 4) {
    return null;
  }

  if (!/\d/.test(raw) && !raw.includes("*")) {
    return null;
  }

  return raw.toUpperCase();
}

function normalizeBusinessName(value) {
  const cleaned = normalizeSpaces(value).replace(/[|]+/g, "").trim();
  if (cleaned.length < 3) {
    return null;
  }

  if (/^(?:page\s+\d+|member fdic|account summary|ending balance)$/i.test(cleaned)) {
    return null;
  }

  return cleaned.toUpperCase();
}

function removeTrailingRepeatedAmount(description, amount) {
  if (!Number.isFinite(amount)) {
    return description;
  }

  const absAmount = Math.abs(amount);
  const moneyPattern = /(\$?\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s*$/;
  const trailingMatch = description.match(moneyPattern);
  if (trailingMatch) {
    const trailingValue = parseAmountToken(trailingMatch[1]);
    if (Number.isFinite(trailingValue) && almostEqual(Math.abs(trailingValue), absAmount, 0.005)) {
      return description.slice(0, trailingMatch.index).trim();
    }
  }

  const amountWithArtifactPattern = /(\$?\d{1,3}(?:,\d{3})*(?:\.\d{2}))\s+\d{12,}\s*$/;
  const artifactMatch = description.match(amountWithArtifactPattern);
  if (artifactMatch) {
    const trailingValue = parseAmountToken(artifactMatch[1]);
    if (Number.isFinite(trailingValue) && almostEqual(Math.abs(trailingValue), absAmount, 0.005)) {
      return description.slice(0, artifactMatch.index).trim();
    }
  }

  return description;
}

function almostEqual(a, b, epsilon) {
  return Math.abs(a - b) <= epsilon;
}

function almostZero(value) {
  return Number.isFinite(value) && Math.abs(value) < 0.00001;
}

function isPasswordError(error) {
  if (!error) {
    return false;
  }

  if (error?.name === "PasswordException") {
    return true;
  }

  return /password/i.test(error?.message || "");
}

module.exports = {
  extractTransactionsFromPdf,
  PdfParseError
};
