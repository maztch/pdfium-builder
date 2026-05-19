import PdfiumWasm from "../dist/pdfium.js";

async function addTextToPdf(inputBytes, text) {
  const mod = await PdfiumWasm();

  mod.ccall("wasm_pdfium_init", "number", [], []);

  const inputPtr = mod._malloc(inputBytes.length);
  mod.HEAPU8.set(inputBytes, inputPtr);

  const handle = mod.ccall(
    "wasm_pdf_open_from_bytes",
    "number",
    ["number", "number", "string"],
    [inputPtr, inputBytes.length, ""]
  );

  if (!handle) {
    mod._free(inputPtr);
    throw new Error("Unable to open PDF");
  }

  const ok = mod.ccall(
    "wasm_pdf_add_text_page",
    "number",
    ["number", "number", "string", "number", "number", "number", "number"],
    [handle, 0, text, 80, 120, 16, 0xff0066cc]
  );

  if (!ok) {
    mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    mod._free(inputPtr);
    throw new Error("Unable to add text");
  }

  const ptrPtr = mod._malloc(4);
  const sizePtr = mod._malloc(4);

  const saved = mod.ccall(
    "wasm_pdf_save_copy",
    "number",
    ["number", "number", "number"],
    [handle, ptrPtr, sizePtr]
  );

  if (!saved) {
    mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
    mod._free(inputPtr);
    mod._free(ptrPtr);
    mod._free(sizePtr);
    throw new Error("Unable to save PDF");
  }

  const outPtr = mod.getValue(ptrPtr, "i32");
  const outSize = mod.getValue(sizePtr, "i32");
  const outBytes = new Uint8Array(mod.HEAPU8.subarray(outPtr, outPtr + outSize));

  mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
  mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
  mod.ccall("wasm_pdfium_destroy", null, [], []);

  mod._free(inputPtr);
  mod._free(ptrPtr);
  mod._free(sizePtr);

  return outBytes;
}

export { addTextToPdf };
