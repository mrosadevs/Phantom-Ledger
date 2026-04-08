/**
 * glParser.js
 *
 * Parses a General Ledger PDF (QuickBooks Online format or similar) and builds
 * a vendor→account map that the main endpoint uses to pre-fill the "GL Account"
 * column in the exported Excel file.
 *
 * GL structure we handle:
 *   Account: 6000 · Rent Expense          ← account header
 *     01/15/2025  Check  1234  Vendor Name  Memo  -2,500.00  7,500.00
 *     01/20/2025  Bill Payment    ABC Corp  Supplies  -300.00  7,200.00
 *   Total for Rent Expense                 ← end of section
 */

const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

// QBO transaction type keywords — skip these when extracting the vendor name
// because they appear before the name in the column order.
const GL_TYPE_WORDS = new Set([
  "check", "bill", "payment", "invoice", "credit", "debit", "deposit",
  "transfer", "journal", "entry", "sales", "receipt", "paycheck", "expense",
  "charge", "refund", "return", "adjustment", "opening", "balance",
  "purchase", "withdrawal", "fee", "tax", "payroll"
]);

// ─── PDF text extraction ──────────────────────────────────────────────────────

async function extractGlLines(buffer) {
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const lines = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byY = {};

    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] * 2) / 2; // 0.5 pt tolerance
      if (!byY[y]) byY[y] = [];
      byY[y].push({ str: item.str.trim(), x: item.transform[4] });
    }

    const sortedYs = Object.keys(byY).map(Number).sort((a, b) => b - a);
    for (const y of sortedYs) {
      byY[y].sort((a, b) => a.x - b.x);
      const text = byY[y].map((i) => i.str).join(" ").trim();
      if (text) lines.push(text);
    }
  }

  return lines;
}

// ─── Vendor extraction from a GL row ─────────────────────────────────────────

function extractVendorFromRow(rowText) {
  // Remove leading date (MM/DD/YYYY or MM/DD/YY)
  let rest = rowText.replace(/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+/, "");

  // Remove trailing balance + amount (two numbers at the end)
  rest = rest.replace(/\s+-?[\d,]+\.\d{2}\s+-?[\d,]+\.\d{2}\s*$/, "");
  // Remove remaining trailing amount
  rest = rest.replace(/\s+-?[\d,]+\.\d{2}\s*$/, "");
  rest = rest.replace(/\s*\$[\d,]+\.\d{2}\s*$/, "");

  const words = rest.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  // Skip leading transaction-type words (Check, Bill Payment, etc.)
  let i = 0;
  while (i < words.length && GL_TYPE_WORDS.has(words[i].toLowerCase())) {
    i++;
  }

  // Skip a standalone numeric token (check #, invoice #)
  if (i < words.length && /^\d+$/.test(words[i])) i++;

  // Collect vendor name words (stop at account codes, long numbers, or account keywords)
  const vendorWords = [];
  while (i < words.length && vendorWords.length < 6) {
    const w = words[i];
    // Stop at 4-5 digit account code
    if (/^\d{4,5}$/.test(w)) break;
    // Stop at patterns like "6000-" or "1000·"
    if (/^\d{3,5}[-·]/.test(w)) break;
    // Stop at known account-type words that suggest we've crossed into the split column
    if (
      vendorWords.length > 0 &&
      /^(accounts?|receivable|payable|liability|revenue|asset|equity|retained|uncategorized)$/i.test(w)
    ) break;
    vendorWords.push(w);
    i++;
  }

  const vendor = vendorWords.join(" ").trim();
  // Must be at least 2 chars and not purely numeric
  if (!vendor || vendor.length < 2 || /^\d+$/.test(vendor)) return null;
  return vendor;
}

// ─── Account header detection ─────────────────────────────────────────────────

// Matches patterns like:
//   "Account: 6000 - Rent Expense"
//   "6000 · Rent Expense"
//   "6000 - Rent Expense"
//   "Account: Rent Expense (6000)"
const ACCOUNT_HEADER_RE = /^(?:account:\s*)?(?:(\d{3,6})\s*[-·:·]\s*)?(.+?)(?:\s*\((\d{3,6})\))?$/i;

