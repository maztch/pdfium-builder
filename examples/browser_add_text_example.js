import PdfiumWasm from "../dist/pdfium.js";

async function addTextToPdf(inputBytes, text) {
  const mod = await PdfiumWasm();

  let initialized = false;
  let inputPtr = 0;
  let ptrPtr = 0;
  let sizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    initialized = Boolean(mod.ccall("wasm_pdfium_init", "number", [], []));
    if (!initialized) throw new Error("Unable to initialize PDFium");

    inputPtr = mod._malloc(inputBytes.length);
    if (!inputPtr) throw new Error("Unable to allocate input PDF buffer");
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      "wasm_pdf_open_from_bytes",
      "number",
      ["number", "number", "string"],
      [inputPtr, inputBytes.length, ""]
    );

    if (!handle) throw new Error("Unable to open PDF");

    const ok = mod.ccall(
      "wasm_pdf_add_text_page",
      "number",
      ["number", "number", "string", "number", "number", "number", "number"],
      [handle, 0, text, 80, 120, 16, 0xff0066cc]
    );

    if (!ok) throw new Error("Unable to add text");

    ptrPtr = mod._malloc(4);
    sizePtr = mod._malloc(4);
    if (!ptrPtr || !sizePtr) throw new Error("Unable to allocate output PDF pointers");

    const saved = mod.ccall(
      "wasm_pdf_save_copy",
      "number",
      ["number", "number", "number"],
      [handle, ptrPtr, sizePtr]
    );

    if (!saved) throw new Error("Unable to save PDF");

    outPtr = mod.getValue(ptrPtr, "i32");
    const outSize = mod.getValue(sizePtr, "i32");
    if (!outPtr || !outSize) throw new Error("Unable to read saved PDF output");

    return new Uint8Array(mod.HEAPU8.subarray(outPtr, outPtr + outSize));
  } finally {
    if (outPtr) mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
    if (handle) mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (ptrPtr) mod._free(ptrPtr);
    if (sizePtr) mod._free(sizePtr);
    if (initialized) mod.ccall("wasm_pdfium_destroy", null, [], []);
  }
}

export { addTextToPdf };
