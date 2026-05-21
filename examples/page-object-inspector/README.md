# Page Object Inspector Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample demonstrates page content object inspection and mutation. It lists page objects, draws their bounds, selects objects, applies affine transforms, deletes objects, and saves the modified PDF.

## What It Covers

- Loads a PDF from a local file input.
- Renders the current page with `renderPage()`.
- Enumerates page objects with `wasm_pdf_page_object_count`.
- Reads object type and bounds with `wasm_pdf_get_page_object_info`.
- Draws object bounds over the rendered canvas.
- Selects objects from a list.
- Applies an affine transform with `wasm_pdf_transform_page_object`.
- Deletes the selected object with `wasm_pdf_delete_page_object`.
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
http://localhost:8080/examples/page-object-inspector/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF stays local in the browser.
- The sample preloads `../demo.pdf` on startup. Use the file input to replace it.
- Page object indices are separate from annotation indices.
- The transform matrix must be invertible.
- This sample includes small local helpers around native page object functions because the direct wrapper does not yet expose high-level page object convenience methods.

## Next Improvements

- Extract page object helpers into `pdfium-api.js`.
- Add drag-to-move object controls.
- Add rotate and scale controls around object center.
- Add object reordering if a native reorder API is added.
