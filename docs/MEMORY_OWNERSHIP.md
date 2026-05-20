# Memory Ownership

This document defines who owns native handles, native pointers, and JS buffers.

## Direct WASM Rules

Prefer `pdfium-api.js` for direct JS usage. It applies these rules internally for the methods it wraps. Use the raw rules below when calling `wasm_pdf_*` exports directly.

| Resource | Created by | Released by | Notes |
|---|---|---|---|
| Input buffer pointer | JS via `_malloc` | JS via `_free` | Copy PDF/image bytes into `HEAPU8` before calling native APIs. |
| Document handle | `wasm_pdf_open_from_bytes` | `wasm_pdf_close` | Always close in `finally`. |
| Output buffer pointer | Wrapper via `malloc` | `wasm_pdf_free_buffer` | Applies to save, metadata, outline, attachment, annotation info, text, search, and render outputs. |
| Pointer-to-pointer slots | JS via `_malloc(4)` | JS via `_free` | Used for output pointer and output size. |
| Render output bytes | Wrapper via `malloc` | `wasm_pdf_free_buffer` | Copy with `HEAPU8.slice` if data must survive memory growth/free. |

## Functions That Allocate Output Buffers

| Function | Output | Release |
|---|---|---|
| `wasm_pdf_save_copy(handle, outPtrPtr, outSizePtr)` | PDF bytes | `wasm_pdf_free_buffer(outPtr)` |
| `wasm_pdf_get_metadata(handle, key, outPtrPtr, outSizePtr)` | UTF-8 bytes | `wasm_pdf_free_buffer(outPtr)` |
| `wasm_pdf_get_outline(handle, outPtrPtr, outSizePtr)` | Binary outline result buffer | `wasm_pdf_free_buffer(outPtr)` |
| `wasm_pdf_get_attachment_info(handle, attachmentIndex, outPtrPtr, outSizePtr)` | Binary attachment info buffer | `wasm_pdf_free_buffer(outPtr)` |
| `wasm_pdf_get_attachment_file(handle, attachmentIndex, outPtrPtr, outSizePtr)` | Attachment file bytes | `wasm_pdf_free_buffer(outPtr)` |
| `wasm_pdf_get_annotation_info(handle, pageIndex, annotationIndex, outPtrPtr, outSizePtr)` | Binary annotation info buffer | `wasm_pdf_free_buffer(outPtr)` |
| `wasm_pdf_get_page_text(handle, pageIndex, outPtrPtr, outSizePtr)` | UTF-8 bytes | `wasm_pdf_free_buffer(outPtr)` |
| `wasm_pdf_search_page_text(handle, pageIndex, query, flags, outPtrPtr, outSizePtr)` | Binary search result buffer | `wasm_pdf_free_buffer(outPtr)` |
| `wasm_pdf_render_page_rgba(handle, pageIndex, width, height, flags, outPtrPtr, outSizePtr)` | RGBA bytes | `wasm_pdf_free_buffer(outPtr)` |
| `wasm_pdf_render_page_area_rgba(handle, pageIndex, left, bottom, right, top, width, height, flags, outPtrPtr, outSizePtr)` | RGBA bytes | `wasm_pdf_free_buffer(outPtr)` |

## Functions That Do Not Allocate Output Buffers

Most mutation/query APIs return scalar values and do not allocate caller-owned output buffers:

- Page count, page size, page rotation, page boxes, permissions.
- Attachment count.
- Page insert/delete/copy/import.
- Text/image insertion and attachment add/update/delete.
- Annotation creation/update/delete and annotation count.
- Page object count/info/delete/transform.

If a function writes into caller-provided scalar pointers, the caller owns those scalar pointer slots and frees them with `_free`.

## Worker Rules

The worker owns all request-local WASM allocations and document handles. It frees them in `finally` blocks.

Worker callers own only JS `ArrayBuffer` values:

- Request `pdfBytes`, `rgbaBytes`, and `imageBytes` can be transferred to avoid copying.
- Response `pdfBytes` and `rgbaBytes` are returned as `ArrayBuffer` values.
- Transferred request buffers are detached on the sender side.

## Safe Direct Pattern

```js
let inputPtr = 0;
let outPtrPtr = 0;
let outSizePtr = 0;
let outPtr = 0;
let handle = 0;

try {
  inputPtr = mod._malloc(inputBytes.length);
  mod.HEAPU8.set(inputBytes, inputPtr);

  handle = mod.ccall("wasm_pdf_open_from_bytes", "number", ["number", "number", "string"], [inputPtr, inputBytes.length, ""]);

  outPtrPtr = mod._malloc(4);
  outSizePtr = mod._malloc(4);
  const ok = mod.ccall("wasm_pdf_save_copy", "number", ["number", "number", "number"], [handle, outPtrPtr, outSizePtr]);
  if (!ok) throw new Error("save failed");

  outPtr = mod.getValue(outPtrPtr, "i32");
  const outSize = mod.getValue(outSizePtr, "i32");
  const output = mod.HEAPU8.slice(outPtr, outPtr + outSize);
} finally {
  if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
  if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
  if (inputPtr) mod._free(inputPtr);
  if (outPtrPtr) mod._free(outPtrPtr);
  if (outSizePtr) mod._free(outSizePtr);
}
```

## Common Mistakes

- Forgetting to call `wasm_pdf_free_buffer` for save/render/outline/attachment/text/search outputs.
- Forgetting to close document handles after errors.
- Keeping a `HEAPU8.subarray` view after freeing or after memory growth.
- Transferring an `ArrayBuffer` to a worker and then trying to reuse it.
- Treating PDF page objects and annotations as the same thing; they have separate APIs and lifetimes.
