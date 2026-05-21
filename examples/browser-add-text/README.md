# Browser Add Text Helper

Sample file: [`index.js`](index.js)

## Purpose

This is a minimal browser module helper for mutating a PDF by inserting text and returning saved PDF bytes.

## Exported API

```js
import { addTextToPdf } from "./examples/browser-add-text/index.js";

const outputBytes = await addTextToPdf(inputBytes, "Hello PDF");
```

## What It Covers

- Creates the direct API with `createPdfiumApi()`.
- Opens PDF bytes with `withDocument()`.
- Adds text to page 1 with `doc.addText()`.
- Saves the modified PDF with `doc.save()`.
- Destroys the PDFium API after use.

## Run

This file is a module helper, not a standalone HTML page. Import it from a browser page or bundler entry.

For a no-bundler test page, serve the repository root:

```bash
npm run examples
```

Then import it from a `<script type="module">` page:

```js
import { addTextToPdf } from "/examples/browser-add-text/index.js";
```

## Notes

- Build `dist/pdfium.js` and `dist/pdfium.wasm` first with `./scripts/build_wrapper_wasm.sh`.
- The helper currently inserts simple single-position text.
- For wrapping, alignment, and font selection, use `doc.addTextBox()` directly from `pdfium-api.js`.
