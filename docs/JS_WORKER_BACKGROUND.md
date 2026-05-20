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

For object selection UIs, use `queryPageObjects` and `deletePageObject`:

```js
{
  id: "request-5",
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
  id: "request-6",
  type: "deletePageObject",
  payload: {
    pdfBytes: inputBytes.buffer,
    pageIndex: 0,
    objectIndex: 1,
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

## Cleanup behavior

The worker initializes PDFium once and reuses the module. Each `addText`, `addImage`, `renderPage`, `renderPageArea`, `queryPageObjects`, and `deletePageObject` request closes its document handle and frees every request-local WASM allocation in a `finally` path.

Requests are serialized through an internal queue so multiple main-thread messages cannot interleave PDFium state changes.

## Important notes

- Use transferable `ArrayBuffer` values to avoid copying input/output PDF bytes.
- Create the worker with `{ type: "module" }` when loading it without a bundler.
- If you relocate `worker/` or `dist/`, update the paths in `worker/pdfium-worker.js`.
