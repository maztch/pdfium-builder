#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <cmath>
#include <limits>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/fpdfapi/parser/cpdf_dictionary.h"
#include "core/fpdfapi/parser/cpdf_document.h"
#include "core/fpdfapi/parser/cpdf_reference.h"
#include "core/fpdfapi/parser/cpdf_string.h"
#include "core/fxcrt/fx_string.h"
#include "core/fxcrt/widestring.h"
#include "fpdfsdk/cpdfsdk_helpers.h"
#include "public/fpdf_doc.h"
#include "public/fpdf_edit.h"
#include "public/fpdf_ppo.h"
#include "public/fpdf_save.h"
#include "public/fpdf_text.h"
#include "public/fpdf_transformpage.h"
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
  WASM_PDF_ERROR_CREATE_PAGE_FAILED = 16,
  WASM_PDF_ERROR_DELETE_PAGE_FAILED = 17,
  WASM_PDF_ERROR_COPY_PAGE_FAILED = 18,
  WASM_PDF_ERROR_IMPORT_PAGES_FAILED = 19,
  WASM_PDF_ERROR_PDFIUM_UNKNOWN = 20,
  WASM_PDF_ERROR_PDFIUM_FILE = 21,
  WASM_PDF_ERROR_PDFIUM_FORMAT = 22,
  WASM_PDF_ERROR_PDFIUM_PASSWORD = 23,
  WASM_PDF_ERROR_PDFIUM_SECURITY = 24,
  WASM_PDF_ERROR_PDFIUM_PAGE = 25,
  WASM_PDF_ERROR_PAGE_GEOMETRY_FAILED = 26,
  WASM_PDF_ERROR_METADATA_READ_FAILED = 27,
  WASM_PDF_ERROR_METADATA_WRITE_FAILED = 28,
  WASM_PDF_ERROR_LOAD_TEXT_PAGE_FAILED = 29,
  WASM_PDF_ERROR_TEXT_EXTRACTION_FAILED = 30,
  WASM_PDF_ERROR_CREATE_IMAGE_FAILED = 31,
  WASM_PDF_ERROR_CREATE_BITMAP_FAILED = 32,
  WASM_PDF_ERROR_SET_IMAGE_BITMAP_FAILED = 33,
  WASM_PDF_ERROR_SET_IMAGE_MATRIX_FAILED = 34,
  WASM_PDF_ERROR_CREATE_RENDER_BITMAP_FAILED = 35,
  WASM_PDF_ERROR_FILL_RENDER_BITMAP_FAILED = 36,
  WASM_PDF_ERROR_PAGE_OBJECT_LOOKUP_FAILED = 37,
  WASM_PDF_ERROR_PAGE_OBJECT_BOUNDS_FAILED = 38,
  WASM_PDF_ERROR_PAGE_OBJECT_DELETE_FAILED = 39,
  WASM_PDF_ERROR_PAGE_OBJECT_TRANSFORM_FAILED = 40,
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

std::vector<uint8_t> Utf16StringToUtf16LeBytes(const std::u16string& input) {
  std::vector<uint8_t> bytes;
  bytes.reserve(input.size() * 2);
  for (char16_t value : input) {
    bytes.push_back(static_cast<uint8_t>(value & 0xFF));
    bytes.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
  }
  return bytes;
}

bool CopyBytesToMalloc(const uint8_t* data,
                       size_t size,
                       uint8_t** out_ptr,
                       uint32_t* out_size) {
  if (size > std::numeric_limits<uint32_t>::max()) {
    SetLastError(WASM_PDF_ERROR_OUTPUT_TOO_LARGE);
    return false;
  }

  uint8_t* buffer = nullptr;
  if (size > 0) {
    buffer = reinterpret_cast<uint8_t*>(malloc(size));
    if (!buffer) {
      SetLastError(WASM_PDF_ERROR_OUT_OF_MEMORY);
      return false;
    }
    memcpy(buffer, data, size);
  }

  *out_ptr = buffer;
  *out_size = static_cast<uint32_t>(size);
  return true;
}

bool CopyVectorToMalloc(const std::vector<uint8_t>& data,
                        uint8_t** out_ptr,
                        uint32_t* out_size) {
  return CopyBytesToMalloc(data.data(), data.size(), out_ptr, out_size);
}

