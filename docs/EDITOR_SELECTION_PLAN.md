# Editor Selection Plan

This plan describes the work needed to make the viewer behave closer to a real PDF editor: selecting text and page elements directly on the rendered page, inspecting selected items, and later editing/updating every element type.

## Goal

Add an editor interaction layer on top of the rendered PDF page that supports:

- Selecting text by click or drag.
- Selecting page objects, images, annotations, and form widgets by click or area selection.
- Showing hover, selection, and multi-selection overlays without re-rendering the PDF.
- Exposing a selected-item inspector that later becomes the edit panel.
- Keeping selection stable enough across mutations, refreshes, and page re-renders.

## Action Plan

### 1) Create Shared Viewer Core

Extract repeated viewer logic from examples into shared modules:

- Canvas rendering state.
- Page navigation.
- Zoom handling.
- PDF-to-canvas coordinate conversion.
- Overlay rendering.
- Hit-test helpers.

Likely files:

- `examples/shared/viewer-core.js`
- `examples/shared/pdf-coordinates.js`
- `examples/shared/overlays.js`
- `examples/shared/hit-testing.js`

Initial implementation status:

- Added `examples/shared/viewer-core.js` for zoom, render-size, and RGBA canvas drawing helpers.
- Added `examples/shared/pdf-coordinates.js` for PDF, canvas, and client coordinate conversion.
- Added `examples/shared/overlays.js` for reusable DOM overlay rectangle rendering.
- Added `examples/shared/hit-testing.js` for point and area hit testing against item rectangles.
- Migrated `examples/full-viewer-workbench/` to use the shared canvas draw, overlay, and zoom helpers.

### 2) Add Selection Mode Model

Define editor modes:

- `pan`
- `selectText`
- `selectObject`
- `selectAnnotation`
- `selectFormWidget`
- `areaSelect`

Shared selection state should include:

- active mode
- selected item type
- selected item index/id
- selected page index
- selected rectangle in PDF coordinates
- current hover item
- current drag state
- multi-selection set

Initial implementation status:

- Added `examples/shared/selection-state.js`.
- Defined `pan`, `selectText`, `selectObject`, `selectAnnotation`, `selectFormWidget`, and `areaSelect` modes.
- Added helpers for mode changes, hover item, selected items, additive selection, drag start/update/end, item keys, and selection summaries.
- Added an editor mode bar to `examples/full-viewer-workbench/`.
- The workbench now owns shared selection state and resets it when a new PDF is loaded.

### 3) Implement Text Hit Testing

Current text search returns bounding boxes only for matching text. A real editor needs text runs or character boxes.

Add APIs:

- Native: `wasm_pdf_get_page_text_runs`
- Direct: `doc.pageTextRuns(pageIndex)`
- Worker: `queryPageTextRuns`

Return shape should include:

```js
{
  index,
  text,
  startIndex,
  charCount,
  rect,
  pageIndex
}
```

Later additions can include font name, font size, color, and transform if PDFium exposes them safely.

Viewer behavior:

- Click selects nearest/intersecting text run.
- Drag creates text selection by intersecting run/char rectangles.
- Overlay shows selected text rectangles.
- Inspector shows selected text and range.

Initial implementation status:

- Added native `wasm_pdf_get_page_text_runs`.
- Added direct `doc.pageTextRuns(pageIndex)`.
- Added worker `queryPageTextRuns`.
- Added character-level text run parsing in direct and worker APIs.
- Wired full workbench Text selection mode to click-hit-test current page text runs.
- Added rubber-band drag selection for current-page text runs in the full workbench.
- `Shift` + drag extends the current text selection.

### 4) Promote Page Object Helpers To Direct API

Page object native APIs already exist, but the workbench needs direct-wrapper methods.

Add direct helpers:

- `doc.pageObjectCount(pageIndex)`
- `doc.pageObjectInfo(pageIndex, objectIndex)`
- `doc.pageObjects(pageIndex)`
- `doc.deletePageObject(pageIndex, objectIndex)`
- `doc.transformPageObject(pageIndex, objectIndex, matrix)`

Implementation status:

- Added all five direct `pdfium-api.js` helpers.
- `pageObjects()` returns selection-friendly records with `kind`, `key`, `label`, `pageIndex`, `typeName`, and `rect`.
- Added smoke coverage for direct object enumeration, info, invalid transform errors, valid transform bounds, and deletion.

Use existing worker/native behavior as the reference.

### 5) Promote Annotation Helpers To Direct API

Annotation native APIs already exist, but the full workbench should not manually manage raw pointers.

Add direct helpers:

- `doc.annotationCount(pageIndex)`
- `doc.annotationInfo(pageIndex, annotationIndex)`
- `doc.annotations(pageIndex)`
- `doc.deleteAnnotation(pageIndex, annotationIndex)`
- `doc.updateAnnotation(...)`

Initial update methods should wrap existing setters:

- rect
- color
- text/contents
- URI

Implementation status:

- Added direct `annotationCount`, `annotationInfo`, `annotations`, and `deleteAnnotation`.
- Added direct `setAnnotationRect`, `setAnnotationColor`, `setAnnotationText`, `setAnnotationUri`, and `updateAnnotation`.
- `annotations()` returns selection-friendly records with `kind`, `key`, `label`, `pageIndex`, `subtypeName`, `rect`, `contents`, `uri`, `colorRgba`, `borderWidth`, and `quadPoints`.
- Added smoke coverage for direct annotation enumeration, updates, invalid info errors, and deletion.

### 6) Normalize Selectable Items

Create one common item shape for hit testing and inspector rendering:

```js
{
  kind: "text" | "pageObject" | "annotation" | "formWidget" | "image",
  pageIndex,
  index,
  rect,
  label,
  data
}
```

