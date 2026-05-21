import { pdfRectContainsPoint, pdfRectsIntersect } from "./pdf-coordinates.js";

export function hitTestItems(items, point, { reverse = true } = {}) {
  const list = reverse ? [...items].reverse() : items;
  return list.find((item) => item.rect && pdfRectContainsPoint(item.rect, point)) || null;
}

export function areaSelectItems(items, rect) {
  return items.filter((item) => item.rect && pdfRectsIntersect(item.rect, rect));
}