bool IsAllowedMetadataKey(const char* key) {
  if (!key || !key[0]) return false;

  constexpr const char* kAllowedKeys[] = {
      "Title",        "Author", "Subject", "Keywords",
      "Creator",      "Producer", "CreationDate", "ModDate",
  };
  for (const char* allowed_key : kAllowedKeys) {
    if (strcmp(key, allowed_key) == 0) return true;
  }
  return false;
}

RetainPtr<CPDF_Dictionary> GetOrCreateInfoDictionary(FPDF_DOCUMENT document) {
  CPDF_Document* doc = CPDFDocumentFromFPDFDocument(document);
  if (!doc) return nullptr;

  RetainPtr<CPDF_Dictionary> info = doc->GetInfo();
  if (info) return info;

  CPDF_Parser* parser = doc->GetParser();
  if (!parser || !parser->GetTrailer()) return nullptr;

  auto new_info = doc->NewIndirect<CPDF_Dictionary>();
  auto* trailer = const_cast<CPDF_Dictionary*>(parser->GetTrailer());
  trailer->SetNewFor<CPDF_Reference>("Info", doc, new_info->GetObjNum());
  return doc->GetInfo();
}

enum WasmPdfPageBox : int {
  WASM_PDF_PAGE_BOX_MEDIA = 0,
  WASM_PDF_PAGE_BOX_CROP = 1,
  WASM_PDF_PAGE_BOX_BLEED = 2,
  WASM_PDF_PAGE_BOX_TRIM = 3,
  WASM_PDF_PAGE_BOX_ART = 4,
};

bool IsValidPageBox(int box_type) {
  return box_type >= WASM_PDF_PAGE_BOX_MEDIA && box_type <= WASM_PDF_PAGE_BOX_ART;
}

bool IsValidPageRect(double left, double bottom, double right, double top) {
  return std::isfinite(left) && std::isfinite(bottom) && std::isfinite(right) &&
         std::isfinite(top) && right > left && top > bottom;
}

bool GetPageBox(FPDF_PAGE page,
                int box_type,
                float* left,
                float* bottom,
                float* right,
                float* top) {
  switch (box_type) {
    case WASM_PDF_PAGE_BOX_MEDIA:
      return FPDFPage_GetMediaBox(page, left, bottom, right, top);
    case WASM_PDF_PAGE_BOX_CROP:
      return FPDFPage_GetCropBox(page, left, bottom, right, top);
    case WASM_PDF_PAGE_BOX_BLEED:
      return FPDFPage_GetBleedBox(page, left, bottom, right, top);
    case WASM_PDF_PAGE_BOX_TRIM:
      return FPDFPage_GetTrimBox(page, left, bottom, right, top);
    case WASM_PDF_PAGE_BOX_ART:
      return FPDFPage_GetArtBox(page, left, bottom, right, top);
    default:
      return false;
  }
}

void SetPageBox(FPDF_PAGE page,
                int box_type,
                float left,
                float bottom,
                float right,
                float top) {
  switch (box_type) {
    case WASM_PDF_PAGE_BOX_MEDIA:
      FPDFPage_SetMediaBox(page, left, bottom, right, top);
      return;
    case WASM_PDF_PAGE_BOX_CROP:
      FPDFPage_SetCropBox(page, left, bottom, right, top);
      return;
    case WASM_PDF_PAGE_BOX_BLEED:
      FPDFPage_SetBleedBox(page, left, bottom, right, top);
      return;
    case WASM_PDF_PAGE_BOX_TRIM:
      FPDFPage_SetTrimBox(page, left, bottom, right, top);
      return;
    case WASM_PDF_PAGE_BOX_ART:
      FPDFPage_SetArtBox(page, left, bottom, right, top);
      return;
    default:
      return;
  }
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

int wasm_pdf_set_page_rotation(uintptr_t handle, int page_index, int rotation) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (rotation < 0 || rotation > 3) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  FPDFPage_SetRotation(page, rotation);
  const int actual_rotation = FPDFPage_GetRotation(page);
  FPDF_ClosePage(page);

  if (actual_rotation != rotation) {
    SetLastError(WASM_PDF_ERROR_PAGE_GEOMETRY_FAILED);
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_get_page_box(uintptr_t handle,
                          int page_index,
                          int box_type,
                          double* left,
                          double* bottom,
                          double* right,
                          double* top) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!left || !bottom || !right || !top || !IsValidPageBox(box_type)) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  *left = 0;
  *bottom = 0;
  *right = 0;
  *top = 0;

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  float box_left = 0;
  float box_bottom = 0;
  float box_right = 0;
  float box_top = 0;
  const bool ok = GetPageBox(page, box_type, &box_left, &box_bottom, &box_right, &box_top);
  FPDF_ClosePage(page);

  if (!ok) {
    SetLastError(WASM_PDF_ERROR_PAGE_GEOMETRY_FAILED);
    return 0;
  }

  *left = box_left;
  *bottom = box_bottom;
  *right = box_right;
  *top = box_top;
  ClearLastError();
  return 1;
}

