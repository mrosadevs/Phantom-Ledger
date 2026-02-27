import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UploadZone from "./components/UploadZone";
import ResultPanel from "./components/ResultPanel";
import FileQueue from "./components/FileQueue";
import StatsPanel from "./components/StatsPanel";
import ThemeToggle from "./components/ThemeToggle";
import KeyboardShortcuts, { ShortcutHelpOverlay } from "./components/KeyboardShortcuts";
import MatrixRain from "./components/MatrixRain";
import "./styles.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const REMOVE_ANIMATION_MS = 220;
const COMPLETION_PULSE_MS = 1400;
const UPDATE_STORAGE_KEY = "phantom-ledger-last-update-id";
const THEME_STORAGE_KEY = "phantom-ledger-theme";

const UPDATE_CARD = {
  id: "2026-02-27-groq-ai-cleaning",
  label: "New",
  date: "Feb 27, 2026",
  title: "AI-powered transaction cleaning",
  items: [
    "Transaction descriptions are now cleaned by AI \u2014 proper casing, merchant name extraction, and shorter fee labels.",
    "Powered by Groq for near-instant processing, even on large statement batches.",
    "Falls back to rule-based cleaning automatically if AI is unavailable.",
    "Fixed sign detection for Citibank statements \u2014 incoming wires no longer incorrectly marked as debits.",
  ],
};

function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function decodeHeaderJson(value, fallbackValue) {
  if (!value) return fallbackValue;
  try {
    return JSON.parse(atob(value));
  } catch {
    return fallbackValue;
  }
}

