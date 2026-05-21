import { canvasRectToPdfRect, clientPointToCanvasPoint, clientPointToPdfPoint } from "./pdf-coordinates.js";
import { areaSelectItems, hitTestItems } from "./hit-testing.js";
import { SELECTION_MODES } from "./selection-state.js";

export const DRAG_THRESHOLD_PX = 4;

export function selectableKindsForMode(mode) {
  if (mode === SELECTION_MODES.SELECT_TEXT) return new Set(["text"]);
  if (mode === SELECTION_MODES.SELECT_OBJECT) return new Set(["pageObject", "image"]);
  if (mode === SELECTION_MODES.SELECT_ANNOTATION) return new Set(["annotation"]);
  if (mode === SELECTION_MODES.SELECT_FORM_WIDGET) return new Set(["formWidget"]);
  if (mode === SELECTION_MODES.AREA_SELECT) return new Set(["text", "pageObject", "image", "annotation", "formWidget"]);
  return new Set();
}

export function selectableItemsForMode(items, mode) {
  const kinds = selectableKindsForMode(mode);
  if (kinds.size === 0) return [];
  return items.filter((item) => kinds.has(item.kind));
}

export function pointerEventToViewerPoints(event, canvas, viewport) {
  return {
    canvas: clientPointToCanvasPoint(event, canvas),
    pdf: clientPointToPdfPoint(event, canvas, viewport),
    client: {
      x: event.clientX,
      y: event.clientY,
    },
  };
}

export function canvasDragRect(startPoint, currentPoint) {
  if (!startPoint || !currentPoint) return null;
  const left = Math.min(startPoint.x, currentPoint.x);
  const top = Math.min(startPoint.y, currentPoint.y);
  return {
    left,
    top,
    width: Math.abs(currentPoint.x - startPoint.x),
    height: Math.abs(currentPoint.y - startPoint.y),
  };
}

export function isAreaDrag(rect, threshold = DRAG_THRESHOLD_PX) {
  return Boolean(rect) && Math.max(rect.width, rect.height) >= threshold;
}

export function hitTestSelectionItems(items, mode, pdfPoint) {
  return hitTestItems(selectableItemsForMode(items, mode), pdfPoint);
}

export function areaSelectSelectionItems(items, mode, canvasRect, viewport) {
  if (!canvasRect) return [];
  return areaSelectItems(selectableItemsForMode(items, mode), canvasRectToPdfRect(canvasRect, viewport));
}
