import PdfiumWasm from "../dist/pdfium.js";

const ERROR_NAMES = Object.freeze({
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
});

class PdfiumWorkerError extends Error {
  constructor(message, code = 0) {
    super(message);
    this.name = "PdfiumWorkerError";
    this.code = code;
    this.errorName = ERROR_NAMES[code] || "unknown";
  }
}

let modulePromise = null;
let requestQueue = Promise.resolve();

function getModule() {
  if (!modulePromise) {
    modulePromise = PdfiumWasm({
      locateFile(file) {
        return new URL(`../dist/${file}`, self.location.href).href;
      },
    }).then((mod) => {
      const initialized = mod.ccall("wasm_pdfium_init", "number", [], []);
      if (!initialized) throwPdfiumError(mod, "Unable to initialize PDFium");
      return mod;
    });
  }

  return modulePromise;
}

function lastError(mod) {
  return mod.ccall("wasm_pdf_last_error", "number", [], []);
}

function throwPdfiumError(mod, message) {
  const code = lastError(mod);
  const name = ERROR_NAMES[code] || "unknown";
  throw new PdfiumWorkerError(`${message} (${name})`, code);
}

function saveDocumentBytes(mod, handle) {
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;

  try {
    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

function asUint8Array(value, label = "payload.pdfBytes") {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  throw new PdfiumWorkerError(`${label} must be an ArrayBuffer or typed array`, 2);
}

function numberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function arrayOrDefault(value, fallback) {
  return Array.isArray(value) ? value : fallback;
}

function enabledByDefault(value) {
  return value !== false;
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

function parseOutline(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  const flatItems = [];
  let offset = 0;
  const itemCount = view.getUint32(offset, true);
  offset += 4;

  function readUint32() {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }

  function readInt32() {
    const value = view.getInt32(offset, true);
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
    const value = decoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  }

  for (let index = 0; index < itemCount; index += 1) {
    const depth = readInt32();
    const childCount = readInt32();
    const title = readString();
    const actionType = readUint32();
    const pageIndex = readInt32();
    const viewMode = readUint32();
    const viewParamCount = readUint32();
    const viewParams = [readDouble(), readDouble(), readDouble(), readDouble()].slice(0, viewParamCount);
    const locationFlags = readUint32();
    const x = readDouble();
    const y = readDouble();
    const zoom = readDouble();
    const uri = readString();
    const filePath = readString();
    const destination = pageIndex >= 0
      ? {
          pageIndex,
          viewMode,
          viewParams,
          x: locationFlags & 1 ? x : null,
          y: locationFlags & 2 ? y : null,
          zoom: locationFlags & 4 ? zoom : null,
        }
      : null;

    flatItems.push({
      index,
      depth,
      title,
      childCount,
      isOpen: childCount >= 0,
      actionType,
      destination,
      uri: uri || null,
      filePath: filePath || null,
      children: [],
    });
  }

  const roots = [];
  const stack = [];
  for (const item of flatItems) {
    while (stack.length > item.depth) stack.pop();
    if (stack.length === 0) {
      roots.push(item);
    } else {
      stack[stack.length - 1].children.push(item);
    }
    stack[item.depth] = item;
  }

  return roots;
}

function parseAttachmentInfo(bytes, index) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  let offset = 0;

  function readUint32() {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }

  function readString() {
    const length = readUint32();
    const value = decoder.decode(bytes.subarray(offset, offset + length));
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

function parseAnnotationInfo(bytes, index) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
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
    const value = decoder.decode(bytes.subarray(offset, offset + length));
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
    flags,
    rect,
    colorRgba: hasColor ? colorRgba >>> 0 : null,
    borderWidth: borderWidth >= 0 ? borderWidth : null,
    contents: contents || null,
    uri: uri || null,
    quadPoints,
  };
}

function parseFormFields(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
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

  function readString() {
    const length = readUint32();
    const value = decoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  }

  const fieldCount = readUint32();
  for (let index = 0; index < fieldCount; index += 1) {
    fields.push({
      index,
      type: readInt32(),
      flags: readUint32(),
      controlCount: readInt32(),
      name: readString(),
      alternateName: readString() || null,
      value: readString(),
      defaultValue: readString(),
    });
  }

  return fields;
}

const DEFAULT_METADATA_KEYS = Object.freeze([
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
  "CreationDate",
  "ModDate",
]);

const PAGE_BOXES = Object.freeze([
  ["media", 0],
  ["crop", 1],
  ["bleed", 2],
  ["trim", 3],
  ["art", 4],
]);

function countOutlineItems(items) {
  let count = 0;
  for (const item of items) {
    count += 1 + countOutlineItems(item.children || []);
  }
  return count;
}

async function addText(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);
  const text = stringOrDefault(payload.text, "");

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const added = mod.ccall(
      "wasm_pdf_add_text_page",
      "number",
      ["number", "number", "string", "number", "number", "number", "number"],
      [
        handle,
        numberOrDefault(payload.pageIndex, 0),
        text,
        numberOrDefault(payload.x, 80),
        numberOrDefault(payload.y, 120),
        numberOrDefault(payload.fontSize, 16),
        numberOrDefault(payload.rgba, 0xff000000),
      ]
    );
    if (!added) throwPdfiumError(mod, "Unable to add text");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function addImage(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);
  const inferredImageFormat = payload.jpegBytes ? "jpeg" : payload.pngBytes ? "png" : "rgba";
  const imageFormat = stringOrDefault(payload.imageFormat, inferredImageFormat);
  const encodedImageBytes = payload.imageBytes || payload.jpegBytes || payload.pngBytes;
  const imageBytes =
    imageFormat === "rgba"
      ? asUint8Array(payload.rgbaBytes, "payload.rgbaBytes")
      : asUint8Array(encodedImageBytes, "payload.imageBytes");

  let inputPtr = 0;
  let imagePtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    imagePtr = mod._malloc(imageBytes.length);
    if (!inputPtr || !imagePtr) throw new PdfiumWorkerError("Unable to allocate worker input buffers", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);
    mod.HEAPU8.set(imageBytes, imagePtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    let added = 0;
    if (imageFormat === "rgba") {
      added = mod.ccall(
        "wasm_pdf_add_rgba_image_page",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number", "number", "number"],
        [
          handle,
          numberOrDefault(payload.pageIndex, 0),
          imagePtr,
          imageBytes.length,
          numberOrDefault(payload.imageWidth, 0),
          numberOrDefault(payload.imageHeight, 0),
          numberOrDefault(payload.x, 0),
          numberOrDefault(payload.y, 0),
          numberOrDefault(payload.displayWidth, 0),
          numberOrDefault(payload.displayHeight, 0),
        ]
      );
    } else if (imageFormat === "jpeg" || imageFormat === "jpg") {
      added = mod.ccall(
        "wasm_pdf_add_jpeg_image_page",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number"],
        [
          handle,
          numberOrDefault(payload.pageIndex, 0),
          imagePtr,
          imageBytes.length,
          numberOrDefault(payload.x, 0),
          numberOrDefault(payload.y, 0),
          numberOrDefault(payload.displayWidth, 0),
          numberOrDefault(payload.displayHeight, 0),
        ]
      );
    } else if (imageFormat === "png") {
      added = mod.ccall(
        "wasm_pdf_add_png_image_page",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number"],
        [
          handle,
          numberOrDefault(payload.pageIndex, 0),
          imagePtr,
          imageBytes.length,
          numberOrDefault(payload.x, 0),
          numberOrDefault(payload.y, 0),
          numberOrDefault(payload.displayWidth, 0),
          numberOrDefault(payload.displayHeight, 0),
        ]
      );
    } else {
      throw new PdfiumWorkerError(`Unsupported image format: ${imageFormat}`, 2);
    }
    if (!added) throwPdfiumError(mod, "Unable to add image");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (imagePtr) mod._free(imagePtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function addAnnotation(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);
  const annotationType = stringOrDefault(payload.annotationType, "");

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const pageIndex = numberOrDefault(payload.pageIndex, 0);
    let added = 0;
    if (annotationType === "highlight") {
      added = mod.ccall(
        "wasm_pdf_add_highlight_annotation",
        "number",
        ["number", "number", "number", "number", "number", "number", "number"],
        [
          handle,
          pageIndex,
          numberOrDefault(payload.left, 0),
          numberOrDefault(payload.bottom, 0),
          numberOrDefault(payload.right, 0),
          numberOrDefault(payload.top, 0),
          numberOrDefault(payload.rgba, 0x80ffff00),
        ]
      );
    } else if (annotationType === "link") {
      added = mod.ccall(
        "wasm_pdf_add_link_annotation",
        "number",
        ["number", "number", "number", "number", "number", "number", "string"],
        [
          handle,
          pageIndex,
          numberOrDefault(payload.left, 0),
          numberOrDefault(payload.bottom, 0),
          numberOrDefault(payload.right, 0),
          numberOrDefault(payload.top, 0),
          stringOrDefault(payload.uri, ""),
        ]
      );
    } else if (annotationType === "textNote") {
      added = mod.ccall(
        "wasm_pdf_add_text_note_annotation",
        "number",
        ["number", "number", "number", "number", "string", "number"],
        [
          handle,
          pageIndex,
          numberOrDefault(payload.x, 0),
          numberOrDefault(payload.y, 0),
          stringOrDefault(payload.contents, ""),
          numberOrDefault(payload.rgba, 0xffffff00),
        ]
      );
    } else if (annotationType === "rectangle") {
      added = mod.ccall(
        "wasm_pdf_add_rectangle_annotation",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number"],
        [
          handle,
          pageIndex,
          numberOrDefault(payload.left, 0),
          numberOrDefault(payload.bottom, 0),
          numberOrDefault(payload.right, 0),
          numberOrDefault(payload.top, 0),
          numberOrDefault(payload.rgba, 0xffff0000),
          numberOrDefault(payload.borderWidth, 1),
        ]
      );
    } else if (annotationType === "freeText") {
      added = mod.ccall(
        "wasm_pdf_add_freetext_annotation",
        "number",
        ["number", "number", "number", "number", "number", "number", "string", "number", "number", "number", "number"],
        [
          handle,
          pageIndex,
          numberOrDefault(payload.left, 0),
          numberOrDefault(payload.bottom, 0),
          numberOrDefault(payload.right, 0),
          numberOrDefault(payload.top, 0),
          stringOrDefault(payload.contents, ""),
          numberOrDefault(payload.fontSize, 12),
          numberOrDefault(payload.textRgba, 0xff000000),
          numberOrDefault(payload.borderRgba, 0xff000000),
          numberOrDefault(payload.borderWidth, 1),
        ]
      );
    } else {
      throw new PdfiumWorkerError(`Unsupported annotation type: ${annotationType}`, 2);
    }

    if (!added) throwPdfiumError(mod, "Unable to add annotation");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function updateAnnotation(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);
  const updateType = stringOrDefault(payload.updateType, "");

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const pageIndex = numberOrDefault(payload.pageIndex, 0);
    const annotationIndex = numberOrDefault(payload.annotationIndex, -1);
    let updated = 0;
    if (updateType === "rect") {
      updated = mod.ccall(
        "wasm_pdf_set_annotation_rect",
        "number",
        ["number", "number", "number", "number", "number", "number", "number"],
        [
          handle,
          pageIndex,
          annotationIndex,
          numberOrDefault(payload.left, 0),
          numberOrDefault(payload.bottom, 0),
          numberOrDefault(payload.right, 0),
          numberOrDefault(payload.top, 0),
        ]
      );
    } else if (updateType === "color") {
      updated = mod.ccall(
        "wasm_pdf_set_annotation_color",
        "number",
        ["number", "number", "number", "number"],
        [handle, pageIndex, annotationIndex, numberOrDefault(payload.rgba, 0xff000000)]
      );
    } else if (updateType === "text") {
      updated = mod.ccall(
        "wasm_pdf_set_annotation_text",
        "number",
        ["number", "number", "number", "string"],
        [handle, pageIndex, annotationIndex, stringOrDefault(payload.contents, "")]
      );
    } else if (updateType === "uri") {
      updated = mod.ccall(
        "wasm_pdf_set_annotation_uri",
        "number",
        ["number", "number", "number", "string"],
        [handle, pageIndex, annotationIndex, stringOrDefault(payload.uri, "")]
      );
    } else {
      throw new PdfiumWorkerError(`Unsupported annotation update type: ${updateType}`, 2);
    }

    if (!updated) throwPdfiumError(mod, "Unable to update annotation");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function queryAnnotations(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!inputPtr || !outPtrPtr || !outSizePtr) {
      throw new PdfiumWorkerError("Unable to allocate annotation query buffers", 3);
    }
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const pageIndex = numberOrDefault(payload.pageIndex, 0);
    const count = mod.ccall("wasm_pdf_annotation_count", "number", ["number", "number"], [handle, pageIndex]);
    if (count < 0) throwPdfiumError(mod, "Unable to count annotations");

    const annotations = [];
    for (let index = 0; index < count; index += 1) {
      const queried = mod.ccall(
        "wasm_pdf_get_annotation_info",
        "number",
        ["number", "number", "number", "number", "number"],
        [handle, pageIndex, index, outPtrPtr, outSizePtr]
      );
      if (!queried) throwPdfiumError(mod, "Unable to query annotation info");

      outPtr = mod.getValue(outPtrPtr, "i32");
      const outSize = mod.getValue(outSizePtr, "i32");
      if (!outPtr || outSize < 64) throw new PdfiumWorkerError("Annotation info output is invalid", 56);

      annotations.push(parseAnnotationInfo(mod.HEAPU8.slice(outPtr, outPtr + outSize), index));
      mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
      outPtr = 0;
    }

    return { annotations };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function deleteAnnotation(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const deleted = mod.ccall(
      "wasm_pdf_delete_annotation",
      "number",
      ["number", "number", "number"],
      [handle, numberOrDefault(payload.pageIndex, 0), numberOrDefault(payload.annotationIndex, -1)]
    );
    if (!deleted) throwPdfiumError(mod, "Unable to delete annotation");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function renderPage(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);
  const width = numberOrDefault(payload.width, 0);
  const height = numberOrDefault(payload.height, 0);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate render output pointers", 3);

    const rendered = mod.ccall(
      "wasm_pdf_render_page_rgba",
      "number",
      ["number", "number", "number", "number", "number", "number", "number"],
      [
        handle,
        numberOrDefault(payload.pageIndex, 0),
        width,
        height,
        numberOrDefault(payload.flags, 0),
        outPtrPtr,
        outSizePtr,
      ]
    );
    if (!rendered) throwPdfiumError(mod, "Unable to render page");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Rendered page output is empty", 35);

    const rgbaBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { rgbaBytes: rgbaBytes.buffer, width, height };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function renderPageArea(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);
  const width = numberOrDefault(payload.width, 0);
  const height = numberOrDefault(payload.height, 0);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate render output pointers", 3);

    const rendered = mod.ccall(
      "wasm_pdf_render_page_area_rgba",
      "number",
      ["number", "number", "number", "number", "number", "number", "number", "number", "number", "number", "number"],
      [
        handle,
        numberOrDefault(payload.pageIndex, 0),
        numberOrDefault(payload.left, 0),
        numberOrDefault(payload.bottom, 0),
        numberOrDefault(payload.right, 0),
        numberOrDefault(payload.top, 0),
        width,
        height,
        numberOrDefault(payload.flags, 0),
        outPtrPtr,
        outSizePtr,
      ]
    );
    if (!rendered) throwPdfiumError(mod, "Unable to render page area");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Rendered page area output is empty", 35);

    const rgbaBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { rgbaBytes: rgbaBytes.buffer, width, height };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function queryPageObjects(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let typePtr = 0;
  let leftPtr = 0;
  let bottomPtr = 0;
  let rightPtr = 0;
  let topPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    typePtr = mod._malloc(4);
    leftPtr = mod._malloc(8);
    bottomPtr = mod._malloc(8);
    rightPtr = mod._malloc(8);
    topPtr = mod._malloc(8);
    if (!inputPtr || !typePtr || !leftPtr || !bottomPtr || !rightPtr || !topPtr) {
      throw new PdfiumWorkerError("Unable to allocate page object query buffers", 3);
    }
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const pageIndex = numberOrDefault(payload.pageIndex, 0);
    const count = mod.ccall("wasm_pdf_page_object_count", "number", ["number", "number"], [handle, pageIndex]);
    if (count < 0) throwPdfiumError(mod, "Unable to count page objects");

    const objects = [];
    for (let index = 0; index < count; index += 1) {
      const ok = mod.ccall(
        "wasm_pdf_get_page_object_info",
        "number",
        ["number", "number", "number", "number", "number", "number", "number", "number"],
        [handle, pageIndex, index, typePtr, leftPtr, bottomPtr, rightPtr, topPtr]
      );
      if (!ok) throwPdfiumError(mod, "Unable to read page object info");

      objects.push({
        index,
        type: mod.getValue(typePtr, "i32"),
        left: mod.getValue(leftPtr, "double"),
        bottom: mod.getValue(bottomPtr, "double"),
        right: mod.getValue(rightPtr, "double"),
        top: mod.getValue(topPtr, "double"),
      });
    }

    return { objects };
  } finally {
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (typePtr) mod._free(typePtr);
    if (leftPtr) mod._free(leftPtr);
    if (bottomPtr) mod._free(bottomPtr);
    if (rightPtr) mod._free(rightPtr);
    if (topPtr) mod._free(topPtr);
  }
}

async function searchPageText(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate search output pointers", 3);

    const searched = mod.ccall(
      "wasm_pdf_search_page_text",
      "number",
      ["number", "number", "string", "number", "number", "number"],
      [
        handle,
        numberOrDefault(payload.pageIndex, 0),
        stringOrDefault(payload.query, ""),
        numberOrDefault(payload.flags, 0),
        outPtrPtr,
        outSizePtr,
      ]
    );
    if (!searched) throwPdfiumError(mod, "Unable to search page text");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || outSize < 4) throw new PdfiumWorkerError("Search output is invalid", 41);

    const bytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { matches: parseSearchResults(bytes) };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function queryOutline(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate outline output pointers", 3);

    const queried = mod.ccall(
      "wasm_pdf_get_outline",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!queried) throwPdfiumError(mod, "Unable to query outline");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || outSize < 4) throw new PdfiumWorkerError("Outline output is invalid", 52);

    const bytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { outline: parseOutline(bytes) };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function queryDocument(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);
  const includePages = enabledByDefault(payload.includePages);
  const includeMetadata = enabledByDefault(payload.includeMetadata);
  const includeOutlineSummary = enabledByDefault(payload.includeOutlineSummary);
  const includeAttachmentSummary = enabledByDefault(payload.includeAttachmentSummary);
  const metadataKeys = arrayOrDefault(payload.metadataKeys, DEFAULT_METADATA_KEYS);

  let inputPtr = 0;
  let widthPtr = 0;
  let heightPtr = 0;
  let leftPtr = 0;
  let bottomPtr = 0;
  let rightPtr = 0;
  let topPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  function freeOutPtr() {
    if (outPtr) {
      mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
      outPtr = 0;
    }
  }

  function readOutputBytes() {
    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    const bytes = outSize > 0 && outPtr ? mod.HEAPU8.slice(outPtr, outPtr + outSize) : new Uint8Array();
    freeOutPtr();
    return bytes;
  }

  try {
    inputPtr = mod._malloc(inputBytes.length);
    widthPtr = mod._malloc(8);
    heightPtr = mod._malloc(8);
    leftPtr = mod._malloc(8);
    bottomPtr = mod._malloc(8);
    rightPtr = mod._malloc(8);
    topPtr = mod._malloc(8);
    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!inputPtr || !widthPtr || !heightPtr || !leftPtr || !bottomPtr || !rightPtr || !topPtr || !outPtrPtr || !outSizePtr) {
      throw new PdfiumWorkerError("Unable to allocate document query buffers", 3);
    }
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const pageCount = mod.ccall("wasm_pdf_page_count", "number", ["number"], [handle]);
    if (pageCount < 0) throwPdfiumError(mod, "Unable to count pages");

    const permissions = mod.ccall("wasm_pdf_get_permissions", "number", ["number"], [handle]) >>> 0;
    if (lastError(mod) !== 0) throwPdfiumError(mod, "Unable to query permissions");

    const pages = [];
    if (includePages) {
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const gotSize = mod.ccall(
          "wasm_pdf_get_page_size",
          "number",
          ["number", "number", "number", "number"],
          [handle, pageIndex, widthPtr, heightPtr]
        );
        if (!gotSize) throwPdfiumError(mod, "Unable to query page size");

        const rotation = mod.ccall("wasm_pdf_get_page_rotation", "number", ["number", "number"], [handle, pageIndex]);
        if (rotation < 0) throwPdfiumError(mod, "Unable to query page rotation");

        const boxes = {};
        for (const [name, boxType] of PAGE_BOXES) {
          const gotBox = mod.ccall(
            "wasm_pdf_get_page_box",
            "number",
            ["number", "number", "number", "number", "number", "number", "number"],
            [handle, pageIndex, boxType, leftPtr, bottomPtr, rightPtr, topPtr]
          );
          boxes[name] = gotBox
            ? {
                left: mod.getValue(leftPtr, "double"),
                bottom: mod.getValue(bottomPtr, "double"),
                right: mod.getValue(rightPtr, "double"),
                top: mod.getValue(topPtr, "double"),
              }
            : null;
        }

        pages.push({
          index: pageIndex,
          width: mod.getValue(widthPtr, "double"),
          height: mod.getValue(heightPtr, "double"),
          rotation,
          boxes,
        });
      }
    }

    const metadata = {};
    if (includeMetadata) {
      for (const key of metadataKeys) {
        if (typeof key !== "string") continue;
        const gotMetadata = mod.ccall(
          "wasm_pdf_get_metadata",
          "number",
          ["number", "string", "number", "number"],
          [handle, key, outPtrPtr, outSizePtr]
        );
        if (!gotMetadata) {
          metadata[key] = null;
          continue;
        }

        metadata[key] = new TextDecoder("utf-8").decode(readOutputBytes());
      }
    }

    let outlineCount = null;
    if (includeOutlineSummary) {
      const gotOutline = mod.ccall(
        "wasm_pdf_get_outline",
        "number",
        ["number", "number", "number"],
        [handle, outPtrPtr, outSizePtr]
      );
      if (!gotOutline) throwPdfiumError(mod, "Unable to query outline summary");
      outlineCount = countOutlineItems(parseOutline(readOutputBytes()));
    }

    let attachmentCount = null;
    if (includeAttachmentSummary) {
      attachmentCount = mod.ccall("wasm_pdf_attachment_count", "number", ["number"], [handle]);
      if (attachmentCount < 0) throwPdfiumError(mod, "Unable to count attachments");
    }

    return {
      pageCount,
      permissions,
      pages,
      metadata,
      outlineCount,
      hasOutline: outlineCount === null ? null : outlineCount > 0,
      attachmentCount,
      hasAttachments: attachmentCount === null ? null : attachmentCount > 0,
    };
  } finally {
    freeOutPtr();
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (widthPtr) mod._free(widthPtr);
    if (heightPtr) mod._free(heightPtr);
    if (leftPtr) mod._free(leftPtr);
    if (bottomPtr) mod._free(bottomPtr);
    if (rightPtr) mod._free(rightPtr);
    if (topPtr) mod._free(topPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function runPageMutation(payload = {}, mutate) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    mutate(mod, handle);
    return saveDocumentBytes(mod, handle);
  } finally {
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
  }
}

async function insertBlankPage(payload = {}) {
  return runPageMutation(payload, (mod, handle) => {
    const inserted = mod.ccall(
      "wasm_pdf_insert_blank_page",
      "number",
      ["number", "number", "number", "number"],
      [
        handle,
        numberOrDefault(payload.pageIndex, 0),
        numberOrDefault(payload.width, 0),
        numberOrDefault(payload.height, 0),
      ]
    );
    if (!inserted) throwPdfiumError(mod, "Unable to insert blank page");
  });
}

async function deletePage(payload = {}) {
  return runPageMutation(payload, (mod, handle) => {
    const deleted = mod.ccall(
      "wasm_pdf_delete_page",
      "number",
      ["number", "number"],
      [handle, numberOrDefault(payload.pageIndex, -1)]
    );
    if (!deleted) throwPdfiumError(mod, "Unable to delete page");
  });
}

async function setPageRotation(payload = {}) {
  return runPageMutation(payload, (mod, handle) => {
    const updated = mod.ccall(
      "wasm_pdf_set_page_rotation",
      "number",
      ["number", "number", "number"],
      [
        handle,
        numberOrDefault(payload.pageIndex, 0),
        numberOrDefault(payload.rotation, -1),
      ]
    );
    if (!updated) throwPdfiumError(mod, "Unable to set page rotation");
  });
}

async function setPageBox(payload = {}) {
  return runPageMutation(payload, (mod, handle) => {
    const updated = mod.ccall(
      "wasm_pdf_set_page_box",
      "number",
      ["number", "number", "number", "number", "number", "number", "number"],
      [
        handle,
        numberOrDefault(payload.pageIndex, 0),
        numberOrDefault(payload.boxType, 0),
        numberOrDefault(payload.left, 0),
        numberOrDefault(payload.bottom, 0),
        numberOrDefault(payload.right, 0),
        numberOrDefault(payload.top, 0),
      ]
    );
    if (!updated) throwPdfiumError(mod, "Unable to set page box");
  });
}

async function setPageSize(payload = {}) {
  return runPageMutation(payload, (mod, handle) => {
    const updated = mod.ccall(
      "wasm_pdf_set_page_size",
      "number",
      ["number", "number", "number", "number"],
      [
        handle,
        numberOrDefault(payload.pageIndex, 0),
        numberOrDefault(payload.width, 0),
        numberOrDefault(payload.height, 0),
      ]
    );
    if (!updated) throwPdfiumError(mod, "Unable to set page size");
  });
}

async function copyPage(payload = {}) {
  const mod = await getModule();
  const dstBytes = asUint8Array(payload.pdfBytes);
  const srcBytes = payload.sourcePdfBytes === undefined
    ? dstBytes
    : asUint8Array(payload.sourcePdfBytes, "payload.sourcePdfBytes");

  let dstPtr = 0;
  let srcPtr = 0;
  let dstHandle = 0;
  let srcHandle = 0;

  try {
    dstPtr = mod._malloc(dstBytes.length);
    srcPtr = mod._malloc(srcBytes.length);
    if (!dstPtr || !srcPtr) throw new PdfiumWorkerError("Unable to allocate page copy buffers", 3);
    mod.HEAPU8.set(dstBytes, dstPtr);
    mod.HEAPU8.set(srcBytes, srcPtr);

    dstHandle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [dstPtr, dstBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!dstHandle) throwPdfiumError(mod, "Unable to open destination PDF");

    srcHandle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [srcPtr, srcBytes.length, stringOrDefault(payload.sourcePassword, stringOrDefault(payload.password, ""))]
    );
    if (!srcHandle) throwPdfiumError(mod, "Unable to open source PDF");

    const copied = mod.ccall(
      "wasm_pdf_copy_page",
      "number",
      ["number", "number", "number", "number"],
      [
        srcHandle,
        numberOrDefault(payload.sourcePageIndex, 0),
        dstHandle,
        numberOrDefault(payload.destinationPageIndex, 0),
      ]
    );
    if (!copied) throwPdfiumError(mod, "Unable to copy page");

    return saveDocumentBytes(mod, dstHandle);
  } finally {
    if (srcHandle) mod.ccall("wasm_pdf_close", null, ["number"], [srcHandle]);
    if (dstHandle) mod.ccall("wasm_pdf_close", null, ["number"], [dstHandle]);
    if (srcPtr) mod._free(srcPtr);
    if (dstPtr) mod._free(dstPtr);
  }
}

async function importPages(payload = {}) {
  const mod = await getModule();
  const dstBytes = asUint8Array(payload.pdfBytes);
  const srcBytes = payload.sourcePdfBytes === undefined
    ? dstBytes
    : asUint8Array(payload.sourcePdfBytes, "payload.sourcePdfBytes");

  let dstPtr = 0;
  let srcPtr = 0;
  let dstHandle = 0;
  let srcHandle = 0;

  try {
    dstPtr = mod._malloc(dstBytes.length);
    srcPtr = mod._malloc(srcBytes.length);
    if (!dstPtr || !srcPtr) throw new PdfiumWorkerError("Unable to allocate page import buffers", 3);
    mod.HEAPU8.set(dstBytes, dstPtr);
    mod.HEAPU8.set(srcBytes, srcPtr);

    dstHandle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [dstPtr, dstBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!dstHandle) throwPdfiumError(mod, "Unable to open destination PDF");

    srcHandle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [srcPtr, srcBytes.length, stringOrDefault(payload.sourcePassword, stringOrDefault(payload.password, ""))]
    );
    if (!srcHandle) throwPdfiumError(mod, "Unable to open source PDF");

    const imported = mod.ccall(
      "wasm_pdf_import_pages",
      "number",
      ["number", "string", "number", "number"],
      [
        srcHandle,
        stringOrDefault(payload.pageRange, ""),
        dstHandle,
        numberOrDefault(payload.destinationPageIndex, 0),
      ]
    );
    if (!imported) throwPdfiumError(mod, "Unable to import pages");

    return saveDocumentBytes(mod, dstHandle);
  } finally {
    if (srcHandle) mod.ccall("wasm_pdf_close", null, ["number"], [srcHandle]);
    if (dstHandle) mod.ccall("wasm_pdf_close", null, ["number"], [dstHandle]);
    if (srcPtr) mod._free(srcPtr);
    if (dstPtr) mod._free(dstPtr);
  }
}

