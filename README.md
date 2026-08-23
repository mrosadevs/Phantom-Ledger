# 👻 Phantom Ledger

### Bank Statement PDF → Clean Excel — Instantly

<div align="center">

![Vite](https://img.shields.io/badge/Vite-React-646cff?style=for-the-badge&logo=vite&logoColor=white)
![Express](https://img.shields.io/badge/Express-API-000000?style=for-the-badge&logo=express&logoColor=white)
![PDF](https://img.shields.io/badge/PDF-Extraction-10b981?style=for-the-badge)

**Upload bank statement PDFs, extract transactions, clean descriptions automatically, and download a polished Excel file — all in one step.**

[🌐 Live Site](https://ledger.accuracycg.com)

</div>

---

## ✨ Features

- 📄 **Multi-PDF Upload** — Upload one or more text-based bank statement PDFs at once
- ✅ **Validation Gate** — Every statement is reconciled against its own printed control totals (`Total deposits and other credits`, `Total checks`, …) and its beginning→ending balance chain, to the cent. Failures are reported loudly, per file, in the UI and in a dedicated **Validation** sheet in the export.
- 🧭 **Sign from Structure** — Transaction signs come from the statement's section headings and explicit minus signs, never from description keywords. When a description disagrees with the structure, the row is flagged `sign-review` instead of silently flipped.
- 🏦💳 **Account-Type Aware** — Bank and credit card statements use opposite sign conventions (a Late Payment Fee on a card is a positive charge). Auto-detected per statement, overridable per batch.
- 🕵️ **Duplicate & Gap Detection** — Byte-identical uploads, repeated statement periods, and missing months in the sequence are all reported.
- 🔍 **Smart Extraction** — Automatically parses dates, descriptions, and amounts, including BofA two-column Checks sections
- 🧹 **Auto-Cleaning** — Transaction descriptions are cleaned using built-in rules
- 📊 **Excel Export** — Download a single `.xlsx` file with all transactions + validation results
- ⚠️ **Account Mismatch Warning** — Alerts you if uploaded statements come from different accounts
- 🧪 **Regression Tests** — `npm test` runs the sign-precedence and validation test suite

---

## 📊 Output Format

The exported Excel file (`accuracy-phantom-ledger.xlsx`) contains a **Transactions** sheet:

| Column | Description |
|--------|-------------|
| 📅 `Date` | Transaction date |
| 🧹 `clean transactions` | Cleaned description |
| 💰 `amount` | Transaction amount |
| 📝 `orginal transactons` | Raw original description |
| 🗂️ `source file` | Which uploaded PDF the row came from |
| 🚩 `flags` | `sign-review` / `zero-value` markers for human review |

…and a **Validation** sheet with each statement's printed-total and balance-chain checks (printed vs extracted vs difference, OK/FAILED).

**Formatting:**
- ✅ Arial font, bold headers
- ✅ Auto-filter on row 1, top row frozen
- ✅ Auto-width columns
- ❌ No colors or fills — clean and minimal

---

## 🛠️ Tech Stack

| Layer | Tech |
|-------|------|
| 🖥️ Client | React + Vite |
| 🗄️ Server | Express.js |
| 📄 PDF Parsing | pdfjs-dist |
| 📊 Excel | ExcelJS / xlsx |
| 🎨 Theme | Dark mode (`#06080f`) |

---

## 🔌 API

### `POST /process`

| Field | Details |
|-------|---------|
| Content-Type | `multipart/form-data` |
| Field name | `pdfs` |
| Accepts | Multiple PDF files |
| Returns | `accuracy-phantom-ledger.xlsx` |

---

## 🚀 Getting Started

```bash
# Install dependencies
npm install

# Run both client + server
npm run dev
```

| Service | URL |
|---------|-----|
| 🖥️ Client | [http://localhost:5173](http://localhost:5173) |
| 🗄️ Server | [http://localhost:8787](http://localhost:8787) |

---

## 📂 Project Structure

```
Phantom-Ledger/
├── client/
│   ├── index.html          # Entry point
│   └── src/
│       └── main.jsx        # React app
├── server/
│   ├── index.js            # Express server
│   ├── pdf-parser.js       # PDF extraction logic
│   └── cleaner.js          # Transaction cleaning rules
├── package.json
└── 📖 README.md            # You're here
```

---

<div align="center">

👻 **From messy PDFs to clean spreadsheets** 📊

</div>
