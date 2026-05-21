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
Text insertion now accepts standard PDF font names, but relying on built-in fonts limits visual consistency and Unicode glyph coverage across viewers.

### Steps
1. Add wrapper API to load font bytes from JS.
2. Create font object with PDFium APIs and cache per document.
3. Add text placement method using loaded font handle or registered font id.
4. Add cleanup logic on document close.
5. Verify output with multiple viewers.

## 3) Advanced text layout

### Why
`wasm_pdf_add_text_box_page()` supports font name selection, hard line breaks, word wrapping, alignment, and multiline layout. More precise document-generation use cases need better typography and predictable fitting behavior.

### Steps
1. Add explicit overflow reporting so callers know whether text was clipped by `height`.
2. Add optional `maxLines` and ellipsis handling.
3. Add character-level fallback wrapping for long words or URLs that exceed `width`.
4. Add line spacing modes such as exact, multiple, and font-size-relative.
5. Add vertical alignment within a text box: top, middle, bottom.
6. Add paragraph spacing and indentation options.
7. Add rotation/skew support for inserted text boxes.

## 4) Better error model

### Why
The wrapper exposes structured error codes via `wasm_pdf_last_error()`. Some APIs still return only success/failure and could expose richer operation-specific details.

### Steps
1. Done: Define numeric error codes and expose `wasm_pdf_last_error()`.
2. Done: Map native error codes to readable JS/worker error names.
3. Add optional diagnostic detail strings for complex failures.
4. Group error codes by domain in the docs.
5. Add smoke tests for newly introduced error paths.

## 5) Smaller wasm bundle

### Why
Faster network delivery and startup.

### Steps
1. Switch wrapper link optimization from `-O3` to `-Oz`.
2. Remove unused exports in `-sEXPORTED_FUNCTIONS` and runtime methods.
3. Re-evaluate unnecessary PDFium features in GN args.
4. Measure size and runtime before/after.

## 6) Throughput and memory tuning

### Why
Large PDFs can create memory pressure and slower processing.

### Steps
1. Benchmark representative file sizes and operations.
2. Tune memory flags (`ALLOW_MEMORY_GROWTH`, initial memory if needed).
3. Reuse module and worker instances instead of re-initializing.
4. Avoid extra JS copies by using transferables/subarrays carefully.

## 7) API surface expansion (editing features)

### Why
The wrapper now covers common document, page, text, image, annotation, attachment, form, render, and query operations. Remaining work should focus on deeper PDF editing features rather than broad one-off wrappers.

### Steps
1. Add reusable font loading and embedded-font text insertion.
2. Add richer path/vector creation and editing helpers.
3. Add page content reordering APIs.
4. Add resource inspection APIs for fonts, images, and XObjects.
5. Keep each new API small, explicit, and separately tested.

## 8) Automated tests and CI

### Why
Prevent regressions when changing wrapper/build flags.

### Steps
1. Done: Add smoke test script that exercises core wrapper, direct API, and worker behavior.
2. Add golden-file checks for selected output characteristics.
3. Add render-based visual assertions for text layout and annotations.
4. Run tests on clean environment in CI.
5. Fail CI on size regressions beyond threshold (optional).

## 9) Worker-first integration package

### Why
Most browser apps should avoid main-thread PDF processing.

### Steps
1. Done: Provide ready-to-use worker module in repo.
2. Done: Standardize message protocol (`id`, `type`, `payload`, `ok`, `error`).
3. Add cancellation/timeout support for long jobs.
4. Document bundler-specific worker setup (Vite/Webpack/Next).

## 10) Safer redaction

### Why
Current text redaction is object-level: it removes intersecting text objects and paints cover rectangles. That is useful for generated/simple PDFs, but not equivalent to a full PDF redaction engine.

### Steps
1. Investigate whether this PDFium build can expose a supported apply-redactions API.
2. Redact annotation contents, link URIs, metadata, and attachments when requested.
3. Detect images/vectors overlapping redaction rectangles and report them as unresolved risks.
4. Add a strict mode that fails if non-text content overlaps a redaction rectangle.
5. Document secure-redaction limitations clearly in API and worker docs.
