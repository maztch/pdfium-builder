# Build Guide

## Required tools

Install and verify:

- `git`
- `python3`
- `ninja`
- Emscripten: `emcc`, `em++`

```bash
emcc --version
em++ --version
ninja --version
```

## Fetch PDFium dependencies

From the repo root:

```bash
./scripts/bootstrap_pdfium.sh
```

This creates:

- `third_party/depot_tools`
- `third_party/pdfium/pdfium`

`third_party/` is intentionally ignored by Git.

## Build pipeline

Run the full build:

```bash
./scripts/build_pdfium_wasm.sh
./scripts/build_wrapper_wasm.sh
```

Outputs:

- `dist/pdfium.js`
- `dist/pdfium.wasm`

## Smoke test

```bash
npm run smoke
```

Equivalent direct command:

```bash
node tests/smoke_node.cjs
```

## Build scripts

- `scripts/bootstrap_pdfium.sh`: fetches upstream PDFium and `depot_tools`.
- `scripts/build_pdfium_wasm.sh`: configures GN args and builds `third_party/pdfium/pdfium/out/wasm/obj/libpdfium.a`.
- `scripts/build_wrapper_wasm.sh`: links `wasm/pdfium_edit_wrapper.cc`, `wasm/pdfium_wasm_platform_stub.cc`, and `libpdfium.a` into JS/WASM.

## PDFium GN args

Edit the generated `args.gn` template in `scripts/build_pdfium_wasm.sh`.

Useful knobs:

- `is_debug = false`: keep `false` for smaller/faster release builds.
- `symbol_level = 0`: set to `1` or `2` for debugging, with larger outputs.
- `pdf_enable_v8 = false`: keep disabled unless JavaScript-in-PDF support is required.
- `pdf_use_skia = false`: keep disabled for this simpler/smaller setup.
- `pdf_is_complete_lib = true`: required to emit `obj/libpdfium.a`.
- `pdf_use_partition_alloc = false`: avoids allocator constraints in the WASM flow.

Practical presets:

- Smallest: `is_debug=false`, `symbol_level=0`, `pdf_enable_v8=false`, `pdf_use_skia=false`.
- Debuggable: `is_debug=true`, `symbol_level=2`, expecting much larger output.

## Emscripten link flags

Main flags live in `scripts/build_wrapper_wasm.sh`:

- `-O3`: speed-oriented output. Use `-Oz` for smaller binary size.
- `-std=c++20`: matches the wrapper and PDFium build expectations.
- `-sALLOW_MEMORY_GROWTH=1`: safer for unknown workloads, with runtime overhead.
- `-sMODULARIZE=1`: emits factory-style JS module.
- `-sEXPORT_ES6=1`: emits ES module glue.
- `-sENVIRONMENT=web,worker,node`: supports browser, worker, and Node runtimes.
- `-sEXPORTED_FUNCTIONS=...`: exports native wrapper symbols.
- `-sEXPORTED_RUNTIME_METHODS=...`: exports Emscripten runtime helpers used by tests/examples.

Keep exported functions minimal. Every unnecessary export increases API surface and can affect output size.

## Clean rebuild

Use this when changing PDFium build flags or when the PDFium output is suspect:

```bash
rm -rf third_party/pdfium/pdfium/out/wasm dist
./scripts/build_pdfium_wasm.sh
./scripts/build_wrapper_wasm.sh
npm run smoke
```

## Emscripten cache

`EM_CACHE` is redirected to `./.emcache` by the wrapper build script. This avoids writes into Homebrew or system-managed Emscripten cache directories.

## Generated files

Generated outputs are not the source of truth:

- `dist/pdfium.js`
- `dist/pdfium.wasm`
- `.emcache/`

Rebuild them from scripts after wrapper or build changes.
