import PdfiumWasm from "./dist/pdfium.js";

export const PDFIUM_ERROR_NAMES = Object.freeze({
  0: "none",
  1: "not_initialized",
  2: "invalid_argument",
  3: "out_of_memory",
  4: "load_document_failed",
  5: "invalid_handle",
  6: "load_page_failed",
  7: "create_text_failed",
  8: "set_text_failed",
  9: "set_color_failed",
  10: "insert_object_failed",
  11: "generate_content_failed",
  12: "save_failed",
  13: "write_failed",
  14: "output_too_large",
  15: "invalid_utf8",
  16: "create_page_failed",
  17: "delete_page_failed",
  18: "copy_page_failed",
  19: "import_pages_failed",
  20: "pdfium_unknown",
  21: "pdfium_file",
  22: "pdfium_format",
  23: "pdfium_password",
  24: "pdfium_security",
  25: "pdfium_page",
  26: "page_geometry_failed",
  27: "metadata_read_failed",
  28: "metadata_write_failed",
  29: "load_text_page_failed",
  30: "text_extraction_failed",
  31: "create_image_failed",
  32: "create_bitmap_failed",
  33: "set_image_bitmap_failed",
  34: "set_image_matrix_failed",
  35: "create_render_bitmap_failed",
  36: "fill_render_bitmap_failed",
  37: "page_object_lookup_failed",
  38: "page_object_bounds_failed",
  39: "page_object_delete_failed",
  40: "page_object_transform_failed",
  41: "text_search_failed",
  42: "create_annotation_failed",
  43: "set_annotation_rect_failed",
  44: "set_annotation_color_failed",
  45: "set_annotation_attachment_failed",
  46: "set_annotation_uri_failed",
  47: "set_annotation_text_failed",
  48: "set_annotation_border_failed",
  49: "generate_annotation_ap_failed",
  50: "load_jpeg_failed",
  51: "decode_png_failed",
  52: "outline_read_failed",
  53: "add_attachment_failed",
  54: "attachment_read_failed",
  55: "attachment_write_failed",
  56: "annotation_read_failed",
  57: "annotation_delete_failed",
  58: "attachment_delete_failed",
});

export class PdfiumApiError extends Error {
  constructor(message, code = 0) {
    super(message);
    this.name = "PdfiumApiError";
    this.code = code;
    this.errorName = PDFIUM_ERROR_NAMES[code] || "unknown";
  }
}

const DEFAULT_LOCATE_FILE = (file) => new URL(`./dist/${file}`, import.meta.url).href;
const textDecoder = new TextDecoder("utf-8");

function asUint8Array(value, label = "bytes") {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  throw new PdfiumApiError(`${label} must be an ArrayBuffer or typed array`, 2);
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function parseSearchResults(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const matches = [];
  let offset = 0;
  const matchCount = view.getUint32(offset, true);
  offset += 4;

  for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
    const startIndex = view.getInt32(offset, true);
    offset += 4;
    const charCount = view.getInt32(offset, true);
    offset += 4;
    const rectCount = view.getUint32(offset, true);
    offset += 4;
    const rects = [];

    for (let rectIndex = 0; rectIndex < rectCount; rectIndex += 1) {
      rects.push({
        left: view.getFloat64(offset, true),
        bottom: view.getFloat64(offset + 8, true),
        right: view.getFloat64(offset + 16, true),
        top: view.getFloat64(offset + 24, true),
      });
      offset += 32;
    }

    matches.push({ startIndex, charCount, rects });
  }

  return matches;
}

export async function createPdfiumApi(options = {}) {
  const mod = await PdfiumWasm({
    locateFile: options.locateFile || DEFAULT_LOCATE_FILE,
    ...options.moduleOptions,
  });

  const api = new PdfiumApi(mod);
  api.init();
  return api;
}

export class PdfiumApi {
  constructor(mod) {
    this.mod = mod;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    const ok = this.mod.ccall("wasm_pdfium_init", "number", [], []);
    if (!ok) this.throwLastError("Unable to initialize PDFium");
    this.initialized = true;
  }

  destroy() {
    if (!this.initialized) return;
    this.mod.ccall("wasm_pdfium_destroy", null, [], []);
    this.initialized = false;
  }

  lastError() {
    return this.mod.ccall("wasm_pdf_last_error", "number", [], []);
  }

  throwLastError(message) {
    const code = this.lastError();
    const name = PDFIUM_ERROR_NAMES[code] || "unknown";
    throw new PdfiumApiError(`${message} (${name})`, code);
  }

  openDocument(pdfBytes, options = {}) {
    return PdfDocument.open(this, pdfBytes, options);
  }

