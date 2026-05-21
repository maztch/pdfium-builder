# Examples

This folder contains small browser-oriented examples that use the ES module API exposed by this repo.

Run browser examples from a local static server so ES modules and `dist/pdfium.wasm` load correctly.

Recommended for frontend developers:

```bash
npm run examples
```

Then open the sample URL shown below.

Standalone browser samples preload [`demo.pdf`](demo.pdf) on startup. Use the PDF file input in each sample to replace it with another local file.

## Samples

| Sample | Type | Summary | Run |
|---|---|---|---|
| [`basic-viewer/`](basic-viewer/) | Browser page | Loads a local PDF, renders pages to canvas, and provides page navigation plus zoom controls. | `http://localhost:8080/examples/basic-viewer/` |
| [`page-info-viewer/`](page-info-viewer/) | Browser page | Renders pages and shows page size, rotation, boxes, permissions, and metadata. | `http://localhost:8080/examples/page-info-viewer/` |
| [`text-search-viewer/`](text-search-viewer/) | Browser page | Extracts page text, searches with flags, lists matches, and draws search rectangles over the canvas. | `http://localhost:8080/examples/text-search-viewer/` |
| [`annotation-workbench/`](annotation-workbench/) | Browser page | Lists, overlays, adds, updates, deletes, renders, and saves annotations. | `http://localhost:8080/examples/annotation-workbench/` |
| [`image-insertion/`](image-insertion/) | Browser page | Uploads a browser image, previews placement, inserts it into the PDF, and saves changes. | `http://localhost:8080/examples/image-insertion/` |
| [`page-management/`](page-management/) | Browser page | Inserts, deletes, duplicates, imports, rotates, resizes, renders, and saves pages. | `http://localhost:8080/examples/page-management/` |
| [`page-geometry/`](page-geometry/) | Browser page | Visualizes and edits media/crop/bleed/trim/art boxes and page size. | `http://localhost:8080/examples/page-geometry/` |
| [`page-object-inspector/`](page-object-inspector/) | Browser page | Lists page objects, overlays bounds, transforms/deletes objects, and saves changes. | `http://localhost:8080/examples/page-object-inspector/` |
| [`metadata-outline/`](metadata-outline/) | Browser page | Views/edits metadata, lists outline/bookmarks, navigates destinations, and saves changes. | `http://localhost:8080/examples/metadata-outline/` |
| [`attachments-panel/`](attachments-panel/) | Browser page | Lists, downloads, adds, replaces, deletes, renders, and saves embedded attachments. | `http://localhost:8080/examples/attachments-panel/` |
| [`redaction-demo/`](redaction-demo/) | Browser page | Searches text, previews redaction bounds, applies object-level redaction, renders, and saves changes. | `http://localhost:8080/examples/redaction-demo/` |
| [`browser-add-text/`](browser-add-text/) | Browser module helper | Exports `addTextToPdf(inputBytes, text)` for adding text to page 1 and returning saved PDF bytes. | Import `examples/browser-add-text/index.js` from a browser page or bundler entry. |

## Requirements

- Build `dist/pdfium.js` and `dist/pdfium.wasm` first with `./scripts/build_wrapper_wasm.sh`.
- Keep `examples/demo.pdf` available if you want the automatic preload behavior.
- Serve the repository root, not just `examples/`, because examples import `../../pdfium-api.js` and load `../../dist/pdfium.wasm`.
- Use a modern browser with ES module and WebAssembly support.
- `npm run examples` uses `npx http-server`; it may download the package the first time.

## Related Docs

- [`docs/VIEWER_SAMPLES.md`](../docs/VIEWER_SAMPLES.md): planned viewer sample roadmap.
- [`docs/USAGE.md`](../docs/USAGE.md): direct API usage.
- [`docs/WORKER.md`](../docs/WORKER.md): worker API usage.
