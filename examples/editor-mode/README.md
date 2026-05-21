# Editor Mode Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample focuses on edit mode only. It preloads `../demo.pdf`, renders one page, exposes selectable editor modes, lets users select text/page objects/images/annotations/form widgets, move and resize selected page objects/images/annotations, edit selected object/image geometry, add a text box, delete supported selected items, undo/redo changes, and save the edited PDF.

## What It Covers

- Preloads `../demo.pdf` on startup.
- Loads a replacement PDF from a local file input.
- Renders the current page with previous/next navigation.
- Uses the shared editor selection model and overlay renderer.
- Supports Pan, Text, Object, Annotation, Form, and Area selection modes.
- Click-selects or rubber-band selects normalized selectable items from `getSelectableItems()`.
- Shows an I-beam cursor in Text mode and renders selected text as square translucent highlight areas.
- Groups Text-mode drag selections into continuous line/range highlights instead of separate run boxes.
- Copies selected text with the Copy selected text button or `Cmd/Ctrl+C`, preserving spaces and punctuation from PDF character order.
- Sets add-text coordinates by clicking empty page space in Text mode.
- Sets add-text box bounds by dragging an empty rectangle in Text mode.
- Shows a selected item inspector, including multi-select counts, bounds, and available actions.
- Replaces selected text page objects with edited content, font, size, and color.
- Shows an accessible icon-only floating selection toolbar near the selected item with copy, delete, move, resize, and edit-focus actions.
- Edits selected page object/image X, Y, width, and height from the object geometry panel.
- Edits selected annotation rectangle, color, border width, text, and URI from the annotation editor panel.
- Creates highlight, rectangle, text note, FreeText, and link annotations from the sidebar panel or floating toolbar using selection bounds or the Add Text rectangle.
- Inserts browser-decoded images using numeric placement, empty Object-mode clicks, or empty Object-mode drag rectangles.
- Moves selected page objects/images/annotations by dragging directly on the canvas, with buttons, or with arrow-key nudge.
- Constrains drag movement to the dominant axis while holding Shift.
- Shows snap guides while dragging near page edges, page centers, and nearby selectable item edges/centers.
- Duplicates selected text page objects with a small offset and selects the duplicates.
- Resizes selected page objects/images by dragging selection handles in Object mode.
- Resizes selected annotation rectangles by dragging selection handles in Annotation mode.
- Shows direction-specific cursors when hovering or dragging resize handles.
- Adds a text box with `addTextBox()`.
- Deletes selected annotations, page objects, and images where supported.
- Stores full-PDF snapshots for undo/redo.
- Saves the modified PDF with `doc.save()`.

## Run

Build the wrapper first:

```bash
./scripts/build_wrapper_wasm.sh
```

Serve the repository root:

```bash
npm run examples
```

Open:

```text
http://localhost:8080/examples/editor-mode/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF stays local in the browser.
- This sample intentionally avoids document metadata, page geometry, attachments, forms editing panels, and other full-workbench tabs.
- Page object and image moves apply `transformPageObject()` translation matrices.
- Page object and image resize also applies `transformPageObject()` with scale/translate matrices based on the dragged handle.
- Object geometry edits apply `transformPageObject()` with a scale/translate matrix derived from the selected object's current PDF-space rectangle and the requested X/Y/width/height.
- Text object edits infer current text from overlapping text runs, delete the selected text page object, and insert a replacement text box at the same bounds.
- Annotation moves update annotation rectangles with `updateAnnotation(..., { rect })`.
- Annotation resize updates annotation rectangles with `updateAnnotation(..., { rect })`.
- Annotation property edits call `updateAnnotation()` with `rect`, `rgba`, `borderWidth`, `contents`, and `uri` as applicable.
- Annotation creation uses direct API helpers for highlight, rectangle, text note, FreeText, and link annotations. New annotations are selected after page refresh when possible.
- FreeText is the default create type because it renders visible editable text on the page. Highlight, rectangle, and link annotations save the Text / contents value as annotation `Contents`, but that content is metadata/popup text rather than visible page text.
- Image insertion uses `createDecodedImagePayload()` and `addRgbaImage()`. Empty clicks in Object mode set the image origin, and empty drag rectangles set exact image bounds before insertion.
- Drag-to-move starts in Object mode on page objects/images or in Annotation mode on annotations. Dragging empty space still performs area selection.
- Shift-drag axis locking and snap guides only apply to direct canvas movement for selected page objects/images/annotations.
- Snap guides use a small PDF-space threshold and snap selected bounds against page margins, page center lines, and nearby selectable item bounds.
- Duplicate support currently applies to text page objects only. Image/path/form object duplication needs broader native clone support.
- The floating toolbar uses inline SVG icons, browser-native tooltips, and accessible labels without adding a runtime icon dependency.
- The floating toolbar uses the same move delta inputs as the Move Items panel. Its grow/shrink actions resize one selected page object, image, or annotation around its center.
- Undo/redo uses bounded full-PDF byte snapshots, which is simple and reliable but not memory optimal for large PDFs.
- Text copy reconstructs selected ranges from `pageText()` character indexes instead of concatenating visible text-run boxes, so hidden spaces and punctuation placement are preserved.
- Text-mode rectangle drags still select text when the rectangle intersects text runs. Empty rectangle drags update the Add Text X/Y/width/height inputs instead.
- Multi-select inspection summarizes selected pages, counts by selectable kind, aggregate bounds, and currently available actions before listing individual items.

## Completed Editor Actions

- Resize selected page objects/images using the existing selection handles.
- Resize selected annotation rectangles with the same handle interaction.
- Improve text selection into continuous line/range selection instead of separate run boxes.
- Copy selected text with a button and keyboard shortcut.
- Add click-to-place text insertion so Text mode can set the add-text coordinates from the canvas.
- Add drag-to-place text insertion so Text mode can set the add-text rectangle from the canvas.
- Add an editable inspector for annotation text, URI, color, border width, and rectangle values.
- Add numeric inspector controls for selected object/image position and size.
- Add a floating selection toolbar with delete, move, resize, and edit actions near the selected item.
- Add Shift-constrained movement and optional snap guides for margins, page center, and nearby objects.
- Add duplicate support for selected text page objects.
- Add per-handle resize cursors for annotations and page objects.
- Add selection grouping and a multi-select inspector with bounds, counts, and available actions.
- Add inline text object replacement for content, font, size, and color.
- Add annotation creation from the editor toolbar.
- Add image placement mode with upload, click placement, and drag rectangle placement.
- Add keyboard nudge variants: Arrow = 1 pt, Shift+Arrow = 10 pt, Alt/Option+Arrow = 0.25 pt.

## Next Actions

- Add visible mouse PDF coordinates and selected bounds while moving/resizing.
- Replace full-PDF snapshot undo with operation-based undo once editor mutations become more granular.
