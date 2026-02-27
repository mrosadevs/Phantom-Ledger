const normalizeMap = {
  "Motorcycle Spare Parts Max Import": "Motorcycle Spare Parts Max Import LLC",
  "Motorcycle Spare Parts Max Import L": "Motorcycle Spare Parts Max Import LLC",
  "CHARCO UTILITIES": "Charlotte County Utilities",
  "CHARLOTTE UTILTY": "Charlotte County Utilities",
  "LEE COUNTY": "LEE COUNTY TAX COLLECTOR",
  "ATT* BILL": "AT&T",
  "ATT* BILL PAYMENT": "AT&T",
  "APPLE.COM/BILL": "APPLE.COM",
  "AMAZON MKTPL": "Amazon",
  "NST THE HOME D": "THE HOME DEPOT",
  "FPL DIRECT DEBIT": "FPL DIRECT"
};

function cleanTransaction(memo) {
  if (!memo || typeof memo !== "string") {
    return memo;
  }

  const m = memo.trim();

  // Pattern: MISC DEPOSIT ... NAME <person/business>
  const miscDepositName = m.match(/^MISC DEPOSIT PAY ID \S+ ORG ID \S+ NAME (.+)$/i);
  if (miscDepositName) {
    return miscDepositName[1].trim();
  }

  // Pattern: OTHER/WITHDRAWAL/ADJ ... NAME <person/business>
  const adjName = m.match(/^OTHER\/WITHDRAWAL\/ADJ PAY ID \S+ ORG ID \S+ NAME (.+)$/i);
  if (adjName) {
    return adjName[1].trim();
  }

  // Pattern: incoming wire transfer source
  const wireFrom = m.match(/^FUNDS TRANSFER WIRE FROM (.+?) [A-Za-z]{3} \d{1,2}$/i);
  if (wireFrom) {
    const wireFromName = wireFrom[1].trim();
    if (/^\d\//.test(wireFromName) && !wireFromName.includes(",")) {
      return wireFromName.replace(/^\d\//, "").trim();
    }
    return wireFromName;
  }

  // Pattern: outgoing domestic/int'l wire destination
  const wireTo = m.match(/^(?:FUNDS TRN OUT CBOL|INT'L WIRE OUT CBOL) WIRE TO (.+?)(?:\s+#\S+)?$/i);
  if (wireTo) {
    return wireTo[1].replace(/\s+SA$/i, "").trim();
  }

  // Pattern: explicit incoming wire fee lines
  if (/^SERVICE CHARGES INCOMING WIRE FEE\b/i.test(m)) {
    return "INCOMING WIRE FEE";
  }

  if (/^SERVICE FEE CHARGES FOR (?:DOMESTIC|INTERNATIONAL) FUNDS TRANSFER$/i.test(m)) {
    return "SERVICE FEE";
  }

  const instantPaymentDebit = m.match(/^INSTANT PAYMENT DEBIT\s+\d{12,}\S*\s+(.+)$/i);
  if (instantPaymentDebit) {
    return instantPaymentDebit[1].trim();
  }

  // Pattern: debit card purchase, keep merchant only
  if (/^DEBIT CARD PURCH Card Ending in /i.test(m)) {
    let rest = m.replace(/^DEBIT CARD PURCH Card Ending in \d+\s+\S+\s+\d+\s+[A-Za-z]{3}\s+\d{1,2}\s+/i, "");
    rest = rest.replace(/\s+[A-Za-z]{3}\s+\d{4}\b.*$/i, "");
    rest = rest.replace(/\s+\d{7,}.*$/i, "");
    rest = rest.replace(/\s+[A-Z]{2}\s+\d+\s*$/i, "");
    if (rest.trim()) {
      return rest.trim();
    }
  }

  // RULE B8: WIRE TYPE:WIRE IN
  if (m.startsWith("WIRE TYPE:WIRE IN")) {
    const match = m.match(/ORIG:(.+?)\s+ID:/);
    if (match) {
      return match[1].trim();
    }
    return "Wire In";
  }

  // RULE B9: WIRE TYPE:WIRE OUT
  if (m.startsWith("WIRE TYPE:WIRE OUT")) {
    const match = m.match(/BNF:(.+?)\s+ID:/);
    if (match) {
      return match[1].trim();
    }
    return "Wire Out";
  }

  // RULE B10: TRANSFER NAME:NAME Confirmation#
  if (/^TRANSFER .+Confirmation#/i.test(m)) {
    const match = m.match(/^TRANSFER (.+?):(.+?)\s+Confirmation#/i);
    if (match) {
      return `${match[1].trim()} to ${match[2].trim()}`;
    }
  }

  // RULE B11: External transfer fee
  if (/^External transfer fee/i.test(m)) {
    return "External Transfer Fee";
  }

  // RULE A18: Wire Trans Svc Charge (any format)
  if (m.startsWith("Wire Trans Svc Charge")) {
    return "Wire Trans Svc Charge";
  }

  // RULE A19-21: Wire/fee exact matches
  if (m === "Wire Transfer Fee") {
    return "Wire Transfer Fee";
  }
  if (m === "Domestic Incoming Wire Fee") {
    return "Domestic Wire Fee";
  }
  if (m === "Online Fx International Wire Fee") {
    return "Online Fx International Wire Fee";
  }
  if (m === "Online US Dollar Intl Wire Fee") {
    return "Intl Wire Fee";
  }

  // RULE B1: Zelle payment from — WITH memo
  if (/^Zelle payment from .+ for "/i.test(m)) {
    const match = m.match(/^Zelle payment from (.+?)\s+for\s+"/i);
    if (match) {
      return match[1].trim();
    }
  }

  // RULE B2: Zelle payment from — no memo
  if (/^Zelle payment from /i.test(m)) {
    const match = m.match(/^Zelle payment from (.+?)\s+Conf#/i);
    if (match) {
      return match[1].trim();
    }
    let name = m.replace(/^Zelle payment from /i, "").trim();
    name = name.replace(/\s+(?:Bac|Wfct|Cof|Cti|Mac|Hna|H50|Bbt|0Ou)\S+.*/i, "");
    name = name.replace(/\s+\d{8,}.*/, "");
    return name.trim();
  }

  // RULE B3: Zelle payment to — WITH memo
  if (/^Zelle payment to .+ for "/i.test(m)) {
    const match = m.match(/^Zelle payment to (.+?)\s+for\s+"/i);
    if (match) {
      return match[1].trim();
    }
  }

  // RULE B4: Zelle payment to — no memo
  if (/^Zelle payment to /i.test(m)) {
    const match = m.match(/^Zelle payment to (.+?)\s+Conf#/i);
    if (match) {
      return match[1].trim();
    }
    let name = m.replace(/^Zelle payment to /i, "").trim();
    name = name.replace(/\s+(?:Bac|Wfct|Cof|Cti|Mac|Hna|H50|Bbt|0Ou)\S+.*/i, "");
    name = name.replace(/\s+\d{8,}.*/, "");
    return name.trim();
  }

  // RULE A2: Zelle to — old format outgoing
  if (/^Zelle to /i.test(m)) {
    const match = m.match(/^Zelle to (.+?)\s+on\s+\d+\/\d+\s+Ref\s+#/i);
    if (match) {
      return match[1].trim();
    }
    return m.replace(/^Zelle to /i, "").replace(/\s+Ref\s+#\S+.*/i, "").trim();
  }

  // RULE A3: Zelle Payment From — old format (capitalized)
  if (m.startsWith("Zelle Payment From ")) {
    let name = m.replace(/^Zelle Payment From /, "");
    name = name.replace(/\s+(?:Bac|Wfct|Cof|Cti|Mac|Hna|H50|Bbt|0Ou)\S+.*/, "");
    name = name.replace(/\s+\d{8,}.*/, "");
    name = name.replace(/\s+CA$/, "").trim();
    return name;
  }

  // RULE B5: Mobile transfer from CHK
  if (/^Mobile transfer from CHK/i.test(m)) {
    const match = m.match(/^Mobile transfer from CHK \d+ Confirmation#\s*\S+;\s*(.+)$/i);
    if (match) {
      const namePart = match[1].trim();
      const commaIdx = namePart.indexOf(",");
      if (commaIdx !== -1) {
        const last = namePart.substring(0, commaIdx).trim();
        const first = namePart.substring(commaIdx + 1).trim();
        if (last === first) {
          return last;
        }
        return `${first} ${last}`;
      }
      return namePart;
    }
    return "Mobile Transfer";
  }

  // RULE B6: Online transfer from CHK
  if (/^Online transfer from CHK/i.test(m)) {
    const match = m.match(/^Online transfer from CHK \d+ Confirmation#\s*\S+;\s*(.+)$/i);
    if (match) {
      const namePart = match[1].trim();
      const commaIdx = namePart.indexOf(",");
      if (commaIdx !== -1) {
        const last = namePart.substring(0, commaIdx).trim();
        const first = namePart.substring(commaIdx + 1).trim();
        if (last === first) {
          return last;
        }
        return `${first} ${last}`;
      }
      return namePart;
    }
    return "Online Transfer";
  }

  // RULE B7: Online transfer to CHK
  if (/^Online transfer to CHK/i.test(m)) {
    const match = m.match(/^Online transfer to CHK\s+\.{0,3}(\d+)/i);
    if (match) {
      return `Transfer to CHK ${match[1]}`;
    }
    return "Online Transfer";
  }

  // RULE A6: Mobile transfer to chk — old format
  if (/^Mobile transfer to chk/i.test(m)) {
    const match = m.match(/CHK\s+(\S+)/i);
    if (match) {
      return `transfer to CHK ${match[1].replace(/;$/, "")}`;
    }
    return "Mobile Transfer";
  }

  // RULE A4: Online Transfer to — old format named account
  if (m.startsWith("Online Transfer to ")) {
    let rest = m.replace(/^Online Transfer to /, "");
    rest = rest.replace(/\s+(?:Everyday|Business|Savings|Personal)\s+(?:Checking|Savings).*/i, "");
    rest = rest.replace(/\s+xxxxxx\d+.*/i, "");
    rest = rest.replace(/\s+Ref\s+#.*/i, "");
    return "Transfer to " + rest.trim();
  }

  // RULE A5: Online Transfer To Chk — old format
  if (/^Online Transfer To Chk/i.test(m)) {
    return "Transfer To Chk 7590";
  }

  // RULE A7: Online Banking payment to CRD
  if (/^Online Banking payment to CRD/i.test(m)) {
    const match = m.match(/CRD\s+(\S+)/i);
    if (match) {
      return `Online Banking payment to CRD ${match[1]}`;
    }
    return "Online Banking payment";
  }

  // RULE A1: WT outgoing wire — old format
  if (/^WT\s+\d/.test(m)) {
    const bnf = m.match(/\/Bnf=(.+?)\s+Srf#/);
    if (bnf) {
      let name = bnf[1].trim();
      name = name.replace(/^G\s+/, "");
      name = name.replace(/\s+CO,.*/, "").replace(/\s+CA,.*/, "");
      return name.trim();
    }
    return m;
  }

  // RULE A8: Fedwire Credit
  if (m.startsWith("Fedwire Credit")) {
    const bo = m.match(/B\/O:\s*\d+\/(.+?)\s*\d\/US\//);
    if (bo) {
      return bo[1].trim();
    }
    const bnf = m.match(/Bnf=([^/]+)/);
    if (bnf) {
      return bnf[1].replace(/\s+Miramar\s+FL.*/, "").trim();
    }
    return "Fedwire Credit";
  }

  // RULE A9: Book Transfer Credit
  if (m.startsWith("Book Transfer Credit")) {
    const org = m.match(/Org:\/\d+\s+(.+?)\s+Ref:/);
    if (org) {
      return org[1].trim();
    }
    const bo = m.match(/B\/O:\s*(.+?)(?:\s+(?:Ocala|Columbus|Miramar)\s)/);
    if (bo) {
      return bo[1].trim();
    }
    const bo2 = m.match(/B\/O:\s*(.+?)(?:\s+\w+\s+\w{2}\s+\d{5})/);
    if (bo2) {
      return bo2[1].trim();
    }
    return "Book Transfer Credit";
  }

  // RULE A10: Online International Wire Transfer
  if (m.startsWith("Online International Wire Transfer")) {
    const ben = m.match(/Ben:\/\d+\s+(.+?)\s+Ref:/);
    if (ben) {
      return ben[1].trim();
    }
    const ac = m.match(/A\/C:\s*(.+?)\s+Medellin/i);
    if (ac) {
      return ac[1].trim();
    }
    return "Online International Wire Transfer";
  }

  // RULE A11: Orig CO Name ACH
  if (m.startsWith("Orig CO Name:")) {
    const descr = m.match(/CO Entry Descr:(\w+)/);
    if (descr && !["ACH", "PMT", "ACHPMT"].includes(descr[1].toUpperCase())) {
      return descr[1];
    }
    const co = m.match(/Orig CO Name:(.+?)\s+Orig\s+ID:/);
    if (co) {
      return co[1].trim();
    }
    return m;
  }

  // RULE A13: Purchase authorized / Recurring / Purchase Intl
  for (const prefix of [
    "Purchase authorized on ",
    "Recurring Payment authorized on ",
    "Purchase Intl authorized on "
  ]) {
    if (m.startsWith(prefix)) {
      let rest = m.slice(prefix.length);
      rest = rest.replace(/^\d{2}\/\d{2}\s+/, "");
      rest = rest.replace(/\s+S\d{10,}\s+Card\s+\d+.*/, "");
      rest = rest.replace(/\s+[A-Z][a-z]{2}$/, "");
      rest = rest.replace(/\s+[A-Z]{2}$/, "");
      rest = rest.replace(/\s+\S+@\S+/, "");
      rest = rest.replace(/\s+Https?:\/\/\S+/i, "");
      return rest.trim();
    }
  }

  // RULE A14: PURCHASE MMDD
  if (m.startsWith("PURCHASE ")) {
    let rest = m.replace(/^PURCHASE\s+\d{4}\s+/, "");
    rest = rest.replace(/\s+\d{10,}.*/, "");
    rest = rest.replace(/\s+[A-Z]{2}$/, "");
    rest = rest.replace(/\*\S+/g, "").trim();
    return rest.trim();
  }

  // RULE A15: CHECKCARD MMDD
  if (m.startsWith("CHECKCARD ")) {
    let rest = m.replace(/^CHECKCARD\s+\d{4}\s+/, "");
    rest = rest.replace(/\s+\d{15,}.*/, "");
    rest = rest.replace(/\s+RECURRING\s+.*/, "");
    rest = rest.replace(/\s+CKCD\s+.*/, "");
    rest = rest.replace(/\s+\d{10}\s*.*/, "");
    rest = rest.replace(/\s+[A-Z]{2}$/, "");
    return rest.trim();
  }

  // RULE A16: DEBIT CARD Card Ending in XXXX
  if (m.startsWith("DEBIT CARD Card Ending in ")) {
    let rest = m.replace(/^DEBIT CARD Card Ending in \d+\s+/, "");
    rest = rest.replace(/\s+[A-Z]{2,}(?:US)?\d{4}$/, "");
    rest = rest.replace(/\s+\d{4,}$/, "");
    rest = rest.replace(/\s+\d+\s+[A-Z]+\s+[A-Z]{2}$/, "");
    return rest.trim();
  }

  // RULE A22: Business to Business ACH Debit
  if (m.includes("Business to Business ACH Debit")) {
    const match = m.match(/Business to Business ACH Debit\s*-\s*(.+?)(?:\s+ACH\s+|\s+Retry|\s+\d)/);
    if (match) {
      return `${match[1].trim()} ACH`;
    }
    const match2 = m.match(/-\s*(.+)/);
    if (match2) {
      return match2[1].trim();
    }
    return "Business to Business ACH Debit";
  }

  // RULE A23: Fee lines
  if (m.startsWith("OVERDRAFT ITEM FEE")) {
    return "Overdraft Fee";
  }
  if (m.includes("FINANCE CHARGE")) {
    return "FINANCE CHARGE";
  }
  if (m.startsWith("Monthly Fee Business")) {
    return "Monthly Fee Business";
  }
  if (m === "RETURN ITEM CHARGEBACK") {
    return "RETURN ITEM CHARGEBACK";
  }
  if (m.startsWith("LATE PAYMENT FEE")) {
    return "LATE PAYMENT FEE";
  }

  // RULE A24: OTHER / WITHDRAWAL / ADJ with NAME field
  if (/^(?:OTHER|WITHDRAWAL|ADJ)/i.test(m)) {
    const nameMatch = m.match(/NAME:\s*(.+?)(?:\s+(?:ID:|MEMO:|$))/i);
    if (nameMatch) {
      return nameMatch[1].trim();
    }
  }

  // RULE A25: SERVICE CHARGE ACCT
  if (m.startsWith("SERVICE CHARGE ACCT")) {
    return m;
  }

  // RULE A26: 4-digit check number only
  if (/^\d{4}$/.test(m)) {
    return `Check ${m}`;
  }

  // RULE A12 / A27: Contains DES: (ACH / IRS fallback)
  if (m.includes(" DES:")) {
    const before = m.match(/^(.+?)\s+DES:/);
    if (before) {
      return before[1].trim();
    }
  }

  // RULE A17: Raw store format — ends with STATE + 15-digit code
  if (/\s[A-Z]{2}\s\d{15,}$/.test(m)) {
    let rest = m.replace(/\s[A-Z]{2}\s\d{15,}$/, "");
    rest = rest.replace(/\s+\d{10}\s*$/, "");
    rest = rest.replace(/\*+/g, " ").trim();
    rest = rest.replace(/\s{2,}/g, " ").trim();
    return rest;
  }

  return m;
}

function applyNormalizationMap(cleanName) {
  if (Object.prototype.hasOwnProperty.call(normalizeMap, cleanName)) {
    return normalizeMap[cleanName];
  }

  return cleanName;
}

function cleanAndNormalizeTransaction(memo) {
  const cleaned = cleanTransaction(memo);
  return applyNormalizationMap(cleaned);
}

module.exports = {
  cleanTransaction,
  normalizeMap,
  applyNormalizationMap,
  cleanAndNormalizeTransaction
};
