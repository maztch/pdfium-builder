# Metadata And Outline Viewer / Editor Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample demonstrates document-level metadata viewing/editing and outline/bookmark inspection. It preloads `../demo.pdf`, renders the current page, lets you edit metadata fields, lists outline items, navigates to outline destinations when available, and saves the modified PDF.

## What It Covers

- Preloads `../demo.pdf` on startup.
- Loads a replacement PDF from a local file input.
- Renders the current page with `renderPage()`.
- Reads common metadata fields with `metadata(key)`.
- Writes metadata fields with `setMetadata(key, value)`.
- Tracks unapplied metadata edits before they are committed to the in-memory PDF.
- Reloads metadata fields from the current in-memory PDF.
- Saves the modified PDF with `doc.save()`.
- Reads outline/bookmark data with `wasm_pdf_get_outline`.
- Lists outline title, action type, destination view mode, page target, URI, and hierarchy depth.
- Navigates to outline page destinations when available.
- Opens URI outline actions in a new tab.

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
http://localhost:8080/examples/metadata-outline/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF stays local in the browser.
- This sample includes a small local parser for the native outline buffer because the direct wrapper does not yet expose a high-level outline convenience method.
- Metadata is applied to the in-memory PDF first. Use **Save PDF** to download the modified file.
- Outline/bookmark data is read-only in this sample because the wrapper currently exposes outline read APIs only.

## Next Improvements

- Extract outline parsing into `pdfium-api.js`.
- Render outline hierarchy as collapsible tree nodes.
- Add validation for PDF date metadata fields.
- Add a worker-backed variant using `queryOutline` and `queryDocument`.
