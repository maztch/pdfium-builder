#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PDFIUM_DIR="${ROOT_DIR}/third_party/pdfium/pdfium"
DIST_DIR="${ROOT_DIR}/dist"
export EM_CACHE="${ROOT_DIR}/.emcache"
mkdir -p "${EM_CACHE}"

LIBPDFIUM_A="${PDFIUM_DIR}/out/wasm/obj/libpdfium.a"
LIBZ_A="${PDFIUM_DIR}/out/wasm/obj/third_party/zlib/libchrome_zlib.a"
WRAPPER_SRC="${ROOT_DIR}/wasm/pdfium_edit_wrapper.cc"
PLATFORM_STUB_SRC="${ROOT_DIR}/wasm/pdfium_wasm_platform_stub.cc"

if [[ ! -f "${LIBPDFIUM_A}" ]]; then
  echo "Missing ${LIBPDFIUM_A}. Run scripts/build_pdfium_wasm.sh first."
  exit 1
fi

if [[ ! -f "${LIBZ_A}" ]]; then
  echo "Missing ${LIBZ_A}. Run scripts/build_pdfium_wasm.sh first."
  exit 1
fi

mkdir -p "${DIST_DIR}"

em++ \
  -O3 \
  -std=c++20 \
  -I"${PDFIUM_DIR}" \
  -I"${PDFIUM_DIR}/public" \
  -I"${PDFIUM_DIR}/third_party/freetype/include" \
  -I"${PDFIUM_DIR}/third_party/freetype/src/include" \
  -I"${PDFIUM_DIR}/third_party/zlib" \
  "${WRAPPER_SRC}" \
  "${PLATFORM_STUB_SRC}" \
  "${LIBPDFIUM_A}" \
  "${LIBZ_A}" \
  -sWASM=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=web,worker,node \
  -sEXPORT_NAME=PdfiumWasm \
  -sEXPORTED_FUNCTIONS='["_malloc","_free","_wasm_pdf_last_error","_wasm_pdfium_init","_wasm_pdfium_destroy","_wasm_pdf_open_from_bytes","_wasm_pdf_close","_wasm_pdf_page_count","_wasm_pdf_get_page_size","_wasm_pdf_get_page_rotation","_wasm_pdf_set_page_rotation","_wasm_pdf_get_page_box","_wasm_pdf_set_page_box","_wasm_pdf_set_page_size","_wasm_pdf_get_permissions","_wasm_pdf_get_metadata","_wasm_pdf_set_metadata","_wasm_pdf_get_outline","_wasm_pdf_attachment_count","_wasm_pdf_add_attachment","_wasm_pdf_set_attachment_file","_wasm_pdf_delete_attachment","_wasm_pdf_get_attachment_info","_wasm_pdf_get_attachment_file","_wasm_pdf_get_form_fields","_wasm_pdf_set_form_field_value","_wasm_pdf_set_form_field_checked","_wasm_pdf_get_page_text","_wasm_pdf_search_page_text","_wasm_pdf_annotation_count","_wasm_pdf_get_annotation_info","_wasm_pdf_delete_annotation","_wasm_pdf_add_highlight_annotation","_wasm_pdf_add_link_annotation","_wasm_pdf_add_text_note_annotation","_wasm_pdf_add_rectangle_annotation","_wasm_pdf_add_freetext_annotation","_wasm_pdf_set_annotation_rect","_wasm_pdf_set_annotation_color","_wasm_pdf_set_annotation_text","_wasm_pdf_set_annotation_uri","_wasm_pdf_page_object_count","_wasm_pdf_get_page_object_info","_wasm_pdf_delete_page_object","_wasm_pdf_transform_page_object","_wasm_pdf_insert_blank_page","_wasm_pdf_delete_page","_wasm_pdf_copy_page","_wasm_pdf_import_pages","_wasm_pdf_add_text_page","_wasm_pdf_add_rgba_image_page","_wasm_pdf_add_jpeg_image_page","_wasm_pdf_add_png_image_page","_wasm_pdf_render_page_rgba","_wasm_pdf_render_page_area_rgba","_wasm_pdf_save_copy","_wasm_pdf_free_buffer"]' \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","getValue","HEAPU8"]' \
  -o "${DIST_DIR}/pdfium.js"

echo "Generated ${DIST_DIR}/pdfium.js and ${DIST_DIR}/pdfium.wasm"
