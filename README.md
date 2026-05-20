# PDFium WASM Custom Build

Build PDFium to WebAssembly, expose custom C/C++ wrapper APIs, and call them from browser JavaScript to edit PDFs (for example, add text and save).

## Project structure

- `scripts/bootstrap_pdfium.sh`: downloads `depot_tools` + PDFium sources
- `scripts/build_pdfium_wasm.sh`: builds `libpdfium.a` for wasm
- `scripts/build_wrapper_wasm.sh`: links wrapper + PDFium to final wasm/js module
- `wasm/pdfium_edit_wrapper.cc`: exported editing API wrapper
- `wasm/pdfium_wasm_platform_stub.cc`: wasm platform shim needed at link time
- `examples/browser_add_text_example.js`: browser usage example
- `worker/pdfium-worker.js`: reusable background worker for add-text jobs
- `dist/`: generated outputs (`pdfium.js`, `pdfium.wasm`)

## Installation

### 1) Required tools

You need:
- `git`
- `python3`
- `ninja`
- `emscripten` (`emcc`, `em++`)

If Emscripten is installed with Homebrew, verify:

```bash
emcc --version
em++ --version
```

### 2) Clone/fetch PDFium dependencies

From this repo root:

```bash
./scripts/bootstrap_pdfium.sh
```

This creates:
- `third_party/depot_tools`
- `third_party/pdfium/pdfium`

## Build

Run full pipeline:

```bash
./scripts/build_pdfium_wasm.sh
./scripts/build_wrapper_wasm.sh
```

Outputs:
- `dist/pdfium.js`
- `dist/pdfium.wasm`

## Smoke test

After building, run the dependency-free Node smoke test:

```bash
node tests/smoke_node.cjs
```

The test creates a minimal one-page PDF in memory, opens it through the WASM wrapper, adds text, saves a copy, and verifies the saved PDF can be reopened.

## Exported wrapper functions

From `wasm/pdfium_edit_wrapper.cc`:
- `wasm_pdf_last_error()`
- `wasm_pdfium_init()`
- `wasm_pdfium_destroy()`
- `wasm_pdf_open_from_bytes(dataPtr, size, password)`
- `wasm_pdf_page_count(handle)`
- `wasm_pdf_get_page_size(handle, pageIndex, widthPtr, heightPtr)`
- `wasm_pdf_get_page_rotation(handle, pageIndex)`
- `wasm_pdf_set_page_rotation(handle, pageIndex, rotation)`
- `wasm_pdf_get_page_box(handle, pageIndex, boxType, leftPtr, bottomPtr, rightPtr, topPtr)`
- `wasm_pdf_set_page_box(handle, pageIndex, boxType, left, bottom, right, top)`
- `wasm_pdf_set_page_size(handle, pageIndex, width, height)`
- `wasm_pdf_get_permissions(handle)`
- `wasm_pdf_get_metadata(handle, key, outPtrPtr, outSizePtr)`
- `wasm_pdf_set_metadata(handle, key, value)`
- `wasm_pdf_insert_blank_page(handle, pageIndex, width, height)`
- `wasm_pdf_delete_page(handle, pageIndex)`
- `wasm_pdf_copy_page(srcHandle, srcPageIndex, dstHandle, dstPageIndex)`
- `wasm_pdf_import_pages(srcHandle, pageRange, dstHandle, dstPageIndex)`
- `wasm_pdf_add_text_page(handle, pageIndex, text, x, y, fontSize, rgba)`
- `wasm_pdf_save_copy(handle, outPtrPtr, outSizePtr)`
- `wasm_pdf_free_buffer(ptr)`
- `wasm_pdf_close(handle)`

`wasm_pdf_last_error()` returns a numeric code from this wrapper enum:

