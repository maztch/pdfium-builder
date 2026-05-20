# Where to Find Methods to Add or Remove

## 1) Current exported methods (already exposed to JS)

Start here:
- `wasm/pdfium_edit_wrapper.cc`

Current exported functions are the `extern "C"` methods named like:
- `wasm_pdf_last_error`
- `wasm_pdfium_init`
- `wasm_pdf_open_from_bytes`
- `wasm_pdf_page_count`
- `wasm_pdf_get_page_size`
- `wasm_pdf_get_page_rotation`
- `wasm_pdf_set_page_rotation`
- `wasm_pdf_get_page_box`
- `wasm_pdf_set_page_box`
- `wasm_pdf_set_page_size`
- `wasm_pdf_get_permissions`
- `wasm_pdf_get_metadata`
- `wasm_pdf_set_metadata`
- `wasm_pdf_get_page_text`
- `wasm_pdf_insert_blank_page`
- `wasm_pdf_delete_page`
- `wasm_pdf_copy_page`
- `wasm_pdf_import_pages`
- `wasm_pdf_add_text_page`
- `wasm_pdf_add_rgba_image_page`
- `wasm_pdf_render_page_rgba`
- `wasm_pdf_render_page_area_rgba`
- `wasm_pdf_save_copy`

If you remove a function here, also remove it from:
- `scripts/build_wrapper_wasm.sh` -> `-sEXPORTED_FUNCTIONS`

## 2) Public PDFium API methods you can wrap

Look in PDFium public headers:
- `third_party/pdfium/pdfium/public/fpdfview.h`
- `third_party/pdfium/pdfium/public/fpdf_edit.h`
- `third_party/pdfium/pdfium/public/fpdf_save.h`
- `third_party/pdfium/pdfium/public/fpdf_text.h`
- `third_party/pdfium/pdfium/public/fpdf_ppo.h`
- `third_party/pdfium/pdfium/public/fpdf_transformpage.h`

Search examples:
```bash
rg -n "FPDFPageObj_|FPDFText_|FPDF_Save|FPDF_Load|FPDFPage_" third_party/pdfium/pdfium/public
```

## 3) How to add a new method

1. Identify target PDFium API in `public/*.h`.
2. Add a wrapper function in `wasm/pdfium_edit_wrapper.cc`.
3. Add function name to `-sEXPORTED_FUNCTIONS` in `scripts/build_wrapper_wasm.sh`.
4. Rebuild: `./scripts/build_wrapper_wasm.sh`.
5. Call from JS via `ccall`/`cwrap`.

## 4) How to remove a method safely

1. Remove JS usage first.
2. Remove wrapper function from `pdfium_edit_wrapper.cc`.
3. Remove symbol from `-sEXPORTED_FUNCTIONS`.
4. Rebuild and verify no unresolved symbol usage remains.

## 5) Where to inspect generated availability

Generated JS glue in:
- `dist/pdfium.js`

You can grep to confirm a symbol exists:
```bash
rg -n "wasm_pdf_add_text_page|wasm_pdf_add_rgba_image_page|wasm_pdf_render_page_rgba|wasm_pdf_render_page_area_rgba|wasm_pdf_save_copy" dist/pdfium.js
```
