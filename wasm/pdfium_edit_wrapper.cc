#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <limits>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "public/fpdf_edit.h"
#include "public/fpdf_save.h"
#include "public/fpdfview.h"

namespace {

enum WasmPdfError : int {
  WASM_PDF_ERROR_NONE = 0,
  WASM_PDF_ERROR_NOT_INITIALIZED = 1,
  WASM_PDF_ERROR_INVALID_ARGUMENT = 2,
  WASM_PDF_ERROR_OUT_OF_MEMORY = 3,
  WASM_PDF_ERROR_LOAD_DOCUMENT_FAILED = 4,
  WASM_PDF_ERROR_INVALID_HANDLE = 5,
  WASM_PDF_ERROR_LOAD_PAGE_FAILED = 6,
  WASM_PDF_ERROR_CREATE_TEXT_FAILED = 7,
  WASM_PDF_ERROR_SET_TEXT_FAILED = 8,
  WASM_PDF_ERROR_SET_COLOR_FAILED = 9,
  WASM_PDF_ERROR_INSERT_OBJECT_FAILED = 10,
  WASM_PDF_ERROR_GENERATE_CONTENT_FAILED = 11,
  WASM_PDF_ERROR_SAVE_FAILED = 12,
  WASM_PDF_ERROR_WRITE_FAILED = 13,
  WASM_PDF_ERROR_OUTPUT_TOO_LARGE = 14,
  WASM_PDF_ERROR_INVALID_UTF8 = 15,
  WASM_PDF_ERROR_PDFIUM_UNKNOWN = 20,
  WASM_PDF_ERROR_PDFIUM_FILE = 21,
  WASM_PDF_ERROR_PDFIUM_FORMAT = 22,
  WASM_PDF_ERROR_PDFIUM_PASSWORD = 23,
  WASM_PDF_ERROR_PDFIUM_SECURITY = 24,
  WASM_PDF_ERROR_PDFIUM_PAGE = 25,
};

int g_last_error = WASM_PDF_ERROR_NONE;

void SetLastError(WasmPdfError error) {
  g_last_error = error;
}

void ClearLastError() {
  SetLastError(WASM_PDF_ERROR_NONE);
}

WasmPdfError PdfiumLastErrorToWasmError(WasmPdfError fallback) {
  switch (FPDF_GetLastError()) {
    case FPDF_ERR_SUCCESS:
      return fallback;
    case FPDF_ERR_UNKNOWN:
      return WASM_PDF_ERROR_PDFIUM_UNKNOWN;
    case FPDF_ERR_FILE:
      return WASM_PDF_ERROR_PDFIUM_FILE;
    case FPDF_ERR_FORMAT:
      return WASM_PDF_ERROR_PDFIUM_FORMAT;
    case FPDF_ERR_PASSWORD:
      return WASM_PDF_ERROR_PDFIUM_PASSWORD;
    case FPDF_ERR_SECURITY:
      return WASM_PDF_ERROR_PDFIUM_SECURITY;
    case FPDF_ERR_PAGE:
      return WASM_PDF_ERROR_PDFIUM_PAGE;
    default:
      return fallback;
  }
}

bool IsUtf8ContinuationByte(unsigned char value) {
  return (value & 0xC0) == 0x80;
}

bool DecodeUtf8ToUtf16(const char* input, std::u16string* output) {
  if (!input || !output) return false;

  output->clear();
  const auto* bytes = reinterpret_cast<const unsigned char*>(input);

  while (*bytes) {
    uint32_t code_point = 0;
    uint32_t min_code_point = 0;
    int extra_bytes = 0;
    const unsigned char first = *bytes++;

    if (first < 0x80) {
      code_point = first;
    } else if (first >= 0xC2 && first <= 0xDF) {
      code_point = first & 0x1F;
      min_code_point = 0x80;
      extra_bytes = 1;
    } else if (first >= 0xE0 && first <= 0xEF) {
      code_point = first & 0x0F;
      min_code_point = 0x800;
      extra_bytes = 2;
    } else if (first >= 0xF0 && first <= 0xF4) {
      code_point = first & 0x07;
      min_code_point = 0x10000;
      extra_bytes = 3;
    } else {
      return false;
    }

    for (int i = 0; i < extra_bytes; ++i) {
      const unsigned char next = *bytes++;
      if (!IsUtf8ContinuationByte(next)) return false;
      code_point = (code_point << 6) | (next & 0x3F);
    }

    if (code_point < min_code_point || code_point > 0x10FFFF ||
        (code_point >= 0xD800 && code_point <= 0xDFFF)) {
      return false;
    }

    if (code_point <= 0xFFFF) {
      output->push_back(static_cast<char16_t>(code_point));
    } else {
      code_point -= 0x10000;
      output->push_back(static_cast<char16_t>(0xD800 + (code_point >> 10)));
      output->push_back(static_cast<char16_t>(0xDC00 + (code_point & 0x3FF)));
    }
  }

  return true;
}

struct MemWriter {
  FPDF_FILEWRITE filewrite;
  std::vector<uint8_t> data;
};

int MemWriteBlock(FPDF_FILEWRITE* pThis, const void* data, unsigned long size) {
  if (!pThis || (!data && size > 0)) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }
  if (size == 0) return 1;

