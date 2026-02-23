import { useEffect } from "react";

export default function KeyboardShortcuts({
  onTriggerUpload,
  onTriggerProcess,
  onTriggerDownload,
  canProcess,
  hasDownload,
  onToggleHelp,
}) {
  useEffect(() => {
    const handler = (e) => {
      // Don't fire when typing in inputs
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        if (e.key === "Escape") {
          e.target.blur();
        }
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      if (e.key === "?" && !ctrl) {
        e.preventDefault();
        onToggleHelp();
        return;
      }

      if (e.key === "Escape") {
        onToggleHelp(false);
        return;
      }

      if (ctrl && e.key.toLowerCase() === "u") {
        e.preventDefault();
        onTriggerUpload();
        return;
      }

      if (ctrl && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (canProcess) onTriggerProcess();
        return;
      }

      if (ctrl && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (hasDownload) onTriggerDownload();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTriggerUpload, onTriggerProcess, onTriggerDownload, canProcess, hasDownload, onToggleHelp]);

  return null;
}

export function ShortcutHelpOverlay({ onClose }) {
  const shortcuts = [
    { keys: ["Ctrl", "U"], label: "Upload files" },
    { keys: ["Ctrl", "E"], label: "Extract transactions" },
    { keys: ["Ctrl", "D"], label: "Download Excel" },
    { keys: ["?"], label: "Show shortcuts" },
    { keys: ["Esc"], label: "Close / dismiss" },
  ];

  return (
    <div className="shortcut-overlay" onClick={onClose}>
      <div className="shortcut-overlay-card" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard Shortcuts</h2>
        <div className="shortcut-list">
          {shortcuts.map((s) => (
            <div className="shortcut-row" key={s.label}>
              <span className="shortcut-label">{s.label}</span>
              <span className="shortcut-keys">
                {s.keys.map((k) => (
                  <kbd className="kbd" key={k}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="shortcut-close-hint">Press Esc or click outside to close</p>
      </div>
    </div>
  );
}
