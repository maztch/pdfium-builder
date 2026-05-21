import { pdfRectToCanvasRect } from "./pdf-coordinates.js";
import { appendRectOverlay } from "./overlays.js";

const RESIZE_HANDLE_NAMES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function renderSelectionOverlays(overlay, selection, {
  viewport,
  pageIndex,
  dragRect = null,
} = {}) {
  if (!selection || !viewport) return;

  if (selection.hoverItem?.pageIndex === pageIndex && selection.hoverItem.rect) {
    appendSelectionRect(overlay, selection.hoverItem, {
      viewport,
      className: "selection-box hover",
    });
  }

  const visibleSelectedItems = selection.selectedItems.filter((item) => item.pageIndex === pageIndex && item.rect);
  for (const item of visibleSelectedItems) {
    appendSelectionRect(overlay, item, {
      viewport,
      className: `selection-box selected ${selectionClassForKind(item.kind)}${visibleSelectedItems.length > 1 ? " multi" : ""}`,
    });
  }

  for (const item of visibleSelectedItems) {
    if (item.kind === "text") continue;
    appendResizeHandles(overlay, item.rect, viewport);
  }

  if (selection.drag.active && visibleSelectedItems.length > 0) {
    for (const item of visibleSelectedItems) {
      appendSelectionRect(overlay, item, {
        viewport,
        className: "selection-box drag-ghost",
      });
    }
  }

  if (selection.drag.active && dragRect) {
    appendCanvasRect(overlay, dragRect, "selection-marquee");
  }
}

function appendSelectionRect(overlay, item, { viewport, className }) {
  appendRectOverlay(overlay, item.rect, {
    viewport,
    className,
    dataset: {
      key: item.key || "",
      kind: item.kind || "",
    },
  });
}

function appendResizeHandles(overlay, rect, viewport) {
  const canvasRect = pdfRectToCanvasRect(rect, viewport);
  for (const name of RESIZE_HANDLE_NAMES) {
    const handle = document.createElement("div");
    handle.className = `selection-handle ${name}`;
    const point = handlePoint(name, canvasRect);
    handle.style.left = `${point.x}px`;
    handle.style.top = `${point.y}px`;
    overlay.append(handle);
  }
}

function appendCanvasRect(overlay, rect, className) {
  const node = document.createElement("div");
  node.className = className;
  node.style.left = `${rect.left}px`;
  node.style.top = `${rect.top}px`;
  node.style.width = `${rect.width}px`;
  node.style.height = `${rect.height}px`;
  overlay.append(node);
}

function handlePoint(name, rect) {
  const xMid = rect.left + rect.width / 2;
  const yMid = rect.top + rect.height / 2;
  const xRight = rect.left + rect.width;
  const yBottom = rect.top + rect.height;
  const map = {
    nw: { x: rect.left, y: rect.top },
    n: { x: xMid, y: rect.top },
    ne: { x: xRight, y: rect.top },
    e: { x: xRight, y: yMid },
    se: { x: xRight, y: yBottom },
    s: { x: xMid, y: yBottom },
    sw: { x: rect.left, y: yBottom },
    w: { x: rect.left, y: yMid },
  };
  return map[name];
}

function selectionClassForKind(kind) {
  if (!kind) return "kind-item";
  return `kind-${kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
