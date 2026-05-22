import {
  createDecodedImagePayload,
  createPdfiumApi,
} from "../../pdfium-api.js";
import {
  isEditableShortcutTarget,
  KEYBOARD_ACTIONS,
  keyboardShortcutFromEvent,
} from "../shared/keyboard-shortcuts.js";
import {
  canvasRectToPdfRect,
  pdfRectToCanvasRect,
  pdfRectsIntersect,
} from "../shared/pdf-coordinates.js";
import {
  canRedo,
  canUndo,
  clearHistory,
  createPdfSnapshotHistory,
  pushSnapshot,
  redoSnapshot,
  undoSnapshot,
} from "../shared/pdf-history.js";
import {
  areaSelectSelectionItems,
  canvasDragRect as dragRectFromPoints,
  hitTestSelectionItems,
  isAreaDrag,
  pointerEventToViewerPoints,
} from "../shared/pointer-interactions.js";
import { renderSelectionInspector } from "../shared/selection-inspector.js";
import { renderSelectionOverlays } from "../shared/selection-overlays.js";
import {
  clearSelection,
  createSelectionState,
  endDrag,
  replaceSelection,
  selectItem,
  selectionItemKey,
  SELECTION_MODES,
  SELECTION_MODE_LABELS,
  selectionSummary,
  setHoverItem,
  setSelectionMode,
  startDrag,
  updateDrag,
} from "../shared/selection-state.js";
import { drawRgbaToCanvas } from "../shared/viewer-core.js";
const RENDER_ANNOTATIONS = 0x01;
const SNAP_THRESHOLD_PT = 6;

// Shared app state and DOM handles.
const state = {
  api: null,
  doc: null,
  fileName: "",
  pageIndex: 0,
  pageCount: 0,
  pageSize: null,
  renderSize: null,
  zoom: 1,
  rendering: false,
  dirty: false,
  selection: createSelectionState({ mode: SELECTION_MODES.SELECT_OBJECT }),
  history: createPdfSnapshotHistory(),
  selectableItems: [],
  pageText: "",
  decodedImage: null,
  inlineTextEditor: null,
};
const $ = (id) => document.getElementById(id);
const el = {
  pdfInput: $("pdfInput"),
  prevButton: $("prevButton"),
  nextButton: $("nextButton"),
  saveButton: $("saveButton"),
  status: $("status"),
  fileName: $("fileName"),
  pageInfo: $("pageInfo"),
  pageSize: $("pageSize"),
  zoomInfo: $("zoomInfo"),
  dirtyInfo: $("dirtyInfo"),
  mouseInfo: $("mouseInfo"),
  selectedBoundsInfo: $("selectedBoundsInfo"),
  dragInfo: $("dragInfo"),
  selectionModeInfo: $("selectionModeInfo"),
  selectionInfo: $("selectionInfo"),
  clearButton: $("clearButton"),
  deleteButton: $("deleteButton"),
  copyTextButton: $("copyTextButton"),
  duplicateButton: $("duplicateButton"),
  undoInfo: $("undoInfo"),
  redoInfo: $("redoInfo"),
  undoButton: $("undoButton"),
  redoButton: $("redoButton"),
  selectionInspector: $("selectionInspector"),
  objectEditorStatus: $("objectEditorStatus"),
  objectXInput: $("objectXInput"),
  objectYInput: $("objectYInput"),
  objectWidthInput: $("objectWidthInput"),
  objectHeightInput: $("objectHeightInput"),
  applyObjectButton: $("applyObjectButton"),
  textObjectEditorStatus: $("textObjectEditorStatus"),
  textObjectInput: $("textObjectInput"),
  textObjectFontInput: $("textObjectFontInput"),
  textObjectFontSizeInput: $("textObjectFontSizeInput"),
  textObjectColorInput: $("textObjectColorInput"),
  applyTextObjectButton: $("applyTextObjectButton"),
  annotationEditorStatus: $("annotationEditorStatus"),
  annotLeftInput: $("annotLeftInput"),
  annotBottomInput: $("annotBottomInput"),
  annotRightInput: $("annotRightInput"),
  annotTopInput: $("annotTopInput"),
  annotColorInput: $("annotColorInput"),
  annotBorderInput: $("annotBorderInput"),
  annotTextInput: $("annotTextInput"),
  annotUriInput: $("annotUriInput"),
  applyAnnotationButton: $("applyAnnotationButton"),
  createAnnotationType: $("createAnnotationType"),
  createAnnotationColor: $("createAnnotationColor"),
  createAnnotationBorderInput: $("createAnnotationBorderInput"),
  createAnnotationFontSizeInput: $("createAnnotationFontSizeInput"),
  createAnnotationTextInput: $("createAnnotationTextInput"),
  createAnnotationUriInput: $("createAnnotationUriInput"),
  createAnnotationButton: $("createAnnotationButton"),
  moveXInput: $("moveXInput"),
  moveYInput: $("moveYInput"),
  moveLeftButton: $("moveLeftButton"),
  moveRightButton: $("moveRightButton"),
  moveDownButton: $("moveDownButton"),
  moveUpButton: $("moveUpButton"),
  textInput: $("textInput"),
  textXInput: $("textXInput"),
  textYInput: $("textYInput"),
  textWidthInput: $("textWidthInput"),
  textHeightInput: $("textHeightInput"),
  fontSizeInput: $("fontSizeInput"),
  addTextButton: $("addTextButton"),
  imageInput: $("imageInput"),
  imageInfo: $("imageInfo"),
  imageXInput: $("imageXInput"),
  imageYInput: $("imageYInput"),
  imageWidthInput: $("imageWidthInput"),
  imageHeightInput: $("imageHeightInput"),
  insertImageButton: $("insertImageButton"),
  emptyState: $("emptyState"),
  pageStack: $("pageStack"),
  canvas: $("pageCanvas"),
  overlay: $("overlay"),
  selectionToolbar: $("selectionToolbar"),
  toolbarCopyButton: $("toolbarCopyButton"),
  toolbarMoveLeftButton: $("toolbarMoveLeftButton"),
  toolbarMoveUpButton: $("toolbarMoveUpButton"),
  toolbarMoveDownButton: $("toolbarMoveDownButton"),
  toolbarMoveRightButton: $("toolbarMoveRightButton"),
  toolbarShrinkButton: $("toolbarShrinkButton"),
  toolbarGrowButton: $("toolbarGrowButton"),
  toolbarCreateAnnotationButton: $("toolbarCreateAnnotationButton"),
  toolbarEditButton: $("toolbarEditButton"),
  toolbarDuplicateButton: $("toolbarDuplicateButton"),
  toolbarDeleteButton: $("toolbarDeleteButton"),
};

