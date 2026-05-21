import { pdfRectToCanvasRect } from "./pdf-coordinates.js";

export function clearOverlay(overlay) {
  overlay.replaceChildren();
}

export function appendRectOverlay(overlay, rect, {
  viewport,
  active = false,
  className = "overlay-rect",
  activeClassName = "active",
  minSize = 1,
  dataset = {},
} = {}) {
  const canvasRect = pdfRectToCanvasRect(rect, viewport);
  const node = document.createElement("div");
  node.className = `${className}${active ? ` ${activeClassName}` : ""}`;
  node.style.left = `${canvasRect.left}px`;
  node.style.top = `${canvasRect.top}px`;
  node.style.width = `${Math.max(minSize, canvasRect.width)}px`;
  node.style.height = `${Math.max(minSize, canvasRect.height)}px`;
  for (const [key, value] of Object.entries(dataset)) node.dataset[key] = String(value);
  overlay.append(node);
  return node;
}

export function renderRectOverlays(overlay, items, options = {}) {
  clearOverlay(overlay);
  for (const item of items) {
    appendRectOverlay(overlay, item.rect, {
      ...options,
      active: Boolean(item.active),
      dataset: item.dataset || {},
    });
  }
}
