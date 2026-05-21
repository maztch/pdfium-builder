export const SELECTION_MODES = Object.freeze({
  PAN: "pan",
  SELECT_TEXT: "selectText",
  SELECT_OBJECT: "selectObject",
  SELECT_ANNOTATION: "selectAnnotation",
  SELECT_FORM_WIDGET: "selectFormWidget",
  AREA_SELECT: "areaSelect",
});

export const SELECTION_MODE_LABELS = Object.freeze({
  [SELECTION_MODES.PAN]: "Pan",
  [SELECTION_MODES.SELECT_TEXT]: "Text",
  [SELECTION_MODES.SELECT_OBJECT]: "Object",
  [SELECTION_MODES.SELECT_ANNOTATION]: "Annotation",
  [SELECTION_MODES.SELECT_FORM_WIDGET]: "Form widget",
  [SELECTION_MODES.AREA_SELECT]: "Area",
});

export function createSelectionState({ mode = SELECTION_MODES.PAN } = {}) {
  assertSelectionMode(mode);
  return {
    mode,
    currentItem: null,
    selectedItems: [],
    hoverItem: null,
    drag: createEmptyDragState(),
  };
}

export function createEmptyDragState() {
  return {
    active: false,
    type: null,
    startPoint: null,
    currentPoint: null,
    startRect: null,
    item: null,
  };
}

export function setSelectionMode(selection, mode) {
  assertSelectionState(selection);
  assertSelectionMode(mode);
  selection.mode = mode;
  selection.hoverItem = null;
  selection.drag = createEmptyDragState();
  return selection;
}

export function setHoverItem(selection, item) {
  assertSelectionState(selection);
  selection.hoverItem = item || null;
  return selection;
}

export function selectItem(selection, item, { additive = false } = {}) {
  assertSelectionState(selection);
  if (!item) return clearSelection(selection);

  if (!additive) {
    selection.selectedItems = [item];
    selection.currentItem = item;
    return selection;
  }

  const key = selectionItemKey(item);
  const existingIndex = selection.selectedItems.findIndex((selected) => selectionItemKey(selected) === key);
  if (existingIndex >= 0) {
    selection.selectedItems.splice(existingIndex, 1);
    selection.currentItem = selection.selectedItems.at(-1) || null;
  } else {
    selection.selectedItems.push(item);
    selection.currentItem = item;
  }
  return selection;
}

export function replaceSelection(selection, items = []) {
  assertSelectionState(selection);
  selection.selectedItems = [...items];
  selection.currentItem = selection.selectedItems.at(-1) || null;
  return selection;
}

export function clearSelection(selection) {
  assertSelectionState(selection);
  selection.currentItem = null;
  selection.selectedItems = [];
  selection.hoverItem = null;
  selection.drag = createEmptyDragState();
  return selection;
}

export function startDrag(selection, { type = "select", startPoint = null, startRect = null, item = null } = {}) {
  assertSelectionState(selection);
  selection.drag = {
    active: true,
    type,
    startPoint,
    currentPoint: startPoint,
    startRect,
    item,
  };
  return selection;
}

export function updateDrag(selection, currentPoint) {
  assertSelectionState(selection);
  if (!selection.drag.active) return selection;
  selection.drag.currentPoint = currentPoint;
  return selection;
}

export function endDrag(selection) {
  assertSelectionState(selection);
  selection.drag = createEmptyDragState();
  return selection;
}

export function selectionItemKey(item) {
  if (!item) return "";
  if (item.key) return String(item.key);
  const kind = item.kind || "item";
  const pageIndex = Number.isInteger(item.pageIndex) ? item.pageIndex : "?";
  const index = Number.isInteger(item.index) ? item.index : item.id ?? "?";
  return `${kind}:${pageIndex}:${index}`;
}

export function isSelected(selection, item) {
  assertSelectionState(selection);
  const key = selectionItemKey(item);
  return selection.selectedItems.some((selected) => selectionItemKey(selected) === key);
}

export function selectionSummary(selection) {
  assertSelectionState(selection);
  if (selection.selectedItems.length === 0) return "None";
  if (selection.selectedItems.length === 1) {
    const item = selection.selectedItems[0];
    return item.label || selectionItemKey(item);
  }
  return `${selection.selectedItems.length} items`;
}

export function assertSelectionMode(mode) {
  if (!Object.values(SELECTION_MODES).includes(mode)) {
    throw new Error(`Unknown selection mode: ${mode}`);
  }
}

function assertSelectionState(selection) {
  if (!selection || typeof selection !== "object") {
    throw new Error("selection state is required");
  }
}
