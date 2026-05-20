# Examples

These examples show common task flows. They assume `dist/pdfium.js` and `dist/pdfium.wasm` have already been built.

## Worker helper

Use one helper for request/response wiring:

```js
export function requestPdfWorker(worker, type, payload, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();

    function onMessage(event) {
      if (event.data?.id !== id) return;
      worker.removeEventListener("message", onMessage);

      if (!event.data.ok) {
        const error = new Error(event.data.error?.message || "PDF worker request failed");
        error.code = event.data.error?.code;
        error.errorName = event.data.error?.name;
        reject(error);
        return;
      }

      resolve(event.data.payload);
    }

    worker.addEventListener("message", onMessage);
    worker.postMessage({ id, type, payload }, transfer);
  });
}
```

Create the worker:

```js
const worker = new Worker(new URL("../worker/pdfium-worker.js", import.meta.url), { type: "module" });
```

## Add Text

```js
const inputBytes = new Uint8Array(await file.arrayBuffer());

const result = await requestPdfWorker(
  worker,
  "addText",
  {
    pdfBytes: inputBytes.buffer,
    pageIndex: 0,
    text: "Approved",
    x: 72,
    y: 720,
    fontSize: 18,
    rgba: 0xff003366,
  },
  [inputBytes.buffer]
);

const outputPdf = new Uint8Array(result.pdfBytes);
```

## Add JPEG Or PNG

```js
const pdfBytes = new Uint8Array(await file.arrayBuffer());
const imageBytes = new Uint8Array(await imageFile.arrayBuffer());

const result = await requestPdfWorker(
  worker,
  "addImage",
  {
    pdfBytes: pdfBytes.buffer,
    imageFormat: "png",
    imageBytes: imageBytes.buffer,
    pageIndex: 0,
    x: 72,
    y: 120,
    displayWidth: 240,
    displayHeight: 160,
  },
  [pdfBytes.buffer, imageBytes.buffer]
);
```

Use `imageFormat: "jpeg"` for JPEG files. PNG support is limited to common non-interlaced 8-bit grayscale, RGB, grayscale-alpha, and RGBA PNGs.

## Add A FreeText Box

```js
const result = await requestPdfWorker(
  worker,
  "addAnnotation",
  {
    pdfBytes: inputBytes.buffer,
    annotationType: "freeText",
    pageIndex: 0,
    left: 72,
    bottom: 300,
    right: 300,
    top: 360,
    contents: "Visible editable text",
    fontSize: 14,
    textRgba: 0xff003366,
    borderRgba: 0xff003366,
    borderWidth: 1,
  },
  [inputBytes.buffer]
);
```

## Search Text And Highlight It

```js
const searchBytes = inputBytes.slice();
const search = await requestPdfWorker(
  worker,
  "searchPageText",
  {
    pdfBytes: searchBytes.buffer,
    pageIndex: 0,
    query: "invoice",
    flags: 0,
  },
  [searchBytes.buffer]
);

const firstRect = search.matches[0]?.rects[0];
if (firstRect) {
  const editBytes = inputBytes.slice();
  const highlighted = await requestPdfWorker(
    worker,
    "addAnnotation",
    {
      pdfBytes: editBytes.buffer,
      annotationType: "highlight",
      pageIndex: 0,
      ...firstRect,
      rgba: 0x80ffff00,
    },
    [editBytes.buffer]
  );
}
```

`searchPageText` is read-only and returns match rectangles. If you transfer a buffer to the worker, that buffer is detached on the caller side, so keep or create another copy before a later mutation.

## Render A Preview

```js
const preview = await requestPdfWorker(
  worker,
  "renderPage",
  {
    pdfBytes: inputBytes.buffer,
    pageIndex: 0,
    width: 1024,
    height: 768,
    flags: 0x01,
  },
  [inputBytes.buffer]
);

const pixels = new Uint8ClampedArray(preview.rgbaBytes);
const imageData = new ImageData(pixels, preview.width, preview.height);
canvas.getContext("2d").putImageData(imageData, 0, 0);
```

## Build Bookmark Navigation

```js
const outlineBytes = inputBytes.slice();
const { outline } = await requestPdfWorker(
  worker,
  "queryOutline",
  {
    pdfBytes: outlineBytes.buffer,
  },
  [outlineBytes.buffer]
);

function renderBookmarkList(items) {
  return items.map((item) => ({
    label: item.title,
    pageIndex: item.destination?.pageIndex ?? null,
    y: item.destination?.y ?? null,
    url: item.uri,
    children: renderBookmarkList(item.children),
  }));
}

const navigation = renderBookmarkList(outline);
```

`queryOutline` is read-only. Transfer a copied buffer if you still need the original PDF bytes for later edits.

## Add And Read Embedded Attachments

```js
const attachmentBytes = new TextEncoder().encode("source data");

const attached = await requestPdfWorker(
  worker,
  "addAttachment",
  {
    pdfBytes: inputBytes.buffer,
    name: "source.txt",
    fileBytes: attachmentBytes.buffer,
    mimeType: "text/plain",
  },
  [inputBytes.buffer, attachmentBytes.buffer]
);

const queryBytes = new Uint8Array(attached.pdfBytes).slice();
const { attachments } = await requestPdfWorker(
  worker,
  "queryAttachments",
  {
    pdfBytes: queryBytes.buffer,
  },
  [queryBytes.buffer]
);

const readBytes = new Uint8Array(attached.pdfBytes).slice();
const { attachment } = await requestPdfWorker(
  worker,
  "readAttachment",
  {
    pdfBytes: readBytes.buffer,
    attachmentIndex: attachments[0].index,
  },
  [readBytes.buffer]
);

const text = new TextDecoder().decode(attachment.fileBytes);
```

Attachment APIs operate on document-level embedded files. They are separate from file-attachment annotations.

## Render A Page Area

```js
const cropped = await requestPdfWorker(
  worker,
  "renderPageArea",
  {
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
  [inputBytes.buffer]
);
```

## Move A Page Object

```js
const queryBytes = inputBytes.slice();
const query = await requestPdfWorker(
  worker,
  "queryPageObjects",
  {
    pdfBytes: queryBytes.buffer,
    pageIndex: 0,
  },
  [queryBytes.buffer]
);

const image = query.objects.find((object) => object.type === 3);
if (image) {
  const editBytes = inputBytes.slice();
  const moved = await requestPdfWorker(
    worker,
    "transformPageObject",
    {
      pdfBytes: editBytes.buffer,
      pageIndex: 0,
      objectIndex: image.index,
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 24,
      f: 36,
    },
    [editBytes.buffer]
  );
}
```

As with text search, `queryPageObjects` is read-only. Keep an untransferred copy of the PDF if you want to query and then mutate.

## Direct Native Call Pattern

Use direct calls when you need APIs not yet wrapped by worker messages:

```js
import PdfiumWasm from "../dist/pdfium.js";

const mod = await PdfiumWasm({
  locateFile(file) {
    return new URL(`../dist/${file}`, import.meta.url).href;
  },
});

mod.ccall("wasm_pdfium_init", "number", [], []);
```

For full memory ownership details, see [Memory Ownership](MEMORY_OWNERSHIP.md).
