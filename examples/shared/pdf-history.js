export function createPdfSnapshotHistory({ limit = 20 } = {}) {
  return {
    limit,
    undoStack: [],
    redoStack: [],
  };
}

export function clearHistory(history) {
  history.undoStack = [];
  history.redoStack = [];
}

export function pushSnapshot(history, label, pdfBytes) {
  if (!pdfBytes) return;
  history.undoStack.push({
    label,
    pdfBytes: new Uint8Array(pdfBytes),
  });
  if (history.undoStack.length > history.limit) history.undoStack.shift();
  history.redoStack = [];
}

export function canUndo(history) {
  return history.undoStack.length > 0;
}

export function canRedo(history) {
  return history.redoStack.length > 0;
}

export function undoSnapshot(history, currentBytes) {
  if (!canUndo(history)) return null;
  const snapshot = history.undoStack.pop();
  if (currentBytes) {
    history.redoStack.push({
      label: snapshot.label,
      pdfBytes: new Uint8Array(currentBytes),
    });
  }
  return snapshot;
}

export function redoSnapshot(history, currentBytes) {
  if (!canRedo(history)) return null;
  const snapshot = history.redoStack.pop();
  if (currentBytes) {
    history.undoStack.push({
      label: snapshot.label,
      pdfBytes: new Uint8Array(currentBytes),
    });
    if (history.undoStack.length > history.limit) history.undoStack.shift();
  }
  return snapshot;
}
