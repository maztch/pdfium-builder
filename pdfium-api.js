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
  59: "form_read_failed",
  60: "form_write_failed",
  61: "redaction_failed",
  62: "text_layout_failed",
  63: "page_object_duplicate_failed",
});

export const PAGE_OBJECT_TYPE_NAMES = Object.freeze({
  0: "unknown",
  1: "text",
  2: "path",
  3: "image",
});

export const ANNOTATION_SUBTYPE_NAMES = Object.freeze({
  1: "text",
  2: "link",
  3: "freeText",
  4: "line",
  5: "square",
  6: "circle",
  7: "polygon",
  8: "polyline",
  9: "highlight",
  10: "underline",
  11: "squiggly",
  12: "strikeout",
  13: "stamp",
  14: "caret",
  15: "ink",
  16: "popup",
  17: "fileAttachment",
  18: "sound",
  19: "movie",
  20: "widget",
  21: "screen",
  22: "printerMark",
  23: "trapNet",
  24: "watermark",
  25: "threeD",
  26: "richMedia",
  27: "xfaWidget",
});

export const SELECTABLE_ITEM_KINDS = Object.freeze({
  TEXT: "text",
  PAGE_OBJECT: "pageObject",
  ANNOTATION: "annotation",
  FORM_WIDGET: "formWidget",
  IMAGE: "image",
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

function alignmentValue(value) {
  if (typeof value === "number") return value;
  if (value === "center") return 1;
  if (value === "right") return 2;
  return 0;
}

function browserImageGlobals() {
  const createBitmap = globalThis.createImageBitmap;
  const offscreenCanvas = globalThis.OffscreenCanvas;
  const documentObject = globalThis.document;
  return { createBitmap, offscreenCanvas, documentObject };
}

function createCanvas(width, height) {
  const { offscreenCanvas, documentObject } = browserImageGlobals();
  if (typeof offscreenCanvas === "function") {
    return new offscreenCanvas(width, height);
  }

  if (documentObject?.createElement) {
    const canvas = documentObject.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  throw new PdfiumApiError("Canvas image decoding requires OffscreenCanvas or document.createElement('canvas')", 2);
}

function isImageDataLike(value) {
  return value &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    value.data &&
    value.data.length === value.width * value.height * 4;
}

async function imageSourceToBitmap(source, options = {}) {
  const { createBitmap } = browserImageGlobals();
  if (typeof createBitmap !== "function") {
    throw new PdfiumApiError("createImageBitmap is required for encoded image decoding", 2);
  }

  const imageBitmapType = globalThis.ImageBitmap;
  if (imageBitmapType && source instanceof imageBitmapType) {
    return { bitmap: source, shouldClose: false };
  }

  const blobType = globalThis.Blob;
  if (blobType && source instanceof blobType) {
    return { bitmap: await createBitmap(source), shouldClose: true };
  }

  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    if (!blobType) throw new PdfiumApiError("Blob is required to decode ArrayBuffer image bytes", 2);
    const bytes = asUint8Array(source, "imageSource");
    const blob = new blobType([bytes], options.mimeType ? { type: options.mimeType } : undefined);
    return { bitmap: await createBitmap(blob), shouldClose: true };
  }

  return { bitmap: await createBitmap(source), shouldClose: true };
}

export async function decodeImageToRgba(source, options = {}) {
  if (isImageDataLike(source)) {
    return {
      rgbaBytes: new Uint8ClampedArray(source.data),
      width: source.width,
      height: source.height,
    };
  }

  const { bitmap, shouldClose } = await imageSourceToBitmap(source, options);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height) throw new PdfiumApiError("Decoded image has invalid dimensions", 2);

    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new PdfiumApiError("Unable to acquire 2D canvas context for image decoding", 2);

    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return {
      rgbaBytes: new Uint8ClampedArray(imageData.data),
      width,
      height,
    };
  } finally {
    if (shouldClose && typeof bitmap.close === "function") bitmap.close();
  }
}

