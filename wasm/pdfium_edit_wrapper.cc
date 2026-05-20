#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <cmath>
#include <limits>
#include <memory>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "core/fpdfapi/page/cpdf_annotcontext.h"
#include "core/fpdfapi/parser/cpdf_dictionary.h"
#include "core/fpdfapi/parser/cpdf_document.h"
#include "core/fpdfapi/parser/cpdf_name.h"
#include "core/fpdfapi/parser/cpdf_reference.h"
#include "core/fpdfapi/parser/cpdf_stream.h"
#include "core/fpdfapi/parser/cpdf_string.h"
#include "core/fpdfdoc/cpdf_annot.h"
#include "core/fpdfdoc/cpdf_defaultappearance.h"
#include "core/fpdfdoc/cpdf_filespec.h"
#include "core/fpdfdoc/cpdf_generateap.h"
#include "core/fpdfdoc/cpdf_interactiveform.h"
#include "core/fxcrt/fx_string.h"
#include "core/fxcrt/widestring.h"
#include "fpdfsdk/cpdfsdk_helpers.h"
#include "public/fpdf_annot.h"
#include "public/fpdf_attachment.h"
#include "public/fpdf_doc.h"
#include "public/fpdf_edit.h"
#include "public/fpdf_ppo.h"
#include "public/fpdf_save.h"
#include "public/fpdf_text.h"
#include "public/fpdf_transformpage.h"
#include "public/fpdfview.h"
#include "third_party/zlib/zlib.h"

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
  WASM_PDF_ERROR_TEXT_SEARCH_FAILED = 41,
  WASM_PDF_ERROR_CREATE_ANNOTATION_FAILED = 42,
  WASM_PDF_ERROR_SET_ANNOTATION_RECT_FAILED = 43,
  WASM_PDF_ERROR_SET_ANNOTATION_COLOR_FAILED = 44,
  WASM_PDF_ERROR_SET_ANNOTATION_ATTACHMENT_FAILED = 45,
  WASM_PDF_ERROR_SET_ANNOTATION_URI_FAILED = 46,
  WASM_PDF_ERROR_SET_ANNOTATION_TEXT_FAILED = 47,
  WASM_PDF_ERROR_SET_ANNOTATION_BORDER_FAILED = 48,
  WASM_PDF_ERROR_GENERATE_ANNOTATION_AP_FAILED = 49,
  WASM_PDF_ERROR_LOAD_JPEG_FAILED = 50,
  WASM_PDF_ERROR_DECODE_PNG_FAILED = 51,
  WASM_PDF_ERROR_OUTLINE_READ_FAILED = 52,
  WASM_PDF_ERROR_ADD_ATTACHMENT_FAILED = 53,
  WASM_PDF_ERROR_ATTACHMENT_READ_FAILED = 54,
  WASM_PDF_ERROR_ATTACHMENT_WRITE_FAILED = 55,
  WASM_PDF_ERROR_ANNOTATION_READ_FAILED = 56,
  WASM_PDF_ERROR_ANNOTATION_DELETE_FAILED = 57,
};

int g_last_error = WASM_PDF_ERROR_NONE;

struct MemoryFileAccess {
  const uint8_t* data = nullptr;
  uint32_t size = 0;
};

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