Build a page-level query:

```js
getSelectableItems(pageIndex)
```

This should combine:

- text runs
- page objects
- annotations
- form widgets

Implementation status:

- Added `SELECTABLE_ITEM_KINDS` and `doc.getSelectableItems(pageIndex, options)` to the direct API.
- Normalized direct text runs, page objects, image page objects, annotations, and form widgets to `{ kind, pageIndex, index, rect, label, key, data }`.
- Added smoke coverage for mixed selectable item queries and form widget selectable records.
- Updated the full workbench to refresh current-page selectable items from `doc.getSelectableItems(pageIndex)` and derive text selection runs from that normalized list.

### 7) Implement Pointer Interaction Layer

Add canvas/page-stack event handling:

- `pointerdown`
- `pointermove`
- `pointerup`
- `dblclick`
- keyboard shortcuts

Required interactions:

- click select
- hover highlight
- shift-click multi-select
- drag area select
- drag selected item to move later
- resize handles later

Every pointer event should convert:

- viewport/client coordinates
- canvas pixel coordinates
- PDF user-space coordinates

Implementation status:

- Added `examples/shared/pointer-interactions.js` for mode-aware item filtering, coordinate conversion, point hit testing, and area hit testing.
- Replaced the full workbench text-only pointer flow with generic pointer handling for Text, Object/Image, Annotation, Form widget, and Area modes.
- Added hover state updates, click selection, `Shift` multi-select, rubber-band area selection, and double-click selection status.
- Added keyboard handling for `Escape`, `Cmd/Ctrl+S`, and `Delete`/`Backspace` for deletable annotation/page-object/image selections.

### 8) Add Selection Overlay UI

Overlays should update independently from PDF rendering.

Overlay types:

- hover rectangle
- selected rectangle
- multi-selected rectangles
- text selection highlights
- resize handles
- drag ghost
- area-selection marquee

Do not re-render the PDF for hover/selection changes.

Implementation status:

- Added `examples/shared/selection-overlays.js` as the reusable selection overlay renderer.
- Full workbench selection overlays now render independently from page rendering through `renderOverlays()`.
- Added hover boxes, selected and multi-selected boxes, text-specific highlight styling, non-text resize handles, drag ghost outlines, and area-selection marquees.

### 9) Add Selected Item Inspector

Add a generic inspector panel showing:

- item type
- page index
- bounds
- selected text/content
- object-specific metadata
- widget/annotation/page-object details

Initial inspector can be read-only. Later, it becomes the edit panel for each item type.

Implementation status:

- Added `examples/shared/selection-inspector.js` as a reusable read-only inspector for normalized selectable items.
- Added a Selected Item panel to the full workbench.
- Inspector shows generic item type, page, index, key, bounds, and item-specific text, page-object/image, annotation, and form-widget metadata.
- Multi-selection shows a compact selected item list.

### 10) Add Keyboard Shortcuts

Initial shortcuts:

- `Escape`: clear selection
- `Delete` / `Backspace`: delete selected item where supported
- arrow keys: nudge selected item later
- `Shift + arrow`: larger nudge later
- `Cmd/Ctrl + S`: save
- `Cmd/Ctrl + Z`: undo later
- `Cmd/Ctrl + Shift + Z`: redo later

Implementation status:

- Added `examples/shared/keyboard-shortcuts.js` for shortcut classification and editable-target filtering.
- Full workbench handles `Escape`, `Delete`/`Backspace`, and `Cmd/Ctrl+S` with active behavior.
- Full workbench handles arrow-key nudge and `Cmd/Ctrl+Z`/`Cmd/Ctrl+Shift+Z` with explicit planned-feature status messages until transform/history support lands.
- Added visible shortcut help to the Editor Mode panel.

### 11) Define Mutation Refresh Rules

After any edit:

- mark document dirty
- refresh selectable items for the current page
- re-render page only if visual PDF content changed
- keep selection if the item identity still resolves
- otherwise clear selection and show a status message

PDFium object and annotation indexes can change after deletions/imports/saves, so identity must be treated as semi-stable until stronger IDs exist.

### 12) Add Undo/Redo Foundation

Before adding broad element editing, define undo/redo.

Simple first version:

- store full PDF byte snapshots before each mutation
- restore by reopening snapshot bytes

Suggested API:

```js
history.pushSnapshot(label)
history.undo()
history.redo()
```

Later optimization can move to operation-based undo.

### 13) Integrate Into Full Viewer Workbench

Add an `Editor` tab or mode bar to `examples/full-viewer-workbench/`.

Suggested mode bar:

- Select
- Text
- Object
- Annotation
- Form
- Area

The specialized panels should react to the selected item.

## Recommended Implementation Order

1. Extract shared coordinate and overlay utilities.
2. Add direct page object helpers.
3. Add direct annotation helpers.
4. Add text-run bounding-box API.
5. Add selectable item model and hit testing.
6. Add click and drag selection in the full workbench.
7. Add selected-item inspector panel.
8. Add delete and move operations for selected items.
9. Add undo/redo snapshots.
10. Expand editing per element type.

## API Gaps To Close First

- Text runs/character boxes with coordinates.
- Direct page object enumeration/update/delete helpers.
- Direct annotation enumeration/update/delete helpers.
- Shared overlay and hit-testing modules.
- Selection state shared by the full workbench.

## Known Risks

- Text selection quality depends on text-run/character box granularity.
- PDFium object indexes can change after mutations.
- Some page objects may have bounds that do not match visible pixels exactly.
- Rotated pages and non-default boxes require careful coordinate normalization.
- Full secure redaction still needs separate strict-mode work.