// Status, document lifecycle, and common render updates.
function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle("error", isError);
}
async function getApi() {
  if (!state.api)
    state.api = await createPdfiumApi({
      locateFile: (file) => new URL(`../../dist/${file}`, import.meta.url).href,
    });
  return state.api;
}
function closeDocument() {
  cancelInlineTextEdit();
  if (state.doc) state.doc.close();
  state.doc = null;
  state.pageText = "";
}
function updateControls() {
  const doc = Boolean(state.doc);
  const movable = movableSelection().length > 0;
  const resizable =
    state.selection.selectedItems.length === 1 &&
    isResizableItem(state.selection.selectedItems[0]);
  const text = selectedText();
  const deletable = deletableSelection().length > 0;
  const duplicable = duplicableObjectSelection().length > 0;
  const object = selectedObject();
  const textObject = selectedTextObject();
  const annotation = selectedAnnotation();
  el.prevButton.disabled = !doc || state.rendering || state.pageIndex <= 0;
  el.nextButton.disabled =
    !doc || state.rendering || state.pageIndex >= state.pageCount - 1;
  el.saveButton.disabled = !doc || state.rendering || !state.dirty;
  el.addTextButton.disabled = !doc || state.rendering;
  el.createAnnotationButton.disabled = !doc || state.rendering;
  el.insertImageButton.disabled =
    !doc || state.rendering || !state.decodedImage;
  el.undoButton.disabled = !doc || state.rendering || !canUndo(state.history);
  el.redoButton.disabled = !doc || state.rendering || !canRedo(state.history);
  el.undoInfo.textContent = String(state.history.undoStack.length);
  el.redoInfo.textContent = String(state.history.redoStack.length);
  el.deleteButton.disabled = !deletable;
  el.copyTextButton.disabled = !text;
  el.duplicateButton.disabled = !doc || state.rendering || !duplicable;
  el.moveLeftButton.disabled = !doc || state.rendering || !movable;
  el.moveRightButton.disabled = !doc || state.rendering || !movable;
  el.moveDownButton.disabled = !doc || state.rendering || !movable;
  el.moveUpButton.disabled = !doc || state.rendering || !movable;
  el.applyObjectButton.disabled = !doc || state.rendering || !object;
  el.applyTextObjectButton.disabled = !doc || state.rendering || !textObject;
  el.applyAnnotationButton.disabled = !doc || state.rendering || !annotation;
  el.toolbarCopyButton.disabled = !text;
  el.toolbarDeleteButton.disabled = !deletable;
  el.toolbarDuplicateButton.disabled = !doc || state.rendering || !duplicable;
  el.toolbarCreateAnnotationButton.disabled = !doc || state.rendering;
  el.toolbarMoveLeftButton.disabled = !doc || state.rendering || !movable;
  el.toolbarMoveRightButton.disabled = !doc || state.rendering || !movable;
  el.toolbarMoveDownButton.disabled = !doc || state.rendering || !movable;
  el.toolbarMoveUpButton.disabled = !doc || state.rendering || !movable;
  el.toolbarShrinkButton.disabled = !doc || state.rendering || !resizable;
  el.toolbarGrowButton.disabled = !doc || state.rendering || !resizable;
  el.toolbarEditButton.disabled = state.selection.selectedItems.length === 0;
  el.clearButton.disabled =
    state.selection.selectedItems.length === 0 &&
    !state.selection.currentItem &&
    !state.selection.hoverItem;
}
function renderSelectionState() {
  positionInlineTextEditor();
  el.pageStack.dataset.selectionMode = state.selection.mode;
  el.pageStack.classList.toggle(
    "dragging",
    state.selection.drag.active && state.selection.drag.type === "moveItems",
  );
  el.pageStack.classList.toggle(
    "resizing",
    state.selection.drag.active && state.selection.drag.type === "resizeItem",
  );
  document
    .querySelectorAll("[data-selection-mode]")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.selectionMode === state.selection.mode,
      ),
    );
  el.selectionModeInfo.textContent =
    SELECTION_MODE_LABELS[state.selection.mode] || state.selection.mode;
  el.selectionInfo.textContent = selectionSummary(state.selection);
  renderSelectionInspector(el.selectionInspector, state.selection);
  renderObjectGeometryEditor();
  renderTextObjectEditor();
  renderAnnotationEditor();
  renderSelectionToolbar();
  updateSelectedBoundsInfo();
  updateControls();
}
function changeSelectionMode(mode) {
  cancelInlineTextEdit();
  setResizeHandleCursor(null);
  setSelectionMode(state.selection, mode);
  renderSelectionState();
  renderOverlays();
  setStatus(`Edit mode: ${SELECTION_MODE_LABELS[mode] || mode}.`);
}
function clearEditorSelection() {
  cancelInlineTextEdit();
  clearSelection(state.selection);
  updateDragInfo();
  renderSelectionState();
  renderOverlays();
  setStatus("Selection cleared.");
}
function pushHistorySnapshot(label) {
  if (state.doc) pushSnapshot(state.history, label, state.doc.save());
  updateControls();
}
async function restoreHistorySnapshot(snapshot, message) {
  if (!snapshot) return;
  closeDocument();
  state.doc = state.api.openDocument(snapshot.pdfBytes);
  state.dirty = true;
  clearSelection(state.selection);
  await renderCurrentPage();
  el.dirtyInfo.textContent = "Yes";
  setStatus(`${message}: ${snapshot.label}. Save the PDF to persist changes.`);
  updateControls();
}
async function undoHistory() {
  try {
    if (!state.doc || !canUndo(state.history)) {
      setStatus("Nothing to undo.");
      return;
    }
    await restoreHistorySnapshot(
      undoSnapshot(state.history, state.doc.save()),
      "Undid",
    );
  } catch (e) {
    console.error(e);
    setStatus(e instanceof Error ? e.message : "Unable to undo.", true);
  }
}
async function redoHistory() {
  try {
    if (!state.doc || !canRedo(state.history)) {
      setStatus("Nothing to redo.");
      return;
    }
    await restoreHistorySnapshot(
      redoSnapshot(state.history, state.doc.save()),
      "Redid",
    );
  } catch (e) {
    console.error(e);
    setStatus(e instanceof Error ? e.message : "Unable to redo.", true);
  }
}
function currentViewport() {
  return { pageSize: state.pageSize, renderSize: state.renderSize };
}
function drawRgba(bytes, width, height) {
  drawRgbaToCanvas({
    canvas: el.canvas,
    overlay: el.overlay,
    rgbaBytes: bytes,
    width,
    height,
  });
}
function refreshSelectableItems() {
  state.selectableItems = [];
  if (!state.doc) return;
  try {
    state.selectableItems = state.doc.getSelectableItems(state.pageIndex);
  } catch (e) {
    console.warn(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to refresh selectable items.",
      true,
    );
  }
}
function renderOverlays() {
  el.overlay.replaceChildren();
  if (!state.pageSize || !state.renderSize) return;
  renderSelectionOverlays(el.overlay, state.selection, {
    viewport: currentViewport(),
    pageIndex: state.pageIndex,
    dragRect:
      state.selection.drag.active && state.selection.drag.type === "areaSelect"
        ? canvasDragRect()
        : null,
  });
  renderSnapGuides();
  positionInlineTextEditor();
}
function canvasDragRect() {
  const drag = state.selection.drag;
  return drag.active
    ? dragRectFromPoints(drag.startPoint, drag.currentPoint)
    : null;
}
function formatPt(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "-";
}
function formatRectInfo(rect) {
  return rect
    ? `x ${formatPt(rect.left)}, y ${formatPt(rect.bottom)}, w ${formatPt(rect.right - rect.left)}, h ${formatPt(rect.top - rect.bottom)}`
    : "-";
}
function updateMouseInfo(point) {
  el.mouseInfo.textContent = point
    ? `${formatPt(point.x)}, ${formatPt(point.y)} pt`
    : "-";
}
function updateSelectedBoundsInfo() {
  el.selectedBoundsInfo.textContent = formatRectInfo(
    pdfBounds(
      state.selection.selectedItems.filter(
        (item) => item.pageIndex === state.pageIndex,
      ),
    ),
  );
}
function updateDragInfo(text = "-") {
  el.dragInfo.textContent = text;
}
function selectedCanvasBounds() {
  const items = state.selection.selectedItems.filter(
    (item) => item.pageIndex === state.pageIndex && item.rect,
  );
  if (!items.length || !state.pageSize || !state.renderSize) return null;
  return items
    .map((item) => pdfRectToCanvasRect(item.rect, currentViewport()))
    .reduce(
      (bounds, rect) =>
        bounds
          ? {
              left: Math.min(bounds.left, rect.left),
              top: Math.min(bounds.top, rect.top),
              right: Math.max(bounds.right, rect.left + rect.width),
              bottom: Math.max(bounds.bottom, rect.top + rect.height),
            }
          : {
              left: rect.left,
              top: rect.top,
              right: rect.left + rect.width,
              bottom: rect.top + rect.height,
            },
      null,
    );
}
function renderSelectionToolbar() {
  const bounds = selectedCanvasBounds();
  if (!bounds || state.selection.drag.active) {
    el.selectionToolbar.hidden = true;
    return;
  }
  const x = Math.max(
    96,
    Math.min(state.renderSize.width - 96, (bounds.left + bounds.right) / 2),
  );
  const above = bounds.top >= 52;
  el.selectionToolbar.hidden = false;
  el.selectionToolbar.style.left = `${x}px`;
  if (above) {
    el.selectionToolbar.style.top = `${Math.max(0, bounds.top - 10)}px`;
    el.selectionToolbar.style.transform = "translate(-50%,-100%)";
  } else {
    el.selectionToolbar.style.top = `${Math.min(state.renderSize.height, bounds.bottom + 10)}px`;
    el.selectionToolbar.style.transform = "translate(-50%,0)";
  }
}
function mergeSelectionItems(existing, added) {
  const seen = new Set(existing.map(selectionItemKey));
  const merged = [...existing];
  added.forEach((item) => {
    const key = selectionItemKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  });
  return merged;
}
function textRangeStart(item) {
  return item.startIndex ?? item.data?.startIndex ?? 0;
}
function textRangeLength(item) {
  return (
    item.charCount ??
    item.data?.charCount ??
    String(item.text || item.data?.text || "").length
  );
}

