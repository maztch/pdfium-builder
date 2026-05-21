# Text Search Viewer Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample extends the viewer flow with page text extraction, text search, result lists, and canvas overlays. It introduces the coordinate conversion needed by later annotation, page object, and page geometry samples.

## What It Covers

- Loads a PDF from a local file input.
- Renders the current page with `renderPage()`.
- Extracts current page text with `pageText(pageIndex)`.
- Searches current page text with `searchPageText(pageIndex, query, flags)`.
- Supports search flags:
  - match case
  - whole word
  - consecutive
- Lists search matches with start index, character count, and rectangle count.
- Draws search result rectangles over the canvas.
- Highlights the selected match.
- Keeps search overlays aligned when changing page or zoom.

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
http://localhost:8080/examples/text-search-viewer/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF stays local in the browser.
- The sample preloads `../demo.pdf` on startup. Use the file input to replace it.
- This sample uses the direct API on the main thread.
- PDF coordinates use a bottom-left origin; canvas coordinates use a top-left origin. The sample uses `pdfRectToCanvasRect()` to convert search rectangles for overlays.

## Next Improvements

- Add previous/next match navigation.
- Scroll the active match into view.
- Show snippets around each match.
- Extract overlay helpers into shared example utilities.
