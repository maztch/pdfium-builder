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
  const rgbaBytes = asUint8Array(payload.rgbaBytes, "payload.rgbaBytes");

  let inputPtr = 0;
  let imagePtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    inputPtr = mod._malloc(inputBytes.length);
    imagePtr = mod._malloc(rgbaBytes.length);
    if (!inputPtr || !imagePtr) throw new PdfiumWorkerError("Unable to allocate worker input buffers", 3);
    mod.HEAPU8.set(inputBytes, inputPtr);
    mod.HEAPU8.set(rgbaBytes, imagePtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, stringOrDefault(payload.password, "")]
    );
    if (!handle) throwPdfiumError(mod, "Unable to open PDF");

    const added = mod.ccall(
      "wasm_pdf_add_rgba_image_page",
      "number",
      ["number", "number", "number", "number", "number", "number", "number", "number", "number", "number"],
      [
        handle,
        numberOrDefault(payload.pageIndex, 0),
        imagePtr,
        rgbaBytes.length,
        numberOrDefault(payload.imageWidth, 0),
        numberOrDefault(payload.imageHeight, 0),
        numberOrDefault(payload.x, 0),
        numberOrDefault(payload.y, 0),
        numberOrDefault(payload.displayWidth, 0),
        numberOrDefault(payload.displayHeight, 0),
      ]
    );
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
