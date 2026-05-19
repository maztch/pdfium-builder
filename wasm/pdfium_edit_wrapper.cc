#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "public/fpdf_edit.h"
#include "public/fpdf_save.h"
#include "public/fpdfview.h"

namespace {

struct MemWriter {
  FPDF_FILEWRITE filewrite;
  std::vector<uint8_t> data;
};

int MemWriteBlock(FPDF_FILEWRITE* pThis, const void* data, unsigned long size) {
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

}  // namespace

extern "C" {

int wasm_pdfium_init() {
  if (g_pdfium_initialized) return 1;

  FPDF_LIBRARY_CONFIG config;
  memset(&config, 0, sizeof(config));
  config.version = 2;
  config.m_pUserFontPaths = nullptr;
  config.m_pIsolate = nullptr;
  config.m_v8EmbedderSlot = 0;

  FPDF_InitLibraryWithConfig(&config);
  g_pdfium_initialized = true;
  return 1;
}

void wasm_pdfium_destroy() {
  if (!g_pdfium_initialized) return;

  for (auto& kv : g_docs) {
    if (kv.second && kv.second->doc) {
      FPDF_CloseDocument(kv.second->doc);
      kv.second->doc = nullptr;
    }
  }
  g_docs.clear();

  FPDF_DestroyLibrary();
  g_pdfium_initialized = false;
}

uintptr_t wasm_pdf_open_from_bytes(const uint8_t* data,
                                   uint32_t size,
                                   const char* password) {
  if (!g_pdfium_initialized || !data || size == 0) return 0;

  auto state = std::make_unique<DocumentState>();
  state->source.assign(data, data + size);

  state->doc =
      FPDF_LoadMemDocument(state->source.data(), static_cast<int>(state->source.size()),
                           password && password[0] ? password : nullptr);
  if (!state->doc) return 0;

  uintptr_t handle = reinterpret_cast<uintptr_t>(state.get());
  g_docs.emplace(handle, std::move(state));
  return handle;
}

void wasm_pdf_close(uintptr_t handle) {
  auto it = g_docs.find(handle);
  if (it == g_docs.end()) return;

  if (it->second->doc) {
    FPDF_CloseDocument(it->second->doc);
    it->second->doc = nullptr;
  }

  g_docs.erase(it);
}

int wasm_pdf_add_text_page(uintptr_t handle,
                           int page_index,
                           const char* text_utf8,
                           double x,
                           double y,
                           double font_size,
                           uint32_t rgba) {
  if (!text_utf8) return 0;

  auto it = g_docs.find(handle);
  if (it == g_docs.end() || !it->second->doc) return 0;

  FPDF_DOCUMENT doc = it->second->doc;
  FPDF_PAGE page = FPDF_LoadPage(doc, page_index);
  if (!page) return 0;

  FPDF_PAGEOBJECT text_obj = FPDFPageObj_NewTextObj(doc, "Helvetica", static_cast<float>(font_size));
  if (!text_obj) {
    FPDF_ClosePage(page);
    return 0;
  }

  std::u16string utf16;
  while (*text_utf8) {
    unsigned char c = static_cast<unsigned char>(*text_utf8++);
    if (c < 0x80) {
      utf16.push_back(static_cast<char16_t>(c));
    } else {
      // Fallback for non-ASCII text in this minimal example.
      utf16.push_back(u'?');
      while ((*text_utf8 & 0xC0) == 0x80) text_utf8++;
    }
  }

  if (!FPDFText_SetText(text_obj, reinterpret_cast<const unsigned short*>(utf16.c_str()))) {
    FPDFPageObj_Destroy(text_obj);
    FPDF_ClosePage(page);
    return 0;
  }

  const unsigned int a = (rgba >> 24) & 0xFF;
  const unsigned int r = (rgba >> 16) & 0xFF;
  const unsigned int g = (rgba >> 8) & 0xFF;
  const unsigned int b = rgba & 0xFF;

  if (!FPDFPageObj_SetFillColor(text_obj, r, g, b, a)) {
    FPDFPageObj_Destroy(text_obj);
    FPDF_ClosePage(page);
    return 0;
  }

  FPDFPageObj_Transform(text_obj, 1, 0, 0, 1, static_cast<float>(x), static_cast<float>(y));

  if (!FPDFPage_InsertObject(page, text_obj)) {
    FPDFPageObj_Destroy(text_obj);
    FPDF_ClosePage(page);
    return 0;
  }

  FPDFPage_GenerateContent(page);
  FPDF_ClosePage(page);
  return 1;
}

int wasm_pdf_save_copy(uintptr_t handle, uint8_t** out_ptr, uint32_t* out_size) {
  if (!out_ptr || !out_size) return 0;

  auto it = g_docs.find(handle);
  if (it == g_docs.end() || !it->second->doc) return 0;

  MemWriter writer{};
  writer.filewrite.version = 1;
  writer.filewrite.WriteBlock = MemWriteBlock;

  if (!FPDF_SaveAsCopy(it->second->doc, &writer.filewrite, FPDF_NO_INCREMENTAL)) {
    return 0;
  }

  uint8_t* buffer = reinterpret_cast<uint8_t*>(malloc(writer.data.size()));
  if (!buffer) return 0;

  memcpy(buffer, writer.data.data(), writer.data.size());

  *out_ptr = buffer;
  *out_size = static_cast<uint32_t>(writer.data.size());
  return 1;
}

void wasm_pdf_free_buffer(uint8_t* ptr) {
  if (!ptr) return;
  free(ptr);
}

}  // extern "C"
