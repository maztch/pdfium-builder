# Image Insertion Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample demonstrates browser image decoding plus PDF image insertion. It lets you load a PDF, upload an image, preview the placement rectangle, insert the image into the current page, re-render, and save the modified PDF.

## What It Covers

- Loads a PDF from a local file input.
- Renders the current page with `renderPage()`.
- Uploads a browser-supported image file.
- Decodes the image with `createDecodedImagePayload()`.
- Shows decoded image dimensions and a preview.
- Sets image placement with numeric PDF-space fields.
- Clicks the canvas to set the image bottom-left position.
- Shows a placement rectangle overlay.
- Inserts the image with `doc.addRgbaImage()`.
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
http://localhost:8080/examples/image-insertion/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF and image stay local in the browser.
- The sample uses browser decoding, so PNG, JPEG, WebP, and other browser-supported formats can be converted to RGBA before insertion.
- PDF coordinates use a bottom-left origin; canvas coordinates use a top-left origin. Clicking the canvas maps the click to PDF-space placement.

## Next Improvements

- Add drag-to-place and drag-to-resize controls.
- Add preserve-aspect-ratio locking.
- Add worker-backed insertion for larger PDFs/images.
- Add encoded JPEG/PNG insertion variants for comparing output size.
