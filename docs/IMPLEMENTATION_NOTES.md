# Implementation Notes

These notes explain non-obvious implementation choices in the wrapper.

## UTF-8 To UTF-16

JavaScript strings passed through `ccall` arrive as UTF-8. The wrapper strictly decodes UTF-8 before passing UTF-16 data to PDFium Unicode APIs.

Malformed UTF-8 fails with error code `15` instead of silently replacing bytes. This keeps saved PDFs deterministic and gives callers actionable diagnostics.

## Metadata Writes

PDFium exposes public metadata read APIs, but not equivalent write APIs for all document info keys used here.

The wrapper writes metadata by accessing the PDF `/Info` dictionary through PDFium internals. This is why metadata writes are documented as custom-wrapper behavior rather than plain public PDFium behavior.

## FreeText Annotation Appearance

A FreeText annotation is not reliably visible unless it has a usable default appearance and an appearance stream.

The wrapper:

- Creates a `FPDF_ANNOT_FREETEXT` annotation.
- Sets `Contents`, rect, border color, and border width.
- Ensures the document AcroForm/default font resources exist.
- Writes a FreeText default appearance string with font size and text color.
- Calls PDFium's annotation appearance generator.

If appearance generation fails, callers receive error code `49`.

## Embedded Attachments

Attachment names and file bytes use PDFium's public attachment APIs.

MIME type writes use the embedded file stream `/Subtype` entry through PDFium internals because the public attachment API exposes MIME reads but no MIME setter. Attachment APIs cover document-level embedded files, not file-attachment annotations.

## JPEG Insertion

JPEG insertion uses PDFium's public `FPDFImageObj_LoadJpegFileInline()` API.

The wrapper supplies encoded JPEG bytes through an in-memory `FPDF_FILEACCESS`. The inline API copies the JPEG data into the PDF, so the caller can free the input buffer after the call returns.

PDFium may accept some malformed JPEG-like byte streams at insert time because full image validation can be deferred. Use render validation if you need strict JPEG acceptance checks.

## PNG Insertion

PDFium has a public encoded JPEG insertion API, but no equivalent public encoded PNG insertion API in this build path.

The wrapper implements a small PNG decoder for common web PNGs and then reuses the existing RGBA insertion path.

Supported PNG subset:

- Non-interlaced only.
- 8-bit grayscale, RGB, grayscale-alpha, and RGBA.
- zlib-compressed IDAT data.
- Standard PNG row filters: None, Sub, Up, Average, Paeth.

Unsupported PNGs fail with error code `51`:

- Palette color PNGs.
- Interlaced PNGs.
- 16-bit PNGs.
- Color-key transparency chunks.
- Uncommon ancillary features that require color transforms.

This keeps the wrapper dependency surface small while covering the normal browser-exported PNG path. For full PNG compatibility, decode to RGBA in JavaScript and use `wasm_pdf_add_rgba_image_page` or worker `addImage` with `rgbaBytes`.

## Rendering Output

PDFium render bitmaps are created in BGRA order. The wrapper converts render output to row-major RGBA before returning it to JavaScript.

This makes browser canvas usage straightforward:

```js
const imageData = new ImageData(new Uint8ClampedArray(rgbaBytes), width, height);
```

## Search Result Buffer

The native search API returns a compact binary buffer instead of JSON to keep the C ABI simple:

```text
uint32 matchCount
repeat matchCount:
  int32 startIndex
  int32 charCount
  uint32 rectCount
  repeat rectCount:
    double left
    double bottom
    double right
    double top
```

The worker parses this buffer into plain JS objects.

## Worker Serialization

PDFium has global initialization state and several APIs that mutate document/page state. The worker serializes requests through an internal promise queue so multiple main-thread messages do not interleave native operations.

This is conservative and predictable. If high throughput becomes important, use multiple worker instances with separate PDFium modules.