function parseAccountHeader(line) {
  // Must contain at least one account-like signal
  const hasCode = /\b\d{4,6}\b/.test(line);
  const hasAccountPrefix = /^account:/i.test(line);

  if (!hasCode && !hasAccountPrefix) return null;

  // Skip total / subtotal lines
  if (/^total\b/i.test(line)) return null;

  const m = line.match(ACCOUNT_HEADER_RE);
  if (!m) return null;

  const code = m[1] || m[3] || "";
  const name = m[2].replace(/\s*[-·]\s*$/, "").trim();

  // Sanity-check: name shouldn't be a date or short garbage
  if (!name || name.length < 3 || /^\d+$/.test(name)) return null;

  return { code, name: name.replace(/total\b.*/i, "").trim() };
}

// ─── Normalize for fuzzy matching ────────────────────────────────────────────

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Word-overlap (Jaccard) similarity, ignoring very short words
function wordOverlap(a, b) {
  const stopWords = new Set(["the", "of", "and", "or", "for", "to", "a", "an", "in", "on", "at"]);
  const wordsA = new Set(a.split(" ").filter((w) => w.length > 1 && !stopWords.has(w)));
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 1 && !stopWords.has(w)));
  if (!wordsA.size || !wordsB.size) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return overlap / union;
}

// ─── Main GL parse function ───────────────────────────────────────────────────

/**
 * Parses a GL PDF buffer and returns a Map<normalizedVendor, glEntry>
 * where glEntry = { vendor, accountCode, accountName, count }
 */
async function parseGeneralLedger(buffer) {
  const lines = await extractGlLines(buffer);
  const DATE_ROW_RE = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s/;
  const SKIP_RE = /^(total\b|page\s+\d|date\s+transaction|begin|end|balance|as\s+of\b)/i;

  const vendorMap = new Map(); // normalized vendor name → {vendor, accountCode, accountName, count}
  let currentAccount = null;

  for (const line of lines) {
    if (SKIP_RE.test(line)) continue;

    // Check for account header
    const acct = parseAccountHeader(line);
    if (acct) {
      currentAccount = acct;
      continue;
    }

    // Transaction row inside an account section
    if (currentAccount && DATE_ROW_RE.test(line)) {
      const vendor = extractVendorFromRow(line);
      if (!vendor) continue;

      const key = normalize(vendor);
      if (!key || key.length < 2) continue;

      const existing = vendorMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        vendorMap.set(key, {
          vendor,
          accountCode: currentAccount.code,
          accountName: currentAccount.name,
          count: 1,
        });
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[gl] Parsed ${vendorMap.size} unique GL vendor entries`);
  return vendorMap;
}

// ─── Match a single cleaned bank name to the GL ───────────────────────────────

const MATCH_THRESHOLD = 0.4; // minimum Jaccard score to accept

/**
 * Given a cleaned bank transaction name and the vendor map from parseGeneralLedger,
 * returns the best matching GL entry or null.
 */
function matchToGL(cleanName, vendorMap) {
  if (!cleanName || !vendorMap || !vendorMap.size) return null;

  const norm = normalize(cleanName);
  if (!norm || norm.length < 2) return null;

  // 1. Exact match
  if (vendorMap.has(norm)) {
    return vendorMap.get(norm);
  }

  // 2. Prefix / substring (for cases where bank name is shorter/longer than GL name)
  for (const [key, entry] of vendorMap) {
    if (norm.startsWith(key) || key.startsWith(norm)) {
      return entry;
    }
  }

  // 3. Best word-overlap match above threshold
  let bestScore = MATCH_THRESHOLD;
  let bestMatch = null;

  for (const [key, entry] of vendorMap) {
    const score = wordOverlap(norm, key);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  return bestMatch;
}

module.exports = { parseGeneralLedger, matchToGL };
