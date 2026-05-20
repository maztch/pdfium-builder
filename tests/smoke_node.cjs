#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const distDir = path.join(__dirname, '..', 'dist');

function createMinimalPdf() {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Outlines 5 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Outlines /First 6 0 R /Last 7 0 R /Count 3 >>\nendobj\n',
    '6 0 obj\n<< /Title (Chapter 1) /Parent 5 0 R /Next 7 0 R /First 8 0 R /Last 8 0 R /Count 1 /Dest [3 0 R /XYZ 0 792 0] >>\nendobj\n',
    '7 0 obj\n<< /Title (External link) /Parent 5 0 R /Prev 6 0 R /A << /S /URI /URI (https://example.com) >> >>\nendobj\n',
    '8 0 obj\n<< /Title (Section 1.1) /Parent 6 0 R /Dest [3 0 R /Fit] >>\nendobj\n',
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

function parseOutlineItems(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');
  const items = [];
  let offset = 0;
  const itemCount = view.getUint32(offset, true);
  offset += 4;

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
    const size = readUint32();
    const value = decoder.decode(bytes.subarray(offset, offset + size));
    offset += size;
    return value;
  }

  for (let i = 0; i < itemCount; i += 1) {
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
    items.push({ depth, childCount, title, actionType, pageIndex, viewMode, viewParamCount, viewParams, locationFlags, x, y, zoom, uri, filePath });
  }

  return items;
}

function parseAttachmentInfo(bytes, index) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');
  let offset = 0;

  function readUint32() {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  }

  function readString() {
    const size = readUint32();
    const value = decoder.decode(bytes.subarray(offset, offset + size));
    offset += size;
    return value;
  }

  const name = readString();
  const mimeType = readString();
  const fileSize = view.getInt32(offset, true);
  return { index, name, mimeType, fileSize };
}

