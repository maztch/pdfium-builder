#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');

const PdfiumWasm = require('../dist/pdfium.js');

function createMinimalPdf() {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, 'ascii'));
}

async function main() {
  const mod = await PdfiumWasm({
    locateFile(file) {
      return path.join(__dirname, '..', 'dist', file);
    },
  });

  const inputBytes = createMinimalPdf();
  let initialized = false;
  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;

  try {
    assert.equal(mod.ccall('wasm_pdfium_init', 'number', [], []), 1, 'PDFium init failed');
    initialized = true;

    inputPtr = mod._malloc(inputBytes.length);
    assert.notEqual(inputPtr, 0, 'input malloc failed');
    mod.HEAPU8.set(inputBytes, inputPtr);

    handle = mod.ccall(
      'wasm_pdf_open_from_bytes',
      'number',
      ['number', 'number', 'string'],
      [inputPtr, inputBytes.length, '']
    );
    assert.notEqual(handle, 0, 'open input PDF failed');

    const added = mod.ccall(
      'wasm_pdf_add_text_page',
      'number',
      ['number', 'number', 'string', 'number', 'number', 'number', 'number'],
      [handle, 0, 'Smoke test', 72, 720, 18, 0xff003366]
    );
    assert.equal(added, 1, 'add text failed');

    outPtrPtr = mod._malloc(4);
    outSizePtr = mod._malloc(4);
    assert.notEqual(outPtrPtr, 0, 'out pointer malloc failed');
    assert.notEqual(outSizePtr, 0, 'out size malloc failed');

    const saved = mod.ccall(
      'wasm_pdf_save_copy',
      'number',
      ['number', 'number', 'number'],
      [handle, outPtrPtr, outSizePtr]
    );
    assert.equal(saved, 1, 'save PDF failed');

    outPtr = mod.getValue(outPtrPtr, 'i32');
    const outSize = mod.getValue(outSizePtr, 'i32');
    assert.notEqual(outPtr, 0, 'save returned null output pointer');
    assert.ok(outSize > inputBytes.length, `expected output to grow, got ${outSize} <= ${inputBytes.length}`);

    const outBytes = new Uint8Array(mod.HEAPU8.subarray(outPtr, outPtr + outSize));
    assert.equal(Buffer.from(outBytes.subarray(0, 5)).toString('ascii'), '%PDF-', 'output is not a PDF');

    const reopened = mod.ccall(
      'wasm_pdf_open_from_bytes',
      'number',
      ['number', 'number', 'string'],
      [outPtr, outSize, '']
    );
    assert.notEqual(reopened, 0, 'saved PDF cannot be reopened');
    mod.ccall('wasm_pdf_close', null, ['number'], [reopened]);

    console.log(`Smoke test passed: ${inputBytes.length} input bytes -> ${outSize} output bytes`);
  } finally {
    if (outPtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [outPtr]);
    if (handle) mod.ccall('wasm_pdf_close', null, ['number'], [handle]);
    if (inputPtr) mod._free(inputPtr);
    if (outPtrPtr) mod._free(outPtrPtr);
    if (outSizePtr) mod._free(outSizePtr);
    if (initialized) mod.ccall('wasm_pdfium_destroy', null, [], []);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
