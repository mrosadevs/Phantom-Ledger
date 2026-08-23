/**
 * Regression tests for the sign-precedence and validation logic.
 *
 * The scenarios come straight from METHOD.md §6 — the 22 observed sign flips
 * on the Julio Garcia 2026 run.  Structure (section heading / explicit token
 * sign) must always beat description keywords; keywords may only decide when
 * there is no structural evidence, and disagreements are flagged for review.
 *
 * Run: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { __internal } = require("./pdfParser");

const {
  resolveAmountSign,
  inferSectionSign,
  detectAccountType,
  recordControlLine,
  buildValidation,
  createDocState,
  parseAmountToken
} = __internal;

// ── METHOD.md §6: the 22 observed flips ──────────────────────────────────────

test("Barclaycard ACH in a withdrawals section stays negative despite 'CREDITCARD' in the payee", () => {
  // BofA checking, section "Withdrawals and other debits" → sectionSign -1.
  // Old code: "credit" keyword forced positive.  5 rows, part of $49,045.84 swing.
  const { amount, flags } = resolveAmountSign(2500, "BARCLAYCARD US DES:CREDITCARD ID:12345", {
    sectionSign: -1,
    explicitSign: false
  });
  assert.equal(amount, -2500);
  assert.ok(flags.includes("sign-review"), "keyword disagreement should flag for review");
});

test("Zelle payment whose memo says 'Deposit' stays a withdrawal", () => {
  const { amount } = resolveAmountSign(1200, 'Zelle payment to Elvin Paver for "Deposit on job"', {
    sectionSign: -1,
    explicitSign: false
  });
  assert.equal(amount, -1200);
});

test("AMAZON SHOP WITH POINTS CREDIT keeps its explicit negative sign (AMEX)", () => {
  // AMEX prints -$12.34 for credits — explicit sign is ground truth.
  // Old code: "credit" keyword forced positive.  12 rows.
  const { amount } = resolveAmountSign(-12.34, "AMAZON SHOP WITH POINTS CREDIT", {
    sectionSign: 0,
    explicitSign: true
  });
  assert.equal(amount, -12.34);
});

test("Late Payment Fee on a credit card is a charge (positive) despite the 'fee' keyword", () => {
  // Section sign +1 comes from the CC fees section; old code forced negative.  3 rows.
  const { amount, flags } = resolveAmountSign(35, "Late Payment Fee", {
    sectionSign: 1,
    explicitSign: false
  });
  assert.equal(amount, 35);
  assert.ok(flags.includes("sign-review"));
});

test("contradictory keywords with no structure keep natural sign and flag for review", () => {
  // 'Zelle payment to … "Deposit"' matches both predicates — rule ordering
  // must not decide the outcome.
  const { amount, flags } = resolveAmountSign(500, 'Zelle payment to ASHLEY AVERY for "Julio Garcia deposit"', {
    sectionSign: 0,
    explicitSign: false
  });
  assert.equal(amount, 500);
  assert.ok(flags.includes("sign-review"));
});

test("keywords still decide when there is no structural evidence", () => {
  assert.equal(resolveAmountSign(90, "Monthly maintenance fee", { sectionSign: 0, explicitSign: false }).amount, -90);
  assert.equal(resolveAmountSign(90, "Interest earned", { sectionSign: 0, explicitSign: false }).amount, 90);
});

test("BofA credit card sections force the section sign over token signs", () => {
  const { amount } = resolveAmountSign(-99, "AGENT FEE 12345", {
    sectionSign: 1,
    explicitSign: true,
    inCreditCardSection: true
  });
  assert.equal(amount, 99);
});

// ── Section sign inference per account type (METHOD.md §7.3) ─────────────────

test("credit card convention: payments negative, charges/fees/interest positive", () => {
  assert.equal(inferSectionSign("Payments and Credits", "credit_card"), -1);
  assert.equal(inferSectionSign("New Charges", "credit_card"), 1);
  assert.equal(inferSectionSign("Fees", "credit_card"), 1);
  assert.equal(inferSectionSign("Interest Charged", "credit_card"), 1);
});

test("bank convention: fees negative, deposits positive", () => {
  assert.equal(inferSectionSign("Service fees", "bank"), -1);
  assert.equal(inferSectionSign("Deposits and other credits", "bank"), 1);
  assert.equal(inferSectionSign("Withdrawals and other debits", "bank"), -1);
});

test("BofA credit card section labels keep their fixed convention", () => {
  assert.equal(inferSectionSign("Purchases and Other Charges", "bank"), 1);
  assert.equal(inferSectionSign("Payments and Other Credits", "bank"), -1);
  assert.equal(inferSectionSign("Cash Advances", "bank"), 1);
});

// ── Account type detection ────────────────────────────────────────────────────

test("detects an AMEX-style credit card statement", () => {
  const lines = [
    { text: "Minimum Payment Due $35.00" },
    { text: "Payment Due Date 01/28/26" },
    { text: "Closing Date 01/03/26" }
  ];
  assert.equal(detectAccountType(lines), "credit_card");
});

test("detects a BofA-style bank statement", () => {
  const lines = [
    { text: "Deposits and other credits" },
    { text: "Withdrawals and other debits" },
    { text: "Business Checking" }
  ];
  assert.equal(detectAccountType(lines), "bank");
});

// ── Validation gate (METHOD.md §7.1) ─────────────────────────────────────────

test("validation catches a lost check row (the June two-column checks bug)", () => {
  const docState = createDocState("bank");
  docState.sectionsSeen.add("checks");
  docState.currentSection = { name: "Checks", compact: "checks", sign: -1 };
  recordControlLine("Total checks -24,279.12", "total checks -24,279.12", docState);

  // Parser only extracted one of the two side-by-side checks.
  const rows = [
    { section: "checks", amount: -12139.56 }
  ];

  const validation = buildValidation(rows, docState, "06.pdf");
  assert.equal(validation.passed, false);
  assert.equal(validation.sectionChecks.length, 1);
  assert.ok(Math.abs(validation.sectionChecks[0].delta - 12139.56) < 0.01);
});

test("validation passes when sections tie to the cent", () => {
  const docState = createDocState("bank");
  docState.currentSection = { name: "Deposits and other credits", compact: "depositsandothercredits", sign: 1 };
  docState.sectionsSeen.add("depositsandothercredits");
  recordControlLine(
    "Total deposits and other credits $1,500.00",
    "total deposits and other credits $1,500.00",
    docState
  );

  const rows = [
    { section: "depositsandothercredits", amount: 1000 },
    { section: "depositsandothercredits", amount: 500 }
  ];

  const validation = buildValidation(rows, docState, "01.pdf");
  assert.equal(validation.passed, true);
});

test("balance chain catches whole missing sections", () => {
  const docState = createDocState("bank");
  recordControlLine("Beginning balance on November 1, 2025 $8,214.66", "beginning balance on november 1, 2025 $8,214.66", docState);
  recordControlLine("Ending balance on November 30, 2025 $9,214.66", "ending balance on november 30, 2025 $9,214.66", docState);

  const validation = buildValidation([{ section: null, amount: 250 }], docState, "11.pdf");
  assert.equal(validation.balanceCheck.pass, false);
  assert.ok(Math.abs(validation.balanceCheck.delta - 750) < 0.01);

  const validationOk = buildValidation([{ section: null, amount: 1000 }], createDocStateWithBalances(8214.66, 9214.66), "11.pdf");
  assert.equal(validationOk.balanceCheck.pass, true);
});

function createDocStateWithBalances(beginning, ending) {
  const docState = createDocState("bank");
  docState.balances.beginning = beginning;
  docState.balances.ending = ending;
  return docState;
}

test("a sign flip breaks two section totals at once", () => {
  // A withdrawal flipped positive lands in neither section's favor: with
  // sections summed separately the withdrawals total is short.
  const docState = createDocState("bank");
  docState.currentSection = { name: "Withdrawals and other debits", compact: "withdrawalsandotherdebits", sign: -1 };
  docState.sectionsSeen.add("withdrawalsandotherdebits");
  recordControlLine(
    "Total withdrawals and other debits -$5,000.00",
    "total withdrawals and other debits -$5,000.00",
    docState
  );

  // One $1,000 withdrawal was (hypothetically) flipped to +1,000: |sum| = 3,000 ≠ 5,000.
  const rows = [
    { section: "withdrawalsandotherdebits", amount: -4000 },
    { section: "withdrawalsandotherdebits", amount: 1000 }
  ];
  const validation = buildValidation(rows, docState, "x.pdf");
  assert.equal(validation.passed, false);
});

test("year-to-date total boxes are ignored", () => {
  const docState = createDocState("credit_card");
  recordControlLine("Total Fees Charged in 2026 $210.00", "total fees charged in 2026 $210.00", docState);
  assert.equal(docState.printedTotals.length, 0);
});

test("duplicate printed totals are recorded once", () => {
  const docState = createDocState("bank");
  docState.sectionsSeen.add("serVicefees".toLowerCase());
  recordControlLine("Total service fees -$118.50", "total service fees -$118.50", docState);
  recordControlLine("Total service fees -$118.50", "total service fees -$118.50", docState);
  assert.equal(docState.printedTotals.length, 1);
});

// ── Amount token parsing ──────────────────────────────────────────────────────

test("parseAmountToken handles signs, parentheses, CR/DR", () => {
  assert.equal(parseAmountToken("$1,234.56"), 1234.56);
  assert.equal(parseAmountToken("-$1,234.56"), -1234.56);
  assert.equal(parseAmountToken("(1,234.56)"), -1234.56);
  assert.equal(parseAmountToken("1,234.56 DR"), -1234.56);
  assert.equal(parseAmountToken("1,234.56", "debit"), -1234.56);
  assert.equal(parseAmountToken("1,234.56", "credit"), 1234.56);
});
