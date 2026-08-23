import TransactionTable from "./TransactionTable";

function validationBadge(validation) {
  if (!validation || validation.passed === null) {
    return { className: "unknown", label: "Not validated" };
  }
  if (validation.passed) {
    return { className: "pass", label: "Tied to the cent" };
  }
  return { className: "fail", label: "Totals mismatch" };
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

function FileValidationList({ fileReports }) {
  if (!fileReports?.length) return null;

  return (
    <div className="result-list-wrap">
      <h3>Statement Validation</h3>
      <ul className="validation-list">
        {fileReports.map((report) => {
          const badge = validationBadge(report.validation);
          const failedChecks = (report.validation?.sectionChecks || []).filter((c) => !c.pass);
          const balance = report.validation?.balanceCheck;
          return (
            <li key={report.fileName} className="validation-item">
              <div className="validation-item-head">
                <span className="validation-file">{report.fileName}</span>
                <span className={`validation-badge ${badge.className}`}>{badge.label}</span>
                <span className="validation-meta">
                  {report.transactions} txn{report.transactions === 1 ? "" : "s"}
                  {" · "}
                  {report.accountType === "credit_card" ? "credit card" : "bank"}
                  {report.statementPeriod?.end ? ` · thru ${report.statementPeriod.end}` : ""}
                </span>
              </div>
              {failedChecks.map((check) => (
                <p key={check.label} className="validation-fail-detail">
                  {check.label}: extracted {formatMoney(check.extracted)} vs printed {formatMoney(check.printed)} (off by {formatMoney(check.delta)})
                </p>
              ))}
              {balance && !balance.pass ? (
                <p className="validation-fail-detail">
                  Balance chain: net {formatMoney(balance.net)} vs expected {formatMoney(balance.expectedNet)} (off by {formatMoney(balance.delta)})
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function renderDateRange(dateRange) {
  if (!dateRange?.start || !dateRange?.end) return "—";
  return `${dateRange.start} \u2192 ${dateRange.end}`;
}

export default function ResultPanel({
  canProcess,
  fileCount,
  isProcessing,
  progress,
  result,
  onProcess,
  onDownload,
}) {
  const summary = result?.summary;
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  const previewTransactions = Array.isArray(result?.previewTransactions)
    ? result.previewTransactions
    : [];
  const hasDownload = Boolean(result?.workbookBlob);

  return (
    <section className="panel results-panel">
      <div className="preview-header">
        <h2>Extract & Export</h2>
        <div className="preview-actions">
          <button
            type="button"
            className="button-primary"
            disabled={!canProcess}
            onClick={onProcess}
          >
            {isProcessing ? "Extracting\u2026" : "Extract"}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={!hasDownload || isProcessing}
            onClick={onDownload}
          >
            Download Excel
          </button>
          <div className="export-info-wrap">
            <button type="button" className="export-info-btn" aria-label="Export format info">
              i
            </button>
            <div className="export-tooltip">
              <h4>Excel Columns</h4>
              <ul>
                <li>Date</li>
                <li>Clean Description</li>
                <li>Amount</li>
                <li>Original Memo</li>
                <li>Source File</li>
                <li>Flags (review markers)</li>
              </ul>
              <h4>Sheets</h4>
              <ul>
                <li>Transactions</li>
                <li>Validation (per-statement checks)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {!fileCount && !summary ? (
        <p className="empty-note">Upload PDFs first, then run extraction.</p>
      ) : null}

      {isProcessing ? (
        <div className="progress-wrap" role="status" aria-live="polite">
          <div className="progress-track">
            <div
              className="progress-bar animating"
              style={{ width: `${Math.max(4, progress)}%` }}
            />
          </div>
          <p className="progress-label">
            Processing PDFs\u2026 {Math.round(progress)}%
          </p>
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="summary-grid">
            <article className="summary-card">
              <h3>Transactions</h3>
              <p>{summary.totalTransactions}</p>
            </article>
            <article className="summary-card">
              <h3>Files Processed</h3>
              <p>
                {summary.processedFiles}
                <span className="summary-mono"> / {summary.totalFiles}</span>
              </p>
            </article>
            <article className="summary-card">
              <h3>Date Range</h3>
              <p className="summary-mono">{renderDateRange(summary.dateRange)}</p>
            </article>
            <article className={`summary-card verification-card ${
              summary.validationPassed === true ? "pass" : summary.validationPassed === false ? "fail" : ""
            }`}>
              <h3>Verification</h3>
              <p>
                {summary.validationPassed === true
                  ? "✓ Tied"
                  : summary.validationPassed === false
                    ? "✗ Mismatch"
                    : "—"}
                {summary.reviewCount > 0 ? (
                  <span className="summary-mono"> · {summary.reviewCount} to review</span>
                ) : null}
              </p>
            </article>
          </div>

          <FileValidationList fileReports={result?.fileReports} />

          {warnings.length > 0 ? (
            <div className="result-list-wrap">
              <h3>Warnings</h3>
              <ul className="result-list warning">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {previewTransactions.length > 0 ? (
            <div className="result-list-wrap">
              <h3>Transaction Preview</h3>
              <TransactionTable transactions={previewTransactions} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
