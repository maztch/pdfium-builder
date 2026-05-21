# Editor Mode Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample focuses on edit mode only. It preloads `../demo.pdf`, renders one page, exposes selectable editor modes, lets users select text/page objects/images/annotations/form widgets, move selected page objects/images, add a text box, delete supported selected items, undo/redo changes, and save the edited PDF.

## What It Covers

- Preloads `../demo.pdf` on startup.
- Loads a replacement PDF from a local file input.
- Renders the current page with previous/next navigation.
- Uses the shared editor selection model and overlay renderer.
- Supports Pan, Text, Object, Annotation, Form, and Area selection modes.
- Click-selects or rubber-band selects normalized selectable items from `getSelectableItems()`.
- Shows a selected item inspector.
- Moves selected page objects/images by dragging directly on the canvas, with buttons, or with arrow-key nudge.
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
- Move interactions apply `transformPageObject()` translation matrices and therefore target page objects/images only.
- Drag-to-move starts in Object mode when the pointer begins on a page object/image. Dragging empty space still performs area selection.
- Undo/redo uses bounded full-PDF byte snapshots, which is simple and reliable but not memory optimal for large PDFs.
