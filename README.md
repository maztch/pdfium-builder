# PDFium WASM Custom Build

Build PDFium to WebAssembly, expose custom C/C++ wrapper APIs, and call them from browser JavaScript to edit PDFs (for example, add text and save).

## Project structure

- `scripts/bootstrap_pdfium.sh`: downloads `depot_tools` + PDFium sources
- `scripts/build_pdfium_wasm.sh`: builds `libpdfium.a` for wasm
- `scripts/build_wrapper_wasm.sh`: links wrapper + PDFium to final wasm/js module
- `wasm/pdfium_edit_wrapper.cc`: exported editing API wrapper
- `wasm/pdfium_wasm_platform_stub.cc`: wasm platform shim needed at link time
- `examples/browser_add_text_example.js`: browser usage example
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

## Exported wrapper functions

From `wasm/pdfium_edit_wrapper.cc`:
- `wasm_pdfium_init()`
- `wasm_pdfium_destroy()`
- `wasm_pdf_open_from_bytes(dataPtr, size, password)`
- `wasm_pdf_add_text_page(handle, pageIndex, text, x, y, fontSize, rgba)`
- `wasm_pdf_save_copy(handle, outPtrPtr, outSizePtr)`
- `wasm_pdf_free_buffer(ptr)`
- `wasm_pdf_close(handle)`

## Browser usage flow

1. Read input PDF into `Uint8Array`
2. Call `wasm_pdf_open_from_bytes`
3. Call `wasm_pdf_add_text_page`
4. Call `wasm_pdf_save_copy`
5. Create a Blob and download/save

See: `examples/browser_add_text_example.js`

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
- Replacing ASCII-only UTF-8 fallback with full UTF-8 -> UTF-16 conversion
- Embedding/loading custom fonts instead of only using `"Helvetica"`
- Adding structured error codes (instead of only `0/1`)
- Adding APIs for page insertion/removal, image placement, metadata, etc.

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