  auto* writer = reinterpret_cast<MemWriter*>(pThis);
  const auto* bytes = reinterpret_cast<const uint8_t*>(data);
  writer->data.insert(writer->data.end(), bytes, bytes + size);
  return 1;
}

struct DocumentState {
  std::vector<uint8_t> source;
  FPDF_DOCUMENT doc = nullptr;
};

std::unordered_map<uintptr_t, std::unique_ptr<DocumentState>> g_docs;
bool g_pdfium_initialized = false;

FPDF_DOCUMENT GetDocument(uintptr_t handle) {
  auto it = g_docs.find(handle);
  if (it == g_docs.end() || !it->second->doc) return nullptr;
  return it->second->doc;
}

}  // namespace

extern "C" {

int wasm_pdf_last_error() {
  return g_last_error;
}

int wasm_pdfium_init() {
  if (g_pdfium_initialized) {
    ClearLastError();
    return 1;
  }

  FPDF_LIBRARY_CONFIG config;
  memset(&config, 0, sizeof(config));
  config.version = 2;
  config.m_pUserFontPaths = nullptr;
  config.m_pIsolate = nullptr;
  config.m_v8EmbedderSlot = 0;

  FPDF_InitLibraryWithConfig(&config);
  g_pdfium_initialized = true;
  ClearLastError();
  return 1;
}

void wasm_pdfium_destroy() {
  if (!g_pdfium_initialized) {
    ClearLastError();
    return;
  }

  for (auto& kv : g_docs) {
    if (kv.second && kv.second->doc) {
      FPDF_CloseDocument(kv.second->doc);
      kv.second->doc = nullptr;
    }
  }
  g_docs.clear();

  FPDF_DestroyLibrary();
  g_pdfium_initialized = false;
  ClearLastError();
}

uintptr_t wasm_pdf_open_from_bytes(const uint8_t* data,
                                   uint32_t size,
                                   const char* password) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!data || size == 0) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  auto state = std::make_unique<DocumentState>();
  state->source.assign(data, data + size);

  state->doc =
      FPDF_LoadMemDocument(state->source.data(), static_cast<int>(state->source.size()),
                           password && password[0] ? password : nullptr);
  if (!state->doc) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_DOCUMENT_FAILED));
    return 0;
  }

  uintptr_t handle = reinterpret_cast<uintptr_t>(state.get());
  g_docs.emplace(handle, std::move(state));
  ClearLastError();
  return handle;
}

void wasm_pdf_close(uintptr_t handle) {
  auto it = g_docs.find(handle);
  if (it == g_docs.end()) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return;
  }

  if (it->second->doc) {
    FPDF_CloseDocument(it->second->doc);
    it->second->doc = nullptr;
  }

  g_docs.erase(it);
  ClearLastError();
}

int wasm_pdf_page_count(uintptr_t handle) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return -1;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return -1;
  }

  const int page_count = FPDF_GetPageCount(doc);
  ClearLastError();
  return page_count;
}

