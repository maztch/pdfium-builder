# Page Management Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample demonstrates document page mutations: insert blank pages, delete pages, duplicate pages, import pages from another PDF, rotate pages, resize pages, and save the modified PDF.

## What It Covers

- Loads a destination PDF from a local file input.
- Renders the current page with `renderPage()`.
- Navigates pages and zooms the preview.
- Inserts blank pages before or after the current page.
- Deletes the current page.
- Duplicates the current page with `wasm_pdf_copy_page`.
- Opens a second source PDF and imports pages with `wasm_pdf_import_pages`.
- Applies page rotation with `setPageRotation()`.
- Applies page size changes with `setPageSize()`.
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
http://localhost:8080/examples/page-management/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDFs stay local in the browser.
- The sample preloads `../demo.pdf` on startup. Use the file input to replace it.
- This sample uses the direct API on the main thread.
- The direct wrapper already exposes high-level insert/delete/rotate/resize methods. Copy/import are called through small local helpers around the exported native functions.
- Import page ranges use PDFium's one-based range format, for example `1,3,5-7`. Leave the range empty to import all pages.

## Next Improvements

- Add thumbnail strip navigation.
- Add drag-and-drop page reordering if a reorder API is added.
- Add worker-backed page mutations for larger PDFs.
- Add explicit page box controls or link to a dedicated page geometry sample.