function parseAnnotationInfo(bytes, index) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');
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
    const size = readUint32();
    const value = decoder.decode(bytes.subarray(offset, offset + size));
    offset += size;
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
  for (let i = 0; i < quadCount; i += 1) {
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
  let sourceHandle = 0;
  let invalidTextPtr = 0;
  let imagePtr = 0;
  let jpegPtr = 0;
  let pngPtr = 0;
  let metadataPtrPtr = 0;
  let metadataSizePtr = 0;
  let metadataPtr = 0;
  let textPtr = 0;
  let outlinePtr = 0;
  let outlinePtrPtr = 0;
  let outlineSizePtr = 0;
  let attachmentDataPtr = 0;
  let attachmentInfoPtr = 0;
  let attachmentInfoPtrPtr = 0;
  let attachmentInfoSizePtr = 0;
  let attachmentFilePtr = 0;
  let attachmentFilePtrPtr = 0;
  let attachmentFileSizePtr = 0;
  let annotationInfoPtr = 0;
  let annotationInfoPtrPtr = 0;
  let annotationInfoSizePtr = 0;
  let searchPtr = 0;
  let searchPtrPtr = 0;
  let searchSizePtr = 0;
  let renderPtr = 0;
  let renderPtrPtr = 0;
  let renderSizePtr = 0;
  let typePtr = 0;
  let widthPtr = 0;
  let heightPtr = 0;
  let leftPtr = 0;
  let bottomPtr = 0;
  let rightPtr = 0;
  let topPtr = 0;

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

    metadataPtrPtr = mod._malloc(4);
    metadataSizePtr = mod._malloc(4);
    outlinePtrPtr = mod._malloc(4);
    outlineSizePtr = mod._malloc(4);
    attachmentInfoPtrPtr = mod._malloc(4);
    attachmentInfoSizePtr = mod._malloc(4);
    attachmentFilePtrPtr = mod._malloc(4);
    attachmentFileSizePtr = mod._malloc(4);
    annotationInfoPtrPtr = mod._malloc(4);
    annotationInfoSizePtr = mod._malloc(4);
    assert.notEqual(metadataPtrPtr, 0, 'metadata out pointer malloc failed');
    assert.notEqual(metadataSizePtr, 0, 'metadata out size malloc failed');
    assert.notEqual(outlinePtrPtr, 0, 'outline out pointer malloc failed');
    assert.notEqual(outlineSizePtr, 0, 'outline out size malloc failed');
    assert.notEqual(attachmentInfoPtrPtr, 0, 'attachment info out pointer malloc failed');
    assert.notEqual(attachmentInfoSizePtr, 0, 'attachment info out size malloc failed');
    assert.notEqual(attachmentFilePtrPtr, 0, 'attachment file out pointer malloc failed');
    assert.notEqual(attachmentFileSizePtr, 0, 'attachment file out size malloc failed');
    assert.notEqual(annotationInfoPtrPtr, 0, 'annotation info out pointer malloc failed');
    assert.notEqual(annotationInfoSizePtr, 0, 'annotation info out size malloc failed');

    const pageCount = mod.ccall('wasm_pdf_page_count', 'number', ['number'], [handle]);
    assert.equal(pageCount, 1, 'page count should report one page');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'page count should clear last error');

    assert.equal(mod.ccall('wasm_pdf_page_object_count', 'number', ['number', 'number'], [handle, 0]), 0, 'empty fixture should start with zero page objects');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'page object count should clear last error');
    assert.equal(mod.ccall('wasm_pdf_annotation_count', 'number', ['number', 'number'], [handle, 0]), 0, 'empty fixture should start with zero annotations');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'annotation count should clear last error');

    widthPtr = mod._malloc(8);
    heightPtr = mod._malloc(8);
    typePtr = mod._malloc(4);
    leftPtr = mod._malloc(8);
    bottomPtr = mod._malloc(8);
    rightPtr = mod._malloc(8);
    topPtr = mod._malloc(8);
    assert.notEqual(widthPtr, 0, 'width malloc failed');
    assert.notEqual(heightPtr, 0, 'height malloc failed');
    assert.notEqual(typePtr, 0, 'type malloc failed');
    assert.notEqual(leftPtr, 0, 'left malloc failed');
    assert.notEqual(bottomPtr, 0, 'bottom malloc failed');
    assert.notEqual(rightPtr, 0, 'right malloc failed');
    assert.notEqual(topPtr, 0, 'top malloc failed');

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

    const gotMediaBox = mod.ccall(
      'wasm_pdf_get_page_box',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 0, leftPtr, bottomPtr, rightPtr, topPtr]
    );
    assert.equal(gotMediaBox, 1, 'media box should be readable');
    assert.equal(mod.getValue(leftPtr, 'double'), 0, 'media left should match fixture');
    assert.equal(mod.getValue(bottomPtr, 'double'), 0, 'media bottom should match fixture');
    assert.equal(mod.getValue(rightPtr, 'double'), 612, 'media right should match fixture');
    assert.equal(mod.getValue(topPtr, 'double'), 792, 'media top should match fixture');

    const setPageSize = mod.ccall(
      'wasm_pdf_set_page_size',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 0, 420, 540]
    );
    assert.equal(setPageSize, 1, 'set page size should succeed');
    assert.equal(mod.ccall('wasm_pdf_get_page_size', 'number', ['number', 'number', 'number', 'number'], [handle, 0, widthPtr, heightPtr]), 1, 'updated page size should be readable');
    assert.equal(mod.getValue(widthPtr, 'double'), 420, 'updated page width should match');
    assert.equal(mod.getValue(heightPtr, 'double'), 540, 'updated page height should match');

    const setCropBox = mod.ccall(
      'wasm_pdf_set_page_box',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 1, 10, 20, 400, 500]
    );
    assert.equal(setCropBox, 1, 'set crop box should succeed');

    const gotCropBox = mod.ccall(
      'wasm_pdf_get_page_box',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 1, leftPtr, bottomPtr, rightPtr, topPtr]
    );
    assert.equal(gotCropBox, 1, 'crop box should be readable after set');
    assert.equal(mod.getValue(leftPtr, 'double'), 10, 'crop left should match');
    assert.equal(mod.getValue(bottomPtr, 'double'), 20, 'crop bottom should match');
    assert.equal(mod.getValue(rightPtr, 'double'), 400, 'crop right should match');
    assert.equal(mod.getValue(topPtr, 'double'), 500, 'crop top should match');

    const invalidBox = mod.ccall(
      'wasm_pdf_get_page_box',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 99, leftPtr, bottomPtr, rightPtr, topPtr]
    );
    assert.equal(invalidBox, 0, 'invalid box type should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid box type should report invalid argument');

    const setRotation = mod.ccall(
      'wasm_pdf_set_page_rotation',
      'number',
      ['number', 'number', 'number'],
      [handle, 0, 1]
    );
    assert.equal(setRotation, 1, 'set page rotation should succeed');
    assert.equal(mod.ccall('wasm_pdf_get_page_rotation', 'number', ['number', 'number'], [handle, 0]), 1, 'page rotation should update');

    const permissions = mod.ccall('wasm_pdf_get_permissions', 'number', ['number'], [handle]);
    assert.equal(permissions >>> 0, 0xffffffff, 'unprotected fixture should report full permissions');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'permissions should clear last error');

    const metadataTitle = 'Smoke metadata: café 中文 😀';
    const setMetadata = mod.ccall(
      'wasm_pdf_set_metadata',
      'number',
      ['number', 'string', 'string'],
      [handle, 'Title', metadataTitle]
    );
    assert.equal(setMetadata, 1, 'set metadata should succeed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'set metadata should clear last error');

    const gotMetadata = mod.ccall(
      'wasm_pdf_get_metadata',
      'number',
      ['number', 'string', 'number', 'number'],
      [handle, 'Title', metadataPtrPtr, metadataSizePtr]
    );
    assert.equal(gotMetadata, 1, 'get metadata should succeed');
    metadataPtr = mod.getValue(metadataPtrPtr, 'i32');
    const metadataSize = mod.getValue(metadataSizePtr, 'i32');
    assert.notEqual(metadataPtr, 0, 'metadata output pointer should not be null for non-empty title');
    assert.equal(
      Buffer.from(mod.HEAPU8.subarray(metadataPtr, metadataPtr + metadataSize)).toString('utf8'),
      metadataTitle,
      'metadata title should round-trip as UTF-8'
    );
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [metadataPtr]);
    metadataPtr = 0;

    const invalidMetadataKey = mod.ccall(
      'wasm_pdf_get_metadata',
      'number',
      ['number', 'string', 'number', 'number'],
      [handle, 'NotARealMetadataKey', metadataPtrPtr, metadataSizePtr]
    );
    assert.equal(invalidMetadataKey, 0, 'invalid metadata key should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid metadata key should report invalid argument');

    const gotOutline = mod.ccall(
      'wasm_pdf_get_outline',
      'number',
      ['number', 'number', 'number'],
      [handle, outlinePtrPtr, outlineSizePtr]
    );
    assert.equal(gotOutline, 1, 'outline should be readable');
    outlinePtr = mod.getValue(outlinePtrPtr, 'i32');
    const outlineSize = mod.getValue(outlineSizePtr, 'i32');
    assert.notEqual(outlinePtr, 0, 'outline output pointer should not be null');
    const outlineItems = parseOutlineItems(mod.HEAPU8.slice(outlinePtr, outlinePtr + outlineSize));
    assert.equal(outlineItems.length, 3, 'fixture should expose three outline items');
    assert.deepEqual(outlineItems.map((item) => [item.depth, item.title]), [
      [0, 'Chapter 1'],
      [1, 'Section 1.1'],
      [0, 'External link'],
    ], 'outline should preserve depth-first navigation order');
    assert.equal(outlineItems[0].pageIndex, 0, 'first outline item should target page 0');
    assert.equal(outlineItems[0].viewMode, 1, 'first outline item should preserve XYZ view mode');
    assert.equal(outlineItems[0].locationFlags, 3, 'first outline item should expose x/y flags');
    assert.equal(outlineItems[0].x, 0, 'first outline x should match');
    assert.equal(outlineItems[0].y, 792, 'first outline y should match');
    assert.equal(outlineItems[2].actionType, 3, 'external outline item should expose URI action');
    assert.equal(outlineItems[2].uri, 'https://example.com', 'external outline URI should match');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [outlinePtr]);
    outlinePtr = 0;

    const invalidOutline = mod.ccall(
      'wasm_pdf_get_outline',
      'number',
      ['number', 'number', 'number'],
      [handle, 0, outlineSizePtr]
    );
    assert.equal(invalidOutline, 0, 'invalid outline output pointer should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid outline output pointer should report invalid argument');

    assert.equal(mod.ccall('wasm_pdf_attachment_count', 'number', ['number'], [handle]), 0, 'fixture should start with no attachments');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'attachment count should clear last error');

    const attachmentBytes = Buffer.from('hello embedded attachment', 'utf8');
    attachmentDataPtr = mod._malloc(attachmentBytes.length);
    assert.notEqual(attachmentDataPtr, 0, 'attachment data malloc failed');
    mod.HEAPU8.set(attachmentBytes, attachmentDataPtr);

    const invalidAttachment = mod.ccall(
      'wasm_pdf_add_attachment',
      'number',
      ['number', 'string', 'number', 'number', 'string'],
      [handle, '', attachmentDataPtr, attachmentBytes.length, 'text/plain']
    );
    assert.equal(invalidAttachment, 0, 'empty attachment name should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'empty attachment name should report invalid argument');

    const addedAttachment = mod.ccall(
      'wasm_pdf_add_attachment',
      'number',
      ['number', 'string', 'number', 'number', 'string'],
      [handle, 'notes-✓.txt', attachmentDataPtr, attachmentBytes.length, 'text/plain']
    );
    assert.equal(addedAttachment, 1, 'add attachment should succeed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'add attachment should clear last error');
    assert.equal(mod.ccall('wasm_pdf_attachment_count', 'number', ['number'], [handle]), 1, 'attachment count should include added attachment');

    const gotAttachmentInfo = mod.ccall(
      'wasm_pdf_get_attachment_info',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 0, attachmentInfoPtrPtr, attachmentInfoSizePtr]
    );
    assert.equal(gotAttachmentInfo, 1, 'attachment info should be readable');
    attachmentInfoPtr = mod.getValue(attachmentInfoPtrPtr, 'i32');
    const attachmentInfoSize = mod.getValue(attachmentInfoSizePtr, 'i32');
    const attachmentInfo = parseAttachmentInfo(mod.HEAPU8.slice(attachmentInfoPtr, attachmentInfoPtr + attachmentInfoSize), 0);
    assert.equal(attachmentInfo.name, 'notes-✓.txt', 'attachment name should round-trip as UTF-8');
    assert.equal(attachmentInfo.mimeType, 'text/plain', 'attachment MIME type should be readable');
    assert.equal(attachmentInfo.fileSize, attachmentBytes.length, 'attachment file size should match');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [attachmentInfoPtr]);
    attachmentInfoPtr = 0;

    const gotAttachmentFile = mod.ccall(
      'wasm_pdf_get_attachment_file',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 0, attachmentFilePtrPtr, attachmentFileSizePtr]
    );
    assert.equal(gotAttachmentFile, 1, 'attachment file should be readable');
    attachmentFilePtr = mod.getValue(attachmentFilePtrPtr, 'i32');
    const attachmentFileSize = mod.getValue(attachmentFileSizePtr, 'i32');
    assert.equal(attachmentFileSize, attachmentBytes.length, 'attachment file output size should match');
    assert.equal(
      Buffer.from(mod.HEAPU8.subarray(attachmentFilePtr, attachmentFilePtr + attachmentFileSize)).toString('utf8'),
      'hello embedded attachment',
      'attachment bytes should round-trip'
    );
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [attachmentFilePtr]);
    attachmentFilePtr = 0;

    const invalidAttachmentRead = mod.ccall(
      'wasm_pdf_get_attachment_info',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 9, attachmentInfoPtrPtr, attachmentInfoSizePtr]
    );
    assert.equal(invalidAttachmentRead, 0, 'invalid attachment index should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid attachment index should report invalid argument');

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

    sourceHandle = mod.ccall(
      'wasm_pdf_open_from_bytes',
      'number',
      ['number', 'number', 'string'],
      [inputPtr, inputBytes.length, '']
    );
    assert.notEqual(sourceHandle, 0, 'open source PDF failed');

    const copied = mod.ccall(
      'wasm_pdf_copy_page',
      'number',
      ['number', 'number', 'number', 'number'],
      [sourceHandle, 0, handle, 1]
    );
    assert.equal(copied, 1, 'copy page should succeed');
    assert.equal(mod.ccall('wasm_pdf_page_count', 'number', ['number'], [handle]), 2, 'copy should add one page');

    const gotCopiedPageSize = mod.ccall(
      'wasm_pdf_get_page_size',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 1, widthPtr, heightPtr]
    );
    assert.equal(gotCopiedPageSize, 1, 'copied page size should be readable');
    assert.equal(mod.getValue(widthPtr, 'double'), 612, 'copied page width should match source');
    assert.equal(mod.getValue(heightPtr, 'double'), 792, 'copied page height should match source');

    const imported = mod.ccall(
      'wasm_pdf_import_pages',
      'number',
      ['number', 'string', 'number', 'number'],
      [sourceHandle, '1', handle, 2]
    );
    assert.equal(imported, 1, 'import pages should succeed');
    assert.equal(mod.ccall('wasm_pdf_page_count', 'number', ['number'], [handle]), 3, 'import should add one page');

    const invalidImport = mod.ccall(
      'wasm_pdf_import_pages',
      'number',
      ['number', 'string', 'number', 'number'],
      [sourceHandle, '9', handle, 3]
    );
    assert.equal(invalidImport, 0, 'invalid import range should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 19, 'invalid import should report import failure');

    assert.equal(mod.ccall('wasm_pdf_delete_page', 'number', ['number', 'number'], [handle, 2]), 1, 'delete imported page should succeed');
    assert.equal(mod.ccall('wasm_pdf_delete_page', 'number', ['number', 'number'], [handle, 1]), 1, 'delete copied page should succeed');
    assert.equal(mod.ccall('wasm_pdf_page_count', 'number', ['number'], [handle]), 1, 'copy/import cleanup should restore one page');

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

    const imageBytes = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 0, 255,
    ]);
    imagePtr = mod._malloc(imageBytes.length);
    assert.notEqual(imagePtr, 0, 'image malloc failed');
    mod.HEAPU8.set(imageBytes, imagePtr);

    const invalidImage = mod.ccall(
      'wasm_pdf_add_rgba_image_page',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, imagePtr, imageBytes.length - 1, 2, 2, 72, 120, 48, 48]
    );
    assert.equal(invalidImage, 0, 'invalid image size should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid image size should report invalid argument');

    const addedImage = mod.ccall(
      'wasm_pdf_add_rgba_image_page',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, imagePtr, imageBytes.length, 2, 2, 72, 120, 48, 48]
    );
    assert.equal(addedImage, 1, 'add RGBA image should succeed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'valid image insert should clear last error');

    const invalidJpegArgs = mod.ccall(
      'wasm_pdf_add_jpeg_image_page',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 0, 0, 130, 120, 48, 48]
    );
    assert.equal(invalidJpegArgs, 0, 'invalid JPEG arguments should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid JPEG arguments should report invalid argument');

    const jpegBytes = fs.readFileSync(
      path.join(__dirname, '..', 'third_party', 'pdfium', 'pdfium', 'testing', 'resources', 'mona_lisa.jpg')
    );
    jpegPtr = mod._malloc(jpegBytes.length);
    assert.notEqual(jpegPtr, 0, 'JPEG malloc failed');
    mod.HEAPU8.set(jpegBytes, jpegPtr);
    const addedJpeg = mod.ccall(
      'wasm_pdf_add_jpeg_image_page',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, jpegPtr, jpegBytes.length, 130, 120, 48, 48]
    );
    assert.equal(addedJpeg, 1, 'add JPEG image should succeed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'valid JPEG insert should clear last error');

    const invalidPng = mod.ccall(
      'wasm_pdf_add_png_image_page',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, invalidTextPtr, 3, 188, 120, 48, 48]
    );
    assert.equal(invalidPng, 0, 'invalid PNG bytes should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 51, 'invalid PNG should report PNG decode failure');

    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64'
    );
    pngPtr = mod._malloc(pngBytes.length);
    assert.notEqual(pngPtr, 0, 'PNG malloc failed');
    mod.HEAPU8.set(pngBytes, pngPtr);
    const addedPng = mod.ccall(
      'wasm_pdf_add_png_image_page',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, pngPtr, pngBytes.length, 188, 120, 48, 48]
    );
    assert.equal(addedPng, 1, 'add PNG image should succeed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'valid PNG insert should clear last error');

    assert.equal(mod.ccall('wasm_pdf_page_object_count', 'number', ['number', 'number'], [handle, 0]), 4, 'text and image inserts should add four page objects');

    const gotTextObject = mod.ccall(
      'wasm_pdf_get_page_object_info',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 0, typePtr, leftPtr, bottomPtr, rightPtr, topPtr]
    );
    assert.equal(gotTextObject, 1, 'text page object info should be readable');
    assert.equal(mod.getValue(typePtr, 'i32'), 1, 'first object should be text');
    assert.ok(mod.getValue(rightPtr, 'double') > mod.getValue(leftPtr, 'double'), 'text object bounds should have width');
    assert.ok(mod.getValue(topPtr, 'double') > mod.getValue(bottomPtr, 'double'), 'text object bounds should have height');

    const gotImageObject = mod.ccall(
      'wasm_pdf_get_page_object_info',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 1, typePtr, leftPtr, bottomPtr, rightPtr, topPtr]
    );
    assert.equal(gotImageObject, 1, 'image page object info should be readable');
    assert.equal(mod.getValue(typePtr, 'i32'), 3, 'second object should be image');
    assert.equal(mod.getValue(leftPtr, 'double'), 72, 'image object left should match placement');
    assert.equal(mod.getValue(bottomPtr, 'double'), 120, 'image object bottom should match placement');
    assert.equal(mod.getValue(rightPtr, 'double'), 120, 'image object right should match placement');
    assert.equal(mod.getValue(topPtr, 'double'), 168, 'image object top should match placement');

    const invalidTransform = mod.ccall(
      'wasm_pdf_transform_page_object',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 1, 0, 0, 0, 0, 0, 0]
    );
    assert.equal(invalidTransform, 0, 'singular object transform should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'singular object transform should report invalid argument');

    const transformedImage = mod.ccall(
      'wasm_pdf_transform_page_object',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 1, 1, 0, 0, 1, 10, 20]
    );
    assert.equal(transformedImage, 1, 'translate page object should succeed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'valid object transform should clear last error');

    const gotTransformedImageObject = mod.ccall(
      'wasm_pdf_get_page_object_info',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 1, typePtr, leftPtr, bottomPtr, rightPtr, topPtr]
    );
    assert.equal(gotTransformedImageObject, 1, 'transformed image page object info should be readable');
    assert.equal(mod.getValue(leftPtr, 'double'), 82, 'transformed image object left should move');
    assert.equal(mod.getValue(bottomPtr, 'double'), 140, 'transformed image object bottom should move');
    assert.equal(mod.getValue(rightPtr, 'double'), 130, 'transformed image object right should move');
    assert.equal(mod.getValue(topPtr, 'double'), 188, 'transformed image object top should move');

    const invalidObjectInfo = mod.ccall(
      'wasm_pdf_get_page_object_info',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 99, typePtr, leftPtr, bottomPtr, rightPtr, topPtr]
    );
    assert.equal(invalidObjectInfo, 0, 'invalid page object index should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid page object index should report invalid argument');

    const deletedObject = mod.ccall(
      'wasm_pdf_delete_page_object',
      'number',
      ['number', 'number', 'number'],
      [handle, 0, 1]
    );
    assert.equal(deletedObject, 1, 'delete page object should succeed');
    assert.equal(mod.ccall('wasm_pdf_page_object_count', 'number', ['number', 'number'], [handle, 0]), 3, 'delete page object should remove one object');

    const invalidLink = mod.ccall(
      'wasm_pdf_add_link_annotation',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'string'],
      [handle, 0, 72, 220, 180, 240, 'https://example.com/café']
    );
    assert.equal(invalidLink, 0, 'non-ASCII link URI should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'non-ASCII link URI should report invalid argument');

    const highlightAnnotation = mod.ccall(
      'wasm_pdf_add_highlight_annotation',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 72, 700, 260, 735, 0x80ffff00]
    );
    assert.equal(highlightAnnotation, 1, 'highlight annotation should succeed');

    const linkAnnotation = mod.ccall(
      'wasm_pdf_add_link_annotation',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'string'],
      [handle, 0, 72, 650, 220, 680, 'https://example.com']
    );
    assert.equal(linkAnnotation, 1, 'link annotation should succeed');

    const invalidNote = mod.ccall(
      'wasm_pdf_add_text_note_annotation',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 250, 240, invalidTextPtr, 0xffffff00]
    );
    assert.equal(invalidNote, 0, 'malformed UTF-8 note should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 15, 'malformed note should report invalid UTF-8');

    const noteAnnotation = mod.ccall(
      'wasm_pdf_add_text_note_annotation',
      'number',
      ['number', 'number', 'number', 'number', 'string', 'number'],
      [handle, 0, 250, 240, 'Reviewer note: café 中文', 0xffffff00]
    );
    assert.equal(noteAnnotation, 1, 'text note annotation should succeed');

    const rectangleAnnotation = mod.ccall(
      'wasm_pdf_add_rectangle_annotation',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 240, 120, 360, 190, 0xffff0000, 2]
    );
    assert.equal(rectangleAnnotation, 1, 'rectangle annotation should succeed');

    const invalidFreeText = mod.ccall(
      'wasm_pdf_add_freetext_annotation',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 72, 300, 260, 360, invalidTextPtr, 12, 0xff000000, 0xff003366, 1]
    );
    assert.equal(invalidFreeText, 0, 'malformed UTF-8 FreeText should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 15, 'malformed FreeText should report invalid UTF-8');

    const freeTextAnnotation = mod.ccall(
      'wasm_pdf_add_freetext_annotation',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'string', 'number', 'number', 'number', 'number'],
      [handle, 0, 72, 300, 300, 360, 'Visible FreeText: café 中文', 14, 0xff003366, 0xff003366, 1]
    );
    assert.equal(freeTextAnnotation, 1, 'FreeText annotation should succeed');

    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'valid annotation insert should clear last error');
    assert.equal(mod.ccall('wasm_pdf_annotation_count', 'number', ['number', 'number'], [handle, 0]), 5, 'annotation inserts should add five annotations');

    const updatedHighlightRect = mod.ccall(
      'wasm_pdf_set_annotation_rect',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [handle, 0, 0, 80, 705, 270, 740]
    );
    assert.equal(updatedHighlightRect, 1, 'update highlight rect should succeed');

    const updatedHighlightColor = mod.ccall(
      'wasm_pdf_set_annotation_color',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 0, 0, 0x8000ff00]
    );
    assert.equal(updatedHighlightColor, 1, 'update highlight color should succeed');

    const invalidAnnotationText = mod.ccall(
      'wasm_pdf_set_annotation_text',
      'number',
      ['number', 'number', 'number', 'number'],
      [handle, 0, 2, invalidTextPtr]
    );
    assert.equal(invalidAnnotationText, 0, 'malformed annotation text update should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 15, 'malformed annotation text update should report invalid UTF-8');

    const updatedNoteText = mod.ccall(
      'wasm_pdf_set_annotation_text',
      'number',
      ['number', 'number', 'number', 'string'],
      [handle, 0, 2, 'Updated note: café 中文']
    );
    assert.equal(updatedNoteText, 1, 'update note text should succeed');

    const invalidUriUpdate = mod.ccall(
      'wasm_pdf_set_annotation_uri',
      'number',
      ['number', 'number', 'number', 'string'],
      [handle, 0, 1, 'https://example.com/café']
    );
    assert.equal(invalidUriUpdate, 0, 'non-ASCII annotation URI update should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'non-ASCII annotation URI update should report invalid argument');

    const updatedLinkUri = mod.ccall(
      'wasm_pdf_set_annotation_uri',
      'number',
      ['number', 'number', 'number', 'string'],
      [handle, 0, 1, 'https://example.org/updated']
    );
    assert.equal(updatedLinkUri, 1, 'update link URI should succeed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'valid annotation updates should clear last error');
    assert.equal(mod.ccall('wasm_pdf_annotation_count', 'number', ['number', 'number'], [handle, 0]), 5, 'annotation updates should not change annotation count');

    const gotHighlightInfo = mod.ccall(
      'wasm_pdf_get_annotation_info',
      'number',
      ['number', 'number', 'number', 'number', 'number'],
      [handle, 0, 0, annotationInfoPtrPtr, annotationInfoSizePtr]
    );
    assert.equal(gotHighlightInfo, 1, 'highlight annotation info should be readable');
    annotationInfoPtr = mod.getValue(annotationInfoPtrPtr, 'i32');
    const highlightInfoSize = mod.getValue(annotationInfoSizePtr, 'i32');
    const highlightInfo = parseAnnotationInfo(mod.HEAPU8.slice(annotationInfoPtr, annotationInfoPtr + highlightInfoSize), 0);
    assert.equal(highlightInfo.subtype, 9, 'highlight info subtype should match');
    assert.equal(highlightInfo.rect.left, 80, 'updated highlight left should be readable');
    assert.equal(highlightInfo.rect.bottom, 705, 'updated highlight bottom should be readable');
    assert.equal(highlightInfo.rect.right, 270, 'updated highlight right should be readable');
    assert.equal(highlightInfo.rect.top, 740, 'updated highlight top should be readable');
    assert.equal(highlightInfo.colorRgba, 0x8000ff00, 'updated highlight color should be readable');
    assert.equal(highlightInfo.quadPoints.length, 1, 'highlight should expose one quadpoint set');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [annotationInfoPtr]);
    annotationInfoPtr = 0;

    const gotLinkInfo = mod.ccall(
      'wasm_pdf_get_annotation_info',
      'number',
      ['number', 'number', 'number', 'number', 'number'],
      [handle, 0, 1, annotationInfoPtrPtr, annotationInfoSizePtr]
    );
    assert.equal(gotLinkInfo, 1, 'link annotation info should be readable');
    annotationInfoPtr = mod.getValue(annotationInfoPtrPtr, 'i32');
    const linkInfoSize = mod.getValue(annotationInfoSizePtr, 'i32');
    const linkInfo = parseAnnotationInfo(mod.HEAPU8.slice(annotationInfoPtr, annotationInfoPtr + linkInfoSize), 1);
    assert.equal(linkInfo.subtype, 2, 'link info subtype should match');
    assert.equal(linkInfo.uri, 'https://example.org/updated', 'updated link URI should be readable');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [annotationInfoPtr]);
    annotationInfoPtr = 0;

    const gotNoteInfo = mod.ccall(
      'wasm_pdf_get_annotation_info',
      'number',
      ['number', 'number', 'number', 'number', 'number'],
      [handle, 0, 2, annotationInfoPtrPtr, annotationInfoSizePtr]
    );
    assert.equal(gotNoteInfo, 1, 'text note annotation info should be readable');
    annotationInfoPtr = mod.getValue(annotationInfoPtrPtr, 'i32');
    const noteInfoSize = mod.getValue(annotationInfoSizePtr, 'i32');
    const noteInfo = parseAnnotationInfo(mod.HEAPU8.slice(annotationInfoPtr, annotationInfoPtr + noteInfoSize), 2);
    assert.equal(noteInfo.subtype, 1, 'text note info subtype should match');
    assert.equal(noteInfo.contents, 'Updated note: café 中文', 'updated note text should be readable');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [annotationInfoPtr]);
    annotationInfoPtr = 0;

    let rectangleAnnotationIndex = -1;
    let freeTextAnnotationIndex = -1;
    for (let index = 0; index < 5; index += 1) {
      const gotAnnotationInfo = mod.ccall(
        'wasm_pdf_get_annotation_info',
        'number',
        ['number', 'number', 'number', 'number', 'number'],
        [handle, 0, index, annotationInfoPtrPtr, annotationInfoSizePtr]
      );
      assert.equal(gotAnnotationInfo, 1, `annotation ${index} info should be readable`);
      annotationInfoPtr = mod.getValue(annotationInfoPtrPtr, 'i32');
      const annotationInfoSize = mod.getValue(annotationInfoSizePtr, 'i32');
      const annotationInfo = parseAnnotationInfo(mod.HEAPU8.slice(annotationInfoPtr, annotationInfoPtr + annotationInfoSize), index);
      if (annotationInfo.subtype === 5) rectangleAnnotationIndex = index;
      if (annotationInfo.subtype === 3) freeTextAnnotationIndex = index;
      mod.ccall('wasm_pdf_free_buffer', null, ['number'], [annotationInfoPtr]);
      annotationInfoPtr = 0;
    }
    assert.notEqual(rectangleAnnotationIndex, -1, 'rectangle annotation should be discoverable by subtype');
    assert.notEqual(freeTextAnnotationIndex, -1, 'FreeText annotation should remain discoverable before deletion');

    const invalidAnnotationInfo = mod.ccall(
      'wasm_pdf_get_annotation_info',
      'number',
      ['number', 'number', 'number', 'number', 'number'],
      [handle, 0, 99, annotationInfoPtrPtr, annotationInfoSizePtr]
    );
    assert.equal(invalidAnnotationInfo, 0, 'invalid annotation info index should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid annotation info index should report invalid argument');

    const deletedAnnotation = mod.ccall(
      'wasm_pdf_delete_annotation',
      'number',
      ['number', 'number', 'number'],
      [handle, 0, 0]
    );
    assert.equal(deletedAnnotation, 1, 'delete annotation should succeed');
    assert.equal(mod.ccall('wasm_pdf_annotation_count', 'number', ['number', 'number'], [handle, 0]), 4, 'delete annotation should remove one annotation');

    const invalidAnnotationDelete = mod.ccall(
      'wasm_pdf_delete_annotation',
      'number',
      ['number', 'number', 'number'],
      [handle, 0, 99]
    );
    assert.equal(invalidAnnotationDelete, 0, 'invalid annotation delete index should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid annotation delete index should report invalid argument');

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
    assert.equal(mod.ccall('wasm_pdf_page_object_count', 'number', ['number', 'number'], [reopened, 0]), 3, 'saved PDF should persist deleted object state');
    assert.equal(mod.ccall('wasm_pdf_annotation_count', 'number', ['number', 'number'], [reopened, 0]), 4, 'saved PDF should persist deleted annotation state');
    assert.equal(mod.ccall('wasm_pdf_get_page_rotation', 'number', ['number', 'number'], [reopened, 0]), 1, 'saved PDF rotation should persist');
    assert.equal(mod.ccall(
      'wasm_pdf_get_page_box',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [reopened, 0, 0, leftPtr, bottomPtr, rightPtr, topPtr]
    ), 1, 'saved PDF media box should be readable');
    assert.equal(mod.getValue(leftPtr, 'double'), 0, 'saved media left should persist');
    assert.equal(mod.getValue(bottomPtr, 'double'), 0, 'saved media bottom should persist');
    assert.equal(mod.getValue(rightPtr, 'double'), 420, 'saved media right should persist');
    assert.equal(mod.getValue(topPtr, 'double'), 540, 'saved media top should persist');
    assert.equal(mod.ccall(
      'wasm_pdf_get_page_text',
      'number',
      ['number', 'number', 'number', 'number'],
      [reopened, 0, metadataPtrPtr, metadataSizePtr]
    ), 1, 'saved PDF page text should be extractable');
    textPtr = mod.getValue(metadataPtrPtr, 'i32');
    const textSize = mod.getValue(metadataSizePtr, 'i32');
    assert.notEqual(textPtr, 0, 'page text output pointer should not be null');
    const extractedText = Buffer.from(mod.HEAPU8.subarray(textPtr, textPtr + textSize)).toString('utf8');
    assert.match(extractedText, /Smoke test/, 'extracted text should contain added text');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [textPtr]);
    textPtr = 0;

    const invalidTextExtraction = mod.ccall(
      'wasm_pdf_get_page_text',
      'number',
      ['number', 'number', 'number', 'number'],
      [reopened, 99, metadataPtrPtr, metadataSizePtr]
    );
    assert.equal(invalidTextExtraction, 0, 'invalid page text extraction should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 6, 'invalid page text extraction should report load page failure');

    renderPtrPtr = mod._malloc(4);
    renderSizePtr = mod._malloc(4);
    searchPtrPtr = mod._malloc(4);
    searchSizePtr = mod._malloc(4);
    assert.notEqual(renderPtrPtr, 0, 'render out pointer malloc failed');
    assert.notEqual(renderSizePtr, 0, 'render out size malloc failed');
    assert.notEqual(searchPtrPtr, 0, 'search out pointer malloc failed');
    assert.notEqual(searchSizePtr, 0, 'search out size malloc failed');

    const invalidSearchPtr = invalidTextPtr;
    const invalidSearch = mod.ccall(
      'wasm_pdf_search_page_text',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number'],
      [reopened, 0, invalidSearchPtr, 0, searchPtrPtr, searchSizePtr]
    );
    assert.equal(invalidSearch, 0, 'malformed UTF-8 search should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 15, 'malformed search should report invalid UTF-8');

    const foundText = mod.ccall(
      'wasm_pdf_search_page_text',
      'number',
      ['number', 'number', 'string', 'number', 'number', 'number'],
      [reopened, 0, 'Smoke', 0, searchPtrPtr, searchSizePtr]
    );
    assert.equal(foundText, 1, 'search page text should succeed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'search page text should clear last error');
    searchPtr = mod.getValue(searchPtrPtr, 'i32');
    const searchSize = mod.getValue(searchSizePtr, 'i32');
    assert.ok(searchSize >= 48, 'search result should contain match header and at least one rect');
    const searchView = new DataView(mod.HEAPU8.buffer, searchPtr, searchSize);
    assert.equal(searchView.getUint32(0, true), 1, 'search should find one Smoke match');
    assert.ok(searchView.getInt32(4, true) >= 0, 'search match start index should be non-negative');
    assert.equal(searchView.getInt32(8, true), 5, 'search match length should match query length');
    assert.ok(searchView.getUint32(12, true) >= 1, 'search match should include at least one rectangle');
    const searchLeft = searchView.getFloat64(16, true);
    const searchBottom = searchView.getFloat64(24, true);
    const searchRight = searchView.getFloat64(32, true);
    const searchTop = searchView.getFloat64(40, true);
    assert.ok(searchRight > searchLeft, 'search rectangle should have width');
    assert.ok(searchTop > searchBottom, 'search rectangle should have height');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [searchPtr]);
    searchPtr = 0;

    const missingText = mod.ccall(
      'wasm_pdf_search_page_text',
      'number',
      ['number', 'number', 'string', 'number', 'number', 'number'],
      [reopened, 0, 'not-present-in-fixture', 0, searchPtrPtr, searchSizePtr]
    );
    assert.equal(missingText, 1, 'missing text search should still succeed');
    searchPtr = mod.getValue(searchPtrPtr, 'i32');
    const missingSearchSize = mod.getValue(searchSizePtr, 'i32');
    assert.equal(missingSearchSize, 4, 'missing search result should only include match count');
    assert.equal(new DataView(mod.HEAPU8.buffer, searchPtr, missingSearchSize).getUint32(0, true), 0, 'missing search should return zero matches');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [searchPtr]);
    searchPtr = 0;

    const invalidRender = mod.ccall(
      'wasm_pdf_render_page_rgba',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [reopened, 0, 0, 64, 0, renderPtrPtr, renderSizePtr]
    );
    assert.equal(invalidRender, 0, 'invalid render dimensions should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid render dimensions should report invalid argument');

    const rendered = mod.ccall(
      'wasm_pdf_render_page_rgba',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [reopened, 0, 64, 64, 0, renderPtrPtr, renderSizePtr]
    );
    assert.equal(rendered, 1, 'render page should succeed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'render page should clear last error');
    renderPtr = mod.getValue(renderPtrPtr, 'i32');
    const renderSize = mod.getValue(renderSizePtr, 'i32');
    assert.notEqual(renderPtr, 0, 'render output pointer should not be null');
    assert.equal(renderSize, 64 * 64 * 4, 'render output should be RGBA width * height * 4');
    const renderBytes = mod.HEAPU8.subarray(renderPtr, renderPtr + renderSize);
    assert.ok(renderBytes.some((value) => value !== 0), 'render output should contain non-zero pixels');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [renderPtr]);
    renderPtr = 0;

    const invalidAreaRender = mod.ccall(
      'wasm_pdf_render_page_area_rgba',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [reopened, 0, 100, 100, 50, 150, 32, 32, 0, renderPtrPtr, renderSizePtr]
    );
    assert.equal(invalidAreaRender, 0, 'invalid area render rectangle should fail');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 2, 'invalid area render should report invalid argument');

    const renderedArea = mod.ccall(
      'wasm_pdf_render_page_area_rgba',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [reopened, 0, 0, 0, 210, 270, 32, 32, 0, renderPtrPtr, renderSizePtr]
    );
    assert.equal(renderedArea, 1, 'render page area should succeed');
    assert.equal(mod.ccall('wasm_pdf_last_error', 'number', [], []), 0, 'render page area should clear last error');
    renderPtr = mod.getValue(renderPtrPtr, 'i32');
    const renderAreaSize = mod.getValue(renderSizePtr, 'i32');
    assert.notEqual(renderPtr, 0, 'render area output pointer should not be null');
    assert.equal(renderAreaSize, 32 * 32 * 4, 'render area output should be RGBA width * height * 4');
    const renderAreaBytes = mod.HEAPU8.subarray(renderPtr, renderPtr + renderAreaSize);
    assert.ok(renderAreaBytes.some((value) => value !== 0), 'render area output should contain non-zero pixels');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [renderPtr]);
    renderPtr = 0;

    const renderedFreeTextArea = mod.ccall(
      'wasm_pdf_render_page_area_rgba',
      'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [reopened, 0, 70, 295, 305, 365, 64, 32, 0x01, renderPtrPtr, renderSizePtr]
    );
    assert.equal(renderedFreeTextArea, 1, 'render FreeText area should succeed');
    renderPtr = mod.getValue(renderPtrPtr, 'i32');
    const renderFreeTextSize = mod.getValue(renderSizePtr, 'i32');
    assert.notEqual(renderPtr, 0, 'render FreeText output pointer should not be null');
    assert.equal(renderFreeTextSize, 64 * 32 * 4, 'render FreeText output should be RGBA width * height * 4');
    const renderFreeTextBytes = mod.HEAPU8.subarray(renderPtr, renderPtr + renderFreeTextSize);
    assert.ok(
      renderFreeTextBytes.some((value, index) => index % 4 !== 3 && value !== 255),
      'render FreeText area should contain visible non-white annotation pixels'
    );
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [renderPtr]);
    renderPtr = 0;

    assert.equal(mod.ccall(
      'wasm_pdf_get_metadata',
      'number',
      ['number', 'string', 'number', 'number'],
      [reopened, 'Title', metadataPtrPtr, metadataSizePtr]
    ), 1, 'saved PDF metadata title should be readable');
    metadataPtr = mod.getValue(metadataPtrPtr, 'i32');
    const savedMetadataSize = mod.getValue(metadataSizePtr, 'i32');
    assert.notEqual(metadataPtr, 0, 'saved metadata output pointer should not be null');
    assert.equal(
      Buffer.from(mod.HEAPU8.subarray(metadataPtr, metadataPtr + savedMetadataSize)).toString('utf8'),
      metadataTitle,
      'saved metadata title should persist'
    );
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [metadataPtr]);
    metadataPtr = 0;

    assert.equal(mod.ccall(
      'wasm_pdf_get_outline',
      'number',
      ['number', 'number', 'number'],
      [reopened, outlinePtrPtr, outlineSizePtr]
    ), 1, 'saved PDF outline should be readable');
    outlinePtr = mod.getValue(outlinePtrPtr, 'i32');
    const savedOutlineSize = mod.getValue(outlineSizePtr, 'i32');
    const savedOutlineItems = parseOutlineItems(mod.HEAPU8.slice(outlinePtr, outlinePtr + savedOutlineSize));
    assert.equal(savedOutlineItems.length, 3, 'saved PDF outline should persist');
    assert.equal(savedOutlineItems[1].title, 'Section 1.1', 'saved nested outline title should persist');
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [outlinePtr]);
    outlinePtr = 0;

    assert.equal(mod.ccall('wasm_pdf_attachment_count', 'number', ['number'], [reopened]), 1, 'saved PDF attachment count should persist');
    assert.equal(mod.ccall(
      'wasm_pdf_get_attachment_file',
      'number',
      ['number', 'number', 'number', 'number'],
      [reopened, 0, attachmentFilePtrPtr, attachmentFileSizePtr]
    ), 1, 'saved PDF attachment file should be readable');
    attachmentFilePtr = mod.getValue(attachmentFilePtrPtr, 'i32');
    const savedAttachmentFileSize = mod.getValue(attachmentFileSizePtr, 'i32');
    assert.equal(savedAttachmentFileSize, attachmentBytes.length, 'saved attachment file size should match');
    assert.equal(
      Buffer.from(mod.HEAPU8.subarray(attachmentFilePtr, attachmentFilePtr + savedAttachmentFileSize)).toString('utf8'),
      'hello embedded attachment',
      'saved attachment bytes should persist'
    );
    mod.ccall('wasm_pdf_free_buffer', null, ['number'], [attachmentFilePtr]);
    attachmentFilePtr = 0;
    mod.ccall('wasm_pdf_close', null, ['number'], [reopened]);

    console.log(`Smoke test passed: ${inputBytes.length} input bytes -> ${outSize} output bytes`);
  } finally {
    if (searchPtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [searchPtr]);
    if (renderPtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [renderPtr]);
    if (textPtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [textPtr]);
    if (outlinePtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [outlinePtr]);
    if (attachmentInfoPtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [attachmentInfoPtr]);
    if (attachmentFilePtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [attachmentFilePtr]);
    if (annotationInfoPtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [annotationInfoPtr]);
    if (metadataPtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [metadataPtr]);
    if (outPtr) mod.ccall('wasm_pdf_free_buffer', null, ['number'], [outPtr]);
    if (sourceHandle) mod.ccall('wasm_pdf_close', null, ['number'], [sourceHandle]);
    if (handle) mod.ccall('wasm_pdf_close', null, ['number'], [handle]);
    if (invalidTextPtr) mod._free(invalidTextPtr);
    if (imagePtr) mod._free(imagePtr);
    if (jpegPtr) mod._free(jpegPtr);
    if (pngPtr) mod._free(pngPtr);
    if (attachmentDataPtr) mod._free(attachmentDataPtr);
    if (typePtr) mod._free(typePtr);
    if (widthPtr) mod._free(widthPtr);
    if (heightPtr) mod._free(heightPtr);
    if (leftPtr) mod._free(leftPtr);
    if (bottomPtr) mod._free(bottomPtr);
    if (rightPtr) mod._free(rightPtr);
    if (topPtr) mod._free(topPtr);
    if (metadataPtrPtr) mod._free(metadataPtrPtr);
    if (metadataSizePtr) mod._free(metadataSizePtr);
    if (outlinePtrPtr) mod._free(outlinePtrPtr);
    if (outlineSizePtr) mod._free(outlineSizePtr);
    if (attachmentInfoPtrPtr) mod._free(attachmentInfoPtrPtr);
    if (attachmentInfoSizePtr) mod._free(attachmentInfoSizePtr);
    if (attachmentFilePtrPtr) mod._free(attachmentFilePtrPtr);
    if (attachmentFileSizePtr) mod._free(attachmentFileSizePtr);
    if (annotationInfoPtrPtr) mod._free(annotationInfoPtrPtr);
    if (annotationInfoSizePtr) mod._free(annotationInfoSizePtr);
    if (searchPtrPtr) mod._free(searchPtrPtr);
    if (searchSizePtr) mod._free(searchSizePtr);
    if (renderPtrPtr) mod._free(renderPtrPtr);
    if (renderSizePtr) mod._free(renderSizePtr);
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
