# Usage Guide

This guide covers direct use of the generated ES module. For background processing, use the [Worker Guide](WORKER.md).

## Load the module

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
3. Run query APIs such as page count, page size, metadata, text extraction, search, annotations, or page objects.
4. Run mutation APIs such as page insertion, text/image insertion, annotations, metadata, geometry, or object transforms.
5. Optionally render a full page or area to RGBA preview pixels.
6. Save with `wasm_pdf_save_copy`.
7. Create a `Blob` and download or upload it.

See `examples/browser_add_text_example.js` for a runnable browser-oriented example.

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
