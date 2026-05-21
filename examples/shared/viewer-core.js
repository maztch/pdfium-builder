export function clampZoom(zoom, { min = 0.25, max = 3 } = {}) {
  return Math.min(max, Math.max(min, Number(zoom.toFixed(2))));
}

export function zoomIn(zoom, step = 0.25, limits) {
  return clampZoom(zoom + step, limits);
}

export function zoomOut(zoom, step = 0.25, limits) {
  return clampZoom(zoom - step, limits);
}

export function pageRenderSize(pageSize, zoom) {
  return {
    width: Math.max(1, Math.round(pageSize.width * zoom)),
    height: Math.max(1, Math.round(pageSize.height * zoom)),
  };
}

export function drawRgbaToCanvas({ canvas, overlay, rgbaBytes, width, height }) {
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (overlay) {
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
  }
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgbaBytes), width, height), 0, 0);
}

export function nextPageIndex(pageIndex, pageCount) {
  return Math.min(pageCount - 1, pageIndex + 1);
}

export function previousPageIndex(pageIndex) {
  return Math.max(0, pageIndex - 1);
}
