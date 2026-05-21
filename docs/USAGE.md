# Usage Guide

This guide covers direct use of the generated ES module. For background processing, use the [Worker Guide](WORKER.md).

## Preferred direct API

Use `pdfium-api.js` for direct main-thread or Node usage. It wraps the raw Emscripten module, opens/closes document handles, copies output buffers, frees native pointers, and maps `wasm_pdf_last_error()` into `PdfiumApiError`.

```js
import { createPdfiumApi } from "../pdfium-api.js";

const pdfium = await createPdfiumApi({
  locateFile(file) {
    return new URL(`../dist/${file}`, import.meta.url).href;
  },
});

try {
  const outputBytes = await pdfium.withDocument(inputBytes, (doc) => {
    console.log(doc.pageCount());
    console.log(doc.pageSize(0));

    doc.addText({
      pageIndex: 0,
      text: "Hello PDF",
      x: 72,
      y: 720,
      fontSize: 18,
      rgba: 0xff003366,
    });

    return doc.save();
  });

  const blob = new Blob([outputBytes], { type: "application/pdf" });
  console.log(blob);
} finally {
  pdfium.destroy();
}
```

`withDocument()` is the safest path for one-document flows. If you need to keep a document open across multiple calls, use `openDocument()` and close it explicitly:

```js
const doc = pdfium.openDocument(inputBytes);
try {
  doc.setPageRotation(0, 1);
  doc.setPageBox(0, 1, { left: 10, bottom: 20, right: 400, top: 500 });
  const outputBytes = doc.save();
} finally {
  doc.close();
}
```

The direct API currently covers lifecycle, save, page count/size/rotation/boxes, permissions, metadata read/write, embedded attachment list/read/add/update/delete, AcroForm field read/write, page text extraction, text search/redaction, text insertion with wrapping/alignment/font selection, page insert/delete, page rotation/boxes/size, RGBA image insertion, browser image decoding to RGBA, and page rendering.

Wrapped text insertion:

```js
await pdfium.withDocument(inputBytes, (doc) => {
  const lineCount = doc.addTextBox({
    pageIndex: 0,
    text: "A longer note that should wrap inside the box.",
    x: 72,
    y: 700,
    width: 240,
    height: 96,
    fontSize: 12,
    fontName: "Helvetica-Bold",
    align: "center",
    lineHeight: 15,
    rgba: 0xff003366,
  });
  console.log(lineCount);
  return doc.save();
});
```

Basic text redaction:

```js
await pdfium.withDocument(inputBytes, (doc) => {
  const redactedCount = doc.redactPageText({
    pageIndex: 0,
    query: "confidential",
    flags: 2,
    rgba: 0xff000000,
  });
  console.log(redactedCount);
  return doc.save();
});
```

Redaction is object-level in this build: matching text objects are removed and cover rectangles are painted over match bounds.

Basic AcroForm usage:

```js
await pdfium.withDocument(inputBytes, (doc) => {
  const fields = doc.formFields();
  console.log(fields.map((field) => [field.name, field.value]));

  doc.setFormFieldValue("customer.name", "Updated value");
  doc.setFormFieldChecked("agree", true);
  doc.setFormFieldChecked("choice", true, 1);
  doc.setFormFieldSelectedIndex("country", 2);
  return doc.save();
});
```

Embedded attachment usage:

```js
await pdfium.withDocument(inputBytes, (doc) => {
  const before = doc.attachments();
  console.log(before.map((attachment) => attachment.name));

  doc.addAttachment({
    name: "notes.txt",
    mimeType: "text/plain",
    fileBytes: new TextEncoder().encode("hello from an embedded file"),
  });

  const [attachment] = doc.attachments();
  const read = doc.readAttachment(attachment.index);
  console.log(new TextDecoder().decode(read.fileBytes));

  doc.updateAttachment(attachment.index, {
    mimeType: "text/plain",
    fileBytes: new TextEncoder().encode("updated bytes"),
  });

  return doc.save();
});
```

## Browser image decoding

For arbitrary browser-supported image formats such as PNG, JPEG, WebP, AVIF, or GIF first frames, decode with `createImageBitmap` and canvas, then insert through the RGBA path:

```js
await pdfium.withDocument(pdfBytes, async (doc) => {
  await doc.addImageFromSource(imageFile, {
    pageIndex: 0,
    x: 72,
    y: 120,
    displayWidth: 240,
    displayHeight: 160,
  });

  return doc.save();
});
```

To use the same decode path with the worker, build an RGBA payload and send it to `addImage`:

```js
import { createDecodedImagePayload } from "../pdfium-api.js";

const imagePayload = await createDecodedImagePayload(imageFile);
const result = await requestPdfWorker(
  worker,
  "addImage",
  {
    pdfBytes: pdfBytes.buffer,
    ...imagePayload,
    pageIndex: 0,
    x: 72,
    y: 120,
    displayWidth: 240,
    displayHeight: 160,
  },
  [pdfBytes.buffer, imagePayload.rgbaBytes.buffer]
);
```

This browser-side path is more format-compatible than the native PNG decoder because it uses the browser's image stack before handing row-major RGBA bytes to WASM.

## Load the module