// Selection helpers keep panels, toolbar state, and mutations using one model.
function selectedText() {
  const ranges = state.selection.selectedItems
    .filter((item) => item.kind === "text")
    .map((item) => ({
      start: textRangeStart(item),
      end: textRangeStart(item) + textRangeLength(item),
      top: item.rect?.top ?? 0,
      bottom: item.rect?.bottom ?? 0,
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return "";
  if (!state.pageText)
    return ranges
      .map((range) =>
        state.selectableItems
          .filter(
            (item) =>
              item.kind === "text" &&
              textRangeStart(item) >= range.start &&
              textRangeStart(item) < range.end,
          )
          .sort((a, b) => textRangeStart(a) - textRangeStart(b))
          .map((item) => item.text || item.data?.text || "")
          .join(""),
      )
      .filter(Boolean)
      .join("\n");
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      previous.top = Math.max(previous.top, range.top);
      previous.bottom = Math.min(previous.bottom, range.bottom);
    } else merged.push({ ...range });
  }
  return merged
    .map((range) =>
      state.pageText.slice(range.start, range.end).replace(/\r\n/g, "\n"),
    )
    .join("\n");
}
function selectedObject() {
  return state.selection.selectedItems.length === 1 &&
    isResizableObject(state.selection.selectedItems[0])
    ? state.selection.selectedItems[0]
    : null;
}
function selectedTextObject() {
  const item =
    state.selection.selectedItems.length === 1
      ? state.selection.selectedItems[0]
      : null;
  return item?.kind === "pageObject" && item.type === 1 && item.rect
    ? item
    : null;
}
function selectedAnnotation() {
  return state.selection.selectedItems.length === 1 &&
    state.selection.selectedItems[0].kind === "annotation"
    ? state.selection.selectedItems[0]
    : null;
}
function isFreeTextAnnotation(item) {
  return (
    item?.kind === "annotation" &&
    (item.subtypeName === "freeText" ||
      item.data?.subtypeName === "freeText" ||
      item.subtype === 3 ||
      item.data?.subtype === 3)
  );
}
function numberValue(input) {
  return Number(input.value);
}
function colorToRgba(color, alpha = 255) {
  const hex = color.replace("#", "");
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return ((alpha & 0xff) << 24) | (r << 16) | (g << 8) | b;
}
function rgbaToHex(rgba) {
  if (!Number.isInteger(rgba)) return "#f59e0b";
  const r = (rgba >> 16) & 0xff;
  const g = (rgba >> 8) & 0xff;
  const b = rgba & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
function setObjectInputsDisabled(disabled) {
  [
    el.objectXInput,
    el.objectYInput,
    el.objectWidthInput,
    el.objectHeightInput,
  ].forEach((input) => {
    input.disabled = disabled;
  });
}
function renderObjectGeometryEditor() {
  const object = selectedObject();
  setObjectInputsDisabled(!object);
  if (!object) {
    el.objectEditorStatus.textContent =
      "Select one page object or image to edit its position and size.";
    return;
  }
  const rect = object.rect;
  el.objectEditorStatus.textContent = `Editing ${object.kind === "image" ? "image" : object.typeName || object.label || "page object"} #${object.index}.`;
  el.objectXInput.value = rect.left.toFixed(1);
  el.objectYInput.value = rect.bottom.toFixed(1);
  el.objectWidthInput.value = (rect.right - rect.left).toFixed(1);
  el.objectHeightInput.value = (rect.top - rect.bottom).toFixed(1);
}
function setTextObjectInputsDisabled(disabled) {
  [
    el.textObjectInput,
    el.textObjectFontInput,
    el.textObjectFontSizeInput,
    el.textObjectColorInput,
  ].forEach((input) => {
    input.disabled = disabled;
  });
}
function inferredTextForObject(object) {
  const runs = state.selectableItems
    .filter(
      (item) =>
        item.kind === "text" &&
        item.rect &&
        pdfRectsIntersect(item.rect, object.rect),
    )
    .sort((a, b) => textRangeStart(a) - textRangeStart(b));
  if (!runs.length) return "";
  const start = Math.min(...runs.map(textRangeStart));
  const end = Math.max(...runs.map(textEndIndex));
  return state.pageText
    ? state.pageText.slice(start, end).replace(/\r\n/g, "\n")
    : runs.map((run) => run.text || run.data?.text || "").join("");
}
function textObjectFontSize(object) {
  return Math.max(
    1,
    Number(object?.fontSize ?? object?.data?.fontSize) || 0,
    object?.rect ? object.rect.top - object.rect.bottom : 0,
  );
}
function renderTextObjectEditor() {
  const object = selectedTextObject();
  setTextObjectInputsDisabled(!object);
  if (!object) {
    el.textObjectEditorStatus.textContent =
      "Select one text page object in Object mode to replace its content and style.";
    return;
  }
  el.textObjectEditorStatus.textContent = `Replacing text object #${object.index}. Native replacement preserves the original font and size when supported.`;
  const active = document.activeElement;
  const objectChanged = el.textObjectInput.dataset.objectKey !== object.key;
  if (active !== el.textObjectInput)
    el.textObjectInput.value =
      !objectChanged && el.textObjectInput.value
        ? el.textObjectInput.value
        : inferredTextForObject(object);
  el.textObjectInput.dataset.objectKey = object.key;
  if (active !== el.textObjectFontSizeInput && objectChanged)
    el.textObjectFontSizeInput.value = textObjectFontSize(object).toFixed(1);
}
function setAnnotationInputsDisabled(disabled) {
  [
    el.annotLeftInput,
    el.annotBottomInput,
    el.annotRightInput,
    el.annotTopInput,
    el.annotColorInput,
    el.annotBorderInput,
    el.annotTextInput,
    el.annotUriInput,
  ].forEach((input) => {
    input.disabled = disabled;
  });
}
function renderAnnotationEditor() {
  const annotation = selectedAnnotation();
  setAnnotationInputsDisabled(!annotation);
  if (!annotation) {
    el.annotationEditorStatus.textContent =
      "Select one annotation to edit its properties.";
    return;
  }
  const data = annotation.data || {};
  el.annotationEditorStatus.textContent = `Editing ${annotation.subtypeName || data.subtypeName || annotation.label || "annotation"} #${annotation.index}.`;
  el.annotLeftInput.value = annotation.rect.left.toFixed(1);
  el.annotBottomInput.value = annotation.rect.bottom.toFixed(1);
  el.annotRightInput.value = annotation.rect.right.toFixed(1);
  el.annotTopInput.value = annotation.rect.top.toFixed(1);
  el.annotColorInput.value = rgbaToHex(annotation.colorRgba ?? data.colorRgba);
  el.annotBorderInput.value = String(
    annotation.borderWidth ?? data.borderWidth ?? 0,
  );
  el.annotTextInput.value = annotation.contents ?? data.contents ?? "";
  el.annotUriInput.value = annotation.uri ?? data.uri ?? "";
}
async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  try {
    if (!document.execCommand("copy"))
      throw new Error("Clipboard copy was rejected");
  } finally {
    input.remove();
  }
}
async function copySelectedText() {
  const text = selectedText();
  if (!text) {
    setStatus("Select text before copying.");
    return;
  }
  try {
    await writeClipboardText(text);
    setStatus(
      `Copied ${text.length} character${text.length === 1 ? "" : "s"} of selected text.`,
    );
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to copy selected text.",
      true,
    );
  }
}
function isCopyShortcut(event) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === "c"
  );
}
function rectUnion(items) {
  return items.reduce(
    (rect, item) =>
      rect
        ? {
            left: Math.min(rect.left, item.rect.left),
            bottom: Math.min(rect.bottom, item.rect.bottom),
            right: Math.max(rect.right, item.rect.right),
            top: Math.max(rect.top, item.rect.top),
          }
        : { ...item.rect },
    null,
  );
}
function textEndIndex(item) {
  return textRangeStart(item) + textRangeLength(item);
}
function textLineCenter(item) {
  return (item.rect.top + item.rect.bottom) / 2;
}
function normalizeTextSelection(hits) {
  const textHits = hits.filter((item) => item.kind === "text" && item.rect);
  if (!textHits.length) return hits;
  const minStart = Math.min(...textHits.map(textRangeStart));
  const maxEnd = Math.max(...textHits.map(textEndIndex));
  const rangeRuns = state.selectableItems
    .filter(
      (item) =>
        item.kind === "text" &&
        item.rect &&
        textRangeStart(item) >= minStart &&
        textEndIndex(item) <= maxEnd,
    )
    .sort((a, b) => textRangeStart(a) - textRangeStart(b));
  const lines = [];
  rangeRuns.forEach((run) => {
    let line = lines.find(
      (candidate) =>
        Math.abs(textLineCenter(candidate.items[0]) - textLineCenter(run)) <=
        Math.max(2, (run.rect.top - run.rect.bottom) * 0.6),
    );
    if (!line) {
      line = { items: [] };
      lines.push(line);
    }
    line.items.push(run);
  });
  lines.sort((a, b) => textRangeStart(a.items[0]) - textRangeStart(b.items[0]));
  return lines.map((line, lineIndex) => {
    const items = line.items.sort(
      (a, b) => textRangeStart(a) - textRangeStart(b),
    );
    const first = items.reduce(
      (min, item) => (textRangeStart(item) < textRangeStart(min) ? item : min),
      items[0],
    );
    const last = items.reduce(
      (max, item) => (textEndIndex(item) > textEndIndex(max) ? item : max),
      items[0],
    );
    const start = textRangeStart(first);
    const end = textEndIndex(last);
    const text = state.pageText
      ? state.pageText.slice(start, end)
      : items.map((item) => item.text || item.data?.text || "").join("");
    return {
      kind: "text",
      pageIndex: state.pageIndex,
      index: first.index,
      rect: rectUnion(items),
      text,
      startIndex: start,
      charCount: end - start,
      label: text || `Text range ${lineIndex + 1}`,
      key: `textRange:${state.pageIndex}:${start}:${end}:${lineIndex}`,
      data: { text, startIndex: start, charCount: end - start, runs: items },
    };
  });
}
function deletableSelection() {
  return state.selection.selectedItems.filter(
    (item) =>
      item.pageIndex === state.pageIndex &&
      (item.kind === "annotation" ||
        item.kind === "pageObject" ||
        item.kind === "image"),
  );
}
function movableObjectSelection() {
  return state.selection.selectedItems.filter(
    (item) =>
      item.pageIndex === state.pageIndex &&
      (item.kind === "pageObject" || item.kind === "image"),
  );
}
function movableAnnotationSelection() {
  return state.selection.selectedItems.filter(
    (item) => item.pageIndex === state.pageIndex && item.kind === "annotation",
  );
}

