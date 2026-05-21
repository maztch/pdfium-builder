# Editor Mode Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample focuses on edit mode only. It preloads `../demo.pdf`, renders one page, exposes selectable editor modes, lets users select text/page objects/images/annotations/form widgets, move selected page objects/images/annotations, add a text box, delete supported selected items, undo/redo changes, and save the edited PDF.

## What It Covers

- Preloads `../demo.pdf` on startup.
- Loads a replacement PDF from a local file input.
- Renders the current page with previous/next navigation.
- Uses the shared editor selection model and overlay renderer.
- Supports Pan, Text, Object, Annotation, Form, and Area selection modes.
- Click-selects or rubber-band selects normalized selectable items from `getSelectableItems()`.
- Shows an I-beam cursor in Text mode and renders selected text as square translucent highlight areas.
- Shows a selected item inspector.
- Moves selected page objects/images/annotations by dragging directly on the canvas, with buttons, or with arrow-key nudge.
- Resizes selected page objects/images by dragging selection handles in Object mode.
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
- Annotation moves update annotation rectangles with `updateAnnotation(..., { rect })`.
- Drag-to-move starts in Object mode on page objects/images or in Annotation mode on annotations. Dragging empty space still performs area selection.
- Undo/redo uses bounded full-PDF byte snapshots, which is simple and reliable but not memory optimal for large PDFs.

## Completed Editor Actions

- Resize selected page objects/images using the existing selection handles.

## Next Actions

- Resize selected annotation rectangles with the same handle interaction.
- Improve text selection into continuous line/range selection instead of separate run boxes.
- Add click-to-place text insertion so Text mode can set the add-text coordinates from the canvas.
- Add an editable inspector for annotation text, URI, color, border width, and rectangle values.
- Add numeric inspector controls for selected object/image position and size.
- Add a floating selection toolbar with delete, move, resize, and edit actions near the selected item.
- Add Shift-constrained movement and optional snap guides for margins, page center, and nearby objects.
- Add duplicate support for selected objects if native object copy/import support is exposed.
- Replace full-PDF snapshot undo with operation-based undo once editor mutations become more granular.
