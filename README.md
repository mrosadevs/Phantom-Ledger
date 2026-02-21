# Accuracy Phantom Ledger

Accuracy Phantom Ledger merges PDF extraction and transaction cleaning into one unified app.

## Flow

1. Upload one or more text-based bank statement PDFs.
2. Extract transactions from all PDFs.
3. Clean descriptions with the full cleaning rules.
4. Download one final Excel file.

## Output Excel

Columns (exact):

- `Date`
- `clean transactions`
- `amount`
- `orginal transactons`

Formatting:

- Arial font
- Bold headers
- Auto-filter on row 1
- Top row frozen
- Auto-width columns
- No colors/fills

## API

### `POST /process`

- `Content-Type`: `multipart/form-data`
- Field name: `pdfs`
- Accepts multiple PDF files
- Returns: `accuracy-phantom-ledger.xlsx`

## Notes

- Blank-page/no-transaction parser warnings are suppressed from the UI.
- The only user-facing warning is account mismatch across uploaded statements.

## Run

```bash
npm install
npm run dev
```

- Client: `http://localhost:5173`
- Server: `http://localhost:8787`
