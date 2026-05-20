/* global PdfiumWasm, importScripts */

importScripts("../dist/pdfium.js");

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
  20: "pdfium_unknown",
  21: "pdfium_file",
  22: "pdfium_format",
  23: "pdfium_password",
  24: "pdfium_security",
  25: "pdfium_page",
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

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  throw new PdfiumWorkerError("payload.pdfBytes must be an ArrayBuffer or typed array", 2);
}

function numberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" ? value : fallback;
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

async function handleRequest(message = {}) {
  if (message.type === "addText") {
    return addText(message.payload);
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
  return response?.pdfBytes instanceof ArrayBuffer ? [response.pdfBytes] : [];
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