int wasm_pdf_set_page_box(uintptr_t handle,
                          int page_index,
                          int box_type,
                          double left,
                          double bottom,
                          double right,
                          double top) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!IsValidPageBox(box_type) || !IsValidPageRect(left, bottom, right, top)) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  SetPageBox(page,
             box_type,
             static_cast<float>(left),
             static_cast<float>(bottom),
             static_cast<float>(right),
             static_cast<float>(top));
  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_set_page_size(uintptr_t handle, int page_index, double width, double height) {
  if (!std::isfinite(width) || !std::isfinite(height) || width <= 0 || height <= 0) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }
  return wasm_pdf_set_page_box(handle, page_index, WASM_PDF_PAGE_BOX_MEDIA, 0, 0, width, height);
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

int wasm_pdf_get_metadata(uintptr_t handle,
                          const char* key,
                          uint8_t** out_ptr,
                          uint32_t* out_size) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!IsAllowedMetadataKey(key) || !out_ptr || !out_size) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  *out_ptr = nullptr;
  *out_size = 0;

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  const unsigned long required_size = FPDF_GetMetaText(doc, key, nullptr, 0);
  if (required_size == 0) {
    SetLastError(WASM_PDF_ERROR_METADATA_READ_FAILED);
    return 0;
  }

  std::vector<uint8_t> utf16le(required_size);
  const unsigned long written_size =
      FPDF_GetMetaText(doc, key, utf16le.data(), required_size);
  if (written_size != required_size) {
    SetLastError(WASM_PDF_ERROR_METADATA_READ_FAILED);
    return 0;
  }

  if (utf16le.size() >= 2 && utf16le[utf16le.size() - 1] == 0 &&
      utf16le[utf16le.size() - 2] == 0) {
    utf16le.resize(utf16le.size() - 2);
  }

  const WideString wide = WideString::FromUTF16LE(utf16le);
  const ByteString utf8 = FX_UTF8Encode(wide.AsStringView());
  const auto* utf8_data = reinterpret_cast<const uint8_t*>(utf8.c_str());
  if (!CopyBytesToMalloc(utf8_data, utf8.GetLength(), out_ptr, out_size)) {
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_set_metadata(uintptr_t handle, const char* key, const char* value_utf8) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!IsAllowedMetadataKey(key) || !value_utf8) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_DOCUMENT document = GetDocument(handle);
  if (!document) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  std::u16string utf16;
  if (!DecodeUtf8ToUtf16(value_utf8, &utf16)) {
    SetLastError(WASM_PDF_ERROR_INVALID_UTF8);
    return 0;
  }

  RetainPtr<CPDF_Dictionary> info = GetOrCreateInfoDictionary(document);
  if (!info) {
    SetLastError(WASM_PDF_ERROR_METADATA_WRITE_FAILED);
    return 0;
  }

  const std::vector<uint8_t> utf16le = Utf16StringToUtf16LeBytes(utf16);
  const WideString wide = WideString::FromUTF16LE(utf16le);
  info->SetNewFor<CPDF_String>(key, wide.AsStringView());
  ClearLastError();
  return 1;
}