// Page object, image, and annotation movement/resizing.
function movableSelection() {
  return [...movableObjectSelection(), ...movableAnnotationSelection()];
}
function duplicableObjectSelection() {
  return state.selection.selectedItems.filter(
    (item) =>
      item.pageIndex === state.pageIndex &&
      item.kind === "pageObject" &&
      item.type === 1,
  );
}
function isMovableItem(item) {
  return (
    item?.pageIndex === state.pageIndex &&
    (item.kind === "pageObject" ||
      item.kind === "image" ||
      item.kind === "annotation")
  );
}
function isResizableObject(item) {
  return (
    item?.pageIndex === state.pageIndex &&
    (item.kind === "pageObject" || item.kind === "image") &&
    item.rect
  );
}
function isResizableAnnotation(item) {
  return (
    item?.pageIndex === state.pageIndex &&
    item.kind === "annotation" &&
    item.rect
  );
}
function isResizableItem(item) {
  return isResizableObject(item) || isResizableAnnotation(item);
}
function isSelectedItem(item) {
  const key = selectionItemKey(item);
  return state.selection.selectedItems.some(
    (selected) => selectionItemKey(selected) === key,
  );
}
function shiftedItem(item, deltaX, deltaY) {
  return {
    ...item,
    rect: item.rect
      ? {
          left: item.rect.left + deltaX,
          bottom: item.rect.bottom + deltaY,
          right: item.rect.right + deltaX,
          top: item.rect.top + deltaY,
        }
      : item.rect,
  };
}
function pdfBounds(items) {
  return items
    .filter((item) => item.rect)
    .reduce(
      (rect, item) =>
        rect
          ? {
              left: Math.min(rect.left, item.rect.left),
              bottom: Math.min(rect.bottom, item.rect.bottom),
              right: Math.max(rect.right, item.rect.right),
              top: Math.max(rect.top, item.rect.top),
            }
          : { ...item.rect },
      null,
    );
}
function snapCandidatesForAxis(axis, selectedKeys) {
  const candidates = [];
  if (axis === "x") {
    candidates.push(
      { value: 0 },
      { value: state.pageSize.width / 2 },
      { value: state.pageSize.width },
    );
  } else {
    candidates.push(
      { value: 0 },
      { value: state.pageSize.height / 2 },
      { value: state.pageSize.height },
    );
  }
  state.selectableItems.forEach((item) => {
    if (
      item.pageIndex !== state.pageIndex ||
      !item.rect ||
      selectedKeys.has(selectionItemKey(item))
    )
      return;
    if (axis === "x")
      candidates.push(
        { value: item.rect.left },
        { value: (item.rect.left + item.rect.right) / 2 },
        { value: item.rect.right },
      );
    else
      candidates.push(
        { value: item.rect.bottom },
        { value: (item.rect.bottom + item.rect.top) / 2 },
        { value: item.rect.top },
      );
  });
  return candidates;
}
function snapDelta(axis, bounds, delta, selectedKeys) {
  const moving =
    axis === "x"
      ? [
          bounds.left + delta,
          (bounds.left + bounds.right) / 2 + delta,
          bounds.right + delta,
        ]
      : [
          bounds.bottom + delta,
          (bounds.bottom + bounds.top) / 2 + delta,
          bounds.top + delta,
        ];
  let best = null;
  snapCandidatesForAxis(axis, selectedKeys).forEach((candidate) => {
    moving.forEach((value) => {
      const adjustment = candidate.value - value;
      const distance = Math.abs(adjustment);
      if (distance <= SNAP_THRESHOLD_PT && (!best || distance < best.distance))
        best = { adjustment, distance, value: candidate.value };
    });
  });
  return best
    ? { delta: delta + best.adjustment, guide: { axis, value: best.value } }
    : { delta, guide: null };
}
function resolvedMoveDelta(currentPdfPoint, { shiftKey = false } = {}) {
  const drag = state.selection.drag;
  const start = drag.item?.startPdfPoint;
  const baseItems = drag.item?.baseItems || [];
  const bounds = pdfBounds(baseItems);
  if (!start || !bounds) return { deltaX: 0, deltaY: 0, guides: [] };
  let deltaX = currentPdfPoint.x - start.x;
  let deltaY = currentPdfPoint.y - start.y;
  if (shiftKey) {
    if (Math.abs(deltaX) >= Math.abs(deltaY)) deltaY = 0;
    else deltaX = 0;
  }
  const selectedKeys = new Set(baseItems.map(selectionItemKey));
  const xSnap = snapDelta("x", bounds, deltaX, selectedKeys);
  const ySnap = snapDelta("y", bounds, deltaY, selectedKeys);
  return {
    deltaX: xSnap.delta,
    deltaY: ySnap.delta,
    guides: [xSnap.guide, ySnap.guide].filter(Boolean),
  };
}
function renderSnapGuides() {
  const guides = state.selection.drag.item?.snapGuides || [];
  if (!guides.length || !state.pageSize || !state.renderSize) return;
  const scaleX = state.renderSize.width / state.pageSize.width;
  const scaleY = state.renderSize.height / state.pageSize.height;
  guides.forEach((guide) => {
    const node = document.createElement("div");
    if (guide.axis === "x") {
      node.className = "snap-guide vertical";
      node.style.left = `${guide.value * scaleX}px`;
      node.style.height = `${state.renderSize.height}px`;
    } else {
      node.className = "snap-guide horizontal";
      node.style.top = `${(state.pageSize.height - guide.value) * scaleY}px`;
      node.style.width = `${state.renderSize.width}px`;
    }
    el.overlay.append(node);
  });
}
function resizedRectFromHandle(rect, handle, pdfPoint) {
  const next = { ...rect };
  if (handle.includes("w")) next.left = Math.min(pdfPoint.x, next.right - 1);
  if (handle.includes("e")) next.right = Math.max(pdfPoint.x, next.left + 1);
  if (handle.includes("s")) next.bottom = Math.min(pdfPoint.y, next.top - 1);
  if (handle.includes("n")) next.top = Math.max(pdfPoint.y, next.bottom + 1);
  return next;
}
function resizeMatrix(baseRect, nextRect) {
  const width = Math.max(0.001, baseRect.right - baseRect.left);
  const height = Math.max(0.001, baseRect.top - baseRect.bottom);
  const sx = (nextRect.right - nextRect.left) / width;
  const sy = (nextRect.top - nextRect.bottom) / height;
  return {
    a: sx,
    b: 0,
    c: 0,
    d: sy,
    e: nextRect.left - sx * baseRect.left,
    f: nextRect.bottom - sy * baseRect.bottom,
  };
}
function handlePointsForRect(rect) {
  const view = currentViewport();
  const canvasRect = pdfRectToCanvasRect(rect, view);
  const xMid = canvasRect.left + canvasRect.width / 2;
  const yMid = canvasRect.top + canvasRect.height / 2;
  const xRight = canvasRect.left + canvasRect.width;
  const yBottom = canvasRect.top + canvasRect.height;
  return [
    { name: "nw", x: canvasRect.left, y: canvasRect.top },
    { name: "n", x: xMid, y: canvasRect.top },
    { name: "ne", x: xRight, y: canvasRect.top },
    { name: "e", x: xRight, y: yMid },
    { name: "se", x: xRight, y: yBottom },
    { name: "s", x: xMid, y: yBottom },
    { name: "sw", x: canvasRect.left, y: yBottom },
    { name: "w", x: canvasRect.left, y: yMid },
  ];
}
function resizableSelection() {
  if (state.selection.mode === SELECTION_MODES.SELECT_OBJECT)
    return movableObjectSelection();
  if (state.selection.mode === SELECTION_MODES.SELECT_ANNOTATION)
    return movableAnnotationSelection();
  return [];
}
function hitTestResizeHandle(canvasPoint) {
  const radius = 8;
  for (const item of resizableSelection()) {
    if (!item.rect) continue;
    for (const handle of handlePointsForRect(item.rect)) {
      if (
        Math.abs(canvasPoint.x - handle.x) <= radius &&
        Math.abs(canvasPoint.y - handle.y) <= radius
      )
        return { item, handle: handle.name };
    }
  }
  return null;
}
function setResizeHandleCursor(handle) {
  if (handle) el.pageStack.dataset.resizeHandle = handle;
  else delete el.pageStack.dataset.resizeHandle;
}
function previewMoveDrag(currentPdfPoint, event) {
  const drag = state.selection.drag;
  if (!drag.active || drag.type !== "moveItems") return;
  const result = resolvedMoveDelta(currentPdfPoint, {
    shiftKey: event?.shiftKey,
  });
  drag.item.lastDelta = result;
  drag.item.snapGuides = result.guides;
  replaceSelection(
    state.selection,
    (drag.item.baseItems || []).map((item) =>
      shiftedItem(item, result.deltaX, result.deltaY),
    ),
  );
  updateDragInfo(
    `move dx ${formatPt(result.deltaX)}, dy ${formatPt(result.deltaY)}`,
  );
  renderSelectionState();
  renderOverlays();
}
function previewResizeDrag(currentPdfPoint) {
  const drag = state.selection.drag;
  if (!drag.active || drag.type !== "resizeItem") return;
  const item = drag.item?.baseItem;
  if (!item?.rect) return;
  const nextRect = resizedRectFromHandle(
    item.rect,
    drag.item.handle,
    currentPdfPoint,
  );
  replaceSelection(state.selection, [{ ...item, rect: nextRect }]);
  updateDragInfo(`resize ${formatRectInfo(nextRect)}`);
  renderSelectionState();
  renderOverlays();
}

