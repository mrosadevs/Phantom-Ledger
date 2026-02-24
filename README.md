# 👻 Phantom Ledger

### Bank Statement PDF → Clean Excel — Instantly

<div align="center">

![Vite](https://img.shields.io/badge/Vite-React-646cff?style=for-the-badge&logo=vite&logoColor=white)
![Express](https://img.shields.io/badge/Express-API-000000?style=for-the-badge&logo=express&logoColor=white)
![PDF](https://img.shields.io/badge/PDF-Extraction-10b981?style=for-the-badge)

**Upload bank statement PDFs, extract transactions, clean descriptions automatically, and download a polished Excel file — all in one step.**

</div>

---

## ✨ Features

- 📄 **Multi-PDF Upload** — Upload one or more text-based bank statement PDFs at once
- 🔍 **Smart Extraction** — Automatically parses dates, descriptions, and amounts
- 🧹 **Auto-Cleaning** — Transaction descriptions are cleaned using built-in rules
- 📊 **Excel Export** — Download a single `.xlsx` file with all transactions
- ⚠️ **Account Mismatch Warning** — Alerts you if uploaded statements come from different accounts
- 🤫 **Clean UX** — Parser warnings are suppressed, only relevant alerts shown

---

## 📊 Output Format

The exported Excel file (`accuracy-phantom-ledger.xlsx`) contains:

| Column | Description |
|--------|-------------|
| 📅 `Date` | Transaction date |
| 🧹 `clean transactions` | Cleaned description |
| 💰 `amount` | Transaction amount |
| 📝 `orginal transactons` | Raw original description |

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
