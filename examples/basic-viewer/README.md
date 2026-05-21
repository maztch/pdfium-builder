# Basic Viewer Sample

Sample file: [`index.html`](index.html)

## Purpose

This is the first viewer sample. It demonstrates the smallest useful browser PDF viewer built on the direct ES module API.

## What It Covers

- Loads a PDF from a local file input.
- Opens the PDF with `createPdfiumApi()` and `api.openDocument()`.
- Reads `pageCount()` and `pageSize(pageIndex)`.
- Renders pages with `renderPage()`.
- Draws rendered RGBA pixels to a `<canvas>`.
- Provides previous/next page navigation.
- Provides zoom out, reset, and zoom in controls.
- Closes the current document when another PDF is loaded or the page unloads.

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
http://localhost:8080/examples/basic-viewer/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF stays local in the browser.
- The sample preloads `../demo.pdf` on startup. Use the file input to replace it.
- This sample uses the direct API on the main thread. Later viewer samples can use `worker/pdfium-worker.js` for heavier operations.
- Render flag `0x01` is enabled so annotations are included when PDFium renders the page.

## Next Improvements

- Add fit-to-width.
- Add keyboard navigation.
- Add a worker-backed rendering path.
- Add a text-search overlay sample on top of this viewer.