// Text placement and in-place text editing.
function placeTextAtPoint(point) {
  el.textXInput.value = point.x.toFixed(1);
  el.textYInput.value = point.y.toFixed(1);
  setStatus(
    `Text insertion point set to ${point.x.toFixed(1)}, ${point.y.toFixed(1)} pt.`,
  );
}
function placeTextInCanvasRect(rect) {
  const pdfRect = canvasRectToPdfRect(rect, currentViewport());
  const width = Math.max(1, pdfRect.right - pdfRect.left);
  const height = Math.max(1, pdfRect.top - pdfRect.bottom);
  el.textXInput.value = pdfRect.left.toFixed(1);
  el.textYInput.value = pdfRect.bottom.toFixed(1);
  el.textWidthInput.value = width.toFixed(1);
  el.textHeightInput.value = height.toFixed(1);
  setStatus(
    `Text box set to ${width.toFixed(1)} x ${height.toFixed(1)} pt. Click Add text box to create it.`,
  );
}
async function resizeSelectedBy(delta) {
  const item =
    state.selection.selectedItems.length === 1
      ? state.selection.selectedItems[0]
      : null;
  if (!isResizableItem(item)) {
    setStatus(
      "Select one page object, image, or annotation before resizing from the toolbar.",
    );
    return;
  }
  const rect = item.rect;
  const centerX = (rect.left + rect.right) / 2;
  const centerY = (rect.bottom + rect.top) / 2;
  const width = Math.max(1, rect.right - rect.left + delta);
  const height = Math.max(1, rect.top - rect.bottom + delta);
  await resizeSelectedItem(
    item,
    {
      left: centerX - width / 2,
      bottom: centerY - height / 2,
      right: centerX + width / 2,
      top: centerY + height / 2,
    },
    delta > 0 ? "Grew selected item." : "Shrank selected item.",
    delta > 0 ? "Grow selected item" : "Shrink selected item",
  );
}
function focusSelectionEditor() {
  const item = state.selection.currentItem || state.selection.selectedItems[0];
  if (!item) {
    setStatus("Select an item before editing.");
    return;
  }
  if (item.kind === "pageObject" && item.type === 1) {
    startInlineTextEdit(item);
    return;
  }
  if (isFreeTextAnnotation(item)) {
    startInlineTextEdit(item);
    return;
  }
  if (item.kind === "pageObject" || item.kind === "image") {
    el.objectXInput.focus();
    el.objectXInput.select();
    setStatus("Object geometry editor focused.");
    return;
  }
  if (item.kind === "annotation") {
    el.annotLeftInput.focus();
    el.annotLeftInput.select();
    setStatus("Annotation editor focused.");
    return;
  }
  if (item.kind === "text") {
    const editable = editableTextItemForSelection(item);
    if (editable) {
      replaceSelection(state.selection, [editable]);
      renderSelectionState();
      renderOverlays();
      startInlineTextEdit(editable);
      return;
    }
    el.copyTextButton.focus();
    setStatus(
      "Text selection can be copied or used as a reference for new text.",
    );
    return;
  }
  setStatus("This selected item is inspect-only in the editor sample.");
}
function inlineTextValue(item) {
  if (item.kind === "pageObject") return inferredTextForObject(item);
  return item.contents ?? item.data?.contents ?? "";
}
function editableTextItemForSelection(item) {
  if (item?.kind === "pageObject" && item.type === 1 && item.rect) return item;
  if (isFreeTextAnnotation(item) && item.rect) return item;
  if (item?.kind !== "text" || !item.rect) return null;
  return (
    state.selectableItems.find(
      (candidate) =>
        candidate.kind === "pageObject" &&
        candidate.type === 1 &&
        candidate.rect &&
        pdfRectsIntersect(candidate.rect, item.rect),
    ) || null
  );
}
function editableTextItemAtPoint(point) {
  const mode = state.selection.mode;
  if (mode === SELECTION_MODES.SELECT_ANNOTATION) {
    const hit = hitTestSelectionItems(state.selectableItems, mode, point);
    return isFreeTextAnnotation(hit) ? hit : null;
  }
  if (mode === SELECTION_MODES.SELECT_OBJECT) {
    const hit = hitTestSelectionItems(state.selectableItems, mode, point);
    return editableTextItemForSelection(hit);
  }
  if (mode === SELECTION_MODES.SELECT_TEXT) {
    const hit = hitTestSelectionItems(state.selectableItems, mode, point);
    return editableTextItemForSelection(hit);
  }
  return null;
}
function positionInlineTextEditor() {
  const editor = state.inlineTextEditor;
  if (!editor || !state.pageSize || !state.renderSize) return;
  const rect = editor.item.rect;
  if (!rect) {
    cancelInlineTextEdit();
    return;
  }
  const canvasRect = pdfRectToCanvasRect(rect, currentViewport());
  editor.node.style.left = `${canvasRect.left}px`;
  editor.node.style.top = `${canvasRect.top}px`;
  editor.node.style.minWidth = `${Math.max(64, canvasRect.width)}px`;
  editor.node.style.minHeight = `${Math.max(34, canvasRect.height)}px`;
  const fontSize =
    editor.item.kind === "pageObject"
      ? Number(el.textObjectFontSizeInput.value) ||
        Math.max(12, canvasRect.height * 0.7)
      : Math.max(12, canvasRect.height * 0.45);
  editor.node.style.fontSize = `${fontSize}px`;
}
function cancelInlineTextEdit() {
  if (!state.inlineTextEditor) return;
  state.inlineTextEditor.node.remove();
  state.inlineTextEditor = null;
}
function inlineEditorText(node) {
  return (node.innerText || node.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n$/, "");
}
function selectInlineEditorText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
async function replaceTextObjectContent(object, text, message, label) {
  const rect = object.rect;
  pushHistorySnapshot(label);
  if (typeof state.doc.mod?._wasm_pdf_replace_text_page_object === "function")
    state.doc.replaceTextPageObject(state.pageIndex, object.index, text);
  else {
    state.doc.deletePageObject(state.pageIndex, object.index);
    state.doc.addTextBox({
      pageIndex: state.pageIndex,
      text,
      x: rect.left,
      y: rect.bottom,
      width: Math.max(1, rect.right - rect.left),
      height: Math.max(1, rect.top - rect.bottom),
      fontSize: textObjectFontSize(object),
      rgba: colorToRgba(el.textObjectColorInput.value),
      fontName: el.textObjectFontInput.value || "Helvetica",
      align: "left",
    });
  }
  clearSelection(state.selection);
  await refreshAfterMutation(message, { preserveSelection: false });
}
async function commitInlineTextEdit() {
  const editor = state.inlineTextEditor;
  if (!editor) return;
  const item = editor.item;
  const text = inlineEditorText(editor.node);
  cancelInlineTextEdit();
  if (!text.trim()) {
    setStatus("Enter text before committing the inline edit.", true);
    return;
  }
  try {
    if (item.kind === "pageObject")
      await replaceTextObjectContent(
        item,
        text,
        "Inline text object edited.",
        "Inline edit text object",
      );
    else if (isFreeTextAnnotation(item)) {
      pushHistorySnapshot("Inline edit FreeText annotation");
      state.doc.updateAnnotation(state.pageIndex, item.index, {
        contents: text,
      });
      await refreshAfterMutation("Inline FreeText annotation edited.");
    } else
      setStatus("Selected item does not support inline text editing.", true);
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to commit inline text edit.",
      true,
    );
  }
}
function startInlineTextEdit(item) {
  const editable = editableTextItemForSelection(item);
  if (!editable) {
    setStatus(
      "Double-click a text page object or FreeText annotation to edit it inline.",
    );
    return;
  }
  cancelInlineTextEdit();
  replaceSelection(state.selection, [editable]);
  renderSelectionState();
  renderOverlays();
  const node = document.createElement("div");
  node.className = "inline-text-editor";
  node.contentEditable = "plaintext-only";
  node.textContent = inlineTextValue(editable);
  node.setAttribute("role", "textbox");
  node.setAttribute("aria-label", "Inline PDF text editor");
  node.addEventListener("pointerdown", (event) => event.stopPropagation());
  node.addEventListener("click", (event) => event.stopPropagation());
  node.addEventListener("input", positionInlineTextEditor);
  node.addEventListener("paste", (event) => {
    event.preventDefault();
    document.execCommand(
      "insertText",
      false,
      event.clipboardData?.getData("text/plain") || "",
    );
  });
  node.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelInlineTextEdit();
      renderSelectionState();
      renderOverlays();
      setStatus("Inline text edit canceled.");
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      await commitInlineTextEdit();
    }
  });
  node.addEventListener("blur", () => {
    queueMicrotask(() => commitInlineTextEdit());
  });
  el.pageStack.append(node);
  state.inlineTextEditor = { item: editable, node };
  positionInlineTextEditor();
  node.focus();
  selectInlineEditorText(node);
  setStatus(
    "Editing text inline. The editor grows with typed text; Cmd/Ctrl+Enter or blur commits; Esc cancels.",
  );
}
function handlePageDoubleClick(event) {
  if (
    !state.doc ||
    !state.pageSize ||
    !state.renderSize ||
    state.selection.drag.active
  )
    return;
  const points = pointerEventToViewerPoints(
    event,
    el.canvas,
    currentViewport(),
  );
  const editable = editableTextItemAtPoint(points.pdf);
  if (!editable) return;
  event.preventDefault();
  startInlineTextEdit(editable);
}
function releasePointer(event) {
  if (el.pageStack.hasPointerCapture?.(event.pointerId))
    el.pageStack.releasePointerCapture(event.pointerId);
}
function handlePagePointerDown(event) {
  if (state.inlineTextEditor) return;
  if (
    !state.doc ||
    !state.pageSize ||
    !state.renderSize ||
    event.button !== 0 ||
    state.selection.mode === SELECTION_MODES.PAN
  )
    return;
  event.preventDefault();
  const points = pointerEventToViewerPoints(
    event,
    el.canvas,
    currentViewport(),
  );
  const resizeHit = hitTestResizeHandle(points.canvas);
  if (resizeHit && isResizableItem(resizeHit.item)) {
    setResizeHandleCursor(resizeHit.handle);
    startDrag(state.selection, {
      type: "resizeItem",
      startPoint: points.canvas,
      item: {
        handle: resizeHit.handle,
        startPdfPoint: points.pdf,
        baseItem: { ...resizeHit.item, rect: { ...resizeHit.item.rect } },
      },
    });
    el.pageStack.setPointerCapture(event.pointerId);
    renderSelectionState();
    renderOverlays();
    return;
  }
  setResizeHandleCursor(null);
  const hit = hitTestSelectionItems(
    state.selectableItems,
    state.selection.mode,
    points.pdf,
  );
  const moveMode =
    state.selection.mode === SELECTION_MODES.SELECT_OBJECT ||
    state.selection.mode === SELECTION_MODES.SELECT_ANNOTATION;
  if (moveMode && isMovableItem(hit)) {
    if (!isSelectedItem(hit))
      selectItem(state.selection, hit, { additive: false });
    startDrag(state.selection, {
      type: "moveItems",
      startPoint: points.canvas,
      item: {
        startPdfPoint: points.pdf,
        baseItems: movableSelection().map((item) => ({
          ...item,
          rect: item.rect ? { ...item.rect } : item.rect,
        })),
      },
    });
    el.pageStack.setPointerCapture(event.pointerId);
    renderSelectionState();
    renderOverlays();
    return;
  }
  startDrag(state.selection, {
    type: "areaSelect",
    startPoint: points.canvas,
    item: { additive: event.shiftKey, mode: state.selection.mode },
  });
  el.pageStack.setPointerCapture(event.pointerId);
  renderOverlays();
}
function handlePagePointerMove(event) {
  if (!state.doc || !state.pageSize || !state.renderSize) return;
  const points = pointerEventToViewerPoints(
    event,
    el.canvas,
    currentViewport(),
  );
  updateMouseInfo(points.pdf);
  if (state.selection.drag.active) {
    event.preventDefault();
    updateDrag(state.selection, points.canvas);
    if (state.selection.drag.type === "moveItems") {
      setResizeHandleCursor(null);
      previewMoveDrag(points.pdf, event);
    } else if (state.selection.drag.type === "resizeItem") {
      setResizeHandleCursor(state.selection.drag.item?.handle);
      previewResizeDrag(points.pdf);
    } else {
      setResizeHandleCursor(null);
      updateDragInfo("selecting area");
      renderOverlays();
    }
    return;
  }
  updateDragInfo();
  const resizeHit = hitTestResizeHandle(points.canvas);
  setResizeHandleCursor(resizeHit?.handle);
  setHoverItem(
    state.selection,
    resizeHit?.item ||
      hitTestSelectionItems(
        state.selectableItems,
        state.selection.mode,
        points.pdf,
      ),
  );
  renderSelectionState();
  renderOverlays();
}
async function handlePagePointerUp(event) {
  if (!state.selection.drag.active) return;
  event.preventDefault();
  const drag = state.selection.drag;
  const additive = Boolean(drag.item?.additive);
  const mode = drag.item?.mode || state.selection.mode;
  const points = pointerEventToViewerPoints(
    event,
    el.canvas,
    currentViewport(),
  );
  updateMouseInfo(points.pdf);
  updateDrag(state.selection, points.canvas);
  setResizeHandleCursor(null);
  updateDragInfo();
  if (drag.type === "resizeItem") {
    const rect = canvasDragRect();
    const baseItem = drag.item?.baseItem;
    const handle = drag.item?.handle;
    endDrag(state.selection);
    releasePointer(event);
    if (!isAreaDrag(rect) || !baseItem?.rect || !handle) {
      replaceSelection(state.selection, baseItem ? [baseItem] : []);
      renderSelectionState();
      renderOverlays();
      setStatus("Selected resize handle. Drag farther to resize.");
      return;
    }
    const nextRect = resizedRectFromHandle(baseItem.rect, handle, points.pdf);
    replaceSelection(state.selection, [baseItem]);
    await resizeSelectedItem(baseItem, nextRect);
    return;
  }
  if (drag.type === "moveItems") {
    const rect = canvasDragRect();
    const start = drag.item?.startPdfPoint;
    const baseItems = drag.item?.baseItems || [];
    const result = resolvedMoveDelta(points.pdf, { shiftKey: event.shiftKey });
    endDrag(state.selection);
    releasePointer(event);
    if (!isAreaDrag(rect) || !start) {
      replaceSelection(state.selection, baseItems);
      renderSelectionState();
      renderOverlays();
      setStatus("Selected item. Drag farther to move it.");
      return;
    }
    replaceSelection(state.selection, baseItems);
    await moveSelectedItems(
      result.deltaX,
      result.deltaY,
      "Drag selected items",
    );
    return;
  }
  const rect = canvasDragRect();
  if (isAreaDrag(rect)) {
    const rawHits = areaSelectSelectionItems(
      state.selectableItems,
      mode,
      rect,
      currentViewport(),
    );
    const hits =
      mode === SELECTION_MODES.SELECT_TEXT
        ? normalizeTextSelection(rawHits)
        : rawHits;
    if (mode === SELECTION_MODES.SELECT_TEXT && !hits.length) {
      clearSelection(state.selection);
      placeTextInCanvasRect(rect);
    } else if (
      mode === SELECTION_MODES.SELECT_OBJECT &&
      state.decodedImage &&
      !hits.length
    ) {
      clearSelection(state.selection);
      setImagePlacementFromRect(rect);
    } else {
      replaceSelection(
        state.selection,
        additive
          ? mergeSelectionItems(state.selection.selectedItems, hits)
          : hits,
      );
      setStatus(
        hits.length
          ? `Selected ${hits.length} ${mode === SELECTION_MODES.SELECT_TEXT ? "text line" : "item"}${hits.length === 1 ? "" : "s"}.`
          : "No selectable items in selected area.",
      );
    }
  } else {
    const hit = hitTestSelectionItems(state.selectableItems, mode, points.pdf);
    if (mode === SELECTION_MODES.SELECT_TEXT && !hit) {
      clearSelection(state.selection);
      placeTextAtPoint(points.pdf);
    } else if (
      mode === SELECTION_MODES.SELECT_OBJECT &&
      state.decodedImage &&
      !hit
    ) {
      clearSelection(state.selection);
      setImagePlacementAtPoint(points.pdf);
    } else {
      selectItem(state.selection, hit, { additive });
      setStatus(
        hit
          ? `Selected ${hit.label || hit.kind}.`
          : "No selectable item at that point.",
      );
    }
  }
  endDrag(state.selection);
  releasePointer(event);
  renderSelectionState();
  renderOverlays();
}
function handlePagePointerCancel(event) {
  if (!state.selection.drag.active) return;
  if (state.selection.drag.type === "moveItems")
    replaceSelection(
      state.selection,
      state.selection.drag.item?.baseItems || [],
    );
  if (
    state.selection.drag.type === "resizeItem" &&
    state.selection.drag.item?.baseItem
  )
    replaceSelection(state.selection, [state.selection.drag.item.baseItem]);
  setResizeHandleCursor(null);
  updateDragInfo();
  endDrag(state.selection);
  releasePointer(event);
  renderSelectionState();
  renderOverlays();
}
function handlePagePointerLeave() {
  if (state.selection.drag.active) return;
  setResizeHandleCursor(null);
  updateMouseInfo(null);
  updateDragInfo();
  setHoverItem(state.selection, null);
  renderSelectionState();
  renderOverlays();
}
async function refreshAfterMutation(
  message,
  { preserveSelection = true } = {},
) {
  const keys = preserveSelection
    ? new Set(state.selection.selectedItems.map(selectionItemKey))
    : new Set();
  state.dirty = true;
  el.dirtyInfo.textContent = "Yes";
  await renderCurrentPage();
  if (keys.size) {
    const next = state.selectableItems.filter((item) =>
      keys.has(selectionItemKey(item)),
    );
    if (next.length) replaceSelection(state.selection, next);
    else clearSelection(state.selection);
  }
  renderSelectionState();
  renderOverlays();
  setStatus(`${message} Save the PDF to persist changes.`);
  updateControls();
}

