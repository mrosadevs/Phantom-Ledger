import { useMemo, useState } from "react";

function compareDates(a, b) {
  const parse = (d) => {
    const parts = String(d || "").split("/");
    if (parts.length === 3) {
      return new Date(`${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`).getTime() || 0;
    }
    return 0;
  };
  return parse(a) - parse(b);
}

function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TransactionTable({ transactions }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [copiedIndex, setCopiedIndex] = useState(null);

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const filteredSorted = useMemo(() => {
    let items = [...(transactions || [])];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (t) =>
          (t.date || "").toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q) ||
          (t.sourceFile || "").toLowerCase().includes(q) ||
          String(t.amount).includes(q)
      );
    }

    if (sortColumn) {
      const dir = sortDirection === "asc" ? 1 : -1;
      items.sort((a, b) => {
        switch (sortColumn) {
          case "amount":
            return dir * ((Number(a.amount) || 0) - (Number(b.amount) || 0));
          case "date":
            return dir * compareDates(a.date, b.date);
          default:
            return dir * String(a[sortColumn] || "").localeCompare(String(b[sortColumn] || ""));
        }
      });
    }

    return items;
  }, [transactions, searchQuery, sortColumn, sortDirection]);

  const toggleExpand = (index) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const copyRow = (row, index) => {
    const text = `${row.date}\t${row.amount}\t${row.description}\t${row.sourceFile || ""}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    });
  };

  const columns = [
    { key: "date", label: "Date" },
    { key: "amount", label: "Amount" },
    { key: "description", label: "Description" },
    { key: "sourceFile", label: "Source" },
  ];

  if (!transactions || transactions.length === 0) return null;

  return (
    <div className="transaction-table-section">
      <div className="transaction-search-wrap">
        <span className="transaction-search-icon">{"\u2315"}</span>
        <input
          type="text"
          className="transaction-search"
          placeholder="Search transactions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="transaction-search-clear"
            onClick={() => setSearchQuery("")}
          >
            {"\u2715"}
          </button>
        )}
      </div>

      <div className="preview-table-wrap">
        {filteredSorted.length === 0 ? (
          <p className="table-empty">No transactions match your search.</p>
        ) : (
          <table className="preview-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={sortColumn === col.key ? "sort-active" : ""}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    <span className="sort-arrow">
                      {sortColumn === col.key
                        ? sortDirection === "asc"
                          ? "\u25B2"
                          : "\u25BC"
                        : "\u25B4"}
                    </span>
                  </th>
                ))}
                <th style={{ width: "60px" }} />
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((row, i) => {
                const amount = Number(row.amount);
                return (
                  <tr key={i} style={{ animationDelay: `${i * 20}ms` }}>
                    <td style={{ whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                      {row.date}
                    </td>
                    <td
                      className={`amount ${amount > 0 ? "positive" : amount < 0 ? "negative" : ""}`}
                    >
                      {formatAmount(row.amount)}
                    </td>
                    <td className="description" onClick={() => toggleExpand(i)}>
                      <span
                        className={`description-text ${expandedRows.has(i) ? "expanded" : ""}`}
                        title={row.description}
                      >
                        {row.description}
                      </span>
                    </td>
                    <td className="source-file">{row.sourceFile}</td>
                    <td>
                      <button
                        type="button"
                        className={`copy-row-btn ${copiedIndex === i ? "copied" : ""}`}
                        onClick={() => copyRow(row, i)}
                      >
                        {copiedIndex === i ? "Copied!" : "Copy"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="table-count">
        {filteredSorted.length} of {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
        {searchQuery ? " (filtered)" : ""}
      </p>
    </div>
  );
}
