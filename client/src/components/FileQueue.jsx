import { useState } from "react";

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** power);
  return `${value.toFixed(value >= 10 || power === 0 ? 0 : 1)} ${units[power]}`;
}

export default function FileQueue({
  queueItems,
  activeCount,
  totalSize,
  isProcessing,
  onRemove,
  onRemoveAll,
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="panel queue-panel">
      <div className="panel-header">
        <h2>File Queue</h2>
        <div className="queue-actions">
          <p className="queue-summary">
            {activeCount > 0
              ? `${activeCount} file${activeCount !== 1 ? "s" : ""} \u00B7 ${formatBytes(totalSize)}`
              : "No files added"}
          </p>
          {activeCount > 0 && (
            <button
              type="button"
              className="button-secondary"
              onClick={onRemoveAll}
              disabled={isProcessing}
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {activeCount > 0 && (
        <button
          type="button"
          className="queue-collapse-toggle"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? `Show ${activeCount} file${activeCount !== 1 ? "s" : ""}` : "Collapse"}
        </button>
      )}

      {queueItems.length > 0 ? (
        <ul className={`file-list ${collapsed ? "collapsed" : ""}`}>
          {queueItems.map((item) => (
            <li
              className={`file-list-item ${item.isRemoving ? "removing" : ""}`}
              key={item.id}
            >
              <div className="file-item-left">
                <span className={`file-status-dot ${item.status || "queued"}`} />
                <div className="file-meta">
                  <p className="file-name" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <p className="file-size">{formatBytes(item.file.size)}</p>
                </div>
              </div>
              <button
                type="button"
                className="delete-mapping"
                onClick={() => onRemove(item.id)}
                disabled={isProcessing || item.isRemoving}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-note">Add at least one PDF to enable extraction.</p>
      )}
    </section>
  );
}
