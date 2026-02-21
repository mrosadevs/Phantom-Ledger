function renderDateRange(dateRange) {
  if (!dateRange?.start || !dateRange?.end) {
    return "n/a";
  }

  return `${dateRange.start} to ${dateRange.end}`;
}

export default function ResultPanel({
  canProcess,
  fileCount,
  isProcessing,
  progress,
  result,
  onProcess,
  onDownload
}) {
  const summary = result?.summary;
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  const previewTransactions = Array.isArray(result?.previewTransactions)
    ? result.previewTransactions
    : [];
  const hasDownload = Boolean(result?.workbookBlob);

  return (
    <section className="panel">
      <div className="preview-header">
        <h2>Extract &amp; Export</h2>
        <div className="preview-actions">
          <button
            type="button"
            className="button-primary"
            disabled={!canProcess}
            onClick={onProcess}
          >
            {isProcessing ? "Extracting..." : "Extract"}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={!hasDownload || isProcessing}
            onClick={onDownload}
          >
            Download Excel
          </button>
        </div>
      </div>

      {!fileCount ? (
        <p className="empty-note">Upload PDFs first, then run extraction.</p>
      ) : null}

      {isProcessing ? (
        <div className="progress-wrap" role="status" aria-live="polite">
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${Math.max(6, progress)}%` }} />
          </div>
          <p className="progress-label">Processing PDFs... {Math.round(progress)}%</p>
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
              <p>{summary.processedFiles} / {summary.totalFiles}</p>
            </article>
            <article className="summary-card">
              <h3>Date Range</h3>
              <p>{renderDateRange(summary.dateRange)}</p>
            </article>
          </div>

          {warnings.length ? (
            <div className="result-list-wrap">
              <h3>Warnings</h3>
              <ul className="result-list warning">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {previewTransactions.length ? (
            <div className="result-list-wrap">
              <h3>Transaction Preview (first {previewTransactions.length})</h3>
              <div className="preview-table-wrap">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Description</th>
                      <th>Source File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewTransactions.map((transaction, index) => (
                      <tr key={`${transaction.date}-${transaction.description}-${index}`}>
                        <td>{transaction.date}</td>
                        <td className="amount">{Number(transaction.amount || 0).toFixed(2)}</td>
                        <td>{transaction.description}</td>
                        <td className="source-file">{transaction.sourceFile || "n/a"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