  async withDocument(pdfBytes, callback, options = {}) {
    const doc = this.openDocument(pdfBytes, options);
    try {
      return await callback(doc);
    } finally {
      doc.close();
    }
  }
}

export class PdfDocument {
  static open(api, pdfBytes, options = {}) {
    const bytes = asUint8Array(pdfBytes, "pdfBytes");
    const mod = api.mod;
    let inputPtr = 0;

    try {
      inputPtr = mod._malloc(bytes.length);
      if (!inputPtr) throw new PdfiumApiError("Unable to allocate input PDF buffer", 3);
      mod.HEAPU8.set(bytes, inputPtr);

      const handle = mod.ccall(
        "wasm_pdf_open_from_bytes",
        "number",
        ["number", "number", "string"],
        [inputPtr, bytes.length, stringOrDefault(options.password, "")]
      );
      if (!handle) api.throwLastError("Unable to open PDF");

      return new PdfDocument(api, handle);
    } finally {
      if (inputPtr) mod._free(inputPtr);
    }
  }

  constructor(api, handle) {
    this.api = api;
    this.mod = api.mod;
    this.handle = handle;
  }

  close() {
    if (!this.handle) return;
    this.mod.ccall("wasm_pdf_close", null, ["number"], [this.handle]);
    this.handle = 0;
  }

  assertOpen() {
    if (!this.handle) throw new PdfiumApiError("PDF document is closed", 5);
  }

  call(name, returnType, argTypes, args, message) {
    this.assertOpen();
    const result = this.mod.ccall(name, returnType, argTypes, args);
    if (!result) this.api.throwLastError(message);
    return result;
  }

  outputBytes(nativeCall, message) {
    this.assertOpen();
    let outPtrPtr = 0;
    let outSizePtr = 0;
    let outPtr = 0;

    try {
      outPtrPtr = this.mod._malloc(4);
      outSizePtr = this.mod._malloc(4);
      if (!outPtrPtr || !outSizePtr) throw new PdfiumApiError("Unable to allocate output pointers", 3);

      const ok = nativeCall(outPtrPtr, outSizePtr);
      if (!ok) this.api.throwLastError(message);

      outPtr = this.mod.getValue(outPtrPtr, "i32");
      const outSize = this.mod.getValue(outSizePtr, "i32");
      const bytes = outSize > 0 && outPtr ? this.mod.HEAPU8.slice(outPtr, outPtr + outSize) : new Uint8Array();
      return bytes;
    } finally {
      if (outPtr) this.mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
      if (outPtrPtr) this.mod._free(outPtrPtr);
      if (outSizePtr) this.mod._free(outSizePtr);
    }
  }