int wasm_pdf_get_page_text(uintptr_t handle,
                           int page_index,
                           uint8_t** out_ptr,
                           uint32_t* out_size) {
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

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  FPDF_TEXTPAGE text_page = FPDFText_LoadPage(page);
  if (!text_page) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_LOAD_TEXT_PAGE_FAILED);
    return 0;
  }

  const int char_count = FPDFText_CountChars(text_page);
  if (char_count < 0) {
    FPDFText_ClosePage(text_page);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_TEXT_EXTRACTION_FAILED);
    return 0;
  }

  if (char_count == 0) {
    FPDFText_ClosePage(text_page);
    FPDF_ClosePage(page);
    if (!CopyBytesToMalloc(nullptr, 0, out_ptr, out_size)) {
      return 0;
    }
    ClearLastError();
    return 1;
  }

  std::vector<unsigned short> text_buffer(static_cast<size_t>(char_count) + 1);
  const int written_count = FPDFText_GetText(text_page, 0, char_count, text_buffer.data());
  FPDFText_ClosePage(text_page);
  FPDF_ClosePage(page);

  if (written_count <= 0) {
    SetLastError(WASM_PDF_ERROR_TEXT_EXTRACTION_FAILED);
    return 0;
  }

  const int code_unit_count = written_count - 1;
  std::vector<uint8_t> utf16le;
  utf16le.reserve(static_cast<size_t>(code_unit_count) * 2);
  for (int i = 0; i < code_unit_count; ++i) {
    const unsigned short value = text_buffer[static_cast<size_t>(i)];
    utf16le.push_back(static_cast<uint8_t>(value & 0xFF));
    utf16le.push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
  }

  const WideString wide = WideString::FromUTF16LE(utf16le);
  const ByteString utf8 = FX_UTF8Encode(wide.AsStringView());
  const auto* utf8_data = reinterpret_cast<const uint8_t*>(utf8.c_str());
  if (!CopyBytesToMalloc(utf8_data, utf8.GetLength(), out_ptr, out_size)) {
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_page_object_count(uintptr_t handle, int page_index) {
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

  const int object_count = FPDFPage_CountObjects(page);
  FPDF_ClosePage(page);

  if (object_count < 0) {
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_LOOKUP_FAILED);
    return -1;
  }

  ClearLastError();
  return object_count;
}

int wasm_pdf_get_page_object_info(uintptr_t handle,
                                  int page_index,
                                  int object_index,
                                  int* type,
                                  double* left,
                                  double* bottom,
                                  double* right,
                                  double* top) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!type || !left || !bottom || !right || !top || object_index < 0) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  *type = FPDF_PAGEOBJ_UNKNOWN;
  *left = 0;
  *bottom = 0;
  *right = 0;
  *top = 0;

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  const int object_count = FPDFPage_CountObjects(page);
  if (object_count < 0) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_LOOKUP_FAILED);
    return 0;
  }
  if (object_index >= object_count) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_PAGEOBJECT object = FPDFPage_GetObject(page, object_index);
  if (!object) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_LOOKUP_FAILED);
    return 0;
  }

  float object_left = 0;
  float object_bottom = 0;
  float object_right = 0;
  float object_top = 0;
  if (!FPDFPageObj_GetBounds(object,
                             &object_left,
                             &object_bottom,
                             &object_right,
                             &object_top)) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_BOUNDS_FAILED);
    return 0;
  }

  *type = FPDFPageObj_GetType(object);
  *left = object_left;
  *bottom = object_bottom;
  *right = object_right;
  *top = object_top;
  FPDF_ClosePage(page);

  ClearLastError();
  return 1;
}

