# Annotation Workbench Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample demonstrates a full annotation flow: inspect annotations, add new annotations, update selected annotation properties, delete annotations, render changes, and save the modified PDF.

## What It Covers

- Loads a PDF from a local file input.
- Renders the current page with annotation rendering enabled.
- Lists annotations on the current page.
- Draws annotation rectangles over the canvas.
- Selects annotations from the list and highlights the selected overlay.
- Adds:
  - highlight annotations
  - rectangle annotations
  - link annotations
  - text note annotations
  - FreeText annotations
- Updates selected annotation:
  - rectangle
  - color
  - contents text
  - URI
- Deletes the selected annotation.
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
http://localhost:8080/examples/annotation-workbench/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF stays local in the browser.
- The sample preloads `../demo.pdf` on startup. Use the file input to replace it.
- This sample uses the direct API on the main thread.
- Link annotation URIs must be non-empty 7-bit ASCII.
- FreeText annotations regenerate an appearance stream when created. Updating FreeText contents updates the annotation contents; viewer appearance behavior depends on PDFium support and the PDF viewer.
- The sample includes local helpers around exported native annotation functions because the direct wrapper does not yet expose a high-level annotation convenience API.

## Next Improvements

- Extract direct annotation helpers into `pdfium-api.js`.
- Add click-and-drag rectangle creation on the canvas.
- Add annotation type-specific forms instead of showing all fields at once.
- Add undo/redo for annotation mutations.
- Add worker-backed annotation mutation calls for heavier PDFs.