  save() {
    return this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_save_copy",
        "number",
        ["number", "number", "number"],
        [this.handle, outPtrPtr, outSizePtr]
      ),
      "Unable to save PDF"
    );
  }

  pageCount() {
    this.assertOpen();
    const count = this.mod.ccall("wasm_pdf_page_count", "number", ["number"], [this.handle]);
    if (count < 0) this.api.throwLastError("Unable to count pages");
    return count;
  }

  pageSize(pageIndex = 0) {
    this.assertOpen();
    return this.withDoublePointers(2, ([widthPtr, heightPtr]) => {
      const ok = this.mod.ccall(
        "wasm_pdf_get_page_size",
        "number",
        ["number", "number", "number", "number"],
        [this.handle, pageIndex, widthPtr, heightPtr]
      );
      if (!ok) this.api.throwLastError("Unable to get page size");
      return {
        width: this.mod.getValue(widthPtr, "double"),
        height: this.mod.getValue(heightPtr, "double"),
      };
    });
  }

  pageRotation(pageIndex = 0) {
    this.assertOpen();
    const rotation = this.mod.ccall("wasm_pdf_get_page_rotation", "number", ["number", "number"], [this.handle, pageIndex]);
    if (rotation < 0) this.api.throwLastError("Unable to get page rotation");
    return rotation;
  }

  pageBox(pageIndex = 0, boxType = 0) {
    this.assertOpen();
    return this.withDoublePointers(4, ([leftPtr, bottomPtr, rightPtr, topPtr]) => {
      const ok = this.mod.ccall(
        "wasm_pdf_get_page_box",
        "number",
        ["number", "number", "number", "number", "number", "number", "number"],
        [this.handle, pageIndex, boxType, leftPtr, bottomPtr, rightPtr, topPtr]
      );
      if (!ok) this.api.throwLastError("Unable to get page box");
      return {
        left: this.mod.getValue(leftPtr, "double"),
        bottom: this.mod.getValue(bottomPtr, "double"),
        right: this.mod.getValue(rightPtr, "double"),
        top: this.mod.getValue(topPtr, "double"),
      };
    });
  }

  permissions() {
    this.assertOpen();
    const permissions = this.mod.ccall("wasm_pdf_get_permissions", "number", ["number"], [this.handle]) >>> 0;
    if (this.api.lastError() !== 0) this.api.throwLastError("Unable to get PDF permissions");
    return permissions;
  }

  metadata(key) {
    const bytes = this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_get_metadata",
        "number",
        ["number", "string", "number", "number"],
        [this.handle, key, outPtrPtr, outSizePtr]
      ),
      "Unable to get metadata"
    );
    return textDecoder.decode(bytes);
  }

  setMetadata(key, value) {
    this.call(
      "wasm_pdf_set_metadata",
      "number",
      ["number", "string", "string"],
      [this.handle, key, value],
      "Unable to set metadata"
    );
    return this;
  }

  pageText(pageIndex = 0) {
    const bytes = this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_get_page_text",
        "number",
        ["number", "number", "number", "number"],
        [this.handle, pageIndex, outPtrPtr, outSizePtr]
      ),
      "Unable to extract page text"
    );
    return textDecoder.decode(bytes);
  }

  searchPageText(pageIndex = 0, query = "", flags = 0) {
    const bytes = this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_search_page_text",
        "number",
        ["number", "number", "string", "number", "number", "number"],
        [this.handle, pageIndex, query, flags, outPtrPtr, outSizePtr]
      ),
      "Unable to search page text"
    );
    return parseSearchResults(bytes);
  }

  addText({ pageIndex = 0, text = "", x = 80, y = 120, fontSize = 16, rgba = 0xff000000 } = {}) {
    this.call(
      "wasm_pdf_add_text_page",
      "number",
      ["number", "number", "string", "number", "number", "number", "number"],
      [this.handle, pageIndex, text, x, y, fontSize, rgba],
      "Unable to add text"
    );
    return this;
  }

  insertBlankPage({ pageIndex = 0, width = 0, height = 0 } = {}) {
    this.call(
      "wasm_pdf_insert_blank_page",
      "number",
      ["number", "number", "number", "number"],
      [this.handle, pageIndex, width, height],
      "Unable to insert blank page"
    );
    return this;
  }

  deletePage(pageIndex) {
    this.call(
      "wasm_pdf_delete_page",
      "number",
      ["number", "number"],
      [this.handle, pageIndex],
      "Unable to delete page"
    );
    return this;
  }

  setPageRotation(pageIndex, rotation) {
    this.call(
      "wasm_pdf_set_page_rotation",
      "number",
      ["number", "number", "number"],
      [this.handle, pageIndex, rotation],
      "Unable to set page rotation"
    );
    return this;
  }

  setPageBox(pageIndex, boxType, { left, bottom, right, top }) {
    this.call(
      "wasm_pdf_set_page_box",
      "number",
      ["number", "number", "number", "number", "number", "number", "number"],
      [this.handle, pageIndex, boxType, left, bottom, right, top],
      "Unable to set page box"
    );
    return this;
  }

  setPageSize(pageIndex, width, height) {
    this.call(
      "wasm_pdf_set_page_size",
      "number",
      ["number", "number", "number", "number"],
      [this.handle, pageIndex, width, height],
      "Unable to set page size"
    );
    return this;
  }

  renderPage({ pageIndex = 0, width = 0, height = 0, flags = 0 } = {}) {
    const rgbaBytes = this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_render_page_rgba",
        "number",
        ["number", "number", "number", "number", "number", "number", "number"],
        [this.handle, pageIndex, width, height, flags, outPtrPtr, outSizePtr]
      ),
      "Unable to render page"
    );
    return { rgbaBytes, width, height };
  }

  renderPageArea({ pageIndex = 0, left = 0, bottom = 0, right = 0, top = 0, width = 0, height = 0, flags = 0 } = {}) {
    const rgbaBytes = this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_render_page_area_rgba",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [this.handle, pageIndex, left, bottom, right, top, width, height, flags, outPtrPtr, outSizePtr]
      ),
      "Unable to render page area"
    );
    return { rgbaBytes, width, height };
  }

  withDoublePointers(count, callback) {
    const ptrs = [];
    try {
      for (let i = 0; i < count; i += 1) {
        const ptr = this.mod._malloc(8);
        if (!ptr) throw new PdfiumApiError("Unable to allocate double pointer", 3);
        ptrs.push(ptr);
      }
      return callback(ptrs);
    } finally {
      for (const ptr of ptrs) this.mod._free(ptr);
    }
  }
}
