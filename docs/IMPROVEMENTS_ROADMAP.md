# Improvements Roadmap

This file lists practical improvements and concrete steps for each one.

## 1) Full Unicode text support

### Why
The wrapper now performs strict UTF-8 -> UTF-16 conversion. Remaining work is validating output behavior across PDF viewers and font coverage.

### Steps
1. Done: Implement robust UTF-8 -> UTF-16 conversion in `wasm/pdfium_edit_wrapper.cc`.
2. Done: Add smoke coverage with accented, CJK, emoji, and malformed UTF-8 inputs.
3. Validate resulting text extraction/rendering in target viewers.
4. Keep explicit error handling for malformed UTF-8.

## 2) Font embedding and custom fonts

### Why
Using only `Helvetica` limits consistency across viewers.

### Steps
1. Add wrapper API to load font bytes from JS.
2. Create font object with PDFium APIs and cache per document.
3. Add text placement method using loaded font handle.
4. Add cleanup logic on document close.
5. Verify output with multiple viewers.

## 3) Better error model

### Why
Current `0/1` style makes debugging difficult.

### Steps
1. Define numeric error codes (enum) per operation.
2. Return detailed errors from each wrapper call.
3. Expose helper `wasm_pdf_last_error()` for diagnostics.
4. Update JS layer to map codes to readable messages.

## 4) Smaller wasm bundle

### Why
Faster network delivery and startup.

### Steps
1. Switch wrapper link optimization from `-O3` to `-Oz`.
2. Remove unused exports in `-sEXPORTED_FUNCTIONS` and runtime methods.
3. Re-evaluate unnecessary PDFium features in GN args.
4. Measure size and runtime before/after.

## 5) Throughput and memory tuning

### Why
Large PDFs can create memory pressure and slower processing.

### Steps
1. Benchmark representative file sizes and operations.
2. Tune memory flags (`ALLOW_MEMORY_GROWTH`, initial memory if needed).
3. Reuse module and worker instances instead of re-initializing.
4. Avoid extra JS copies by using transferables/subarrays carefully.

## 6) API surface expansion (editing features)

### Why
Current API is minimal (open/add text/save/close).

### Steps
1. Add wrappers for page insert/remove/copy (see `fpdf_ppo.h`).
2. Add wrappers for image insertion and transforms (`fpdf_edit.h`).
3. Add wrappers for metadata and page geometry operations.
4. Keep each new API small, explicit, and separately tested.

## 7) Automated tests and CI

### Why
Prevent regressions when changing wrapper/build flags.

### Steps
1. Add smoke test script that builds and runs one edit operation.
2. Add golden-file checks (input -> expected output characteristics).
3. Run tests on clean environment in CI.
4. Fail CI on size regressions beyond threshold (optional).

## 8) Worker-first integration package

### Why
Most browser apps should avoid main-thread PDF processing.

### Steps
1. Provide ready-to-use worker module in repo.
2. Standardize message protocol (`type`, `payload`, `error`).
3. Add cancellation/timeout support for long jobs.
4. Document bundler-specific worker setup (Vite/Webpack/Next).