export async function createDecodedImagePayload(source, options = {}) {
  const decoded = await decodeImageToRgba(source, options);
  return {
    imageFormat: "rgba",
    rgbaBytes: decoded.rgbaBytes,
    imageWidth: decoded.width,
    imageHeight: decoded.height,
  };
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

function parseTextRuns(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const runs = [];
  let offset = 0;
  const runCount = view.getUint32(offset, true);
  offset += 4;

  for (let runPosition = 0; runPosition < runCount; runPosition += 1) {
    const index = view.getInt32(offset, true);
    offset += 4;
    const startIndex = view.getInt32(offset, true);
    offset += 4;
    const charCount = view.getInt32(offset, true);
    offset += 4;
    const rect = {
      left: view.getFloat64(offset, true),
      bottom: view.getFloat64(offset + 8, true),
      right: view.getFloat64(offset + 16, true),
      top: view.getFloat64(offset + 24, true),
    };
    offset += 32;
    const textSize = view.getUint32(offset, true);
    offset += 4;
    const text = textDecoder.decode(bytes.subarray(offset, offset + textSize));
    offset += textSize;
    runs.push({
      index,
      startIndex,
      charCount,
      text,
      rect,
      kind: SELECTABLE_ITEM_KINDS.TEXT,
      label: text || `Text ${index}`,
      data: {
        text,
        startIndex,
        charCount,
      },
    });
  }

  return runs;
}

function pageObjectLabel(type, index) {
  const name = PAGE_OBJECT_TYPE_NAMES[type] || PAGE_OBJECT_TYPE_NAMES[0];
  return `${name[0].toUpperCase()}${name.slice(1)} object ${index}`;
}

function annotationLabel(subtype, index) {
  const name = ANNOTATION_SUBTYPE_NAMES[subtype] || "annotation";
  return `${name[0].toUpperCase()}${name.slice(1)} annotation ${index}`;
}

function formWidgetLabel(field, widget) {
  const fieldName = field.name || "Unnamed field";
  return `${fieldName} widget ${widget.index}`;
}

function normalizeMatrix(matrix = {}) {
  if (Array.isArray(matrix)) {
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = matrix;
    return { a, b, c, d, e, f };
  }

  const { a = 1, b = 0, c = 0, d = 1, e = 0, f = 0 } = matrix;
  return { a, b, c, d, e, f };
}

function parseAnnotationInfo(bytes, index) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  function readInt32() {
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  }

  function readUint32() {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }

  function readDouble() {
    const value = view.getFloat64(offset, true);
    offset += 8;
    return value;
  }

  function readString() {
    const length = readUint32();
    const value = textDecoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  }

  const subtype = readInt32();
  const flags = readInt32();
  const rect = {
    left: readDouble(),
    bottom: readDouble(),
    right: readDouble(),
    top: readDouble(),
  };
  const hasColor = readInt32() !== 0;
  const colorRgba = readInt32();
  const borderWidth = readDouble();
  const contents = readString();
  const uri = readString();
  const quadCount = readUint32();
  const quadPoints = [];
  for (let quadIndex = 0; quadIndex < quadCount; quadIndex += 1) {
    quadPoints.push({
      x1: readDouble(),
      y1: readDouble(),
      x2: readDouble(),
      y2: readDouble(),
      x3: readDouble(),
      y3: readDouble(),
      x4: readDouble(),
      y4: readDouble(),
    });
  }

  return {
    index,
    subtype,
    subtypeName: ANNOTATION_SUBTYPE_NAMES[subtype] || "unknown",
    flags,
    rect,
    colorRgba: hasColor ? colorRgba >>> 0 : null,
    borderWidth: borderWidth >= 0 ? borderWidth : null,
    contents: contents || null,
    uri: uri || null,
    quadPoints,
    kind: SELECTABLE_ITEM_KINDS.ANNOTATION,
    label: annotationLabel(subtype, index),
    data: {
      subtype,
      subtypeName: ANNOTATION_SUBTYPE_NAMES[subtype] || "unknown",
      flags,
      colorRgba: hasColor ? colorRgba >>> 0 : null,
      borderWidth: borderWidth >= 0 ? borderWidth : null,
      contents: contents || null,
      uri: uri || null,
      quadPoints,
    },
  };
}