- `0`: none
- `1`: not initialized
- `2`: invalid argument
- `3`: out of memory
- `4`: load document failed
- `5`: invalid handle
- `6`: load page failed
- `7`: create text failed
- `8`: set text failed
- `9`: set color failed
- `10`: insert object failed
- `11`: generate content failed
- `12`: save failed
- `13`: write failed
- `14`: output too large
- `15`: invalid UTF-8 text
- `16`: create page failed
- `17`: delete page failed
- `18`: copy page failed
- `19`: import pages failed
- `20`: PDFium unknown error
- `21`: PDFium file error
- `22`: PDFium format error
- `23`: PDFium password error
- `24`: PDFium security error
- `25`: PDFium page error
- `26`: page geometry failed
- `27`: metadata read failed
- `28`: metadata write failed

Query return conventions:

- `wasm_pdf_page_count(handle)` returns a page count, or `-1` on failure.
- `wasm_pdf_get_page_size(handle, pageIndex, widthPtr, heightPtr)` returns `1` on success and writes doubles to `widthPtr` / `heightPtr`; it returns `0` on failure. PDFium reports rotation-aware page dimensions here, so a 90/270 degree page may have width and height swapped relative to the media box.
- `wasm_pdf_get_page_rotation(handle, pageIndex)` returns `0`, `1`, `2`, or `3` for 0, 90, 180, or 270 degrees clockwise; it returns `-1` on failure.
- `wasm_pdf_set_page_rotation(handle, pageIndex, rotation)` returns `1` on success and `0` on failure. `rotation` must be `0`, `1`, `2`, or `3`.
- `wasm_pdf_get_page_box(handle, pageIndex, boxType, leftPtr, bottomPtr, rightPtr, topPtr)` returns `1` on success and writes doubles to the output pointers; it returns `0` on failure.
- `wasm_pdf_set_page_box(handle, pageIndex, boxType, left, bottom, right, top)` returns `1` on success and `0` on failure. `right` must be greater than `left`, and `top` must be greater than `bottom`.
- `wasm_pdf_set_page_size(handle, pageIndex, width, height)` returns `1` on success and `0` on failure. It sets the page media box to `[0, 0, width, height]`.
- `wasm_pdf_get_permissions(handle)` returns PDF permission flags. Unprotected or owner-unlocked documents usually return `0xffffffff`; `0` indicates failure when paired with a non-zero `wasm_pdf_last_error()`.
- `wasm_pdf_get_metadata(handle, key, outPtrPtr, outSizePtr)` returns `1` on success and writes a UTF-8 byte buffer plus size. Release non-null output with `wasm_pdf_free_buffer`.
- `wasm_pdf_set_metadata(handle, key, value)` returns `1` on success and `0` on failure. `value` must be valid UTF-8.
- `wasm_pdf_insert_blank_page(handle, pageIndex, width, height)` returns `1` on success and `0` on failure. A `pageIndex` larger than the last page appends.
- `wasm_pdf_delete_page(handle, pageIndex)` returns `1` on success and `0` on failure.
- `wasm_pdf_copy_page(srcHandle, srcPageIndex, dstHandle, dstPageIndex)` imports one source page into the destination document. `dstPageIndex` may equal the destination page count to append.
- `wasm_pdf_import_pages(srcHandle, pageRange, dstHandle, dstPageIndex)` imports a one-based PDFium page range like `"1,3,5-7"`. Pass an empty string to import all source pages. `dstPageIndex` may equal the destination page count to append.

Page box types:

- `0`: media box
- `1`: crop box
- `2`: bleed box
- `3`: trim box
- `4`: art box

Metadata keys:

- `Title`
- `Author`
- `Subject`
- `Keywords`
- `Creator`
- `Producer`
- `CreationDate`
- `ModDate`

## Browser usage flow

1. Read input PDF into `Uint8Array`
2. Call `wasm_pdf_open_from_bytes`
3. Optionally call query APIs like `wasm_pdf_page_count`, `wasm_pdf_get_page_size`, `wasm_pdf_get_page_rotation`, `wasm_pdf_get_page_box`, `wasm_pdf_get_permissions`, and `wasm_pdf_get_metadata`
4. Optionally mutate pages with `wasm_pdf_insert_blank_page`, `wasm_pdf_delete_page`, `wasm_pdf_copy_page`, or `wasm_pdf_import_pages`
5. Optionally mutate page geometry with `wasm_pdf_set_page_rotation`, `wasm_pdf_set_page_box`, or `wasm_pdf_set_page_size`
6. Optionally mutate document metadata with `wasm_pdf_set_metadata`
7. Call `wasm_pdf_add_text_page`
8. Call `wasm_pdf_save_copy`
9. Create a Blob and download/save