int wasm_pdf_delete_page_object(uintptr_t handle, int page_index, int object_index) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (object_index < 0) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  const int object_count = FPDFPage_CountObjects(page);
  if (object_count < 0) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_LOOKUP_FAILED);
    return 0;
  }
  if (object_index >= object_count) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_PAGEOBJECT object = FPDFPage_GetObject(page, object_index);
  if (!object) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_LOOKUP_FAILED);
    return 0;
  }

  if (!FPDFPage_RemoveObject(page, object)) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_DELETE_FAILED);
    return 0;
  }
  FPDFPageObj_Destroy(object);

  if (!FPDFPage_GenerateContent(page)) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_GENERATE_CONTENT_FAILED);
    return 0;
  }

  const int updated_count = FPDFPage_CountObjects(page);
  FPDF_ClosePage(page);
  if (updated_count != object_count - 1) {
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_DELETE_FAILED);
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_transform_page_object(uintptr_t handle,
                                   int page_index,
                                   int object_index,
                                   double a,
                                   double b,
                                   double c,
                                   double d,
                                   double e,
                                   double f) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (object_index < 0 || !std::isfinite(a) || !std::isfinite(b) ||
      !std::isfinite(c) || !std::isfinite(d) || !std::isfinite(e) ||
      !std::isfinite(f) || (a * d - b * c) == 0) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  const int object_count = FPDFPage_CountObjects(page);
  if (object_count < 0) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_LOOKUP_FAILED);
    return 0;
  }
  if (object_index >= object_count) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_PAGEOBJECT object = FPDFPage_GetObject(page, object_index);
  if (!object) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_LOOKUP_FAILED);
    return 0;
  }

  const FS_MATRIX matrix{
      static_cast<float>(a),
      static_cast<float>(b),
      static_cast<float>(c),
      static_cast<float>(d),
      static_cast<float>(e),
      static_cast<float>(f),
  };
  if (!FPDFPageObj_TransformF(object, &matrix)) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_PAGE_OBJECT_TRANSFORM_FAILED);
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

