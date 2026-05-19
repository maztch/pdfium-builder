# Build vs Wrapper

## High-level difference

- **Build**: compiles upstream PDFium and links artifacts into wasm/js outputs.
- **Wrapper**: defines the API surface you expose to JavaScript (`wasm_pdf_*` functions).

Think of it this way:
- Build decides **how PDFium is produced**.
- Wrapper decides **what your app can call**.

## What belongs to build

Build concerns are in scripts:
- `scripts/bootstrap_pdfium.sh`
- `scripts/build_pdfium_wasm.sh`
- `scripts/build_wrapper_wasm.sh`

Typical build changes:
- change optimization (`-O3` vs `-Oz`)
- adjust exported symbols (`-sEXPORTED_FUNCTIONS`)
- enable/disable PDFium features in GN args
- change output names (`pdfium.js/.wasm`)

## What belongs to wrapper

Wrapper concerns are in C++ sources:
- `wasm/pdfium_edit_wrapper.cc`
- `wasm/pdfium_wasm_platform_stub.cc`

Typical wrapper changes:
- add/remove exported C functions
- translate JS-friendly arguments to PDFium API calls
- manage document handles and output buffers
- normalize error handling and return codes

## Dependency direction

- Wrapper depends on PDFium APIs.
- Build depends on wrapper only at final link stage.
- Build can succeed while wrapper API is still incomplete for your product needs.

## Rule of thumb

- If the question is "how do we compile/package this?" -> build.
- If the question is "what functions can JS call?" -> wrapper.