async function queryAttachments(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!inputPtr || !outPtrPtr || !outSizePtr) {
      throw new PdfiumWorkerError("Unable to allocate attachment query buffers", 3);
    }
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const count = mod.ccall("wasm_pdf_attachment_count", "number", ["number"], [handle]);
    if (count < 0) throwPdfiumError(mod, "Unable to count attachments");

    const attachments = [];
    for (let index = 0; index < count; index += 1) {
      const queried = mod.ccall(
        "wasm_pdf_get_attachment_info",
        "number",
        ["number", "number", "number", "number"],
        [handle, index, outPtrPtr, outSizePtr]
      );
      if (!queried) throwPdfiumError(mod, "Unable to query attachment info");

      outPtr = mod.getValue(outPtrPtr, "i32");
      const outSize = mod.getValue(outSizePtr, "i32");
      if (!outPtr || outSize < 12) throw new PdfiumWorkerError("Attachment info output is invalid", 54);

      const bytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
      attachments.push(parseAttachmentInfo(bytes, index));
      mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
      outPtr = 0;
    }

    return { attachments };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function queryFormFields(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!inputPtr || !outPtrPtr || !outSizePtr) {
      throw new PdfiumWorkerError("Unable to allocate form query buffers", 3);
    }
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const queried = mod.ccall(
      "wasm_pdf_get_form_fields",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!queried) throwPdfiumError(mod, "Unable to query form fields");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || outSize < 4) throw new PdfiumWorkerError("Form field output is invalid", 59);

    return { fields: parseFormFields(mod.HEAPU8.slice(outPtr, outPtr + outSize)) };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function setFormFieldValue(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const updated = mod.ccall(
      "wasm_pdf_set_form_field_value",
      "number",
      ["number", "string", "string"],
      [
        handle,
        stringOrDefault(payload.name, ""),
        stringOrDefault(payload.value, ""),
      ]
    );
    if (!updated) throwPdfiumError(mod, "Unable to set form field value");

    return saveDocumentBytes(mod, handle);
  } finally {
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
  }
}