// Document mutations.
async function addText() {
  try {
    pushHistorySnapshot("Add text");
    state.doc.addTextBox({
      pageIndex: state.pageIndex,
      text: el.textInput.value,
      x: Number(el.textXInput.value),
      y: Number(el.textYInput.value),
      width: Number(el.textWidthInput.value),
      height: Number(el.textHeightInput.value),
      fontSize: Number(el.fontSizeInput.value),
      fontName: "Helvetica",
      rgba: 0xff172033,
    });
    await refreshAfterMutation("Text added.");
  } catch (e) {
    console.error(e);
    setStatus(e instanceof Error ? e.message : "Unable to add text.", true);
  }
}
function imagePlacement() {
  const x = numberValue(el.imageXInput);
  const y = numberValue(el.imageYInput);
  const width = numberValue(el.imageWidthInput);
  const height = numberValue(el.imageHeightInput);
  return {
    x,
    y,
    width,
    height,
    valid:
      [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0,
  };
}
function setImagePlacementFromRect(rect) {
  const pdfRect = canvasRectToPdfRect(rect, currentViewport());
  const width = Math.max(1, pdfRect.right - pdfRect.left);
  const height = Math.max(1, pdfRect.top - pdfRect.bottom);
  el.imageXInput.value = pdfRect.left.toFixed(1);
  el.imageYInput.value = pdfRect.bottom.toFixed(1);
  el.imageWidthInput.value = width.toFixed(1);
  el.imageHeightInput.value = height.toFixed(1);
  setStatus(
    `Image placement set to ${width.toFixed(1)} x ${height.toFixed(1)} pt. Click Insert image to create it.`,
  );
}
function setImagePlacementAtPoint(point) {
  const current = imagePlacement();
  el.imageXInput.value = point.x.toFixed(1);
  el.imageYInput.value = point.y.toFixed(1);
  if (!current.valid && state.decodedImage) {
    const width = Math.min(160, state.pageSize?.width || 160);
    const aspect =
      state.decodedImage.imageHeight / state.decodedImage.imageWidth;
    el.imageWidthInput.value = width.toFixed(1);
    el.imageHeightInput.value = (width * aspect).toFixed(1);
  }
  setStatus(
    `Image placement point set to ${point.x.toFixed(1)}, ${point.y.toFixed(1)} pt.`,
  );
}
async function loadImage(file) {
  setStatus("Decoding image...");
  try {
    state.decodedImage = await createDecodedImagePayload(file, {
      mimeType: file.type,
    });
    el.imageInfo.textContent = `${file.name}: ${state.decodedImage.imageWidth} x ${state.decodedImage.imageHeight} px`;
    const width = Math.min(160, state.pageSize?.width || 160);
    const aspect =
      state.decodedImage.imageHeight / state.decodedImage.imageWidth;
    el.imageWidthInput.value = width.toFixed(1);
    el.imageHeightInput.value = (width * aspect).toFixed(1);
    setStatus(
      "Image decoded. In Object mode, click or drag empty page space to set placement.",
    );
  } catch (e) {
    state.decodedImage = null;
    el.imageInfo.textContent = "Unable to decode image.";
    console.error(e);
    setStatus(e instanceof Error ? e.message : "Unable to decode image.", true);
  } finally {
    updateControls();
  }
}
async function insertImage() {
  if (!state.decodedImage) {
    setStatus("Choose an image before inserting.", true);
    return;
  }
  const placement = imagePlacement();
  if (!placement.valid) {
    setStatus(
      "Enter valid image placement with positive width and height.",
      true,
    );
    return;
  }
  try {
    pushHistorySnapshot("Insert image");
    const before = state.doc.pageObjectCount(state.pageIndex);
    state.doc.addRgbaImage({
      pageIndex: state.pageIndex,
      rgbaBytes: state.decodedImage.rgbaBytes,
      imageWidth: state.decodedImage.imageWidth,
      imageHeight: state.decodedImage.imageHeight,
      x: placement.x,
      y: placement.y,
      displayWidth: placement.width,
      displayHeight: placement.height,
    });
    state.dirty = true;
    el.dirtyInfo.textContent = "Yes";
    await renderCurrentPage();
    const inserted = state.selectableItems.find(
      (item) => item.kind === "image" && item.index >= before,
    );
    if (inserted) replaceSelection(state.selection, [inserted]);
    else clearSelection(state.selection);
    renderSelectionState();
    renderOverlays();
    setStatus("Image inserted. Save the PDF to persist changes.");
    updateControls();
  } catch (e) {
    console.error(e);
    setStatus(e instanceof Error ? e.message : "Unable to insert image.", true);
  }
}
function annotationPlacementRect() {
  const selectedBounds = pdfBounds(
    state.selection.selectedItems.filter(
      (item) => item.pageIndex === state.pageIndex && item.rect,
    ),
  );
  if (selectedBounds) return selectedBounds;
  const x = numberValue(el.textXInput);
  const y = numberValue(el.textYInput);
  const width = numberValue(el.textWidthInput);
  const height = numberValue(el.textHeightInput);
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  return { left: x, bottom: y, right: x + width, top: y + height };
}
function createAnnotationColor(type) {
  return colorToRgba(
    el.createAnnotationColor.value,
    type === "highlight" ? 128 : 255,
  );
}
async function createAnnotation() {
  const rect = annotationPlacementRect();
  if (!rect) {
    setStatus(
      "Select an item with bounds or enter a valid Add Text rectangle before creating an annotation.",
      true,
    );
    return;
  }
  const type = el.createAnnotationType.value;
  const borderWidth = numberValue(el.createAnnotationBorderInput);
  const fontSize = numberValue(el.createAnnotationFontSizeInput);
  const text = el.createAnnotationTextInput.value;
  const uri = el.createAnnotationUriInput.value.trim();
  if (
    (type === "link" && !uri) ||
    (type === "freeText" && !text.trim()) ||
    (type === "textNote" && !text.trim())
  ) {
    setStatus("Enter required annotation text or URI before creating.", true);
    return;
  }
  if (
    !Number.isFinite(borderWidth) ||
    borderWidth < 0 ||
    !Number.isFinite(fontSize) ||
    fontSize <= 0
  ) {
    setStatus("Enter valid annotation border width and font size.", true);
    return;
  }
  try {
    pushHistorySnapshot("Create annotation");
    const before = state.doc.annotationCount(state.pageIndex);
    const rgba = createAnnotationColor(type);
    if (type === "highlight")
      state.doc.addHighlightAnnotation(state.pageIndex, rect, rgba);
    else if (type === "rectangle")
      state.doc.addRectangleAnnotation(state.pageIndex, rect, {
        rgba,
        borderWidth,
      });
    else if (type === "link")
      state.doc.addLinkAnnotation(state.pageIndex, rect, uri);
    else if (type === "textNote")
      state.doc.addTextNoteAnnotation(state.pageIndex, {
        x: rect.left,
        y: rect.top,
        contents: text,
        rgba,
      });
    else if (type === "freeText")
      state.doc.addFreeTextAnnotation(state.pageIndex, rect, {
        contents: text,
        fontSize,
        textRgba: 0xff000000,
        borderRgba: rgba,
        borderWidth,
      });
    else throw new Error(`Unsupported annotation type: ${type}`);
    if (text.trim() && type !== "freeText" && type !== "textNote")
      state.doc.setAnnotationText(state.pageIndex, before, text);
    state.dirty = true;
    el.dirtyInfo.textContent = "Yes";
    await renderCurrentPage();
    const created = state.selectableItems.find(
      (item) => item.kind === "annotation" && item.index >= before,
    );
    if (created) replaceSelection(state.selection, [created]);
    else clearSelection(state.selection);
    renderSelectionState();
    renderOverlays();
    setStatus(
      `Created ${type} annotation${type === "freeText" ? " with visible text" : text.trim() ? " with saved contents" : ""}. Save the PDF to persist changes.`,
    );
    updateControls();
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to create annotation.",
      true,
    );
  }
}

