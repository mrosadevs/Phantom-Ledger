import { useMemo } from "react";

function fmt(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function StatsPanel({ transactions, summary }) {
  const stats = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;

    // Prefer full-dataset stats from the backend summary when available
    const hasSummaryStats = summary && Number.isFinite(summary.totalCredits);

    if (hasSummaryStats) {
      return {
        totalCredits: summary.totalCredits,
        totalDebits: summary.totalDebits,
        net: summary.net,
        average: summary.totalTransactions
          ? summary.net / summary.totalTransactions
          : 0,
        largest: Math.max(...transactions.map((t) => Number(t.amount) || 0)),
        smallest: Math.min(...transactions.map((t) => Number(t.amount) || 0)),
        creditCount: summary.creditCount ?? 0,
        debitCount: summary.debitCount ?? 0,
        fromSummary: true,
      };
    }

    // Fallback: calculate from preview transactions only
    const amounts = transactions.map((t) => Number(t.amount) || 0);
    const debits = amounts.filter((a) => a < 0);
    const credits = amounts.filter((a) => a > 0);
    const total = amounts.reduce((s, a) => s + a, 0);

    return {
      totalCredits: credits.reduce((s, a) => s + a, 0),
      totalDebits: debits.reduce((s, a) => s + a, 0),
      net: total,
      average: amounts.length ? total / amounts.length : 0,
      largest: amounts.length ? Math.max(...amounts) : 0,
      smallest: amounts.length ? Math.min(...amounts) : 0,
      creditCount: credits.length,
      debitCount: debits.length,
      fromSummary: false,
    };
  }, [transactions, summary]);

  if (!stats) return null;

  return (
    <section className="panel stats-panel">
      <h2>Quick Stats</h2>
      <div className="stats-grid">
        <div className="stat-card">
          <p className="stat-label">Credits</p>
          <p className="stat-value positive">+{fmt(stats.totalCredits)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Debits</p>
          <p className="stat-value negative">{fmt(stats.totalDebits)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Net</p>
          <p className={`stat-value ${stats.net >= 0 ? "positive" : "negative"}`}>
            {fmt(stats.net)}
          </p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Average</p>
          <p className="stat-value neutral">{fmt(stats.average)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Largest</p>
          <p className="stat-value positive">{fmt(stats.largest)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Smallest</p>
          <p className="stat-value negative">{fmt(stats.smallest)}</p>
        </div>
        <p className="stat-note">
          {stats.fromSummary
            ? `\u2139 Based on all ${summary.totalTransactions} transactions`
            : `\u2139 Based on first ${transactions.length} preview transaction${transactions.length !== 1 ? "s" : ""}${
                summary?.totalTransactions > transactions.length
                  ? ` of ${summary.totalTransactions} total`
                  : ""
              }`}
        </p>
      </div>
    </section>
  );
}
