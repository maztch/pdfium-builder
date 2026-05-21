# Page Geometry Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample demonstrates page geometry inspection and editing. It renders a page, overlays media/crop/bleed/trim/art boxes, lets you edit box coordinates, updates page size, and saves the modified PDF.

## What It Covers

- Loads a PDF from a local file input.
- Renders the current page with `renderPage()`.
- Reads page size with `pageSize(pageIndex)`.
- Reads page boxes with `pageBox(pageIndex, boxType)`.
- Draws page box overlays over the rendered canvas.
- Shows all boxes or only the selected box.
- Edits selected box values:
  - left
  - bottom
  - right
  - top
- Applies box changes with `setPageBox()`.
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
http://localhost:8080/examples/page-geometry/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF stays local in the browser.
- The sample preloads `../demo.pdf` on startup. Use the file input to replace it.
- PDF coordinates use a bottom-left origin; canvas coordinates use a top-left origin. The sample maps boxes with `pdfRectToCanvasRect()`.
- Invalid boxes, such as `right <= left` or `top <= bottom`, are rejected by the native wrapper.

## Next Improvements

- Add draggable box handles.
- Add numeric presets for common page sizes.
- Add visual warnings when boxes fall outside the media box.
- Add a dedicated crop-preview mode.
