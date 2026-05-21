export function createPageViewport({ pageSize, renderSize }) {
  if (!pageSize || !renderSize) throw new Error("pageSize and renderSize are required");
  return {
    pageSize,
    renderSize,
    scaleX: renderSize.width / pageSize.width,
    scaleY: renderSize.height / pageSize.height,
  };
}

export function pdfRectToCanvasRect(rect, viewport) {
  const view = viewport.scaleX ? viewport : createPageViewport(viewport);
  return {
    left: rect.left * view.scaleX,
    top: (view.pageSize.height - rect.top) * view.scaleY,
    width: (rect.right - rect.left) * view.scaleX,
    height: (rect.top - rect.bottom) * view.scaleY,
  };
}

export function canvasRectToPdfRect(rect, viewport) {
  const view = viewport.scaleX ? viewport : createPageViewport(viewport);
  const left = rect.left / view.scaleX;
  const right = (rect.left + rect.width) / view.scaleX;
  const top = view.pageSize.height - rect.top / view.scaleY;
  const bottom = view.pageSize.height - (rect.top + rect.height) / view.scaleY;
  return normalizePdfRect({ left, bottom, right, top });
}

export function clientPointToCanvasPoint(event, canvas) {
  const bounds = canvas.getBoundingClientRect();
  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;
  return {
    x: (event.clientX - bounds.left) * scaleX,
    y: (event.clientY - bounds.top) * scaleY,
  };
}

export function canvasPointToPdfPoint(point, viewport) {
  const view = viewport.scaleX ? viewport : createPageViewport(viewport);
  return {
    x: point.x / view.scaleX,
    y: view.pageSize.height - point.y / view.scaleY,
  };
}

export function clientPointToPdfPoint(event, canvas, viewport) {
  return canvasPointToPdfPoint(clientPointToCanvasPoint(event, canvas), viewport);
}

export function normalizePdfRect(rect) {
  return {
    left: Math.min(rect.left, rect.right),
    bottom: Math.min(rect.bottom, rect.top),
    right: Math.max(rect.left, rect.right),
    top: Math.max(rect.bottom, rect.top),
  };
}

export function pdfRectContainsPoint(rect, point) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.bottom && point.y <= rect.top;
}

export function pdfRectsIntersect(a, b) {
  return a.left <= b.right && a.right >= b.left && a.bottom <= b.top && a.top >= b.bottom;
}
