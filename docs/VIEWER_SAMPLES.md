# Viewer Sample Roadmap

This file lists browser viewer samples that exercise the wrapper API from simple read-only flows to richer editing workbenches.

Run viewer samples from a local static server so ES modules and `pdfium.wasm` load correctly:

```bash
npm run examples
```

Then open `http://localhost:8080/examples/basic-viewer/`.

## 1) Basic Viewer

- Load a PDF from `<input type="file">`.
- Render the current page to a `<canvas>`.
- Show page count, current page, page size, and zoom.
- Provide previous/next page controls.
- Provide zoom in/out/reset controls.
- Initial sample: [`examples/basic-viewer/`](../examples/basic-viewer/).

## 2) Page Info Viewer

- Show page size, rotation, boxes, and permissions.
- Use `queryDocument` in the worker path or direct page query methods.
- Add controls to inspect media, crop, bleed, trim, and art boxes.
- Initial sample: [`examples/page-info-viewer/`](../examples/page-info-viewer/).

## 3) Text Search Viewer

- Extract page text into a side panel.
- Search within the current page.
- Draw search result rectangles over the rendered canvas.
- Provide match navigation.
- Initial sample: [`examples/text-search-viewer/`](../examples/text-search-viewer/).

## 4) Annotation Viewer

- List annotations on the current page.
- Show type, rectangle, color, contents, and URI.
- Draw selected annotation bounds on top of the canvas.
- Delete selected annotations.
- Full sample: [`examples/annotation-workbench/`](../examples/annotation-workbench/).

## 5) Annotation Editor

- Add highlights, links, notes, rectangles, and FreeText annotations.
- Update annotation rectangle, color, text, and URI.
- Save the modified PDF.
- Covered by [`examples/annotation-workbench/`](../examples/annotation-workbench/).

## 6) Text Insertion Demo

- Insert simple text at a clicked page position.
- Insert wrapped text boxes.
- Expose text, font size, standard font name, color, width, height, alignment, and line height controls.

## 7) Image Insertion Demo

- Upload a browser image.
- Decode browser-supported formats to RGBA with `createDecodedImagePayload()`.
- Place the image on the page.
- Resize and save.
- Initial sample: [`examples/image-insertion/`](../examples/image-insertion/).

## 8) Page Management Demo

- Insert blank pages.
- Delete pages.
- Copy pages.
- Import pages from another PDF.
- Rotate pages and change page size.
- Initial sample: [`examples/page-management/`](../examples/page-management/).

## 9) Page Geometry Editor

- Visualize media, crop, bleed, trim, and art boxes.
- Edit box values numerically.
- Preview the resulting page crop/geometry.

## 10) Page Object Inspector

- Enumerate page objects.
- Draw object bounds.
- Delete selected page objects.
- Transform selected objects with translate, scale, and matrix controls.

## 11) Metadata And Outline Viewer

- Read and edit metadata fields.
- Show outline/bookmark presence and tree data.
- Navigate by outline items where destination data is available.

## 12) Attachments Panel

- List embedded files.
- Download attachment bytes.
- Add new attachments.
- Replace or delete existing attachments.

## 13) Forms Demo

- List AcroForm fields and widgets.
- Edit text fields.
- Toggle checkbox/radio state.
- Select combo/list options.
- Show widget geometry and appearance state.

## 14) Redaction Demo

- Search for text.
- Preview redaction rectangles.
- Apply text redaction.
- Save the result.
- Clearly show the current limitation: redaction is object-level and not a full secure redaction engine for complex PDFs.

## 15) Full Viewer Workbench

- Combine rendering, navigation, search, annotations, metadata, attachments, forms, page objects, page management, and save.
- Use a tabbed or sidebar layout so each feature remains isolated and testable.