int wasm_pdf_insert_blank_page(uintptr_t handle,
                               int page_index,
                               double width,
                               double height) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (page_index < 0 || width <= 0 || height <= 0) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDFPage_New(doc, page_index, width, height);
  if (!page) {
    SetLastError(WASM_PDF_ERROR_CREATE_PAGE_FAILED);
    return 0;
  }

  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_delete_page(uintptr_t handle, int page_index) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  const int page_count_before = FPDF_GetPageCount(doc);
  if (page_index < 0 || page_index >= page_count_before) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDFPage_Delete(doc, page_index);

  if (FPDF_GetPageCount(doc) != page_count_before - 1) {
    SetLastError(WASM_PDF_ERROR_DELETE_PAGE_FAILED);
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_copy_page(uintptr_t src_handle,
                       int src_page_index,
                       uintptr_t dst_handle,
                       int dst_page_index) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }

  FPDF_DOCUMENT src_doc = GetDocument(src_handle);
  FPDF_DOCUMENT dst_doc = GetDocument(dst_handle);
  if (!src_doc || !dst_doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  const int src_page_count = FPDF_GetPageCount(src_doc);
  const int dst_page_count = FPDF_GetPageCount(dst_doc);
  if (src_page_index < 0 || src_page_index >= src_page_count ||
      dst_page_index < 0 || dst_page_index > dst_page_count) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  const int page_indices[] = {src_page_index};
  if (!FPDF_ImportPagesByIndex(dst_doc, src_doc, page_indices, 1, dst_page_index)) {
    SetLastError(WASM_PDF_ERROR_COPY_PAGE_FAILED);
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_import_pages(uintptr_t src_handle,
                          const char* page_range,
                          uintptr_t dst_handle,
                          int dst_page_index) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }

  FPDF_DOCUMENT src_doc = GetDocument(src_handle);
  FPDF_DOCUMENT dst_doc = GetDocument(dst_handle);
  if (!src_doc || !dst_doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  const int dst_page_count = FPDF_GetPageCount(dst_doc);
  if (dst_page_index < 0 || dst_page_index > dst_page_count) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  const char* pdfium_page_range = page_range && page_range[0] ? page_range : nullptr;
  if (!FPDF_ImportPages(dst_doc, src_doc, pdfium_page_range, dst_page_index)) {
    SetLastError(WASM_PDF_ERROR_IMPORT_PAGES_FAILED);
    return 0;
  }

  ClearLastError();
  return 1;
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

int wasm_pdf_add_rgba_image_page(uintptr_t handle,
                                 int page_index,
                                 const uint8_t* rgba,
                                 uint32_t rgba_size,
                                 int image_width,
                                 int image_height,
                                 double x,
                                 double y,
                                 double display_width,
                                 double display_height) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!rgba || image_width <= 0 || image_height <= 0 ||
      !std::isfinite(x) || !std::isfinite(y) ||
      !std::isfinite(display_width) || !std::isfinite(display_height) ||
      display_width <= 0 || display_height <= 0) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  const uint64_t row_size = static_cast<uint64_t>(image_width) * 4;
  const uint64_t expected_size = row_size * static_cast<uint64_t>(image_height);
  if (row_size > static_cast<uint64_t>(std::numeric_limits<int>::max()) ||
      expected_size > std::numeric_limits<uint32_t>::max() ||
      rgba_size != static_cast<uint32_t>(expected_size)) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  FPDF_PAGEOBJECT image_obj = FPDFPageObj_NewImageObj(doc);
  if (!image_obj) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_IMAGE_FAILED);
    return 0;
  }

  FPDF_BITMAP bitmap = FPDFBitmap_CreateEx(image_width, image_height, FPDFBitmap_BGRA, nullptr, 0);
  if (!bitmap) {
    FPDFPageObj_Destroy(image_obj);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_BITMAP_FAILED);
    return 0;
  }

  auto* bgra = reinterpret_cast<uint8_t*>(FPDFBitmap_GetBuffer(bitmap));
  const int stride = FPDFBitmap_GetStride(bitmap);
  if (!bgra || stride < static_cast<int>(row_size)) {
    FPDFBitmap_Destroy(bitmap);
    FPDFPageObj_Destroy(image_obj);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_BITMAP_FAILED);
    return 0;
  }

  for (int row = 0; row < image_height; ++row) {
    const uint8_t* src = rgba + static_cast<size_t>(row) * static_cast<size_t>(row_size);
    uint8_t* dst = bgra + static_cast<size_t>(row) * stride;
    for (int col = 0; col < image_width; ++col) {
      dst[col * 4 + 0] = src[col * 4 + 2];
      dst[col * 4 + 1] = src[col * 4 + 1];
      dst[col * 4 + 2] = src[col * 4 + 0];
      dst[col * 4 + 3] = src[col * 4 + 3];
    }
  }

  FPDF_PAGE pages[] = {page};
  if (!FPDFImageObj_SetBitmap(pages, 1, image_obj, bitmap)) {
    FPDFBitmap_Destroy(bitmap);
    FPDFPageObj_Destroy(image_obj);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_IMAGE_BITMAP_FAILED);
    return 0;
  }
  FPDFBitmap_Destroy(bitmap);

  if (!FPDFImageObj_SetMatrix(image_obj,
                              display_width,
                              0,
                              0,
                              display_height,
                              x,
                              y)) {
    FPDFPageObj_Destroy(image_obj);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_IMAGE_MATRIX_FAILED);
    return 0;
  }

  if (!FPDFPage_InsertObject(page, image_obj)) {
    FPDFPageObj_Destroy(image_obj);
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

int wasm_pdf_render_page_rgba(uintptr_t handle,
                              int page_index,
                              int width,
                              int height,
                              int flags,
                              uint8_t** out_ptr,
                              uint32_t* out_size) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (width <= 0 || height <= 0 || flags < 0 || !out_ptr || !out_size) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  *out_ptr = nullptr;
  *out_size = 0;

  const uint64_t row_size = static_cast<uint64_t>(width) * 4;
  const uint64_t output_size = row_size * static_cast<uint64_t>(height);
  if (row_size > static_cast<uint64_t>(std::numeric_limits<int>::max()) ||
      output_size > std::numeric_limits<uint32_t>::max()) {
    SetLastError(WASM_PDF_ERROR_OUTPUT_TOO_LARGE);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  FPDF_BITMAP bitmap = FPDFBitmap_CreateEx(width, height, FPDFBitmap_BGRA, nullptr, 0);
  if (!bitmap) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_RENDER_BITMAP_FAILED);
    return 0;
  }

  if (!FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xFFFFFFFF)) {
    FPDFBitmap_Destroy(bitmap);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_FILL_RENDER_BITMAP_FAILED);
    return 0;
  }

  const int render_flags = flags & ~FPDF_REVERSE_BYTE_ORDER;
  FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, render_flags);
  FPDF_ClosePage(page);

  const auto* bgra = reinterpret_cast<const uint8_t*>(FPDFBitmap_GetBuffer(bitmap));
  const int stride = FPDFBitmap_GetStride(bitmap);
  if (!bgra || stride < static_cast<int>(row_size)) {
    FPDFBitmap_Destroy(bitmap);
    SetLastError(WASM_PDF_ERROR_CREATE_RENDER_BITMAP_FAILED);
    return 0;
  }

  std::vector<uint8_t> rgba(static_cast<size_t>(output_size));
  for (int row = 0; row < height; ++row) {
    const uint8_t* src = bgra + static_cast<size_t>(row) * stride;
    uint8_t* dst = rgba.data() + static_cast<size_t>(row) * static_cast<size_t>(row_size);
    for (int col = 0; col < width; ++col) {
      dst[col * 4 + 0] = src[col * 4 + 2];
      dst[col * 4 + 1] = src[col * 4 + 1];
      dst[col * 4 + 2] = src[col * 4 + 0];
      dst[col * 4 + 3] = src[col * 4 + 3];
    }
  }

  FPDFBitmap_Destroy(bitmap);

  if (!CopyVectorToMalloc(rgba, out_ptr, out_size)) {
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_render_page_area_rgba(uintptr_t handle,
                                   int page_index,
                                   double left,
                                   double bottom,
                                   double right,
                                   double top,
                                   int width,
                                   int height,
                                   int flags,
                                   uint8_t** out_ptr,
                                   uint32_t* out_size) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!IsValidPageRect(left, bottom, right, top) || width <= 0 || height <= 0 ||
      flags < 0 || !out_ptr || !out_size) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  *out_ptr = nullptr;
  *out_size = 0;

  const uint64_t row_size = static_cast<uint64_t>(width) * 4;
  const uint64_t output_size = row_size * static_cast<uint64_t>(height);
  if (row_size > static_cast<uint64_t>(std::numeric_limits<int>::max()) ||
      output_size > std::numeric_limits<uint32_t>::max()) {
    SetLastError(WASM_PDF_ERROR_OUTPUT_TOO_LARGE);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  FPDF_BITMAP bitmap = FPDFBitmap_CreateEx(width, height, FPDFBitmap_BGRA, nullptr, 0);
  if (!bitmap) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_RENDER_BITMAP_FAILED);
    return 0;
  }

  if (!FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xFFFFFFFF)) {
    FPDFBitmap_Destroy(bitmap);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_FILL_RENDER_BITMAP_FAILED);
    return 0;
  }

  const float scale_x = static_cast<float>(width / (right - left));
  const float scale_y = static_cast<float>(height / (top - bottom));
  const FS_MATRIX matrix{
      scale_x,
      0,
      0,
      -scale_y,
      static_cast<float>(-left * scale_x),
      static_cast<float>(top * scale_y),
  };
  const FS_RECTF clipping{
      0,
      0,
      static_cast<float>(width),
      static_cast<float>(height),
  };
  const int render_flags = flags & ~FPDF_REVERSE_BYTE_ORDER;
  FPDF_RenderPageBitmapWithMatrix(bitmap, page, &matrix, &clipping, render_flags);
  FPDF_ClosePage(page);

  const auto* bgra = reinterpret_cast<const uint8_t*>(FPDFBitmap_GetBuffer(bitmap));
  const int stride = FPDFBitmap_GetStride(bitmap);
  if (!bgra || stride < static_cast<int>(row_size)) {
    FPDFBitmap_Destroy(bitmap);
    SetLastError(WASM_PDF_ERROR_CREATE_RENDER_BITMAP_FAILED);
    return 0;
  }

  std::vector<uint8_t> rgba(static_cast<size_t>(output_size));
  for (int row = 0; row < height; ++row) {
    const uint8_t* src = bgra + static_cast<size_t>(row) * stride;
    uint8_t* dst = rgba.data() + static_cast<size_t>(row) * static_cast<size_t>(row_size);
    for (int col = 0; col < width; ++col) {
      dst[col * 4 + 0] = src[col * 4 + 2];
      dst[col * 4 + 1] = src[col * 4 + 1];
      dst[col * 4 + 2] = src[col * 4 + 0];
      dst[col * 4 + 3] = src[col * 4 + 3];
    }
  }

  FPDFBitmap_Destroy(bitmap);

  if (!CopyVectorToMalloc(rgba, out_ptr, out_size)) {
    return 0;
  }

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

  if (!CopyVectorToMalloc(writer.data, out_ptr, out_size)) {
    return 0;
  }

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