async function readAttachment(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);
  const attachmentIndex = numberOrDefault(payload.attachmentIndex, -1);

  let inputPtr = 0;
  let infoPtrPtr = 0;
  let infoSizePtr = 0;
  let filePtrPtr = 0;
  let fileSizePtr = 0;
  let infoPtr = 0;
  let filePtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    infoPtrPtr = mod._malloc(4);
    infoSizePtr = mod._malloc(4);
    filePtrPtr = mod._malloc(4);
    fileSizePtr = mod._malloc(4);
    if (!inputPtr || !infoPtrPtr || !infoSizePtr || !filePtrPtr || !fileSizePtr) {
      throw new PdfiumWorkerError("Unable to allocate attachment read buffers", 3);
    }
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const queried = mod.ccall(
      "wasm_pdf_get_attachment_info",
      "number",
      ["number", "number", "number", "number"],
      [handle, attachmentIndex, infoPtrPtr, infoSizePtr]
    );
    if (!queried) throwPdfiumError(mod, "Unable to query attachment info");

    infoPtr = mod.getValue(infoPtrPtr, "i32");
    const infoSize = mod.getValue(infoSizePtr, "i32");
    if (!infoPtr || infoSize < 12) throw new PdfiumWorkerError("Attachment info output is invalid", 54);
    const attachment = parseAttachmentInfo(mod.HEAPU8.slice(infoPtr, infoPtr + infoSize), attachmentIndex);

    const read = mod.ccall(
      "wasm_pdf_get_attachment_file",
      "number",
      ["number", "number", "number", "number"],
      [handle, attachmentIndex, filePtrPtr, fileSizePtr]
    );
    if (!read) throwPdfiumError(mod, "Unable to read attachment file");

    filePtr = mod.getValue(filePtrPtr, "i32");
    const fileSize = mod.getValue(fileSizePtr, "i32");
    const fileBytes = fileSize > 0 ? mod.HEAPU8.slice(filePtr, filePtr + fileSize) : new Uint8Array();
    return { attachment: { ...attachment, fileBytes: fileBytes.buffer } };
  } finally {
    if (infoPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [infoPtr]);
    if (filePtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [filePtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (infoPtrPtr) mod._free(infoPtrPtr);
    if (infoSizePtr) mod._free(infoSizePtr);
    if (filePtrPtr) mod._free(filePtrPtr);
    if (fileSizePtr) mod._free(fileSizePtr);
  }
}

async function addAttachment(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);
  const fileBytes = asUint8Array(payload.fileBytes, "payload.fileBytes");

  let inputPtr = 0;
  let filePtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    filePtr = fileBytes.length > 0 ? mod._malloc(fileBytes.length) : 0;
    if (!inputPtr || (fileBytes.length > 0 && !filePtr)) {
      throw new PdfiumWorkerError("Unable to allocate attachment input buffers", 3);
    }
    mod.HEAPU8.set(inputBytes, inputPtr);
    if (fileBytes.length > 0) mod.HEAPU8.set(fileBytes, filePtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const added = mod.ccall(
      "wasm_pdf_add_attachment",
      "number",
      ["number", "string", "number", "number", "string"],
      [
        handle,
        stringOrDefault(payload.name, ""),
        filePtr,
        fileBytes.length,
        stringOrDefault(payload.mimeType, ""),
      ]
    );
    if (!added) throwPdfiumError(mod, "Unable to add attachment");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (filePtr) mod._free(filePtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function updateAttachment(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);
  const fileBytes = asUint8Array(payload.fileBytes, "payload.fileBytes");

  let inputPtr = 0;
  let filePtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    filePtr = fileBytes.length > 0 ? mod._malloc(fileBytes.length) : 0;
    if (!inputPtr || (fileBytes.length > 0 && !filePtr)) {
      throw new PdfiumWorkerError("Unable to allocate attachment update buffers", 3);
    }
    mod.HEAPU8.set(inputBytes, inputPtr);
    if (fileBytes.length > 0) mod.HEAPU8.set(fileBytes, filePtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const updated = mod.ccall(
      "wasm_pdf_set_attachment_file",
      "number",
      ["number", "number", "number", "number", "string"],
      [
        handle,
        numberOrDefault(payload.attachmentIndex, -1),
        filePtr,
        fileBytes.length,
        stringOrDefault(payload.mimeType, ""),
      ]
    );
    if (!updated) throwPdfiumError(mod, "Unable to update attachment");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (filePtr) mod._free(filePtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function deleteAttachment(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const deleted = mod.ccall(
      "wasm_pdf_delete_attachment",
      "number",
      ["number", "number"],
      [handle, numberOrDefault(payload.attachmentIndex, -1)]
    );
    if (!deleted) throwPdfiumError(mod, "Unable to delete attachment");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function deletePageObject(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const deleted = mod.ccall(
      "wasm_pdf_delete_page_object",
      "number",
      ["number", "number", "number"],
      [handle, numberOrDefault(payload.pageIndex, 0), numberOrDefault(payload.objectIndex, -1)]
    );
    if (!deleted) throwPdfiumError(mod, "Unable to delete page object");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function transformPageObject(payload = {}) {
  const mod = await getModule();
  const inputBytes = asUint8Array(payload.pdfBytes);

  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new PdfiumWorkerError("Unable to allocate input PDF buffer", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const transformed = mod.ccall(
      "wasm_pdf_transform_page_object",
      "number",
      ["number", "number", "number", "number", "number", "number", "number", "number", "number"],
      [
        handle,
        numberOrDefault(payload.pageIndex, 0),
        numberOrDefault(payload.objectIndex, -1),
        numberOrDefault(payload.a, 1),
        numberOrDefault(payload.b, 0),
        numberOrDefault(payload.c, 0),
        numberOrDefault(payload.d, 1),
        numberOrDefault(payload.e, 0),
        numberOrDefault(payload.f, 0),
      ]
    );
    if (!transformed) throwPdfiumError(mod, "Unable to transform page object");

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    if (!outPtrPtr || !outSizePtr) throw new PdfiumWorkerError("Unable to allocate output PDF pointers", 3);

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, outPtrPtr, outSizePtr]
    );
    if (!saved) throwPdfiumError(mod, "Unable to save PDF");

    outPtr = mod.getValue(outPtrPtr, "i32");
    const outSize = mod.getValue(outSizePtr, "i32");
    if (!outPtr || !outSize) throw new PdfiumWorkerError("Saved PDF output is empty", 12);

    const outBytes = mod.HEAPU8.slice(outPtr, outPtr + outSize);
    return { pdfBytes: outBytes.buffer };
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
  }
}

async function handleRequest(message = {}) {
  if (message.type === "addText") {
    return addText(message.payload);
  }
  if (message.type === "addImage") {
    return addImage(message.payload);
  }
  if (message.type === "addAnnotation") {
    return addAnnotation(message.payload);
  }
  if (message.type === "updateAnnotation") {
    return updateAnnotation(message.payload);
  }
  if (message.type === "queryAnnotations") {
    return queryAnnotations(message.payload);
  }
  if (message.type === "deleteAnnotation") {
    return deleteAnnotation(message.payload);
  }
  if (message.type === "renderPage") {
    return renderPage(message.payload);
  }
  if (message.type === "renderPageArea") {
    return renderPageArea(message.payload);
  }
  if (message.type === "queryPageObjects") {
    return queryPageObjects(message.payload);
  }
  if (message.type === "searchPageText") {
    return searchPageText(message.payload);
  }
  if (message.type === "queryOutline") {
    return queryOutline(message.payload);
  }
  if (message.type === "queryDocument") {
    return queryDocument(message.payload);
  }
  if (message.type === "insertBlankPage") {
    return insertBlankPage(message.payload);
  }
  if (message.type === "deletePage") {
    return deletePage(message.payload);
  }
  if (message.type === "copyPage") {
    return copyPage(message.payload);
  }
  if (message.type === "importPages") {
    return importPages(message.payload);
  }
  if (message.type === "setPageRotation") {
    return setPageRotation(message.payload);
  }
  if (message.type === "setPageBox") {
    return setPageBox(message.payload);
  }
  if (message.type === "setPageSize") {
    return setPageSize(message.payload);
  }
  if (message.type === "queryAttachments") {
    return queryAttachments(message.payload);
  }
  if (message.type === "queryFormFields") {
    return queryFormFields(message.payload);
  }
  if (message.type === "setFormFieldValue") {
    return setFormFieldValue(message.payload);
  }
  if (message.type === "readAttachment") {
    return readAttachment(message.payload);
  }
  if (message.type === "addAttachment") {
    return addAttachment(message.payload);
  }
  if (message.type === "updateAttachment") {
    return updateAttachment(message.payload);
  }
  if (message.type === "deleteAttachment") {
    return deleteAttachment(message.payload);
  }
  if (message.type === "deletePageObject") {
    return deletePageObject(message.payload);
  }
  if (message.type === "transformPageObject") {
    return transformPageObject(message.payload);
  }

  throw new PdfiumWorkerError(`Unsupported worker message type: ${message.type}`, 2);
}

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    code: typeof error?.code === "number" ? error.code : 0,
    name: typeof error?.errorName === "string" ? error.errorName : "unknown",
  };
}

function transferablesFor(response) {
  const transferables = [];
  if (response?.pdfBytes instanceof ArrayBuffer) transferables.push(response.pdfBytes);
  if (response?.rgbaBytes instanceof ArrayBuffer) transferables.push(response.rgbaBytes);
  if (response?.attachment?.fileBytes instanceof ArrayBuffer) transferables.push(response.attachment.fileBytes);
  return transferables;
}

self.onmessage = (event) => {
  const message = event.data || {};

  requestQueue = requestQueue
    .then(() => handleRequest(message))
    .then((payload) => {
      const response = { id: message.id, type: message.type, ok: true, payload };
      self.postMessage(response, transferablesFor(payload));
    })
    .catch((error) => {
      self.postMessage({ id: message.id, type: message.type, ok: false, error: serializeError(error) });
    });
};
