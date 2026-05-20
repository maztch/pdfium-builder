# Internals Guide

## Architecture

The project has three layers:

- PDFium: upstream C++ library built into `libpdfium.a`.
- Wrapper: `wasm/pdfium_edit_wrapper.cc`, which exposes stable `extern "C"` functions named `wasm_pdf_*`.
- JavaScript integration: generated `dist/pdfium.js`, direct `ccall` usage, and `worker/pdfium-worker.js`.

The wrapper owns the JS-facing ABI. Do not expose raw PDFium object pointers directly to JS except through wrapper-owned opaque handles.

## Build vs wrapper responsibilities

Build concerns live in scripts:

- `scripts/bootstrap_pdfium.sh`
- `scripts/build_pdfium_wasm.sh`
- `scripts/build_wrapper_wasm.sh`

Build changes answer: how do we compile, optimize, link, and package PDFium?

Wrapper concerns live in C++ sources:

- `wasm/pdfium_edit_wrapper.cc`
- `wasm/pdfium_wasm_platform_stub.cc`

Wrapper changes answer: what can JavaScript call, how are arguments validated, how are PDFium errors normalized, and who owns memory?

## Adding a wrapper method

1. Identify the PDFium API in `third_party/pdfium/pdfium/public/*.h` or, only when necessary, an internal PDFium header.
2. Add a small exported function in `wasm/pdfium_edit_wrapper.cc`.
3. Validate all JS-provided arguments before calling PDFium.
4. Set a structured last-error code on every failure path.
5. Close PDFium page/annotation/text handles on every path.
6. Add the symbol to `-sEXPORTED_FUNCTIONS` in `scripts/build_wrapper_wasm.sh`.
7. Add smoke coverage in `tests/smoke_node.cjs`.
8. Update `docs/API.md` and worker docs if the API is public.
9. Rebuild with `./scripts/build_wrapper_wasm.sh` and run `npm run smoke`.

## Removing a wrapper method

1. Remove JS and worker usage first.
2. Remove the C++ wrapper function.
3. Remove the symbol from `-sEXPORTED_FUNCTIONS`.
4. Update `docs/API.md`.
5. Rebuild and run the smoke test.

## PDFium public headers to inspect

- `third_party/pdfium/pdfium/public/fpdfview.h`: document/page lifecycle and rendering.
- `third_party/pdfium/pdfium/public/fpdf_edit.h`: page objects, text, images, content generation.
- `third_party/pdfium/pdfium/public/fpdf_annot.h`: annotations.
- `third_party/pdfium/pdfium/public/fpdf_doc.h`: metadata, links, permissions.
- `third_party/pdfium/pdfium/public/fpdf_save.h`: save callbacks.
- `third_party/pdfium/pdfium/public/fpdf_text.h`: text extraction and search.
- `third_party/pdfium/pdfium/public/fpdf_ppo.h`: page import/copy operations.
- `third_party/pdfium/pdfium/public/fpdf_transformpage.h`: page geometry boxes.

Useful search:

```bash
rg -n "FPDFPageObj_|FPDFText_|FPDFAnnot_|FPDF_Save|FPDF_Load|FPDFPage_" third_party/pdfium/pdfium/public
```

## Internal PDFium use

Prefer public PDFium APIs. Use internal headers only when the public API cannot perform the required operation.

Current examples of internal use:

- Metadata writing uses the document `/Info` dictionary because PDFium public APIs are read-only for metadata.
- FreeText annotation appearance generation uses PDFium annotation appearance internals so the text box is visible after creation.

When using internals, document why in the wrapper or related docs, and cover the behavior in smoke tests.

## Current exported methods

The canonical list is in [API Reference](API.md). Source of truth in code:

- `wasm/pdfium_edit_wrapper.cc`: implementation.
- `scripts/build_wrapper_wasm.sh`: exported symbol list.
- `dist/pdfium.js`: generated glue after build.

Confirm generated availability:

```bash
rg -n "wasm_pdf_add_freetext_annotation|wasm_pdf_render_page_area_rgba|wasm_pdf_save_copy" dist/pdfium.js
```

## Error model

The wrapper stores the last failure in an internal enum and exposes it through `wasm_pdf_last_error()`.

Rules for new APIs:

- Clear last error on success.
- Set `WASM_PDF_ERROR_INVALID_ARGUMENT` before returning on bad JS input.
- Prefer operation-specific error codes over generic failures.
- Use `PdfiumLastErrorToWasmError()` when PDFium exposes a useful last error.
- Keep worker `ERROR_NAMES` in sync with the C++ enum.

## UTF-8 and strings

JS strings passed through `ccall(..., "string", ...)` arrive as UTF-8. The wrapper decodes UTF-8 strictly before passing UTF-16 data to PDFium APIs that expect Unicode strings.

Malformed UTF-8 must fail with `WASM_PDF_ERROR_INVALID_UTF8`.

## Output buffers

Functions that return variable-size data allocate with `malloc` and write:

- `outPtrPtr`: pointer to the allocated buffer.
- `outSizePtr`: byte size.

JS must call `wasm_pdf_free_buffer(ptr)` for non-null returned buffers.

## Worker design

`worker/pdfium-worker.js` is intentionally higher level than the raw wrapper:

- It accepts `{ id, type, payload }` requests.
- It returns `{ id, type, ok, payload }` or `{ id, type, ok: false, error }`.
- It serializes requests to avoid interleaving PDFium global state.
- It reuses the initialized module.
- It closes handles and frees request-local allocations in `finally` blocks.

See [Worker Guide](WORKER.md).