// Inspector actions.
async function applyObjectGeometry() {
  const object = selectedObject();
  if (!object) {
    setStatus("Select one page object or image before applying geometry.");
    return;
  }
  const x = numberValue(el.objectXInput);
  const y = numberValue(el.objectYInput);
  const width = numberValue(el.objectWidthInput);
  const height = numberValue(el.objectHeightInput);
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    setStatus(
      "Enter finite object geometry with positive width and height.",
      true,
    );
    return;
  }
  try {
    await resizeSelectedItem(
      object,
      { left: x, bottom: y, right: x + width, top: y + height },
      "Object geometry updated.",
      "Update object geometry",
    );
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to update object geometry.",
      true,
    );
  }
}
async function applyTextObjectChanges() {
  const object = selectedTextObject();
  if (!object) {
    setStatus(
      "Select one text page object in Object mode before replacing text.",
    );
    return;
  }
  const text = el.textObjectInput.value;
  if (!text.trim()) {
    setStatus("Enter replacement text before applying.", true);
    return;
  }
  try {
    await replaceTextObjectContent(
      object,
      text,
      "Text object replaced.",
      "Replace text object",
    );
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to replace text object.",
      true,
    );
  }
}
async function applyAnnotationChanges() {
  const annotation = selectedAnnotation();
  if (!annotation) {
    setStatus("Select one annotation before applying changes.");
    return;
  }
  const updates = {
    rect: {
      left: numberValue(el.annotLeftInput),
      bottom: numberValue(el.annotBottomInput),
      right: numberValue(el.annotRightInput),
      top: numberValue(el.annotTopInput),
    },
    rgba: colorToRgba(el.annotColorInput.value),
    borderWidth: numberValue(el.annotBorderInput),
    contents: el.annotTextInput.value,
  };
  if (el.annotUriInput.value.trim() || annotation.uri || annotation.data?.uri)
    updates.uri = el.annotUriInput.value.trim();
  try {
    pushHistorySnapshot("Update annotation");
    state.doc.updateAnnotation(state.pageIndex, annotation.index, updates);
    await refreshAfterMutation("Annotation updated.");
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to update annotation.",
      true,
    );
  }
}
async function resizeSelectedItem(
  item,
  nextRect,
  message = "Resized selected item.",
  label = "Resize selected item",
) {
  if (!isResizableItem(item)) {
    setStatus("Select a page object, image, or annotation before resizing.");
    return;
  }
  try {
    pushHistorySnapshot(label);
    if (isResizableAnnotation(item))
      state.doc.updateAnnotation(state.pageIndex, item.index, {
        rect: nextRect,
      });
    else
      state.doc.transformPageObject(
        state.pageIndex,
        item.index,
        resizeMatrix(item.rect, nextRect),
      );
    await refreshAfterMutation(message);
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to resize selected item.",
      true,
    );
  }
}
async function moveSelectedItems(
  deltaX,
  deltaY,
  label = "Move selected items",
) {
  const objects = movableObjectSelection();
  const annotations = movableAnnotationSelection();
  const count = objects.length + annotations.length;
  if (!count) {
    setStatus("Select page objects, images, or annotations before moving.");
    return;
  }
  if (
    !Number.isFinite(deltaX) ||
    !Number.isFinite(deltaY) ||
    (!deltaX && !deltaY)
  ) {
    setStatus("Enter a non-zero move delta.");
    return;
  }
  try {
    pushHistorySnapshot(label);
    objects.forEach((item) =>
      state.doc.transformPageObject(state.pageIndex, item.index, {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: deltaX,
        f: deltaY,
      }),
    );
    annotations.forEach((item) =>
      state.doc.updateAnnotation(state.pageIndex, item.index, {
        rect: shiftedItem(item, deltaX, deltaY).rect,
      }),
    );
    await refreshAfterMutation(
      `Moved ${count} item${count === 1 ? "" : "s"} by ${deltaX}, ${deltaY} pt.`,
    );
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to move selected items.",
      true,
    );
  }
}
async function duplicateSelectedObjects() {
  const items = duplicableObjectSelection();
  if (!items.length) {
    setStatus(
      "Select one or more text page objects in Object mode before duplicating.",
    );
    return;
  }
  try {
    pushHistorySnapshot("Duplicate selected objects");
    const newKeys = items.map(
      (item) =>
        `pageObject:${state.pageIndex}:${state.doc.duplicatePageObject(state.pageIndex, item.index, { offsetX: 12, offsetY: -12 })}`,
    );
    state.dirty = true;
    el.dirtyInfo.textContent = "Yes";
    await renderCurrentPage();
    const duplicated = state.selectableItems.filter((item) =>
      newKeys.includes(selectionItemKey(item)),
    );
    if (duplicated.length) replaceSelection(state.selection, duplicated);
    else clearSelection(state.selection);
    renderSelectionState();
    renderOverlays();
    setStatus(
      `Duplicated ${items.length} text object${items.length === 1 ? "" : "s"}. Save the PDF to persist changes.`,
    );
    updateControls();
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to duplicate selected objects.",
      true,
    );
  }
}
async function deleteSelected() {
  const items = deletableSelection();
  if (!items.length) {
    setStatus("Selected items cannot be deleted in this sample.");
    return;
  }
  try {
    pushHistorySnapshot("Delete selected items");
    items
      .filter((item) => item.kind === "annotation")
      .sort((a, b) => b.index - a.index)
      .forEach((item) =>
        state.doc.deleteAnnotation(state.pageIndex, item.index),
      );
    items
      .filter((item) => item.kind === "pageObject" || item.kind === "image")
      .sort((a, b) => b.index - a.index)
      .forEach((item) =>
        state.doc.deletePageObject(state.pageIndex, item.index),
      );
    clearSelection(state.selection);
    await refreshAfterMutation(
      `Deleted ${items.length} item${items.length === 1 ? "" : "s"}.`,
      { preserveSelection: false },
    );
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error ? e.message : "Unable to delete selected items.",
      true,
    );
  }
}