int GetMemoryFileBlock(void* param,
                       unsigned long position,
                       unsigned char* buffer,
                       unsigned long size) {
  const auto* file = static_cast<const MemoryFileAccess*>(param);
  if (!file || !file->data || !buffer || position > file->size ||
      size > file->size - position) {
    return 0;
  }

  memcpy(buffer, file->data + position, size);
  return 1;
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

void AppendInt32(std::vector<uint8_t>* data, int32_t value) {
  const auto unsigned_value = static_cast<uint32_t>(value);
  data->push_back(static_cast<uint8_t>(unsigned_value & 0xFF));
  data->push_back(static_cast<uint8_t>((unsigned_value >> 8) & 0xFF));
  data->push_back(static_cast<uint8_t>((unsigned_value >> 16) & 0xFF));
  data->push_back(static_cast<uint8_t>((unsigned_value >> 24) & 0xFF));
}

void AppendUint32(std::vector<uint8_t>* data, uint32_t value) {
  data->push_back(static_cast<uint8_t>(value & 0xFF));
  data->push_back(static_cast<uint8_t>((value >> 8) & 0xFF));
  data->push_back(static_cast<uint8_t>((value >> 16) & 0xFF));
  data->push_back(static_cast<uint8_t>((value >> 24) & 0xFF));
}

void AppendDouble(std::vector<uint8_t>* data, double value) {
  static_assert(sizeof(double) == 8, "Unexpected double size");
  uint8_t bytes[sizeof(double)];
  memcpy(bytes, &value, sizeof(double));
  data->insert(data->end(), bytes, bytes + sizeof(double));
}

void AppendBytes(std::vector<uint8_t>* data, const uint8_t* bytes, uint32_t size) {
  AppendUint32(data, size);
  if (bytes && size > 0) {
    data->insert(data->end(), bytes, bytes + size);
  }
}

bool GetBookmarkTitleUtf8(FPDF_BOOKMARK bookmark, std::vector<uint8_t>* title) {
  if (!bookmark || !title) return false;

  const unsigned long required_size = FPDFBookmark_GetTitle(bookmark, nullptr, 0);
  if (required_size == 0) return false;

  std::vector<uint8_t> utf16le(required_size);
  const unsigned long written_size =
      FPDFBookmark_GetTitle(bookmark, utf16le.data(), required_size);
  if (written_size != required_size) return false;

  if (utf16le.size() >= 2 && utf16le[utf16le.size() - 1] == 0 &&
      utf16le[utf16le.size() - 2] == 0) {
    utf16le.resize(utf16le.size() - 2);
  }

  const WideString wide = WideString::FromUTF16LE(utf16le);
  const ByteString utf8 = FX_UTF8Encode(wide.AsStringView());
  const auto* utf8_data = reinterpret_cast<const uint8_t*>(utf8.c_str());
  title->assign(utf8_data, utf8_data + utf8.GetLength());
  return true;
}

bool Utf16LeToUtf8Bytes(std::vector<uint8_t> utf16le, std::vector<uint8_t>* utf8_output) {
  if (!utf8_output) return false;

  if (utf16le.size() >= 2 && utf16le[utf16le.size() - 1] == 0 &&
      utf16le[utf16le.size() - 2] == 0) {
    utf16le.resize(utf16le.size() - 2);
  }

  const WideString wide = WideString::FromUTF16LE(utf16le);
  const ByteString utf8 = FX_UTF8Encode(wide.AsStringView());
  const auto* utf8_data = reinterpret_cast<const uint8_t*>(utf8.c_str());
  utf8_output->assign(utf8_data, utf8_data + utf8.GetLength());
  return true;
}

bool GetAttachmentNameUtf8(FPDF_ATTACHMENT attachment, std::vector<uint8_t>* name) {
  if (!attachment || !name) return false;

  const unsigned long required_size = FPDFAttachment_GetName(attachment, nullptr, 0);
  if (required_size == 0) return false;

  std::vector<uint8_t> utf16le(required_size);
  const unsigned long written_size =
      FPDFAttachment_GetName(
          attachment,
          reinterpret_cast<FPDF_WCHAR*>(utf16le.data()),
          required_size);
  if (written_size != required_size) return false;

  return Utf16LeToUtf8Bytes(std::move(utf16le), name);
}

bool GetAttachmentSubtypeUtf8(FPDF_ATTACHMENT attachment, std::vector<uint8_t>* subtype) {
  if (!attachment || !subtype) return false;

  const unsigned long required_size = FPDFAttachment_GetSubtype(attachment, nullptr, 0);
  if (required_size == 0) return false;

  std::vector<uint8_t> utf16le(required_size);
  const unsigned long written_size =
      FPDFAttachment_GetSubtype(
          attachment,
          reinterpret_cast<FPDF_WCHAR*>(utf16le.data()),
          required_size);
  if (written_size != required_size) return false;

  return Utf16LeToUtf8Bytes(std::move(utf16le), subtype);
}

bool GetAttachmentFileSize(FPDF_ATTACHMENT attachment, int32_t* file_size) {
  if (!attachment || !file_size) return false;

  unsigned long required_size = 0;
  if (!FPDFAttachment_GetFile(attachment, nullptr, 0, &required_size)) {
    *file_size = -1;
    return true;
  }
  if (required_size > static_cast<unsigned long>(std::numeric_limits<int32_t>::max())) {
    return false;
  }

  *file_size = static_cast<int32_t>(required_size);
  return true;
}

bool IsNonEmptyAsciiCString(const char* value) {
  if (!value || !value[0]) return false;
  for (const auto* cursor = reinterpret_cast<const unsigned char*>(value); *cursor; ++cursor) {
    if (*cursor > 0x7F) return false;
  }
  return true;
}

bool SetAttachmentSubtype(FPDF_ATTACHMENT attachment, const char* mime_type) {
  if (!mime_type || !mime_type[0]) return true;
  if (!IsNonEmptyAsciiCString(mime_type)) return false;

  CPDF_Object* file = CPDFObjectFromFPDFAttachment(attachment);
  if (!file || !file->IsDictionary()) return false;

  RetainPtr<CPDF_Dictionary> ef_dict =
      file->AsMutableDictionary()->GetMutableDictFor("EF");
  if (!ef_dict) return false;

  RetainPtr<CPDF_Stream> file_stream = ef_dict->GetMutableStreamFor("F");
  if (!file_stream) return false;

  RetainPtr<CPDF_Dictionary> stream_dict = file_stream->GetMutableDict();
  if (!stream_dict) return false;

  stream_dict->SetNewFor<CPDF_Name>("Subtype", mime_type);
  return true;
}

bool GetActionStringBytes(FPDF_DOCUMENT document,
                          FPDF_ACTION action,
                          bool uri,
                          std::vector<uint8_t>* output) {
  if (!action || !output) return false;

  const unsigned long required_size = uri
                                          ? FPDFAction_GetURIPath(document, action, nullptr, 0)
                                          : FPDFAction_GetFilePath(action, nullptr, 0);
  if (required_size == 0) {
    output->clear();
    return true;
  }

  std::vector<uint8_t> buffer(required_size);
  const unsigned long written_size = uri
                                         ? FPDFAction_GetURIPath(document, action, buffer.data(), required_size)
                                         : FPDFAction_GetFilePath(action, buffer.data(), required_size);
  if (written_size != required_size) return false;

  if (!buffer.empty() && buffer.back() == 0) {
    buffer.pop_back();
  }

  *output = std::move(buffer);
  return true;
}

bool GetAnnotationStringUtf8(FPDF_ANNOTATION annot,
                             const char* key,
                             std::vector<uint8_t>* output) {
  if (!annot || !key || !output) return false;

  const unsigned long required_size = FPDFAnnot_GetStringValue(annot, key, nullptr, 0);
  if (required_size == 0) return false;

  std::vector<uint8_t> utf16le(required_size);
  const unsigned long written_size =
      FPDFAnnot_GetStringValue(
          annot,
          key,
          reinterpret_cast<FPDF_WCHAR*>(utf16le.data()),
          required_size);
  if (written_size != required_size) return false;

  return Utf16LeToUtf8Bytes(std::move(utf16le), output);
}

bool GetAnnotationLinkUri(FPDF_DOCUMENT document,
                          FPDF_ANNOTATION annot,
                          std::vector<uint8_t>* output) {
  if (!document || !annot || !output) return false;
  output->clear();

  if (FPDFAnnot_GetSubtype(annot) != FPDF_ANNOT_LINK) return true;

  FPDF_LINK link = FPDFAnnot_GetLink(annot);
  if (!link) return true;

  FPDF_ACTION action = FPDFLink_GetAction(link);
  if (!action || FPDFAction_GetType(action) != PDFACTION_URI) return true;

  return GetActionStringBytes(document, action, true, output);
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

bool IsValidImagePlacement(double x,
                           double y,
                           double display_width,
                           double display_height) {
  return std::isfinite(x) && std::isfinite(y) &&
         std::isfinite(display_width) && std::isfinite(display_height) &&
         display_width > 0 && display_height > 0;
}

uint32_t ReadBigEndianUint32(const uint8_t* data) {
  return (static_cast<uint32_t>(data[0]) << 24) |
         (static_cast<uint32_t>(data[1]) << 16) |
         (static_cast<uint32_t>(data[2]) << 8) |
         static_cast<uint32_t>(data[3]);
}

uint8_t PaethPredictor(uint8_t left, uint8_t up, uint8_t up_left) {
  const int p = static_cast<int>(left) + static_cast<int>(up) -
                static_cast<int>(up_left);
  const int pa = std::abs(p - static_cast<int>(left));
  const int pb = std::abs(p - static_cast<int>(up));
  const int pc = std::abs(p - static_cast<int>(up_left));
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return up_left;
}

bool DecodePngToRgba(const uint8_t* png,
                     uint32_t png_size,
                     std::vector<uint8_t>* rgba,
                     int* width,
                     int* height) {
  if (!png || png_size == 0 || !rgba || !width || !height) return false;

  static constexpr uint8_t kPngSignature[] = {
      0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'};
  if (png_size < sizeof(kPngSignature) ||
      memcmp(png, kPngSignature, sizeof(kPngSignature)) != 0) {
    return false;
  }

  uint32_t png_width = 0;
  uint32_t png_height = 0;
  uint8_t bit_depth = 0;
  uint8_t color_type = 0;
  bool saw_ihdr = false;
  bool saw_iend = false;
  std::vector<uint8_t> idat;

  size_t offset = sizeof(kPngSignature);
  while (offset + 12 <= png_size) {
    const uint32_t length = ReadBigEndianUint32(png + offset);
    if (length > png_size - offset - 12) return false;

    const uint8_t* type = png + offset + 4;
    const uint8_t* chunk = png + offset + 8;
    if (memcmp(type, "IHDR", 4) == 0) {
      if (length != 13 || saw_ihdr) return false;
      png_width = ReadBigEndianUint32(chunk);
      png_height = ReadBigEndianUint32(chunk + 4);
      bit_depth = chunk[8];
      color_type = chunk[9];
      if (chunk[10] != 0 || chunk[11] != 0 || chunk[12] != 0) return false;
      saw_ihdr = true;
    } else if (memcmp(type, "IDAT", 4) == 0) {
      if (!saw_ihdr) return false;
      if (idat.size() > std::numeric_limits<size_t>::max() - length) {
        return false;
      }
      idat.insert(idat.end(), chunk, chunk + length);
    } else if (memcmp(type, "IEND", 4) == 0) {
      saw_iend = true;
      break;
    }

    offset += static_cast<size_t>(length) + 12;
  }

  if (!saw_ihdr || !saw_iend || idat.empty() || png_width == 0 ||
      png_height == 0 || bit_depth != 8 ||
      png_width > static_cast<uint32_t>(std::numeric_limits<int>::max()) ||
      png_height > static_cast<uint32_t>(std::numeric_limits<int>::max())) {
    return false;
  }

  uint32_t channels = 0;
  switch (color_type) {
    case 0:
      channels = 1;
      break;
    case 2:
      channels = 3;
      break;
    case 4:
      channels = 2;
      break;
    case 6:
      channels = 4;
      break;
    default:
      return false;
  }

  const uint64_t row_bytes64 =
      static_cast<uint64_t>(png_width) * static_cast<uint64_t>(channels);
  const uint64_t inflated_size64 =
      (row_bytes64 + 1) * static_cast<uint64_t>(png_height);
  const uint64_t rgba_size64 =
      static_cast<uint64_t>(png_width) * static_cast<uint64_t>(png_height) * 4;
  if (row_bytes64 > std::numeric_limits<uint32_t>::max() ||
      inflated_size64 > std::numeric_limits<uint32_t>::max() ||
      rgba_size64 > std::numeric_limits<uint32_t>::max() ||
      idat.size() > std::numeric_limits<uLong>::max()) {
    return false;
  }

  std::vector<uint8_t> inflated(static_cast<size_t>(inflated_size64));
  uLongf inflated_size = static_cast<uLongf>(inflated.size());
  if (uncompress(inflated.data(),
                 &inflated_size,
                 idat.data(),
                 static_cast<uLong>(idat.size())) != Z_OK ||
      inflated_size != inflated.size()) {
    return false;
  }

  const size_t row_bytes = static_cast<size_t>(row_bytes64);
  std::vector<uint8_t> pixels(row_bytes * static_cast<size_t>(png_height));
  const uint8_t bpp = static_cast<uint8_t>(channels);
  for (uint32_t row = 0; row < png_height; ++row) {
    const uint8_t* src =
        inflated.data() + static_cast<size_t>(row) * (row_bytes + 1);
    const uint8_t filter = src[0];
    ++src;
    uint8_t* dst = pixels.data() + static_cast<size_t>(row) * row_bytes;
    const uint8_t* prev = row == 0
                              ? nullptr
                              : pixels.data() +
                                    static_cast<size_t>(row - 1) * row_bytes;

    for (size_t i = 0; i < row_bytes; ++i) {
      const uint8_t left = i >= bpp ? dst[i - bpp] : 0;
      const uint8_t up = prev ? prev[i] : 0;
      const uint8_t up_left = prev && i >= bpp ? prev[i - bpp] : 0;
      uint8_t predictor = 0;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = static_cast<uint8_t>(
              (static_cast<unsigned int>(left) + static_cast<unsigned int>(up)) / 2);
          break;
        case 4:
          predictor = PaethPredictor(left, up, up_left);
          break;
        default:
          return false;
      }
      dst[i] = static_cast<uint8_t>(src[i] + predictor);
    }
  }

  rgba->assign(static_cast<size_t>(rgba_size64), 0);
  for (uint32_t row = 0; row < png_height; ++row) {
    const uint8_t* src = pixels.data() + static_cast<size_t>(row) * row_bytes;
    uint8_t* dst =
        rgba->data() + static_cast<size_t>(row) * static_cast<size_t>(png_width) * 4;
    for (uint32_t col = 0; col < png_width; ++col) {
      if (color_type == 0) {
        const uint8_t gray = src[col];
        dst[col * 4 + 0] = gray;
        dst[col * 4 + 1] = gray;
        dst[col * 4 + 2] = gray;
        dst[col * 4 + 3] = 255;
      } else if (color_type == 2) {
        const uint8_t* pixel = src + static_cast<size_t>(col) * 3;
        dst[col * 4 + 0] = pixel[0];
        dst[col * 4 + 1] = pixel[1];
        dst[col * 4 + 2] = pixel[2];
        dst[col * 4 + 3] = 255;
      } else if (color_type == 4) {
        const uint8_t* pixel = src + static_cast<size_t>(col) * 2;
        dst[col * 4 + 0] = pixel[0];
        dst[col * 4 + 1] = pixel[0];
        dst[col * 4 + 2] = pixel[0];
        dst[col * 4 + 3] = pixel[1];
      } else {
        const uint8_t* pixel = src + static_cast<size_t>(col) * 4;
        dst[col * 4 + 0] = pixel[0];
        dst[col * 4 + 1] = pixel[1];
        dst[col * 4 + 2] = pixel[2];
        dst[col * 4 + 3] = pixel[3];
      }
    }
  }

  *width = static_cast<int>(png_width);
  *height = static_cast<int>(png_height);
  return true;
}

FS_RECTF MakePdfRect(double left, double bottom, double right, double top) {
  return FS_RECTF{
      static_cast<float>(left),
      static_cast<float>(top),
      static_cast<float>(right),
      static_cast<float>(bottom),
  };
}

FS_QUADPOINTSF MakePdfQuad(double left, double bottom, double right, double top) {
  return FS_QUADPOINTSF{
      static_cast<float>(left),
      static_cast<float>(top),
      static_cast<float>(right),
      static_cast<float>(top),
      static_cast<float>(left),
      static_cast<float>(bottom),
      static_cast<float>(right),
      static_cast<float>(bottom),
  };
}

void SplitRgba(uint32_t rgba,
               unsigned int* r,
               unsigned int* g,
               unsigned int* b,
               unsigned int* a) {
  *a = (rgba >> 24) & 0xFF;
  *r = (rgba >> 16) & 0xFF;
  *g = (rgba >> 8) & 0xFF;
  *b = rgba & 0xFF;
}

bool IsAsciiString(const char* value) {
  if (!value || !value[0]) return false;
  for (const auto* cursor = reinterpret_cast<const unsigned char*>(value); *cursor; ++cursor) {
    if (*cursor > 0x7F) return false;
  }
  return true;
}

bool SetFreeTextDefaultAppearance(CPDF_Document* doc,
                                  CPDF_Dictionary* annot_dict,
                                  double font_size,
                                  uint32_t text_rgba) {
  if (!doc || !annot_dict || !std::isfinite(font_size) || font_size <= 0) {
    return false;
  }

  RetainPtr<CPDF_Dictionary> root = doc->GetMutableRoot();
  if (!root) return false;

  RetainPtr<CPDF_Dictionary> acroform = root->GetMutableDictFor("AcroForm");
  if (!acroform) {
    acroform = CPDF_InteractiveForm::InitAcroFormDict(doc);
  }
  if (!acroform) return false;

  CPDF_DefaultAppearance default_appearance(annot_dict, acroform.Get());
  auto font = default_appearance.GetFont();
  if (!font.has_value() || font.value().name.IsEmpty()) return false;

  unsigned int r = 0;
  unsigned int g = 0;
  unsigned int b = 0;
  unsigned int ignored_alpha = 0;
  SplitRgba(text_rgba, &r, &g, &b, &ignored_alpha);
  const ByteString appearance = ByteString::Format(
      "/%s %.2f Tf %.6f %.6f %.6f rg",
      font.value().name.c_str(),
      static_cast<float>(font_size),
      r / 255.0f,
      g / 255.0f,
      b / 255.0f);
  annot_dict->SetNewFor<CPDF_String>("DA", appearance);
  return true;
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

bool AppendOutlineItems(FPDF_DOCUMENT document,
                        FPDF_BOOKMARK bookmark,
                        int depth,
                        std::unordered_set<FPDF_BOOKMARK>* visited,
                        uint32_t* item_count,
                        std::vector<uint8_t>* result) {
  static constexpr uint32_t kMaxOutlineItems = 10000;
  if (!document || !visited || !item_count || !result || depth < 0) return false;

  FPDF_BOOKMARK current = bookmark;
  while (current) {
    if (*item_count >= kMaxOutlineItems || visited->find(current) != visited->end()) {
      return false;
    }
    visited->insert(current);

    std::vector<uint8_t> title;
    if (!GetBookmarkTitleUtf8(current, &title)) return false;

    const int child_count = FPDFBookmark_GetCount(current);
    FPDF_ACTION action = FPDFBookmark_GetAction(current);
    const unsigned long action_type = action ? FPDFAction_GetType(action) : PDFACTION_UNSUPPORTED;
    FPDF_DEST dest = nullptr;
    if (action && (action_type == PDFACTION_GOTO ||
                   action_type == PDFACTION_REMOTEGOTO ||
                   action_type == PDFACTION_EMBEDDEDGOTO)) {
      dest = FPDFAction_GetDest(document, action);
    }
    if (!dest) {
      dest = FPDFBookmark_GetDest(document, current);
    }

    int page_index = -1;
    unsigned long view_mode = PDFDEST_VIEW_UNKNOWN_MODE;
    unsigned long view_param_count = 0;
    FS_FLOAT view_params[4] = {0, 0, 0, 0};
    uint32_t location_flags = 0;
    FS_FLOAT x = 0;
    FS_FLOAT y = 0;
    FS_FLOAT zoom = 0;
    if (dest) {
      page_index = FPDFDest_GetDestPageIndex(document, dest);
      view_mode = FPDFDest_GetView(dest, &view_param_count, view_params);
      if (view_param_count > 4) view_param_count = 4;

      FPDF_BOOL has_x = 0;
      FPDF_BOOL has_y = 0;
      FPDF_BOOL has_zoom = 0;
      if (FPDFDest_GetLocationInPage(dest, &has_x, &has_y, &has_zoom, &x, &y, &zoom)) {
        if (has_x) location_flags |= 1;
        if (has_y) location_flags |= 2;
        if (has_zoom) location_flags |= 4;
      }
    }

    std::vector<uint8_t> uri;
    std::vector<uint8_t> file_path;
    if (action && action_type == PDFACTION_URI &&
        !GetActionStringBytes(document, action, true, &uri)) {
      return false;
    }
    if (action && (action_type == PDFACTION_LAUNCH || action_type == PDFACTION_REMOTEGOTO) &&
        !GetActionStringBytes(document, action, false, &file_path)) {
      return false;
    }

    AppendInt32(result, depth);
    AppendInt32(result, child_count);
    AppendBytes(result, title.data(), static_cast<uint32_t>(title.size()));
    AppendUint32(result, static_cast<uint32_t>(action_type));
    AppendInt32(result, page_index);
    AppendUint32(result, static_cast<uint32_t>(view_mode));
    AppendUint32(result, static_cast<uint32_t>(view_param_count));
    for (int i = 0; i < 4; ++i) {
      AppendDouble(result, view_params[i]);
    }
    AppendUint32(result, location_flags);
    AppendDouble(result, x);
    AppendDouble(result, y);
    AppendDouble(result, zoom);
    AppendBytes(result, uri.data(), static_cast<uint32_t>(uri.size()));
    AppendBytes(result, file_path.data(), static_cast<uint32_t>(file_path.size()));

    ++(*item_count);

    FPDF_BOOKMARK child = FPDFBookmark_GetFirstChild(document, current);
    if (child && !AppendOutlineItems(document, child, depth + 1, visited, item_count, result)) {
      return false;
    }

    current = FPDFBookmark_GetNextSibling(document, current);
  }

  return true;
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

int wasm_pdf_get_outline(uintptr_t handle, uint8_t** out_ptr, uint32_t* out_size) {
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

  std::vector<uint8_t> result;
  AppendUint32(&result, 0);
  uint32_t item_count = 0;
  FPDF_BOOKMARK first = FPDFBookmark_GetFirstChild(doc, nullptr);
  if (first) {
    std::unordered_set<FPDF_BOOKMARK> visited;
    if (!AppendOutlineItems(doc, first, 0, &visited, &item_count, &result)) {
      SetLastError(WASM_PDF_ERROR_OUTLINE_READ_FAILED);
      return 0;
    }
  }

  result[0] = static_cast<uint8_t>(item_count & 0xFF);
  result[1] = static_cast<uint8_t>((item_count >> 8) & 0xFF);
  result[2] = static_cast<uint8_t>((item_count >> 16) & 0xFF);
  result[3] = static_cast<uint8_t>((item_count >> 24) & 0xFF);

  if (!CopyVectorToMalloc(result, out_ptr, out_size)) {
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_attachment_count(uintptr_t handle) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return -1;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return -1;
  }

  const int attachment_count = FPDFDoc_GetAttachmentCount(doc);
  if (attachment_count < 0) {
    SetLastError(WASM_PDF_ERROR_ATTACHMENT_READ_FAILED);
    return -1;
  }

  ClearLastError();
  return attachment_count;
}

int wasm_pdf_add_attachment(uintptr_t handle,
                            const char* name_utf8,
                            const uint8_t* file_data,
                            uint32_t file_size,
                            const char* mime_type) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!name_utf8 || !name_utf8[0] || (!file_data && file_size > 0)) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FPDF_DOCUMENT doc = GetDocument(handle);
  if (!doc) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  std::u16string name_utf16;
  if (!DecodeUtf8ToUtf16(name_utf8, &name_utf16)) {
    SetLastError(WASM_PDF_ERROR_INVALID_UTF8);
    return 0;
  }

  FPDF_ATTACHMENT attachment =
      FPDFDoc_AddAttachment(doc, reinterpret_cast<const unsigned short*>(name_utf16.c_str()));
  if (!attachment) {
    SetLastError(WASM_PDF_ERROR_ADD_ATTACHMENT_FAILED);
    return 0;
  }

  if (!FPDFAttachment_SetFile(attachment, doc, file_data, file_size)) {
    SetLastError(WASM_PDF_ERROR_ATTACHMENT_WRITE_FAILED);
    return 0;
  }

  if (!SetAttachmentSubtype(attachment, mime_type)) {
    SetLastError(WASM_PDF_ERROR_ATTACHMENT_WRITE_FAILED);
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_get_attachment_info(uintptr_t handle,
                                 int attachment_index,
                                 uint8_t** out_ptr,
                                 uint32_t* out_size) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (attachment_index < 0 || !out_ptr || !out_size) {
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

  FPDF_ATTACHMENT attachment = FPDFDoc_GetAttachment(doc, attachment_index);
  if (!attachment) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  std::vector<uint8_t> name;
  std::vector<uint8_t> subtype;
  int32_t file_size = -1;
  if (!GetAttachmentNameUtf8(attachment, &name) ||
      !GetAttachmentSubtypeUtf8(attachment, &subtype) ||
      !GetAttachmentFileSize(attachment, &file_size)) {
    SetLastError(WASM_PDF_ERROR_ATTACHMENT_READ_FAILED);
    return 0;
  }

  std::vector<uint8_t> result;
  AppendBytes(&result, name.data(), static_cast<uint32_t>(name.size()));
  AppendBytes(&result, subtype.data(), static_cast<uint32_t>(subtype.size()));
  AppendInt32(&result, file_size);

  if (!CopyVectorToMalloc(result, out_ptr, out_size)) {
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_get_attachment_file(uintptr_t handle,
                                 int attachment_index,
                                 uint8_t** out_ptr,
                                 uint32_t* out_size) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (attachment_index < 0 || !out_ptr || !out_size) {
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

  FPDF_ATTACHMENT attachment = FPDFDoc_GetAttachment(doc, attachment_index);
  if (!attachment) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  unsigned long required_size = 0;
  if (!FPDFAttachment_GetFile(attachment, nullptr, 0, &required_size)) {
    SetLastError(WASM_PDF_ERROR_ATTACHMENT_READ_FAILED);
    return 0;
  }
  if (required_size > std::numeric_limits<uint32_t>::max()) {
    SetLastError(WASM_PDF_ERROR_OUTPUT_TOO_LARGE);
    return 0;
  }

  if (required_size == 0) {
    if (!CopyBytesToMalloc(nullptr, 0, out_ptr, out_size)) {
      return 0;
    }
    ClearLastError();
    return 1;
  }

  std::vector<uint8_t> file_bytes(required_size);
  unsigned long actual_size = 0;
  if (!FPDFAttachment_GetFile(
          attachment, file_bytes.data(), required_size, &actual_size) ||
      actual_size != required_size) {
    SetLastError(WASM_PDF_ERROR_ATTACHMENT_READ_FAILED);
    return 0;
  }

  if (!CopyBytesToMalloc(file_bytes.data(), file_bytes.size(), out_ptr, out_size)) {
    return 0;
  }

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

int wasm_pdf_search_page_text(uintptr_t handle,
                              int page_index,
                              const char* query_utf8,
                              int flags,
                              uint8_t** out_ptr,
                              uint32_t* out_size) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!query_utf8 || !query_utf8[0] || flags < 0 || !out_ptr || !out_size) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  *out_ptr = nullptr;
  *out_size = 0;

  std::u16string query_utf16;
  if (!DecodeUtf8ToUtf16(query_utf8, &query_utf16)) {
    SetLastError(WASM_PDF_ERROR_INVALID_UTF8);
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

  FPDF_TEXTPAGE text_page = FPDFText_LoadPage(page);
  if (!text_page) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_LOAD_TEXT_PAGE_FAILED);
    return 0;
  }

  FPDF_SCHHANDLE search =
      FPDFText_FindStart(text_page,
                         reinterpret_cast<const unsigned short*>(query_utf16.c_str()),
                         static_cast<unsigned long>(flags),
                         0);
  if (!search) {
    FPDFText_ClosePage(text_page);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_TEXT_SEARCH_FAILED);
    return 0;
  }

  std::vector<uint8_t> result;
  AppendUint32(&result, 0);
  uint32_t match_count = 0;

  while (FPDFText_FindNext(search)) {
    const int start_index = FPDFText_GetSchResultIndex(search);
    const int char_count = FPDFText_GetSchCount(search);
    if (start_index < 0 || char_count <= 0) {
      FPDFText_FindClose(search);
      FPDFText_ClosePage(text_page);
      FPDF_ClosePage(page);
      SetLastError(WASM_PDF_ERROR_TEXT_SEARCH_FAILED);
      return 0;
    }

    const int rect_count = FPDFText_CountRects(text_page, start_index, char_count);
    if (rect_count < 0) {
      FPDFText_FindClose(search);
      FPDFText_ClosePage(text_page);
      FPDF_ClosePage(page);
      SetLastError(WASM_PDF_ERROR_TEXT_SEARCH_FAILED);
      return 0;
    }

    AppendInt32(&result, start_index);
    AppendInt32(&result, char_count);
    AppendUint32(&result, static_cast<uint32_t>(rect_count));
    for (int i = 0; i < rect_count; ++i) {
      double left = 0;
      double top = 0;
      double right = 0;
      double bottom = 0;
      if (!FPDFText_GetRect(text_page, i, &left, &top, &right, &bottom)) {
        FPDFText_FindClose(search);
        FPDFText_ClosePage(text_page);
        FPDF_ClosePage(page);
        SetLastError(WASM_PDF_ERROR_TEXT_SEARCH_FAILED);
        return 0;
      }
      AppendDouble(&result, left);
      AppendDouble(&result, bottom);
      AppendDouble(&result, right);
      AppendDouble(&result, top);
    }

    ++match_count;
  }

  FPDFText_FindClose(search);
  FPDFText_ClosePage(text_page);
  FPDF_ClosePage(page);

  result[0] = static_cast<uint8_t>(match_count & 0xFF);
  result[1] = static_cast<uint8_t>((match_count >> 8) & 0xFF);
  result[2] = static_cast<uint8_t>((match_count >> 16) & 0xFF);
  result[3] = static_cast<uint8_t>((match_count >> 24) & 0xFF);

  if (!CopyVectorToMalloc(result, out_ptr, out_size)) {
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_annotation_count(uintptr_t handle, int page_index) {
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

  const int annotation_count = FPDFPage_GetAnnotCount(page);
  FPDF_ClosePage(page);
  if (annotation_count < 0) {
    SetLastError(WASM_PDF_ERROR_CREATE_ANNOTATION_FAILED);
    return -1;
  }

  ClearLastError();
  return annotation_count;
}

int wasm_pdf_get_annotation_info(uintptr_t handle,
                                 int page_index,
                                 int annotation_index,
                                 uint8_t** out_ptr,
                                 uint32_t* out_size) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (annotation_index < 0 || !out_ptr || !out_size) {
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

  FPDF_ANNOTATION annot = FPDFPage_GetAnnot(page, annotation_index);
  if (!annot) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  FS_RECTF rect{};
  if (!FPDFAnnot_GetRect(annot, &rect)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_ANNOTATION_READ_FAILED);
    return 0;
  }

  int32_t has_color = 0;
  int32_t color_rgba = 0;
  unsigned int r = 0;
  unsigned int g = 0;
  unsigned int b = 0;
  unsigned int a = 0;
  if (FPDFAnnot_GetColor(annot, FPDFANNOT_COLORTYPE_Color, &r, &g, &b, &a)) {
    has_color = 1;
    color_rgba = static_cast<int32_t>(((a & 0xFF) << 24) |
                                      ((r & 0xFF) << 16) |
                                      ((g & 0xFF) << 8) |
                                      (b & 0xFF));
  }

  float horizontal_radius = 0;
  float vertical_radius = 0;
  float border_width = -1;
  if (!FPDFAnnot_GetBorder(annot, &horizontal_radius, &vertical_radius, &border_width)) {
    border_width = -1;
  }

  std::vector<uint8_t> contents;
  if (!GetAnnotationStringUtf8(annot, "Contents", &contents)) {
    contents.clear();
  }

  std::vector<uint8_t> uri;
  if (!GetAnnotationLinkUri(doc, annot, &uri)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_ANNOTATION_READ_FAILED);
    return 0;
  }

  const size_t quad_count = FPDFAnnot_CountAttachmentPoints(annot);
  if (quad_count > std::numeric_limits<uint32_t>::max()) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_OUTPUT_TOO_LARGE);
    return 0;
  }

  std::vector<uint8_t> result;
  AppendInt32(&result, static_cast<int32_t>(FPDFAnnot_GetSubtype(annot)));
  AppendInt32(&result, FPDFAnnot_GetFlags(annot));
  AppendDouble(&result, rect.left);
  AppendDouble(&result, rect.bottom);
  AppendDouble(&result, rect.right);
  AppendDouble(&result, rect.top);
  AppendInt32(&result, has_color);
  AppendInt32(&result, color_rgba);
  AppendDouble(&result, border_width);
  AppendBytes(&result, contents.data(), static_cast<uint32_t>(contents.size()));
  AppendBytes(&result, uri.data(), static_cast<uint32_t>(uri.size()));
  AppendUint32(&result, static_cast<uint32_t>(quad_count));
  for (size_t i = 0; i < quad_count; ++i) {
    FS_QUADPOINTSF quad{};
    if (!FPDFAnnot_GetAttachmentPoints(annot, i, &quad)) {
      FPDFPage_CloseAnnot(annot);
      FPDF_ClosePage(page);
      SetLastError(WASM_PDF_ERROR_ANNOTATION_READ_FAILED);
      return 0;
    }
    AppendDouble(&result, quad.x1);
    AppendDouble(&result, quad.y1);
    AppendDouble(&result, quad.x2);
    AppendDouble(&result, quad.y2);
    AppendDouble(&result, quad.x3);
    AppendDouble(&result, quad.y3);
    AppendDouble(&result, quad.x4);
    AppendDouble(&result, quad.y4);
  }

  FPDFPage_CloseAnnot(annot);
  FPDF_ClosePage(page);

  if (!CopyVectorToMalloc(result, out_ptr, out_size)) {
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_delete_annotation(uintptr_t handle, int page_index, int annotation_index) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (annotation_index < 0) {
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

  const int annotation_count_before = FPDFPage_GetAnnotCount(page);
  if (annotation_count_before < 0 || annotation_index >= annotation_count_before) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  if (!FPDFPage_RemoveAnnot(page, annotation_index)) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_ANNOTATION_DELETE_FAILED);
    return 0;
  }

  const int annotation_count_after = FPDFPage_GetAnnotCount(page);
  FPDF_ClosePage(page);
  if (annotation_count_after != annotation_count_before - 1) {
    SetLastError(WASM_PDF_ERROR_ANNOTATION_DELETE_FAILED);
    return 0;
  }

  ClearLastError();
  return 1;
}

int wasm_pdf_add_highlight_annotation(uintptr_t handle,
                                      int page_index,
                                      double left,
                                      double bottom,
                                      double right,
                                      double top,
                                      uint32_t rgba) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!IsValidPageRect(left, bottom, right, top)) {
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

  FPDF_ANNOTATION annot = FPDFPage_CreateAnnot(page, FPDF_ANNOT_HIGHLIGHT);
  if (!annot) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_ANNOTATION_FAILED);
    return 0;
  }

  const FS_RECTF rect = MakePdfRect(left, bottom, right, top);
  if (!FPDFAnnot_SetRect(annot, &rect)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_RECT_FAILED);
    return 0;
  }

  const FS_QUADPOINTSF quad = MakePdfQuad(left, bottom, right, top);
  if (!FPDFAnnot_AppendAttachmentPoints(annot, &quad)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_ATTACHMENT_FAILED);
    return 0;
  }

  unsigned int r = 0;
  unsigned int g = 0;
  unsigned int b = 0;
  unsigned int a = 0;
  SplitRgba(rgba, &r, &g, &b, &a);
  if (!FPDFAnnot_SetColor(annot, FPDFANNOT_COLORTYPE_Color, r, g, b, a)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_COLOR_FAILED);
    return 0;
  }

  FPDFPage_CloseAnnot(annot);
  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_add_link_annotation(uintptr_t handle,
                                 int page_index,
                                 double left,
                                 double bottom,
                                 double right,
                                 double top,
                                 const char* uri) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!IsValidPageRect(left, bottom, right, top) || !IsAsciiString(uri)) {
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

  FPDF_ANNOTATION annot = FPDFPage_CreateAnnot(page, FPDF_ANNOT_LINK);
  if (!annot) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_ANNOTATION_FAILED);
    return 0;
  }

  const FS_RECTF rect = MakePdfRect(left, bottom, right, top);
  if (!FPDFAnnot_SetRect(annot, &rect)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_RECT_FAILED);
    return 0;
  }

  const FS_QUADPOINTSF quad = MakePdfQuad(left, bottom, right, top);
  if (!FPDFAnnot_AppendAttachmentPoints(annot, &quad)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_ATTACHMENT_FAILED);
    return 0;
  }

  if (!FPDFAnnot_SetURI(annot, uri)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_URI_FAILED);
    return 0;
  }

  if (!FPDFAnnot_SetBorder(annot, 0, 0, 0)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_BORDER_FAILED);
    return 0;
  }

  FPDFPage_CloseAnnot(annot);
  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_add_text_note_annotation(uintptr_t handle,
                                      int page_index,
                                      double x,
                                      double y,
                                      const char* contents_utf8,
                                      uint32_t rgba) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!std::isfinite(x) || !std::isfinite(y) || !contents_utf8) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  std::u16string contents_utf16;
  if (!DecodeUtf8ToUtf16(contents_utf8, &contents_utf16)) {
    SetLastError(WASM_PDF_ERROR_INVALID_UTF8);
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

  FPDF_ANNOTATION annot = FPDFPage_CreateAnnot(page, FPDF_ANNOT_TEXT);
  if (!annot) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_ANNOTATION_FAILED);
    return 0;
  }

  const FS_RECTF rect = MakePdfRect(x, y, x + 20, y + 20);
  if (!FPDFAnnot_SetRect(annot, &rect)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_RECT_FAILED);
    return 0;
  }

  if (!FPDFAnnot_SetStringValue(
          annot,
          "Contents",
          reinterpret_cast<const unsigned short*>(contents_utf16.c_str()))) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_TEXT_FAILED);
    return 0;
  }

  unsigned int r = 0;
  unsigned int g = 0;
  unsigned int b = 0;
  unsigned int a = 0;
  SplitRgba(rgba, &r, &g, &b, &a);
  if (!FPDFAnnot_SetColor(annot, FPDFANNOT_COLORTYPE_Color, r, g, b, a)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_COLOR_FAILED);
    return 0;
  }

  FPDFPage_CloseAnnot(annot);
  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_add_rectangle_annotation(uintptr_t handle,
                                      int page_index,
                                      double left,
                                      double bottom,
                                      double right,
                                      double top,
                                      uint32_t stroke_rgba,
                                      double border_width) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!IsValidPageRect(left, bottom, right, top) || !std::isfinite(border_width) ||
      border_width < 0) {
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

  FPDF_ANNOTATION annot = FPDFPage_CreateAnnot(page, FPDF_ANNOT_SQUARE);
  if (!annot) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_ANNOTATION_FAILED);
    return 0;
  }

  const FS_RECTF rect = MakePdfRect(left, bottom, right, top);
  if (!FPDFAnnot_SetRect(annot, &rect)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_RECT_FAILED);
    return 0;
  }

  unsigned int r = 0;
  unsigned int g = 0;
  unsigned int b = 0;
  unsigned int a = 0;
  SplitRgba(stroke_rgba, &r, &g, &b, &a);
  if (!FPDFAnnot_SetColor(annot, FPDFANNOT_COLORTYPE_Color, r, g, b, a)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_COLOR_FAILED);
    return 0;
  }

  if (!FPDFAnnot_SetBorder(annot, 0, 0, static_cast<float>(border_width))) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_BORDER_FAILED);
    return 0;
  }

  FPDFPage_CloseAnnot(annot);
  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_add_freetext_annotation(uintptr_t handle,
                                     int page_index,
                                     double left,
                                     double bottom,
                                     double right,
                                     double top,
                                     const char* contents_utf8,
                                     double font_size,
                                     uint32_t text_rgba,
                                     uint32_t border_rgba,
                                     double border_width) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!IsValidPageRect(left, bottom, right, top) || !contents_utf8 ||
      !std::isfinite(font_size) || font_size <= 0 ||
      !std::isfinite(border_width) || border_width < 0) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  std::u16string contents_utf16;
  if (!DecodeUtf8ToUtf16(contents_utf8, &contents_utf16)) {
    SetLastError(WASM_PDF_ERROR_INVALID_UTF8);
    return 0;
  }

  FPDF_DOCUMENT document = GetDocument(handle);
  if (!document) {
    SetLastError(WASM_PDF_ERROR_INVALID_HANDLE);
    return 0;
  }

  FPDF_PAGE page = FPDF_LoadPage(document, page_index);
  if (!page) {
    SetLastError(PdfiumLastErrorToWasmError(WASM_PDF_ERROR_LOAD_PAGE_FAILED));
    return 0;
  }

  FPDF_ANNOTATION annot = FPDFPage_CreateAnnot(page, FPDF_ANNOT_FREETEXT);
  if (!annot) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_CREATE_ANNOTATION_FAILED);
    return 0;
  }

  const FS_RECTF rect = MakePdfRect(left, bottom, right, top);
  if (!FPDFAnnot_SetRect(annot, &rect)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_RECT_FAILED);
    return 0;
  }

  if (!FPDFAnnot_SetStringValue(
          annot,
          "Contents",
          reinterpret_cast<const unsigned short*>(contents_utf16.c_str()))) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_TEXT_FAILED);
    return 0;
  }

  unsigned int border_r = 0;
  unsigned int border_g = 0;
  unsigned int border_b = 0;
  unsigned int border_a = 0;
  SplitRgba(border_rgba, &border_r, &border_g, &border_b, &border_a);
  if (!FPDFAnnot_SetColor(
          annot,
          FPDFANNOT_COLORTYPE_Color,
          border_r,
          border_g,
          border_b,
          border_a)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_COLOR_FAILED);
    return 0;
  }

  if (!FPDFAnnot_SetBorder(annot, 0, 0, static_cast<float>(border_width))) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_BORDER_FAILED);
    return 0;
  }

  CPDF_AnnotContext* annot_context = CPDFAnnotContextFromFPDFAnnotation(annot);
  CPDF_Document* doc = CPDFDocumentFromFPDFDocument(document);
  if (!annot_context || !doc ||
      !SetFreeTextDefaultAppearance(doc,
                                    annot_context->GetMutableAnnotDict().Get(),
                                    font_size,
                                    text_rgba) ||
      !CPDF_GenerateAP::GenerateAnnotAP(
          doc,
          annot_context->GetMutableAnnotDict().Get(),
          CPDF_Annot::Subtype::FREETEXT)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_GENERATE_ANNOTATION_AP_FAILED);
    return 0;
  }

  FPDFPage_CloseAnnot(annot);
  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_set_annotation_rect(uintptr_t handle,
                                 int page_index,
                                 int annotation_index,
                                 double left,
                                 double bottom,
                                 double right,
                                 double top) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (annotation_index < 0 || !IsValidPageRect(left, bottom, right, top)) {
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

  FPDF_ANNOTATION annot = FPDFPage_GetAnnot(page, annotation_index);
  if (!annot) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  const FS_RECTF rect = MakePdfRect(left, bottom, right, top);
  if (!FPDFAnnot_SetRect(annot, &rect)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_RECT_FAILED);
    return 0;
  }

  const FPDF_ANNOTATION_SUBTYPE subtype = FPDFAnnot_GetSubtype(annot);
  if (subtype == FPDF_ANNOT_HIGHLIGHT || subtype == FPDF_ANNOT_LINK ||
      subtype == FPDF_ANNOT_UNDERLINE || subtype == FPDF_ANNOT_SQUIGGLY ||
      subtype == FPDF_ANNOT_STRIKEOUT) {
    const FS_QUADPOINTSF quad = MakePdfQuad(left, bottom, right, top);
    if (FPDFAnnot_CountAttachmentPoints(annot) > 0) {
      if (!FPDFAnnot_SetAttachmentPoints(annot, 0, &quad)) {
        FPDFPage_CloseAnnot(annot);
        FPDF_ClosePage(page);
        SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_ATTACHMENT_FAILED);
        return 0;
      }
    } else if (!FPDFAnnot_AppendAttachmentPoints(annot, &quad)) {
      FPDFPage_CloseAnnot(annot);
      FPDF_ClosePage(page);
      SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_ATTACHMENT_FAILED);
      return 0;
    }
  }

  FPDFPage_CloseAnnot(annot);
  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_set_annotation_color(uintptr_t handle,
                                  int page_index,
                                  int annotation_index,
                                  uint32_t rgba) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (annotation_index < 0) {
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

  FPDF_ANNOTATION annot = FPDFPage_GetAnnot(page, annotation_index);
  if (!annot) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  unsigned int r = 0;
  unsigned int g = 0;
  unsigned int b = 0;
  unsigned int a = 0;
  SplitRgba(rgba, &r, &g, &b, &a);
  if (!FPDFAnnot_SetColor(annot, FPDFANNOT_COLORTYPE_Color, r, g, b, a)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_COLOR_FAILED);
    return 0;
  }

  FPDFPage_CloseAnnot(annot);
  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_set_annotation_text(uintptr_t handle,
                                 int page_index,
                                 int annotation_index,
                                 const char* contents_utf8) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (annotation_index < 0 || !contents_utf8) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  std::u16string contents_utf16;
  if (!DecodeUtf8ToUtf16(contents_utf8, &contents_utf16)) {
    SetLastError(WASM_PDF_ERROR_INVALID_UTF8);
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

  FPDF_ANNOTATION annot = FPDFPage_GetAnnot(page, annotation_index);
  if (!annot) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  if (!FPDFAnnot_SetStringValue(
          annot,
          "Contents",
          reinterpret_cast<const unsigned short*>(contents_utf16.c_str()))) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_TEXT_FAILED);
    return 0;
  }

  FPDFPage_CloseAnnot(annot);
  FPDF_ClosePage(page);
  ClearLastError();
  return 1;
}

