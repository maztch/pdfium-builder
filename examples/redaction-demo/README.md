# Redaction Demo Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample demonstrates a basic text-redaction workflow. It preloads `../demo.pdf`, renders the current page, searches page text, previews redaction rectangles, applies object-level text redaction on the current page, and saves the modified PDF.

## What It Covers

- Preloads `../demo.pdf` on startup.
- Loads a replacement PDF from a local file input.
- Renders the current page with `renderPage()`.
- Extracts current page text with `pageText(pageIndex)`.
- Searches current page text with `searchPageText(pageIndex, query, flags)`.
- Supports search flags:
  - match case
  - whole word
  - consecutive
- Draws redaction preview rectangles over the canvas.
- Applies text redaction with `redactPageText({ pageIndex, query, flags, rgba })`.
- Re-renders the page after redaction.
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
http://localhost:8080/examples/redaction-demo/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF stays local in the browser.
- The sample preloads `../demo.pdf` on startup. Use the file input to replace it.
- This sample uses the direct API on the main thread.
- PDF coordinates use a bottom-left origin; canvas coordinates use a top-left origin. The sample uses `pdfRectToCanvasRect()` to convert search rectangles for overlays.
- Redaction is object-level in this build: matching text objects are removed and black cover rectangles are painted over match bounds.
- This is not a full secure-redaction engine. It does not redact image pixels, vector outlines, annotations, or hidden duplicate text.

## Next Improvements

- Add a whole-document redaction flow that iterates every page.
- Add a review queue before applying redactions.
- Add strict mode warnings when non-text page objects overlap redaction rectangles.
- Add a worker-backed variant using `searchPageText` and `redactPageText`.
