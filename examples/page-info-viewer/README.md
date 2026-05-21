# Page Info Viewer Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample extends the basic viewer with read-only document and page diagnostics. It is intended as a debugging UI for validating page geometry and document-level properties.

## What It Covers

- Loads a PDF from a local file input.
- Renders the current page with `renderPage()`.
- Reads page count with `pageCount()`.
- Reads current page size with `pageSize(pageIndex)`.
- Reads current page rotation with `pageRotation(pageIndex)`.
- Reads media, crop, bleed, trim, and art boxes with `pageBox(pageIndex, boxType)`.
- Reads PDF permission flags with `permissions()`.
- Reads common metadata keys with `metadata(key)`.
- Shows previous/next page and zoom controls.

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
http://localhost:8080/examples/page-info-viewer/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF stays local in the browser.
- The sample preloads `../demo.pdf` on startup. Use the file input to replace it.
- This sample uses the direct API on the main thread.
- Permission labels are decoded from the standard PDF permission bit flags returned by PDFium.

## Next Improvements

- Add a worker-backed variant using `queryDocument`.
- Add a copy-to-clipboard button for diagnostics.
- Add a JSON panel with the full collected page/document info.
- Add visual page-box overlays on top of the rendered canvas.
