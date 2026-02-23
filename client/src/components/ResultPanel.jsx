import TransactionTable from "./TransactionTable";

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
          </div>

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
