# Full Viewer Workbench Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample combines the direct ES module viewer/editor flows into one tabbed browser workbench. It preloads `../demo.pdf`, keeps one document open in the browser, renders pages, exposes common read/write panels, and saves the modified PDF.

## What It Covers

- Preloads `../demo.pdf` on startup.
- Loads a replacement PDF from a local file input.
- Renders the current page with navigation and zoom.
- Tracks editor selection mode with a shared selection state model.
- Refreshes normalized current-page selectable items with `getSelectableItems()`.
- Click-selects selectable text, page objects/images, annotations, and form widgets by active editor mode.
- Drag-selects selectable items with a rubber-band rectangle; hold `Shift` to add to the existing selection.
- Uses hover highlighting, double-click selection status, `Escape` to clear selection, `Cmd/Ctrl+S` to save, and `Delete`/`Backspace` to delete selected annotations/page objects/images.
- Reads permissions, metadata, attachment count, and form field count.
- Edits common metadata fields with `setMetadata(key, value)`.
- Extracts current page text with `pageText(pageIndex)`.
- Searches current page text with `searchPageText(pageIndex, query, flags)` and overlays result rectangles.
- Applies object-level text redaction with `redactPageText()`.
- Inserts wrapped text boxes with `addTextBox()`.
- Inserts/deletes/duplicates pages with `insertBlankPage()`, `deletePage()`, and `copyPage()`.
- Imports pages from a second local PDF with `importPages()`.
- Rotates and resizes pages with `setPageRotation()` and `setPageSize()`.
- Reads and edits page boxes with `pageBox()` and `setPageBox()`.
- Inserts browser-decoded images with `addImageFromSource()`.
- Lists, downloads, adds, replaces, and deletes embedded attachments.
- Lists AcroForm fields, overlays widget bounds, edits text values, toggles checkbox/radio widgets, and selects combo/list options.
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
http://localhost:8080/examples/full-viewer-workbench/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF and secondary import PDF stay local in the browser.
- This sample uses the direct API on the main thread. Larger production apps should consider the worker API to avoid blocking UI during heavy renders/saves.
- Redaction is object-level in this build and is not a full secure-redaction engine.
- Annotation and page-object editing remain linked to focused samples because those examples currently expose lower-level/raw-call details that would make this first workbench too dense.

## Next Improvements

- Promote annotation listing/editing into direct `pdfium-api.js` helpers and embed it as a first-class tab.
- Promote page-object enumeration/transforms into direct helpers and embed it as a first-class tab.
- Add outline/bookmark parsing as a direct helper and include an outline navigation tab.
- Add a worker-backed workbench variant for long-running operations.
- Add shared example components to reduce repeated rendering, overlay, and save code across samples.