int wasm_pdf_set_annotation_uri(uintptr_t handle,
                                int page_index,
                                int annotation_index,
                                const char* uri) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (annotation_index < 0 || !IsAsciiString(uri)) {
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

  FPDF_ANNOTATION annot = FPDFPage_GetAnnot(page, annotation_index);
  if (!annot) {
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  if (FPDFAnnot_GetSubtype(annot) != FPDF_ANNOT_LINK) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  if (!FPDFAnnot_SetURI(annot, uri)) {
    FPDFPage_CloseAnnot(annot);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_SET_ANNOTATION_URI_FAILED);
    return 0;
  }

  FPDFPage_CloseAnnot(annot);
  FPDF_ClosePage(page);
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
      !IsValidImagePlacement(x, y, display_width, display_height)) {
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

int wasm_pdf_add_jpeg_image_page(uintptr_t handle,
                                 int page_index,
                                 const uint8_t* jpeg,
                                 uint32_t jpeg_size,
                                 double x,
                                 double y,
                                 double display_width,
                                 double display_height) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!jpeg || jpeg_size == 0 ||
      !IsValidImagePlacement(x, y, display_width, display_height)) {
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

  MemoryFileAccess file{jpeg, jpeg_size};
  FPDF_FILEACCESS access{};
  access.m_FileLen = jpeg_size;
  access.m_GetBlock = GetMemoryFileBlock;
  access.m_Param = &file;
  FPDF_PAGE pages[] = {page};
  if (!FPDFImageObj_LoadJpegFileInline(pages, 1, image_obj, &access)) {
    FPDFPageObj_Destroy(image_obj);
    FPDF_ClosePage(page);
    SetLastError(WASM_PDF_ERROR_LOAD_JPEG_FAILED);
    return 0;
  }

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

int wasm_pdf_add_png_image_page(uintptr_t handle,
                                int page_index,
                                const uint8_t* png,
                                uint32_t png_size,
                                double x,
                                double y,
                                double display_width,
                                double display_height) {
  if (!g_pdfium_initialized) {
    SetLastError(WASM_PDF_ERROR_NOT_INITIALIZED);
    return 0;
  }
  if (!png || png_size == 0 ||
      !IsValidImagePlacement(x, y, display_width, display_height)) {
    SetLastError(WASM_PDF_ERROR_INVALID_ARGUMENT);
    return 0;
  }

  std::vector<uint8_t> rgba;
  int image_width = 0;
  int image_height = 0;
  if (!DecodePngToRgba(png, png_size, &rgba, &image_width, &image_height)) {
    SetLastError(WASM_PDF_ERROR_DECODE_PNG_FAILED);
    return 0;
  }

  return wasm_pdf_add_rgba_image_page(handle,
                                      page_index,
                                      rgba.data(),
                                      static_cast<uint32_t>(rgba.size()),
                                      image_width,
                                      image_height,
                                      x,
                                      y,
                                      display_width,
                                      display_height);
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
