#!/usr/bin/env node
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const distDir = path.join(__dirname, '..', 'dist');

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
  const { default: PdfiumWasm } = await import(pathToFileURL(path.join(distDir, 'pdfium.js')));
  const mod = await PdfiumWasm({
    locateFile(file) {
      return path.join(distDir, file);
    },
  });

  const inputBytes = createMinimalPdf();
  let initialized = false;
  let inputPtr = 0;
  let outPtrPtr = 0;
  let outSizePtr = 0;
  let outPtr = 0;
  let handle = 0;
  let invalidTextPtr = 0;
  let widthPtr = 0;
  let heightPtr = 0;

  try {
    assert.equal(mod.ccall('wasm_pdfium_init', 'number', [], []), 1, 'PDFium init failed');
    initialized = true;
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'init should clear last error');

    const invalidOpen = mod.ccall(
      'wasm_pdf_open_from_bytes',
      'number',
      ['number', 'number', 'string'],
      [0, 0, '']
    );
    assert.equal(invalidOpen, 0, 'invalid open should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid open should report invalid argument');

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
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'successful open should clear last error');

    const pageCount = mod.ccall('wasm_pdf_page_count', 'number', ['number'], [handle]);
    assert.equal(pageCount, 1, 'page count should report one page');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'page count should clear last error');

    widthPtr = mod._malloc(8);
    heightPtr = mod._malloc(8);
    assert.notEqual(widthPtr, 0, 'width malloc failed');
    assert.notEqual(heightPtr, 0, 'height malloc failed');

    const gotPageSize = mod.ccall(
      'wasm_pdf_get_page_size',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 0, widthPtr, heightPtr]
    );
    assert.equal(gotPageSize, 1, 'page size should be readable');
    assert.equal(mod.getValue(widthPtr, 'double'), 612, 'page width should match fixture');
    assert.equal(mod.getValue(heightPtr, 'double'), 792, 'page height should match fixture');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'page size should clear last error');

    const invalidPageSize = mod.ccall(
      'wasm_pdf_get_page_size',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 99, widthPtr, heightPtr]
    );
    assert.equal(invalidPageSize, 0, 'invalid page size query should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 6, 'invalid page size should report load page failure');

    const rotation = mod.ccall('wasm_pdf_get_page_rotation', 'number', ['number', 'number'], [handle, 0]);
    assert.equal(rotation, 0, 'fixture page should not be rotated');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'page rotation should clear last error');

    const invalidRotation = mod.ccall('wasm_pdf_get_page_rotation', 'number', ['number', 'number'], [handle, 99]);
    assert.equal(invalidRotation, -1, 'invalid page rotation query should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 6, 'invalid page rotation should report load page failure');

    const permissions = mod.ccall('wasm_pdf_get_permissions', 'number', ['number'], [handle]);
    assert.equal(permissions >>> 0, 0xffffffff, 'unprotected fixture should report full permissions');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'permissions should clear last error');

    const inserted = mod.ccall(
      'wasm_pdf_insert_blank_page',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 1, 300, 400]
    );
    assert.equal(inserted, 1, 'blank page insert should succeed');
    assert.equal(mod.ccall('wasm_pdf_page_count', 'number', ['number'], [handle]), 2, 'insert should add one page');

    const gotInsertedPageSize = mod.ccall(
      'wasm_pdf_get_page_size',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 1, widthPtr, heightPtr]
    );
    assert.equal(gotInsertedPageSize, 1, 'inserted page size should be readable');
    assert.equal(mod.getValue(widthPtr, 'double'), 300, 'inserted page width should match');
    assert.equal(mod.getValue(heightPtr, 'double'), 400, 'inserted page height should match');

    const deleted = mod.ccall('wasm_pdf_delete_page', 'number', ['number', 'number'], [handle, 1]);
    assert.equal(deleted, 1, 'delete page should succeed');
    assert.equal(mod.ccall('wasm_pdf_page_count', 'number', ['number'], [handle]), 1, 'delete should remove one page');

    const invalidDelete = mod.ccall('wasm_pdf_delete_page', 'number', ['number', 'number'], [handle, 99]);
    assert.equal(invalidDelete, 0, 'invalid delete should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid delete should report invalid argument');

    invalidTextPtr = mod._malloc(3);
    assert.notEqual(invalidTextPtr, 0, 'invalid text malloc failed');
    mod.HEAPU8.set([0xc3, 0x28, 0], invalidTextPtr);

    const invalidTextAdded = mod.ccall(
      'wasm_pdf_add_text_page',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, invalidTextPtr, 72, 690, 18, 0xff990000]
    );
    assert.equal(invalidTextAdded, 0, 'malformed UTF-8 text should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 15, 'malformed text should report invalid UTF-8');

    const added = mod.ccall(
      'wasm_pdf_add_text_page',
      'number',
      ['number', 'number', 'string', 'number', 'number', 'number', 'number'],
      [handle, 0, 'Smoke test: cafe accent cafe\u0301, CJK \u4e2d\u6587, emoji \ud83d\ude00', 72, 720, 18, 0xff003366]
    );
    assert.equal(added, 1, 'add text failed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'valid UTF-8 add text should clear last error');

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
    assert.equal(mod.ccall('wasm_pdf_page_count', 'number', ['number'], [reopened]), 1, 'saved PDF page count should remain one');
    assert.equal(mod.ccall('wasm_pdf_get_page_rotation', 'number', ['number', 'number'], [reopened, 0]), 0, 'saved PDF rotation should remain zero');
    mod.ccall('wasm_pdf_close', null, ['number'], [reopened]);

    console.log(`Smoke test passed: ${inputBytes.length} input bytes -> ${outSize} output bytes`);
  } finally {
    if (outPtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [outPtr]);
    if (handle) mod.ccall('wasm_pdf_close', null, ['number'], [handle]);
    if (invalidTextPtr) mod._free(invalidTextPtr);
    if (widthPtr) mod._free(widthPtr);
    if (heightPtr) mod._free(heightPtr);
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