// PDF loading, rendering, and saving.
async function renderCurrentPage() {
  cancelInlineTextEdit();
  if (!state.doc || state.rendering) return;
  state.rendering = true;
  updateControls();
  try {
    state.pageCount = state.doc.pageCount();
    state.pageSize = state.doc.pageSize(state.pageIndex);
    state.pageText = state.doc.pageText(state.pageIndex);
    const width = Math.max(1, Math.round(state.pageSize.width * state.zoom));
    const height = Math.max(1, Math.round(state.pageSize.height * state.zoom));
    state.renderSize = { width, height };
    const rendered = state.doc.renderPage({
      pageIndex: state.pageIndex,
      width,
      height,
      flags: RENDER_ANNOTATIONS,
    });
    drawRgba(rendered.rgbaBytes, width, height);
    refreshSelectableItems();
    el.emptyState.hidden = true;
    el.pageStack.hidden = false;
    el.fileName.textContent = state.fileName || "Loaded PDF";
    el.pageInfo.textContent = `${state.pageIndex + 1} / ${state.pageCount}`;
    el.pageSize.textContent = `${state.pageSize.width.toFixed(1)} x ${state.pageSize.height.toFixed(1)} pt`;
    el.zoomInfo.textContent = `${Math.round(state.zoom * 100)}%`;
    el.dirtyInfo.textContent = state.dirty ? "Yes" : "No";
    updateMouseInfo(null);
    updateDragInfo();
    renderSelectionState();
    renderOverlays();
    setStatus("Rendered editor page.");
  } catch (e) {
    state.pageText = "";
    console.error(e);
    setStatus(e instanceof Error ? e.message : "Unable to render PDF.", true);
  } finally {
    state.rendering = false;
    updateControls();
  }
}
async function loadPdf(file) {
  closeDocument();
  clearHistory(state.history);
  state.fileName = file.name;
  state.pageIndex = 0;
  state.pageCount = 0;
  state.pageText = "";
  state.dirty = false;
  clearSelection(state.selection);
  el.emptyState.hidden = false;
  el.pageStack.hidden = true;
  setStatus("Opening PDF...");
  renderSelectionState();
  updateControls();
  try {
    const api = await getApi();
    state.doc = api.openDocument(new Uint8Array(await file.arrayBuffer()));
    await renderCurrentPage();
  } catch (e) {
    closeDocument();
    console.error(e);
    setStatus(e instanceof Error ? e.message : "Unable to open PDF.", true);
  }
}
async function loadDemoPdf() {
  try {
    setStatus("Loading demo.pdf...");
    const response = await fetch("../demo.pdf");
    if (!response.ok)
      throw new Error(`Unable to fetch demo.pdf (${response.status})`);
    const blob = await response.blob();
    await loadPdf(new File([blob], "demo.pdf", { type: "application/pdf" }));
  } catch (e) {
    console.warn(e);
    setStatus(
      "Demo PDF could not be loaded. Choose a PDF file manually.",
      true,
    );
  }
}
function savePdf() {
  try {
    const output = state.doc.save();
    const blob = new Blob([output], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.fileName.replace(/\.pdf$/i, "") || "editor"}-edited.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    state.dirty = false;
    el.dirtyInfo.textContent = "No";
    updateControls();
    setStatus("Saved edited PDF.");
  } catch (e) {
    console.error(e);
    setStatus(e instanceof Error ? e.message : "Unable to save PDF.", true);
  }
}

// Keyboard shortcuts and event wiring.
async function handleKeyDown(event) {
  if (state.inlineTextEditor || isEditableShortcutTarget(event.target)) return;
  if (isCopyShortcut(event) && selectedText()) {
    event.preventDefault();
    await copySelectedText();
    return;
  }
  const shortcut = keyboardShortcutFromEvent(event);
  if (!shortcut) return;
  if (shortcut.preventDefault) event.preventDefault();
  if (shortcut.action === KEYBOARD_ACTIONS.CLEAR_SELECTION)
    clearEditorSelection();
  else if (shortcut.action === KEYBOARD_ACTIONS.DELETE_SELECTION)
    await deleteSelected();
  else if (
    shortcut.action === KEYBOARD_ACTIONS.SAVE &&
    state.doc &&
    !state.rendering
  )
    savePdf();
  else if (shortcut.action === KEYBOARD_ACTIONS.UNDO) await undoHistory();
  else if (shortcut.action === KEYBOARD_ACTIONS.REDO) await redoHistory();
  else if (shortcut.action === KEYBOARD_ACTIONS.NUDGE)
    await moveSelectedItems(
      shortcut.delta.x,
      shortcut.delta.y,
      "Nudge selected items",
    );
}
document
  .querySelectorAll("[data-selection-mode]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      changeSelectionMode(button.dataset.selectionMode),
    ),
  );
el.pdfInput.addEventListener("change", async () => {
  const [file] = el.pdfInput.files;
  if (file) await loadPdf(file);
});
el.prevButton.addEventListener("click", async () => {
  if (state.pageIndex > 0) {
    state.pageIndex -= 1;
    clearSelection(state.selection);
    await renderCurrentPage();
  }
});
el.nextButton.addEventListener("click", async () => {
  if (state.pageIndex < state.pageCount - 1) {
    state.pageIndex += 1;
    clearSelection(state.selection);
    await renderCurrentPage();
  }
});
el.clearButton.addEventListener("click", clearEditorSelection);
el.deleteButton.addEventListener("click", deleteSelected);
el.copyTextButton.addEventListener("click", copySelectedText);
el.duplicateButton.addEventListener("click", duplicateSelectedObjects);
el.applyObjectButton.addEventListener("click", applyObjectGeometry);
el.applyTextObjectButton.addEventListener("click", applyTextObjectChanges);
el.applyAnnotationButton.addEventListener("click", applyAnnotationChanges);
el.createAnnotationButton.addEventListener("click", createAnnotation);
el.imageInput.addEventListener("change", async () => {
  const [file] = el.imageInput.files;
  if (file) await loadImage(file);
  else {
    state.decodedImage = null;
    el.imageInfo.textContent =
      "Choose an image, then click or drag an empty Object-mode area to set placement.";
    updateControls();
  }
});
el.insertImageButton.addEventListener("click", insertImage);
el.selectionToolbar.addEventListener("pointerdown", (event) =>
  event.stopPropagation(),
);
el.selectionToolbar.addEventListener("click", (event) =>
  event.stopPropagation(),
);
el.toolbarCopyButton.addEventListener("click", copySelectedText);
el.toolbarDeleteButton.addEventListener("click", deleteSelected);
el.toolbarDuplicateButton.addEventListener("click", duplicateSelectedObjects);
el.toolbarCreateAnnotationButton.addEventListener("click", createAnnotation);
el.toolbarMoveLeftButton.addEventListener("click", () =>
  moveSelectedItems(
    -Math.abs(Number(el.moveXInput.value) || 0),
    0,
    "Toolbar move selected items",
  ),
);
el.toolbarMoveRightButton.addEventListener("click", () =>
  moveSelectedItems(
    Math.abs(Number(el.moveXInput.value) || 0),
    0,
    "Toolbar move selected items",
  ),
);
el.toolbarMoveDownButton.addEventListener("click", () =>
  moveSelectedItems(
    0,
    -Math.abs(Number(el.moveYInput.value) || 0),
    "Toolbar move selected items",
  ),
);
el.toolbarMoveUpButton.addEventListener("click", () =>
  moveSelectedItems(
    0,
    Math.abs(Number(el.moveYInput.value) || 0),
    "Toolbar move selected items",
  ),
);
el.toolbarShrinkButton.addEventListener("click", () => resizeSelectedBy(-12));
el.toolbarGrowButton.addEventListener("click", () => resizeSelectedBy(12));
el.toolbarEditButton.addEventListener("click", focusSelectionEditor);
el.undoButton.addEventListener("click", undoHistory);
el.redoButton.addEventListener("click", redoHistory);
el.moveLeftButton.addEventListener("click", () =>
  moveSelectedItems(-Math.abs(Number(el.moveXInput.value) || 0), 0),
);
el.moveRightButton.addEventListener("click", () =>
  moveSelectedItems(Math.abs(Number(el.moveXInput.value) || 0), 0),
);
el.moveDownButton.addEventListener("click", () =>
  moveSelectedItems(0, -Math.abs(Number(el.moveYInput.value) || 0)),
);
el.moveUpButton.addEventListener("click", () =>
  moveSelectedItems(0, Math.abs(Number(el.moveYInput.value) || 0)),
);
el.addTextButton.addEventListener("click", addText);
el.saveButton.addEventListener("click", savePdf);
el.pageStack.addEventListener("pointerdown", handlePagePointerDown);
el.pageStack.addEventListener("pointermove", handlePagePointerMove);
el.pageStack.addEventListener("pointerup", handlePagePointerUp);
el.pageStack.addEventListener("pointercancel", handlePagePointerCancel);
el.pageStack.addEventListener("pointerleave", handlePagePointerLeave);
el.pageStack.addEventListener("dblclick", handlePageDoubleClick);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("beforeunload", () => {
  closeDocument();
  if (state.api) state.api.destroy();
});
renderSelectionState();
updateControls();
loadDemoPdf();