See: `examples/browser_add_text_example.js`

## Worker usage flow

Use `worker/pdfium-worker.js` for background processing. The worker accepts request messages shaped as `{ id, type: "addText", payload }` and responds with `{ id, type, ok, payload }` or `{ id, type, ok: false, error }`.

```js
const worker = new Worker(new URL("./worker/pdfium-worker.js", import.meta.url), { type: "module" });

worker.postMessage(
  {
    id: crypto.randomUUID(),
    type: "addText",
    payload: { pdfBytes: inputBytes.buffer, text: "Hello from worker" },
  },
  [inputBytes.buffer]
);
```

See: `docs/JS_WORKER_BACKGROUND.md`

## Parameters you can tune (to improve build/output)

### A) PDFium GN args (`scripts/build_pdfium_wasm.sh`)

Edit the generated `args.gn` template in this script.

Useful knobs:
- `is_debug = false`: keep `false` for smaller/faster release builds
- `symbol_level = 0`: set to `1`/`2` for debugging, but larger outputs
- `pdf_enable_v8 = false`: keep disabled unless JS-in-PDF engine is required
- `pdf_use_skia = false`: keep disabled for simpler/smaller build in this setup
- `pdf_is_complete_lib = true`: required to emit `obj/libpdfium.a`
- `pdf_use_partition_alloc = false`: avoids allocator constraints in wasm flow

Practical presets:
- **Smallest**: `is_debug=false`, `symbol_level=0`, `pdf_enable_v8=false`, `pdf_use_skia=false`
- **Debuggable**: `is_debug=true`, `symbol_level=2` (expect much larger output)

### B) Emscripten link flags (`scripts/build_wrapper_wasm.sh`)

Main optimization and runtime flags:
- `-O3`: highest speed; change to `-Oz` for smaller binary
- `-sALLOW_MEMORY_GROWTH=1`: safer for unknown workloads, slower than fixed memory
- `-sMODULARIZE=1`: JS factory module style
- `-sENVIRONMENT=web,worker,node`: target runtime environments
- `-sEXPORTED_FUNCTIONS=...`: keep minimal; exporting less reduces JS/WASM surface
- `-sEXPORTED_RUNTIME_METHODS=...`: keep minimal for smaller JS glue

Common improvements:
- For smaller bundle: switch `-O3` -> `-Oz`
- For stricter memory: replace growth with fixed memory settings (`-sINITIAL_MEMORY=...`)
- For production hardening: export only APIs you actually call

### C) Wrapper-level improvements (`wasm/pdfium_edit_wrapper.cc`)

You can improve runtime behavior by:
- Validating Unicode rendering/extraction across target viewers and fonts
- Embedding/loading custom fonts instead of only using `"Helvetica"`
- Adding structured error codes (instead of only `0/1`)
- Adding APIs for image placement, text extraction, annotations, etc.

## Notes and caveats

- The build script applies small local patches to checked-out PDFium to make this wasm flow work with current upstream layout.
- Emscripten cache is redirected to `./.emcache` to avoid writing into Homebrew cellar paths.
- First build can take a while; incremental rebuilds are much faster.

## Clean rebuild

If you need a fresh rebuild:

```bash
rm -rf third_party/pdfium/pdfium/out/wasm dist
./scripts/build_pdfium_wasm.sh
./scripts/build_wrapper_wasm.sh
```

## Git ignore for `third_party`

This repo is configured to ignore fetched dependencies:

- `third_party/`

If `third_party` was already tracked in Git, run:

```bash
git rm -r --cached third_party
git add .gitignore
git commit -m "Ignore third_party directory"
```

Then verify:

```bash
git status
```