int wasm_pdf_get_page_size(uintptr_t handle,
                           int page_index,
                           double* width,
                           double* height) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!width || !height) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  *width = 0;
  *height = 0;

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  if (!FPDF_GetPageSizeByIndex(doc, page_index, width, height)) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_get_page_rotation(uintptr_t handle, int page_index) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return -1;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return -1;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return -1;
  }

  const int rotation = FPDFPage_GetRotation(page);
  FPDF_ClosePage(page);

  if (rotation < 0) {
    SetLastError(WASM_PDF_ERROR_LOAD_PAGE_FAILED);
    return -1;
  }

  ClearLastError();
  return rotation;
}

uint32_t wasm_pdf_get_permissions(uintptr_t handle) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  const auto permissions = static_cast<uint32_t>(FPDF_GetDocPermissions(doc));
  ClearLastError();
  return permissions;
}

int wasm_pdf_add_text_page(uintptr_t handle,
                           int page_index,
                           const char* text_utf8,
                           double x,
                           double y,
                           double font_size,
                           uint32_t rgba) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!text_utf8) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  auto it = g_docs.find(handle);
  if (it == g_docs.end() || !it->second->doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  std::u16string utf16;
  if (!DecodeUtf8ToUtf16(text_utf8, &utf16)) {
    SetLastError(WASM_PDF_ERROR_INVALID_UTF8);
    return 0;
  }

  FPDF_DOCUMENT doc = it->second->doc;
  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  FPDF_PAGEOBJECT text_obj = FPDFPageObj_NewTextObj(doc, "Helvetica", static_cast<float>(font_size));
  if (!text_obj) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_TEXT_FAILED);
    return 0;
  }

  if (!FPDFText_SetText(text_obj, reinterpret_cast<const unsigned short*>(utf16.c_str()))) {
    FPDFPageObj_Destroy(text_obj);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_TEXT_FAILED);
    return 0;
  }

  const unsigned int a = (rgba >> 24) & 0xFF;
  const unsigned int r = (rgba >> 16) & 0xFF;
  const unsigned int g = (rgba >> 8) & 0xFF;
  const unsigned int b = rgba & 0xFF;

  if (!FPDFPageObj_SetFillColor(text_obj, r, g, b, a)) {
    FPDFPageObj_Destroy(text_obj);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_COLOR_FAILED);
    return 0;
  }

  FPDFPageObj_Transform(text_obj, 1, 0, 0, 1, static_cast<float>(x), static_cast<float>(y));

  if (!FPDFPage_InsertObject(page, text_obj)) {
    FPDFPageObj_Destroy(text_obj);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INSERT_OBJECT_FAILED);
    return 0;
  }

  if (!FPDFPage_GenerateContent(page)) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_GENERATE_CONTENT_FAILED);
    return 0;
  }

  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_save_copy(uintptr_t handle, uint8_t** out_ptr, uint32_t* out_size) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!out_ptr || !out_size) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  *out_ptr = nullptr;
  *out_size = 0;

  auto it = g_docs.find(handle);
  if (it == g_docs.end() || !it->second->doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  MemWriter writer{};
  writer.filewrite.version = 1;
  writer.filewrite.WriteBlock = MemWriteBlock;

  if (!FPDF_SaveAsCopy(it->second->doc, &writer.filewrite, FPDF_NO_INCREMENTAL)) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_SAVE_FAILED));
    return 0;
  }

  if (writer.data.size() > std::numeric_limits<uint32_t>::max()) {
    SetLastError(WASM_PDF_ERROR_OUTPUT_TOO_LARGE);
    return 0;
  }

  uint8_t* buffer = reinterpret_cast<uint8_t*>(malloc(writer.data.size()));
  if (!buffer) {
    SetLastError(WASM_PDF_ERROR_OUT_OF_MEMORY);
    return 0;
  }

  memcpy(buffer, writer.data.data(), writer.data.size());

  *out_ptr = buffer;
  *out_size = static_cast<uint32_t>(writer.data.size());
  ClearLastError();
  return 1;
}

void wasm_pdf_free_buffer(uint8_t* ptr) {
  if (!ptr) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return;
  }
  free(ptr);
  ClearLastError();
}

}  // extern "C"
