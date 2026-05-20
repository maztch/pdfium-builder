# Running as a JavaScript Worker (Background)

## Why use a Worker

PDF parsing/editing can block the main UI thread. A Worker moves that work to background execution.

## Current implementation

Use:
- `worker/pdfium-worker.js`

The worker is a module worker because `dist/pdfium.js` is generated as an ES module. It imports the generated runtime with `import PdfiumWasm from "../dist/pdfium.js"` and resolves `pdfium.wasm` relative to `dist/`.

The linker already includes:
- `-sENVIRONMENT=web,worker,node`

## Message protocol

For the complete schema table, required fields, defaults, and return payloads, see [Worker Protocol Reference](WORKER_PROTOCOL.md).

Requests use this shape:

```js
{
  id: "request-1",
  type: "addText",
  payload: {
    pdfBytes: inputBytes.buffer,
    text: "Hello from worker",
    pageIndex: 0,
    x: 80,
    y: 120,
    fontSize: 16,
    rgba: 0xff000000,
    password: ""
  }
}
```

For image insertion, use `type: "addImage"` with decoded row-major RGBA pixels:

```js
{
  id: "request-2",
  type: "addImage",
  payload: {
    pdfBytes: inputBytes.buffer,
    rgbaBytes: rgbaPixels.buffer,
    imageWidth: 320,
    imageHeight: 180,
    x: 72,
    y: 120,
    displayWidth: 320,
    displayHeight: 180,
    pageIndex: 0,
    password: ""
  }
}
```

For encoded JPEG or PNG bytes, pass `imageFormat` and `imageBytes` instead of `rgbaBytes`:

```js
{
  id: "request-encoded-image",
  type: "addImage",
  payload: {
    pdfBytes: inputBytes.buffer,
    imageFormat: "png",
    imageBytes: pngBytes.buffer,
    x: 72,
    y: 120,
    displayWidth: 320,
    displayHeight: 180,
    pageIndex: 0,
    password: ""
  }
}
```

For page previews, use `type: "renderPage"`:

```js
{
  id: "request-3",
  type: "renderPage",
  payload: {
    pdfBytes: inputBytes.buffer,
    pageIndex: 0,
    width: 1024,
    height: 768,
    flags: 0x01,
    password: ""
  }
}
```

For cropped previews, use `type: "renderPageArea"` with a PDF user-space rectangle:

```js
{
  id: "request-4",
  type: "renderPageArea",
  payload: {
    pdfBytes: inputBytes.buffer,
    pageIndex: 0,
    left: 72,
    bottom: 120,
    right: 360,
    top: 360,
    width: 512,
    height: 512,
    flags: 0x01,
    password: ""
  }
}
```

Use `addAnnotation` to create highlights, links, text notes, rectangle annotations, or visible FreeText boxes:

```js
{
  id: "request-5",
  type: "addAnnotation",
  payload: {
    pdfBytes: inputBytes.buffer,
    annotationType: "highlight",
    pageIndex: 0,
    left: 72,
    bottom: 700,
    right: 260,
    top: 735,
    rgba: 0x80ffff00,
    password: ""
  }
}
```

Use `updateAnnotation` to change an existing annotation:

```js
{
  id: "request-update-annotation",
  type: "updateAnnotation",
  payload: {
    pdfBytes: inputBytes.buffer,
    updateType: "rect",
    pageIndex: 0,
    annotationIndex: 0,
    left: 80,
    bottom: 705,
    right: 270,
    top: 740,
    password: ""
  }
}
```

For object selection UIs, use `queryPageObjects` and `deletePageObject`:

```js
{
  id: "request-6",
  type: "queryPageObjects",
  payload: {
    pdfBytes: inputBytes.buffer,
    pageIndex: 0,
    password: ""
  }
}
```

```js
{
  id: "request-7",
  type: "deletePageObject",
  payload: {
    pdfBytes: inputBytes.buffer,
    pageIndex: 0,
    objectIndex: 1,
    password: ""
  }
}
```

Use `searchPageText` to find text and get PDF user-space rectangles for highlights:

```js
{
  id: "request-8",
  type: "searchPageText",
  payload: {
    pdfBytes: inputBytes.buffer,
    pageIndex: 0,
    query: "invoice",
    flags: 0,
    password: ""
  }
}
```

Use `queryOutline` to build a navigation tree from PDF bookmarks:

```js
{
  id: "request-outline",
  type: "queryOutline",
  payload: {
    pdfBytes: inputBytes.buffer,
    password: ""
  }
}
```

Use `queryAttachments`, `readAttachment`, and `addAttachment` for document-level embedded files:

```js
{
  id: "request-attachments",
  type: "queryAttachments",
  payload: {
    pdfBytes: inputBytes.buffer,
    password: ""
  }
}
```

```js
{
  id: "request-add-attachment",
  type: "addAttachment",
  payload: {
    pdfBytes: inputBytes.buffer,
    name: "source.txt",
    fileBytes: fileBytes.buffer,
    mimeType: "text/plain",
    password: ""
  }
}
```

Use `transformPageObject` to move, scale, rotate, or shear a selected object:

```js
{
  id: "request-9",
  type: "transformPageObject",
  payload: {
    pdfBytes: inputBytes.buffer,
    pageIndex: 0,
    objectIndex: 1,
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 24,
    f: 36,
    password: ""
  }
}
```

Successful responses use this shape:

```js
{
  id: "request-1",
  type: "addText",
  ok: true,
  payload: {
    pdfBytes: outputArrayBuffer
  }
}
```

Error responses use this shape:

```js
{
  id: "request-1",
  type: "addText",
  ok: false,
  error: {
    message: "Unable to open PDF (pdfium_format)",
    code: 22,
    name: "pdfium_format"
  }
}
```

`error.code` comes from `wasm_pdf_last_error()` where available.

## Main thread usage

```js
const worker = new Worker(new URL("../worker/pdfium-worker.js", import.meta.url), { type: "module" });

worker.onmessage = (event) => {
  const { id, ok, payload, error } = event.data;

  if (!ok) {
    console.error(`PDF worker request ${id} failed`, error);
    return;
  }

  const bytes = new Uint8Array(payload.pdfBytes);
  const blob = new Blob([bytes], { type: "application/pdf" });
  // Use or download the blob.
};

worker.postMessage(
  {
    id: crypto.randomUUID(),
    type: "addText",
    payload: {
      pdfBytes: inputBytes.buffer,
      text: "Hello from worker",
      pageIndex: 0,
      x: 80,
      y: 120,
      fontSize: 16,
      rgba: 0xff003366,
    },
  },
  [inputBytes.buffer]
);
```

Image requests follow the same response shape:

```js
worker.postMessage(
  {
    id: crypto.randomUUID(),
    type: "addImage",
    payload: {
      pdfBytes: inputBytes.buffer,
      rgbaBytes: rgbaPixels.buffer,
      imageWidth: 320,
      imageHeight: 180,
      x: 72,
      y: 120,
      displayWidth: 320,
      displayHeight: 180,
    },
  },
  [inputBytes.buffer, rgbaPixels.buffer]
);
```

Encoded JPEG/PNG requests use the same response shape:

```js
worker.postMessage(
  {
    id: crypto.randomUUID(),
    type: "addImage",
    payload: {
      pdfBytes: inputBytes.buffer,
      imageFormat: "jpeg",
      imageBytes: jpegBytes.buffer,
      x: 72,
      y: 120,
      displayWidth: 320,
      displayHeight: 180,
    },
  },
  [inputBytes.buffer, jpegBytes.buffer]
);
```

Render responses return row-major RGBA pixels:

```js
worker.postMessage(
  {
    id: crypto.randomUUID(),
    type: "renderPage",
    payload: {
      pdfBytes: inputBytes.buffer,
      pageIndex: 0,
      width: 1024,
      height: 768,
      flags: 0x01,
    },
  },
  [inputBytes.buffer]
);
```

Area render responses use the same `{ rgbaBytes, width, height }` payload:

```js
worker.postMessage(
  {
    id: crypto.randomUUID(),
    type: "renderPageArea",
    payload: {
      pdfBytes: inputBytes.buffer,
      pageIndex: 0,
      left: 72,
      bottom: 120,
      right: 360,
      top: 360,
      width: 512,
      height: 512,
      flags: 0x01,
    },
  },
  [inputBytes.buffer]
);
```

Page object queries return object indexes, types, and PDF user-space bounds:

```js
worker.postMessage(
  {
    id: crypto.randomUUID(),
    type: "queryPageObjects",
    payload: { pdfBytes: inputBytes.buffer, pageIndex: 0 },
  },
  [inputBytes.buffer]
);
```

Text search responses return match indexes and one or more rectangles per match:

```js
worker.postMessage(
  {
    id: crypto.randomUUID(),
    type: "searchPageText",
    payload: { pdfBytes: inputBytes.buffer, pageIndex: 0, query: "invoice", flags: 0 },
  },
  [inputBytes.buffer]
);
```

Annotation requests return a saved PDF:

```js
worker.postMessage(
  {
    id: crypto.randomUUID(),
    type: "addAnnotation",
    payload: {
      pdfBytes: inputBytes.buffer,
      annotationType: "rectangle",
      pageIndex: 0,
      left: 72,
      bottom: 120,
      right: 220,
      top: 180,
      rgba: 0xffff0000,
      borderWidth: 2,
    },
  },
  [inputBytes.buffer]
);
```

For visible editable text boxes, use `annotationType: "freeText"`:

```js
worker.postMessage(
  {
    id: crypto.randomUUID(),
    type: "addAnnotation",
    payload: {
      pdfBytes: inputBytes.buffer,
      annotationType: "freeText",
      pageIndex: 0,
      left: 72,
      bottom: 300,
      right: 300,
      top: 360,
      contents: "Visible text box",
      fontSize: 14,
      textRgba: 0xff003366,
      borderRgba: 0xff003366,
      borderWidth: 1,
    },
  },
  [inputBytes.buffer]
);
```

Annotation update requests also return a saved PDF. Supported `updateType` values are `rect`, `color`, `text`, and `uri`.

## Cleanup behavior

The worker initializes PDFium once and reuses the module. Each `addText`, `addImage`, `addAnnotation`, `updateAnnotation`, `renderPage`, `renderPageArea`, `queryPageObjects`, `searchPageText`, `queryOutline`, `queryAttachments`, `readAttachment`, `addAttachment`, `transformPageObject`, and `deletePageObject` request closes its document handle and frees every request-local WASM allocation in a `finally` path.

Requests are serialized through an internal queue so multiple main-thread messages cannot interleave PDFium state changes.

## Important notes

- Use transferable `ArrayBuffer` values to avoid copying input/output PDF bytes.
- Create the worker with `{ type: "module" }` when loading it without a bundler.
- If you relocate `worker/` or `dist/`, update the paths in `worker/pdfium-worker.js`.
- PNG insertion supports non-interlaced 8-bit grayscale, RGB, grayscale-alpha, and RGBA PNGs.
- See [Examples](EXAMPLES.md) for complete worker flows.
