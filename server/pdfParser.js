/**
 * Phantom Ledger's binding of the shared statement parser.
 *
 * The parsing logic lives in @accuracy/statement-parser so that Ledger and
 * Phantom Pulse read statements identically — the two products stay separate,
 * but a parser fix lands once instead of being ported by hand.
 *
 * The only platform-specific part is which pdfjs build opens the file. Ledger
 * parses server-side in Node, so it passes the CommonJS legacy build; Pulse
 * parses in Chromium and passes the native one.
 */
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const { createStatementParser } = require("@accuracy/statement-parser");

module.exports = createStatementParser({ pdfjs });
