import { useEffect, useMemo, useRef, useState } from "react";
import UploadZone from "./components/UploadZone";
import ResultPanel from "./components/ResultPanel";
import "./styles.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const REMOVE_ANIMATION_MS = 220;
const COMPLETION_PULSE_MS = 1400;
const UPDATE_STORAGE_KEY = "phantom-ledger-last-update-id";
const UPDATE_CARD = {
  id: "2026-02-22-cleaning-and-filename",
  label: "Update",
  date: "Feb 22, 2026",
  title: "Cleaner transaction names + statement-based Excel filename",
  items: [
    "Memo cleaning now follows your manual DocuClipper style for wire/deposit/card patterns.",
    "Downloaded Excel uses the business/person name from statement metadata when available.",
    "Date and amount export formatting was adjusted for plain values."
  ]
};

function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** power);
  return `${value.toFixed(value >= 10 || power === 0 ? 0 : 1)} ${units[power]}`;
}

function decodeHeaderJson(value, fallbackValue) {
  if (!value) {
    return fallbackValue;
  }

  try {
    return JSON.parse(atob(value));
  } catch (_error) {
    return fallbackValue;
  }
}

function extractFilename(contentDisposition) {
  if (!contentDisposition) {
    return "accuracy-phantom-ledger.xlsx";
  }

  const match = contentDisposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  if (!match) {
    return "accuracy-phantom-ledger.xlsx";
  }

  return decodeURIComponent(match[1].replace(/"/g, "")).trim() || "accuracy-phantom-ledger.xlsx";
}

function downloadBlob(blob, filename) {
  if (!(blob instanceof Blob)) {
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [queueItems, setQueueItems] = useState([]);
  const [status, setStatus] = useState("Upload one or more digital bank statement PDFs to begin.");
  const [statusError, setStatusError] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [isCompletionPulseActive, setIsCompletionPulseActive] = useState(false);
  const [isUpdateVisible, setIsUpdateVisible] = useState(false);

  const progressIntervalRef = useRef(null);
  const completionPulseTimeoutRef = useRef(null);

  const activeQueueItems = useMemo(
    () => queueItems.filter((item) => !item.isRemoving),
    [queueItems]
  );

  const totalSize = useMemo(
    () => activeQueueItems.reduce((sum, item) => sum + item.file.size, 0),
    [activeQueueItems]
  );

  const canProcess = activeQueueItems.length > 0 && !isProcessing;

  const setStatusMessage = (message, isError = false) => {
    setStatus(message);
    setStatusError(isError);
  };

  const stopProgressSimulation = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  const triggerCompletionPulse = () => {
    setIsCompletionPulseActive(true);

    if (completionPulseTimeoutRef.current) {
      clearTimeout(completionPulseTimeoutRef.current);
    }

    completionPulseTimeoutRef.current = setTimeout(() => {
      setIsCompletionPulseActive(false);
      completionPulseTimeoutRef.current = null;
    }, COMPLETION_PULSE_MS);
  };

  useEffect(() => () => {
    stopProgressSimulation();
    if (completionPulseTimeoutRef.current) {
      clearTimeout(completionPulseTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    try {
      const seenUpdateId = localStorage.getItem(UPDATE_STORAGE_KEY);
      setIsUpdateVisible(seenUpdateId !== UPDATE_CARD.id);
    } catch (_error) {
      setIsUpdateVisible(true);
    }
  }, []);

  const dismissUpdateCard = () => {
    setIsUpdateVisible(false);
    try {
      localStorage.setItem(UPDATE_STORAGE_KEY, UPDATE_CARD.id);
    } catch (_error) {
      // localStorage may be unavailable; no-op
    }
  };

  const startProgressSimulation = () => {
    setProgress(5);
    stopProgressSimulation();

    progressIntervalRef.current = setInterval(() => {
      setProgress((current) => {
        if (current >= 92) {
          return current;
        }

        const step = Math.max(1, Math.round(Math.random() * 5));
        return Math.min(92, current + step);
      });
    }, 220);
  };

  const addFiles = (newFiles) => {
    if (!newFiles?.length || isProcessing) {
      return;
    }

    const merged = new Map(queueItems.map((item) => [item.id, item]));
    for (const file of newFiles) {
      const id = fileKey(file);
      const existing = merged.get(id);
      if (existing) {
        merged.set(id, {
          ...existing,
          file,
          isRemoving: false
        });
      } else {
        merged.set(id, {
          id,
          file,
          isRemoving: false
        });
      }
    }

    const nextQueueItems = Array.from(merged.values());
    const nextCount = nextQueueItems.filter((item) => !item.isRemoving).length;
    setQueueItems(nextQueueItems);
    setStatusMessage(`Queued ${nextCount} PDF file(s).`);
  };

  const removeFile = (fileId) => {
    if (isProcessing) {
      return;
    }

    const target = queueItems.find((item) => item.id === fileId && !item.isRemoving);
    if (!target) {
      return;
    }

    const remainingCount = Math.max(0, activeQueueItems.length - 1);
    setQueueItems((previous) => previous.map((item) => (
      item.id === fileId ? { ...item, isRemoving: true } : item
    )));

    setTimeout(() => {
      setQueueItems((previous) => previous.filter((item) => item.id !== fileId));
    }, REMOVE_ANIMATION_MS);

    setStatusMessage(
      remainingCount
        ? `Queued ${remainingCount} PDF file(s).`
        : "Upload one or more digital bank statement PDFs to begin."
    );
  };

  const removeAllFiles = () => {
    if (isProcessing || !activeQueueItems.length) {
      return;
    }

    setQueueItems((previous) => previous.map((item) => ({ ...item, isRemoving: true })));
    setTimeout(() => {
      setQueueItems([]);
    }, REMOVE_ANIMATION_MS);

    setResult(null);
    setStatusMessage("Upload one or more digital bank statement PDFs to begin.");
  };

  const onInvalidFileType = () => {
    setStatusMessage("Only .pdf files are accepted.", true);
  };

  const handleProcess = async () => {
    if (!activeQueueItems.length || isProcessing) {
      return;
    }

    setResult(null);
    setIsProcessing(true);
    setStatusMessage(`Processing ${activeQueueItems.length} file(s)...`);
    startProgressSimulation();

    try {
      const formData = new FormData();
      for (const item of activeQueueItems) {
        formData.append("pdfs", item.file);
      }

      const response = await fetch(`${API_BASE}/process`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to process files.");
      }

      const summary = decodeHeaderJson(response.headers.get("x-phantom-summary"), null);
      const warnings = decodeHeaderJson(response.headers.get("x-phantom-warnings"), []);
      const previewTransactions = decodeHeaderJson(response.headers.get("x-phantom-preview"), []);
      const workbookBlob = await response.blob();
      const downloadFileName = extractFilename(response.headers.get("content-disposition"));

      setProgress(100);
      setResult({
        summary,
        warnings: Array.isArray(warnings) ? warnings : [],
        previewTransactions: Array.isArray(previewTransactions) ? previewTransactions : [],
        workbookBlob,
        downloadFileName
      });

      const totalTransactions = summary?.totalTransactions ?? 0;
      const warningCount = Array.isArray(warnings) ? warnings.length : 0;
      if (warningCount > 0) {
        setStatusMessage(
          `Extracted ${totalTransactions} transaction(s). ${warningCount} warning(s) found. Ready to download.`,
          true
        );
      } else {
        setStatusMessage(`Extracted ${totalTransactions} transaction(s). Ready to download.`);
      }

      triggerCompletionPulse();
    } catch (error) {
      setResult(null);
      setProgress(0);
      setStatusMessage(error.message || "Processing failed.", true);
    } finally {
      stopProgressSimulation();
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result?.workbookBlob) {
      return;
    }

    downloadBlob(result.workbookBlob, result.downloadFileName || "accuracy-phantom-ledger.xlsx");
  };

  return (
    <main className={`app-shell ${isCompletionPulseActive ? "extraction-done" : ""}`}>
      <header className="app-header">
        <h1>Accuracy Phantom Ledger</h1>
        <p>PDF in, transactions out. Keep the raw memo text and export a clean Excel file.</p>
      </header>

      {isUpdateVisible ? (
        <section className="update-card" aria-live="polite">
          <div className="update-card-head">
            <p className="update-pill">{UPDATE_CARD.label}</p>
            <p className="update-date">{UPDATE_CARD.date}</p>
          </div>
          <h2>{UPDATE_CARD.title}</h2>
          <ul>
            {UPDATE_CARD.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button type="button" className="button-secondary" onClick={dismissUpdateCard}>
            Close
          </button>
        </section>
      ) : null}

      <section className="panel">
        <h2>Upload Bank Statements</h2>
        <UploadZone onFilesAdded={addFiles} onInvalidFiles={onInvalidFileType} disabled={isProcessing} />
        <p className="drop-hint upload-subtext">Supports multiple text-based PDFs. No OCR required.</p>
        <p className={`status-text ${statusError ? "error" : ""}`}>{status}</p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>File Queue</h2>
          <div className="queue-actions">
            <p>{activeQueueItems.length ? `${activeQueueItems.length} file(s) • ${formatBytes(totalSize)}` : "No files added yet."}</p>
            {activeQueueItems.length ? (
              <button
                type="button"
                className="button-secondary"
                onClick={removeAllFiles}
                disabled={isProcessing}
              >
                Remove All
              </button>
            ) : null}
          </div>
        </div>

        {queueItems.length ? (
          <ul className="file-list">
            {queueItems.map((item) => (
              <li className={`file-list-item ${item.isRemoving ? "removing" : ""}`} key={item.id}>
                <div className="file-meta">
                  <p className="file-name" title={item.file.name}>{item.file.name}</p>
                  <p className="file-size">{formatBytes(item.file.size)}</p>
                </div>
                <button
                  type="button"
                  className="delete-mapping"
                  onClick={() => removeFile(item.id)}
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

      <ResultPanel
        canProcess={canProcess}
        fileCount={activeQueueItems.length}
        isProcessing={isProcessing}
        progress={progress}
        result={result}
        onProcess={handleProcess}
        onDownload={handleDownload}
      />
    </main>
  );
}
