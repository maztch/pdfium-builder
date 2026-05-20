# PDFium WASM Custom Build

Build PDFium to WebAssembly, expose a custom C/C++ wrapper API, and call it from browser, worker, or Node JavaScript to inspect and edit PDFs.

## What this repo provides

- A reproducible PDFium WASM build pipeline.
- A JS-callable wrapper around selected PDFium editing/query APIs.
- ES module output in `dist/pdfium.js` plus `dist/pdfium.wasm`.
- A reusable module worker in `worker/pdfium-worker.js`.
- A dependency-free Node smoke test covering core wrapper behavior.

## Project structure

- `scripts/bootstrap_pdfium.sh`: fetches `depot_tools` and PDFium sources.
- `scripts/build_pdfium_wasm.sh`: builds `libpdfium.a` for WASM.
- `scripts/build_wrapper_wasm.sh`: links the wrapper and PDFium into final JS/WASM output.
- `wasm/pdfium_edit_wrapper.cc`: exported `wasm_pdf_*` wrapper API.
- `wasm/pdfium_wasm_platform_stub.cc`: WASM platform shim needed at link time.
- `worker/pdfium-worker.js`: module worker with a stable message protocol.
- `examples/browser_add_text_example.js`: browser usage example.
- `tests/smoke_node.cjs`: Node smoke test.
- `dist/`: generated `pdfium.js` and `pdfium.wasm`.

## Quick start

```bash
./scripts/bootstrap_pdfium.sh
./scripts/build_pdfium_wasm.sh
./scripts/build_wrapper_wasm.sh
npm run smoke
```

Required tools:

- `git`
- `python3`
- `ninja`
- Emscripten tools: `emcc`, `em++`

## Documentation

- [Build Guide](docs/BUILD.md): prerequisites, bootstrap, build commands, tuning, clean rebuilds.
- [API Reference](docs/API.md): exported `wasm_pdf_*` functions, error codes, constants, binary result formats.
- [Feature Matrix](docs/FEATURE_MATRIX.md): capability status across native API, worker support, tests, and docs.
- [Usage Guide](docs/USAGE.md): direct JS lifecycle, browser flow, memory cleanup, examples.
- [Worker Guide](docs/WORKER.md): module worker setup, message protocol, request examples.
- [Internals Guide](docs/INTERNALS.md): wrapper architecture, adding methods, PDFium header locations, build vs wrapper responsibilities.
- [Roadmap](docs/IMPROVEMENTS_ROADMAP.md): planned improvements and implementation notes.

## Current capability summary

- Open PDF bytes, save copies, and close handles.
- Query page count, page size, rotation, boxes, permissions, metadata, annotations, page objects, text, and text search rectangles.
- Mutate page rotation, page boxes, page size, metadata, pages, page objects, annotations, text, and RGBA/JPEG/PNG images.
- Render full pages or PDF-space page areas to RGBA buffers.
- Run heavy PDF work in a module worker with balanced cleanup.

## Smoke test

After building, run:

```bash
npm run smoke
```

The smoke test creates a minimal PDF in memory, exercises the wrapper API, saves a copy, reopens it, and validates persistence plus selected render output.