function parseAttachmentInfo(bytes, index) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  function readUint32() {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }

  function readString() {
    const length = readUint32();
    const value = textDecoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  }

  const name = readString();
  const mimeType = readString();
  const fileSize = view.getInt32(offset, true);
  return {
    index,
    name,
    mimeType: mimeType || null,
    fileSize,
  };
}

function parseFormFields(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fields = [];
  let offset = 0;

  function readInt32() {
    const value = view.getInt32(offset, true);
    offset += 4;
    return value;
  }

  function readUint32() {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }

  function readDouble() {
    const value = view.getFloat64(offset, true);
    offset += 8;
    return value;
  }

  function readString() {
    const length = readUint32();
    const value = textDecoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  }

  const fieldCount = readUint32();
  for (let index = 0; index < fieldCount; index += 1) {
    const field = {
      index,
      type: readInt32(),
      flags: readUint32(),
      controlCount: readInt32(),
      name: readString(),
      alternateName: readString() || null,
      value: readString(),
      defaultValue: readString(),
      widgets: [],
      options: [],
      selectedIndexes: [],
    };

    const widgetCount = readUint32();
    for (let widgetIndex = 0; widgetIndex < widgetCount; widgetIndex += 1) {
      field.widgets.push({
        index: readInt32(),
        pageIndex: readInt32(),
        rect: {
          left: readDouble(),
          bottom: readDouble(),
          right: readDouble(),
          top: readDouble(),
        },
        checked: readInt32() !== 0,
        defaultChecked: readInt32() !== 0,
        hasAppearance: readInt32() !== 0,
        exportValue: readString(),
        onStateName: readString(),
      });
    }

    const optionCount = readUint32();
    for (let optionPosition = 0; optionPosition < optionCount; optionPosition += 1) {
      field.options.push({
        index: readInt32(),
        selected: readInt32() !== 0,
        defaultSelected: readInt32() !== 0,
        label: readString(),
        value: readString(),
      });
    }

    const selectedIndexCount = readUint32();
    for (let selectedPosition = 0; selectedPosition < selectedIndexCount; selectedPosition += 1) {
      field.selectedIndexes.push(readInt32());
    }

    fields.push(field);
  }

  return fields;
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

  pageTextRuns(pageIndex = 0) {
    const bytes = this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_get_page_text_runs",
        "number",
        ["number", "number", "number", "number"],
        [this.handle, pageIndex, outPtrPtr, outSizePtr]
      ),
      "Unable to query page text runs"
    );
    return parseTextRuns(bytes).map((run) => ({
      ...run,
      pageIndex,
      key: `text:${pageIndex}:${run.index}`,
    }));
  }

  pageObjectCount(pageIndex = 0) {
    this.assertOpen();
    const count = this.mod.ccall("wasm_pdf_page_object_count", "number", ["number", "number"], [this.handle, pageIndex]);
    if (count < 0) this.api.throwLastError("Unable to count page objects");
    return count;
  }

  pageObjectInfo(pageIndex = 0, objectIndex = 0) {
    this.assertOpen();
    let typePtr = 0;

    try {
      typePtr = this.mod._malloc(4);
      if (!typePtr) throw new PdfiumApiError("Unable to allocate page object type pointer", 3);

      return this.withDoublePointers(4, ([leftPtr, bottomPtr, rightPtr, topPtr]) => {
        const ok = this.mod.ccall(
          "wasm_pdf_get_page_object_info",
          "number",
          ["number", "number", "number", "number", "number", "number", "number", "number"],
          [this.handle, pageIndex, objectIndex, typePtr, leftPtr, bottomPtr, rightPtr, topPtr]
        );
        if (!ok) this.api.throwLastError("Unable to query page object info");

        const type = this.mod.getValue(typePtr, "i32");
        const rect = {
          left: this.mod.getValue(leftPtr, "double"),
          bottom: this.mod.getValue(bottomPtr, "double"),
          right: this.mod.getValue(rightPtr, "double"),
          top: this.mod.getValue(topPtr, "double"),
        };

        return {
          index: objectIndex,
          pageIndex,
          type,
          typeName: PAGE_OBJECT_TYPE_NAMES[type] || PAGE_OBJECT_TYPE_NAMES[0],
          rect,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
          top: rect.top,
          kind: SELECTABLE_ITEM_KINDS.PAGE_OBJECT,
          label: pageObjectLabel(type, objectIndex),
          key: `pageObject:${pageIndex}:${objectIndex}`,
          data: {
            type,
            typeName: PAGE_OBJECT_TYPE_NAMES[type] || PAGE_OBJECT_TYPE_NAMES[0],
          },
        };
      });
    } finally {
      if (typePtr) this.mod._free(typePtr);
    }
  }

  pageObjects(pageIndex = 0) {
    const count = this.pageObjectCount(pageIndex);
    const objects = [];
    for (let index = 0; index < count; index += 1) {
      objects.push(this.pageObjectInfo(pageIndex, index));
    }
    return objects;
  }

  annotationCount(pageIndex = 0) {
    this.assertOpen();
    const count = this.mod.ccall("wasm_pdf_annotation_count", "number", ["number", "number"], [this.handle, pageIndex]);
    if (count < 0) this.api.throwLastError("Unable to count annotations");
    return count;
  }

  annotationInfo(pageIndex = 0, annotationIndex = 0) {
    const bytes = this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_get_annotation_info",
        "number",
        ["number", "number", "number", "number", "number"],
        [this.handle, pageIndex, annotationIndex, outPtrPtr, outSizePtr]
      ),
      "Unable to query annotation info"
    );
    const annotation = parseAnnotationInfo(bytes, annotationIndex);
    return {
      ...annotation,
      pageIndex,
      key: `annotation:${pageIndex}:${annotation.index}`,
      data: {
        ...annotation.data,
      },
    };
  }

  annotations(pageIndex = 0) {
    const count = this.annotationCount(pageIndex);
    const annotations = [];
    for (let index = 0; index < count; index += 1) {
      annotations.push(this.annotationInfo(pageIndex, index));
    }
    return annotations;
  }

  getSelectableItems(pageIndex = 0, {
    text = true,
    pageObjects = true,
    annotations = true,
    formWidgets = true,
  } = {}) {
    const items = [];

    if (text) items.push(...this.pageTextRuns(pageIndex));
    if (pageObjects) {
      items.push(...this.pageObjects(pageIndex).map((item) => {
        if (item.type !== 3) return item;
        return {
          ...item,
          kind: SELECTABLE_ITEM_KINDS.IMAGE,
          key: `image:${pageIndex}:${item.index}`,
          data: {
            ...item.data,
            pageObjectKind: item.kind,
            pageObjectKey: item.key,
          },
        };
      }));
    }
    if (annotations) items.push(...this.annotations(pageIndex));

    if (formWidgets) {
      for (const field of this.formFields()) {
        for (const widget of field.widgets) {
          if (widget.pageIndex !== pageIndex) continue;
          items.push({
            kind: SELECTABLE_ITEM_KINDS.FORM_WIDGET,
            pageIndex,
            index: widget.index,
            rect: widget.rect,
            label: formWidgetLabel(field, widget),
            key: `formWidget:${pageIndex}:${field.index}:${widget.index}`,
            data: {
              field,
              widget,
              fieldIndex: field.index,
              fieldName: field.name,
              fieldType: field.type,
            },
          });
        }
      }
    }

    return items;
  }

  deletePageObject(pageIndex, objectIndex) {
    this.call(
      "wasm_pdf_delete_page_object",
      "number",
      ["number", "number", "number"],
      [this.handle, pageIndex, objectIndex],
      "Unable to delete page object"
    );
    return this;
  }

  deleteAnnotation(pageIndex, annotationIndex) {
    this.call(
      "wasm_pdf_delete_annotation",
      "number",
      ["number", "number", "number"],
      [this.handle, pageIndex, annotationIndex],
      "Unable to delete annotation"
    );
    return this;
  }

  setAnnotationRect(pageIndex, annotationIndex, { left, bottom, right, top }) {
    this.call(
      "wasm_pdf_set_annotation_rect",
      "number",
      ["number", "number", "number", "number", "number", "number", "number"],
      [this.handle, pageIndex, annotationIndex, left, bottom, right, top],
      "Unable to set annotation rectangle"
    );
    return this;
  }

  setAnnotationColor(pageIndex, annotationIndex, rgba) {
    this.call(
      "wasm_pdf_set_annotation_color",
      "number",
      ["number", "number", "number", "number"],
      [this.handle, pageIndex, annotationIndex, rgba],
      "Unable to set annotation color"
    );
    return this;
  }

  setAnnotationBorderWidth(pageIndex, annotationIndex, borderWidth) {
    this.call(
      "wasm_pdf_set_annotation_border",
      "number",
      ["number", "number", "number", "number"],
      [this.handle, pageIndex, annotationIndex, borderWidth],
      "Unable to set annotation border width"
    );
    return this;
  }

  setAnnotationText(pageIndex, annotationIndex, contents) {
    this.call(
      "wasm_pdf_set_annotation_text",
      "number",
      ["number", "number", "number", "string"],
      [this.handle, pageIndex, annotationIndex, contents],
      "Unable to set annotation text"
    );
    return this;
  }

  setAnnotationUri(pageIndex, annotationIndex, uri) {
    this.call(
      "wasm_pdf_set_annotation_uri",
      "number",
      ["number", "number", "number", "string"],
      [this.handle, pageIndex, annotationIndex, uri],
      "Unable to set annotation URI"
    );
    return this;
  }

  updateAnnotation(pageIndex, annotationIndex, updates = {}) {
    if (updates.rect) this.setAnnotationRect(pageIndex, annotationIndex, updates.rect);
    if (Object.hasOwn(updates, "color")) this.setAnnotationColor(pageIndex, annotationIndex, updates.color);
    if (Object.hasOwn(updates, "rgba")) this.setAnnotationColor(pageIndex, annotationIndex, updates.rgba);
    if (Object.hasOwn(updates, "borderWidth")) this.setAnnotationBorderWidth(pageIndex, annotationIndex, updates.borderWidth);
    if (Object.hasOwn(updates, "text")) this.setAnnotationText(pageIndex, annotationIndex, updates.text);
    if (Object.hasOwn(updates, "contents")) this.setAnnotationText(pageIndex, annotationIndex, updates.contents);
    if (Object.hasOwn(updates, "uri")) this.setAnnotationUri(pageIndex, annotationIndex, updates.uri);
    return this;
  }

  transformPageObject(pageIndex, objectIndex, matrix = {}) {
    const { a, b, c, d, e, f } = normalizeMatrix(matrix);
    this.call(
      "wasm_pdf_transform_page_object",
      "number",
      ["number", "number", "number", "number", "number", "number", "number", "number", "number"],
      [this.handle, pageIndex, objectIndex, a, b, c, d, e, f],
      "Unable to transform page object"
    );
    return this;
  }

  duplicatePageObject(pageIndex, objectIndex, { offsetX = 12, offsetY = -12 } = {}) {
    this.assertOpen();
    const duplicateIndex = this.mod.ccall(
      "wasm_pdf_duplicate_page_object",
      "number",
      ["number", "number", "number", "number", "number"],
      [this.handle, pageIndex, objectIndex, offsetX, offsetY]
    );
    if (duplicateIndex < 0) this.api.throwLastError("Unable to duplicate page object");
    return duplicateIndex;
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

  redactPageText({ pageIndex = 0, query = "", flags = 0, rgba = 0xff000000 } = {}) {
    const redacted = this.mod.ccall(
      "wasm_pdf_redact_page_text",
      "number",
      ["number", "number", "string", "number", "number"],
      [this.handle, pageIndex, query, flags, rgba]
    );
    if (redacted < 0) {
      this.api.throwLastError("Unable to redact page text");
    }
    return redacted;
  }

  formFields() {
    const bytes = this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_get_form_fields",
        "number",
        ["number", "number", "number"],
        [this.handle, outPtrPtr, outSizePtr]
      ),
      "Unable to query form fields"
    );
    return parseFormFields(bytes);
  }

  attachmentCount() {
    this.assertOpen();
    const count = this.mod.ccall("wasm_pdf_attachment_count", "number", ["number"], [this.handle]);
    if (count < 0) this.api.throwLastError("Unable to count attachments");
    return count;
  }

  attachmentInfo(attachmentIndex) {
    const bytes = this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_get_attachment_info",
        "number",
        ["number", "number", "number", "number"],
        [this.handle, attachmentIndex, outPtrPtr, outSizePtr]
      ),
      "Unable to query attachment info"
    );
    return parseAttachmentInfo(bytes, attachmentIndex);
  }

  attachments() {
    const count = this.attachmentCount();
    const attachments = [];
    for (let index = 0; index < count; index += 1) {
      attachments.push(this.attachmentInfo(index));
    }
    return attachments;
  }

  readAttachment(attachmentIndex) {
    const fileBytes = this.outputBytes(
      (outPtrPtr, outSizePtr) => this.mod.ccall(
        "wasm_pdf_get_attachment_file",
        "number",
        ["number", "number", "number", "number"],
        [this.handle, attachmentIndex, outPtrPtr, outSizePtr]
      ),
      "Unable to read attachment file"
    );
    return {
      ...this.attachmentInfo(attachmentIndex),
      fileBytes,
    };
  }

  addAttachment({ name = "", fileBytes = new Uint8Array(), mimeType = "" } = {}) {
    this.assertOpen();
    const bytes = asUint8Array(fileBytes, "fileBytes");
    let filePtr = 0;

    try {
      if (bytes.length > 0) {
        filePtr = this.mod._malloc(bytes.length);
        if (!filePtr) throw new PdfiumApiError("Unable to allocate attachment file buffer", 3);
        this.mod.HEAPU8.set(bytes, filePtr);
      }

      this.call(
        "wasm_pdf_add_attachment",
        "number",
        ["number", "string", "number", "number", "string"],
        [this.handle, name, filePtr, bytes.length, mimeType],
        "Unable to add attachment"
      );
      return this;
    } finally {
      if (filePtr) this.mod._free(filePtr);
    }
  }

  updateAttachment(attachmentIndex, { fileBytes = new Uint8Array(), mimeType = "" } = {}) {
    this.assertOpen();
    const bytes = asUint8Array(fileBytes, "fileBytes");
    let filePtr = 0;

    try {
      if (bytes.length > 0) {
        filePtr = this.mod._malloc(bytes.length);
        if (!filePtr) throw new PdfiumApiError("Unable to allocate attachment file buffer", 3);
        this.mod.HEAPU8.set(bytes, filePtr);
      }

      this.call(
        "wasm_pdf_set_attachment_file",
        "number",
        ["number", "number", "number", "number", "string"],
        [this.handle, attachmentIndex, filePtr, bytes.length, mimeType],
        "Unable to update attachment"
      );
      return this;
    } finally {
      if (filePtr) this.mod._free(filePtr);
    }
  }

  deleteAttachment(attachmentIndex) {
    this.call(
      "wasm_pdf_delete_attachment",
      "number",
      ["number", "number"],
      [this.handle, attachmentIndex],
      "Unable to delete attachment"
    );
    return this;
  }

  setFormFieldValue(name, value) {
    this.call(
      "wasm_pdf_set_form_field_value",
      "number",
      ["number", "string", "string"],
      [this.handle, name, value],
      "Unable to set form field value"
    );
    return this;
  }

  setFormFieldChecked(name, checked, controlIndex = 0) {
    this.call(
      "wasm_pdf_set_form_field_checked",
      "number",
      ["number", "string", "number", "number"],
      [this.handle, name, controlIndex, checked ? 1 : 0],
      "Unable to set form field checked state"
    );
    return this;
  }

  setFormFieldSelectedIndex(name, optionIndex) {
    this.call(
      "wasm_pdf_set_form_field_selected_index",
      "number",
      ["number", "string", "number"],
      [this.handle, name, optionIndex],
      "Unable to set form field selected option"
    );
    return this;
  }

  addText(options = {}) {
    if (
      Object.hasOwn(options, "width") ||
      Object.hasOwn(options, "height") ||
      Object.hasOwn(options, "fontName") ||
      Object.hasOwn(options, "align") ||
      Object.hasOwn(options, "lineHeight")
    ) {
      this.addTextBox(options);
      return this;
    }

    const { pageIndex = 0, text = "", x = 80, y = 120, fontSize = 16, rgba = 0xff000000 } = options;
    this.call(
      "wasm_pdf_add_text_page",
      "number",
      ["number", "number", "string", "number", "number", "number", "number"],
      [this.handle, pageIndex, text, x, y, fontSize, rgba],
      "Unable to add text"
    );
    return this;
  }

  addTextBox({
    pageIndex = 0,
    text = "",
    x = 80,
    y = 120,
    width = 0,
    height = 0,
    fontSize = 16,
    rgba = 0xff000000,
    fontName = "Helvetica",
    align = "left",
    lineHeight = 0,
  } = {}) {
    const lineCount = this.mod.ccall(
      "wasm_pdf_add_text_box_page",
      "number",
      ["number", "number", "string", "number", "number", "number", "number", "number", "number", "string", "number", "number"],
      [
        this.handle,
        pageIndex,
        text,
        x,
        y,
        width,
        height,
        fontSize,
        rgba,
        fontName,
        alignmentValue(align),
        lineHeight,
      ]
    );
    if (lineCount < 0) {
      this.api.throwLastError("Unable to add text box");
    }
    return lineCount;
  }

  addRgbaImage({
    pageIndex = 0,
    rgbaBytes,
    imageWidth = 0,
    imageHeight = 0,
    x = 0,
    y = 0,
    displayWidth = 0,
    displayHeight = 0,
  } = {}) {
    this.assertOpen();
    const bytes = asUint8Array(rgbaBytes, "rgbaBytes");
    let imagePtr = 0;

    try {
      imagePtr = this.mod._malloc(bytes.length);
      if (!imagePtr) throw new PdfiumApiError("Unable to allocate RGBA image buffer", 3);
      this.mod.HEAPU8.set(bytes, imagePtr);

      this.call(
        "wasm_pdf_add_rgba_image_page",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [this.handle, pageIndex, imagePtr, bytes.length, imageWidth, imageHeight, x, y, displayWidth, displayHeight],
        "Unable to add RGBA image"
      );

      return this;
    } finally {
      if (imagePtr) this.mod._free(imagePtr);
    }
  }

  async addImageFromSource(source, {
    pageIndex = 0,
    x = 0,
    y = 0,
    displayWidth,
    displayHeight,
    mimeType,
  } = {}) {
    const decoded = await decodeImageToRgba(source, { mimeType });
    return this.addRgbaImage({
      pageIndex,
      rgbaBytes: decoded.rgbaBytes,
      imageWidth: decoded.width,
      imageHeight: decoded.height,
      x,
      y,
      displayWidth: displayWidth ?? decoded.width,
      displayHeight: displayHeight ?? decoded.height,
    });
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

  copyPage({ sourceDoc = this, sourcePageIndex = 0, destinationPageIndex = 0 } = {}) {
    this.assertOpen();
    if (!sourceDoc || typeof sourceDoc.assertOpen !== "function") {
      throw new PdfiumApiError("sourceDoc must be an open PdfDocument", 2);
    }
    sourceDoc.assertOpen();
    this.call(
      "wasm_pdf_copy_page",
      "number",
      ["number", "number", "number", "number"],
      [sourceDoc.handle, sourcePageIndex, this.handle, destinationPageIndex],
      "Unable to copy page"
    );
    return this;
  }

  importPages({ sourceDoc, pageRange = "", destinationPageIndex = 0 } = {}) {
    this.assertOpen();
    if (!sourceDoc || typeof sourceDoc.assertOpen !== "function") {
      throw new PdfiumApiError("sourceDoc must be an open PdfDocument", 2);
    }
    sourceDoc.assertOpen();
    this.call(
      "wasm_pdf_import_pages",
      "number",
      ["number", "string", "number", "number"],
      [sourceDoc.handle, pageRange, this.handle, destinationPageIndex],
      "Unable to import pages"
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
