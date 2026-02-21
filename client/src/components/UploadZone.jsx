import { useRef, useState } from "react";

function isPdf(file) {
  if (!file) {
    return false;
  }

  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

export default function UploadZone({ onFilesAdded, onInvalidFiles, disabled }) {
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef(null);

  const pickFiles = (fileList) => {
    if (disabled) {
      return;
    }

    const pdfFiles = Array.from(fileList || []).filter(isPdf);
    if (!pdfFiles.length) {
      onInvalidFiles?.();
      return;
    }

    onFilesAdded(pdfFiles);
  };

  const openFileDialog = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  return (
    <div
      className={`drop-zone ${isDragActive ? "drag-active" : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={(event) => {
        if (event.target.tagName !== "BUTTON") {
          openFileDialog();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openFileDialog();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) {
          setIsDragActive(true);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragActive(false);
        pickFiles(event.dataTransfer.files);
      }}
      aria-disabled={disabled}
      aria-label="Upload PDF files"
    >
      <p>Drag and drop statement PDFs here</p>
      <p className="drop-hint">or</p>
      <button
        type="button"
        className="button-secondary"
        disabled={disabled}
        onClick={openFileDialog}
      >
        Choose files
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        hidden
        disabled={disabled}
        onChange={(event) => {
          pickFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