Use this raw module path only when you need an exported `wasm_pdf_*` function that `pdfium-api.js` does not wrap yet.

```js
import PdfiumWasm from "../dist/pdfium.js";

const mod = await PdfiumWasm({
  locateFile(file) {
    return new URL(`../dist/${file}`, import.meta.url).href;
  },
});

if (!mod.ccall("wasm_pdfium_init", "number", [], [])) {
  throw new Error("PDFium init failed");
}
```

## Basic lifecycle

1. Copy input PDF bytes into WASM memory with `_malloc` and `HEAPU8.set`.
2. Open a document with `wasm_pdf_open_from_bytes`.
3. Query or mutate using `wasm_pdf_*` APIs.
4. Save with `wasm_pdf_save_copy`.
5. Copy output bytes from WASM memory.
6. Free output buffers with `wasm_pdf_free_buffer`.
7. Close document handles with `wasm_pdf_close`.
8. Free request-local `_malloc` allocations.

Use `try/finally` for every direct call flow. Most bugs in direct WASM integration are leaked pointers or handles.

## Minimal direct example

```js
let inputPtr = 0;
let outPtrPtr = 0;
let outSizePtr = 0;
let outPtr = 0;
let handle = 0;

try {
  inputPtr = mod._malloc(inputBytes.length);
  if (!inputPtr) throw new Error("input allocation failed");
  mod.HEAPU8.set(inputBytes, inputPtr);

  handle = mod.ccall(
    "wasm_pdf_open_from_bytes",
    "number",
    ["number", "number", "string"],
    [inputPtr, inputBytes.length, ""]
  );
  if (!handle) throw new Error(`open failed: ${mod.ccall("wasm_pdf_last_error", "number", [], [])}`);

  const ok = mod.ccall(
    "wasm_pdf_add_text_page",
    "number",
    ["number", "number", "string", "number", "number", "number", "number"],
    [handle, 0, "Hello PDF", 72, 720, 18, 0xff003366]
  );
  if (!ok) throw new Error(`add text failed: ${mod.ccall("wasm_pdf_last_error", "number", [], [])}`);

  outPtrPtr = mod._malloc(4);
  outSizePtr = mod._malloc(4);
  if (!outPtrPtr || !outSizePtr) throw new Error("output pointer allocation failed");

  const saved = mod.ccall(
    "wasm_pdf_save_copy",
    "number",
    ["number", "number", "number"],
    [handle, outPtrPtr, outSizePtr]
  );
  if (!saved) throw new Error(`save failed: ${mod.ccall("wasm_pdf_last_error", "number", [], [])}`);

  outPtr = mod.getValue(outPtrPtr, "i32");
  const outSize = mod.getValue(outSizePtr, "i32");
  const outputBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);

  const blob = new Blob([outputBytes], { type: "application/pdf" });
  console.log(blob);
} finally {
  if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
  if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
  if (inputPtr) mod._free(inputPtr);
  if (outPtrPtr) mod._free(outPtrPtr);
  if (outSizePtr) mod._free(outSizePtr);
}
```

## Common browser flow

1. Read input PDF into `Uint8Array`.
2. Open with `wasm_pdf_open_from_bytes`.
3. Run query APIs such as page count, page size, metadata, outline/bookmarks, form fields, text extraction, search, annotations, or page objects.
4. Run mutation APIs such as page insertion, text/image insertion, annotations, metadata, form field values, geometry, or object transforms.
5. Optionally render a full page or area to RGBA preview pixels.
6. Save with `wasm_pdf_save_copy`.
7. Create a `Blob` and download or upload it.

See `examples/browser-add-text/index.js` for a runnable browser-oriented example.

## Prefer the worker for UI apps

Direct calls can block the main thread while parsing, rendering, or saving PDFs. Use `worker/pdfium-worker.js` for browser UI integrations unless you have a specific reason to run directly on the main thread.

The worker already serializes requests, reuses the initialized module, closes document handles, and frees request-local WASM allocations.

## Memory ownership rules

- Buffers returned through `outPtrPtr` are owned by the wrapper until released with `wasm_pdf_free_buffer`.
- Pointers returned by `_malloc` are owned by JS and must be released with `_free`.
- Document handles returned by `wasm_pdf_open_from_bytes` must be closed with `wasm_pdf_close`.
- Do not use output pointers after freeing them.
- Do not keep JS views into `HEAPU8` after memory may grow; copy bytes with `slice` when you need stable data.

## Coordinate conventions

Most page geometry uses PDF user-space coordinates:

- Origin is bottom-left.
- Rectangles use `left`, `bottom`, `right`, `top`.
- `right` must be greater than `left`.
- `top` must be greater than `bottom`.

Rendering output uses row-major RGBA pixels.

## Color convention

Wrapper color arguments use `0xAARRGGBB`.

Examples:

- `0xff000000`: opaque black
- `0xff003366`: opaque blue
- `0x80ffff00`: half-transparent yellow
- `0xffff0000`: opaque red

## Error handling

When a wrapper call fails, call:

```js
const code = mod.ccall("wasm_pdf_last_error", "number", [], []);
```

Map the numeric code using [API Reference](API.md#error-codes). The worker already maps these into `{ code, name, message }`.