function extractFilename(contentDisposition) {
  if (!contentDisposition) return "accuracy-phantom-ledger.xlsx";
  const match = contentDisposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  if (!match) return "accuracy-phantom-ledger.xlsx";
  return decodeURIComponent(match[1].replace(/"/g, "")).trim() || "accuracy-phantom-ledger.xlsx";
}

function downloadBlob(blob, filename) {
  if (!(blob instanceof Blob)) return;
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
  // Theme
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved) return saved;
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  // Core state
  const [queueItems, setQueueItems] = useState([]);
  const [status, setStatus] = useState("Upload one or more digital bank statement PDFs to begin.");
  const [statusError, setStatusError] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [isCompletionPulseActive, setIsCompletionPulseActive] = useState(false);
  const [isUpdateVisible, setIsUpdateVisible] = useState(false);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);

  const progressIntervalRef = useRef(null);
  const completionPulseTimeoutRef = useRef(null);
  const uploadTriggerRef = useRef(null);

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
    if (completionPulseTimeoutRef.current) clearTimeout(completionPulseTimeoutRef.current);
  }, []);

  useEffect(() => {
    try {
      const seenUpdateId = localStorage.getItem(UPDATE_STORAGE_KEY);
      setIsUpdateVisible(seenUpdateId !== UPDATE_CARD.id);
    } catch {
      setIsUpdateVisible(true);
    }
  }, []);

  const dismissUpdateCard = () => {
    setIsUpdateVisible(false);
    try { localStorage.setItem(UPDATE_STORAGE_KEY, UPDATE_CARD.id); } catch {}
  };

  const startProgressSimulation = () => {
    setProgress(5);
    stopProgressSimulation();
    progressIntervalRef.current = setInterval(() => {
      setProgress((current) => {
        if (current >= 92) return current;
        const step = Math.max(1, Math.round(Math.random() * 5));
        return Math.min(92, current + step);
      });
    }, 220);
  };

  const updateQueueStatuses = (status) => {
    setQueueItems((prev) =>
      prev.map((item) => (item.isRemoving ? item : { ...item, status }))
    );
  };

  const addFiles = (newFiles) => {
    if (!newFiles?.length || isProcessing) return;

    const merged = new Map(queueItems.map((item) => [item.id, item]));
    for (const file of newFiles) {
      const id = fileKey(file);
      const existing = merged.get(id);
      if (existing) {
        merged.set(id, { ...existing, file, isRemoving: false, status: "queued" });
      } else {
        merged.set(id, { id, file, isRemoving: false, status: "queued" });
      }
    }

    const nextQueueItems = Array.from(merged.values());
    const nextCount = nextQueueItems.filter((item) => !item.isRemoving).length;
    setQueueItems(nextQueueItems);
    setStatusMessage(`Queued ${nextCount} PDF file(s).`);
  };

  const removeFile = (fileId) => {
    if (isProcessing) return;
    const target = queueItems.find((item) => item.id === fileId && !item.isRemoving);
    if (!target) return;

    const remainingCount = Math.max(0, activeQueueItems.length - 1);
    setQueueItems((prev) =>
      prev.map((item) => (item.id === fileId ? { ...item, isRemoving: true } : item))
    );
    setTimeout(() => {
      setQueueItems((prev) => prev.filter((item) => item.id !== fileId));
    }, REMOVE_ANIMATION_MS);

    setStatusMessage(
      remainingCount
        ? `Queued ${remainingCount} PDF file(s).`
        : "Upload one or more digital bank statement PDFs to begin."
    );
  };

  const removeAllFiles = () => {
    if (isProcessing || !activeQueueItems.length) return;
    setQueueItems((prev) => prev.map((item) => ({ ...item, isRemoving: true })));
    setTimeout(() => setQueueItems([]), REMOVE_ANIMATION_MS);
    setResult(null);
    setStatusMessage("Upload one or more digital bank statement PDFs to begin.");
  };

  const onInvalidFileType = () => {
    setStatusMessage("Only .pdf files are accepted.", true);
  };

  const handleProcess = useCallback(async () => {
    if (!activeQueueItems.length || isProcessing) return;

    setResult(null);
    setIsProcessing(true);
    setStatusMessage(`Processing ${activeQueueItems.length} file(s)\u2026`);
    updateQueueStatuses("processing");
    startProgressSimulation();

    try {
      const formData = new FormData();
      for (const item of activeQueueItems) {
        formData.append("pdfs", item.file);
      }

      const response = await fetch(`${API_BASE}/process`, {
        method: "POST",
        body: formData,
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
      updateQueueStatuses("complete");
      setResult({
        summary,
        warnings: Array.isArray(warnings) ? warnings : [],
        previewTransactions: Array.isArray(previewTransactions) ? previewTransactions : [],
        workbookBlob,
        downloadFileName,
      });

      const totalTransactions = summary?.totalTransactions ?? 0;
      const warningCount = Array.isArray(warnings) ? warnings.length : 0;
      if (warningCount > 0) {
        setStatusMessage(
          `Extracted ${totalTransactions} transaction(s). ${warningCount} warning(s). Ready to download.`,
          true
        );
      } else {
        setStatusMessage(`Extracted ${totalTransactions} transaction(s). Ready to download.`);
      }

      triggerCompletionPulse();
    } catch (error) {
      setResult(null);
      setProgress(0);
      updateQueueStatuses("error");
      setStatusMessage(error.message || "Processing failed.", true);
    } finally {
      stopProgressSimulation();
      setIsProcessing(false);
    }
  }, [activeQueueItems, isProcessing]);

  const handleDownload = useCallback(() => {
    if (!result?.workbookBlob) return;
    downloadBlob(result.workbookBlob, result.downloadFileName || "accuracy-phantom-ledger.xlsx");
  }, [result]);

  const handleToggleHelp = useCallback((forceClose) => {
    if (forceClose === false) {
      setIsShortcutHelpOpen(false);
    } else {
      setIsShortcutHelpOpen((v) => !v);
    }
  }, []);

  return (
    <>
    <MatrixRain />
    <main className={`app-shell ${isCompletionPulseActive ? "extraction-done" : ""}`}>
      <header className="app-header">
        <div className="header-content">
          <h1>Accuracy Phantom Ledger</h1>
          <p>PDF in, transactions out. Extract and export clean Excel files.</p>
        </div>
        <div className="header-actions">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
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
            Dismiss
          </button>
        </section>
      ) : null}

      <section className="panel upload-panel">
        <h2>Upload Statements</h2>
        <UploadZone
          onFilesAdded={addFiles}
          onInvalidFiles={onInvalidFileType}
          disabled={isProcessing}
          triggerRef={uploadTriggerRef}
        />
        <p className="drop-hint upload-subtext">
          Supports multiple text-based PDFs. No OCR required.
        </p>
        <p className={`status-text ${statusError ? "error" : ""}`}>{status}</p>
      </section>

      <FileQueue
        queueItems={queueItems}
        activeCount={activeQueueItems.length}
        totalSize={totalSize}
        isProcessing={isProcessing}
        onRemove={removeFile}
        onRemoveAll={removeAllFiles}
      />

      <ResultPanel
        canProcess={canProcess}
        fileCount={activeQueueItems.length}
        isProcessing={isProcessing}
        progress={progress}
        result={result}
        onProcess={handleProcess}
        onDownload={handleDownload}
      />

      {result?.previewTransactions?.length > 0 && (
        <StatsPanel
          transactions={result.previewTransactions}
          summary={result.summary}
        />
      )}

      <KeyboardShortcuts
        onTriggerUpload={() => uploadTriggerRef.current?.open()}
        onTriggerProcess={handleProcess}
        onTriggerDownload={handleDownload}
        canProcess={canProcess}
        hasDownload={Boolean(result?.workbookBlob)}
        onToggleHelp={handleToggleHelp}
      />

      {isShortcutHelpOpen && (
        <ShortcutHelpOverlay onClose={() => setIsShortcutHelpOpen(false)} />
      )}
    </main>
    </>
  );
}
