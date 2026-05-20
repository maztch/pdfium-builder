# API Reference

The exported API is implemented in `wasm/pdfium_edit_wrapper.cc` and linked through `scripts/build_wrapper_wasm.sh` via `-sEXPORTED_FUNCTIONS`.

All exported wrapper functions use the `wasm_pdf_*` prefix. Most mutation functions return `1` on success and `0` on failure. Query functions document their failure sentinel below. Call `wasm_pdf_last_error()` after a failure for diagnostics.

## Lifecycle

- `wasm_pdf_last_error()`
- `wasm_pdfium_init()`
- `wasm_pdfium_destroy()`
- `wasm_pdf_open_from_bytes(dataPtr, size, password)`
- `wasm_pdf_save_copy(handle, outPtrPtr, outSizePtr)`
- `wasm_pdf_free_buffer(ptr)`
- `wasm_pdf_close(handle)`

## Page queries and geometry

- `wasm_pdf_page_count(handle)` returns a page count, or `-1` on failure.
- `wasm_pdf_get_page_size(handle, pageIndex, widthPtr, heightPtr)` returns `1` and writes doubles. PDFium reports rotation-aware dimensions.
- `wasm_pdf_get_page_rotation(handle, pageIndex)` returns `0`, `1`, `2`, or `3` for 0, 90, 180, or 270 degrees clockwise; `-1` on failure.
- `wasm_pdf_set_page_rotation(handle, pageIndex, rotation)` sets rotation. `rotation` must be `0`, `1`, `2`, or `3`.
- `wasm_pdf_get_page_box(handle, pageIndex, boxType, leftPtr, bottomPtr, rightPtr, topPtr)` writes a page box rectangle.
- `wasm_pdf_set_page_box(handle, pageIndex, boxType, left, bottom, right, top)` updates a page box. `right > left` and `top > bottom` are required.
- `wasm_pdf_set_page_size(handle, pageIndex, width, height)` sets the media box to `[0, 0, width, height]`.
- `wasm_pdf_get_permissions(handle)` returns PDF permission flags. Unprotected or owner-unlocked documents usually return `0xffffffff`; `0` indicates failure only when paired with a non-zero last error.

Page box types:

- `0`: media box
- `1`: crop box
- `2`: bleed box
- `3`: trim box
- `4`: art box

## Pages

- `wasm_pdf_insert_blank_page(handle, pageIndex, width, height)` inserts a blank page. A `pageIndex` larger than the last page appends.
- `wasm_pdf_delete_page(handle, pageIndex)` deletes a page.
- `wasm_pdf_copy_page(srcHandle, srcPageIndex, dstHandle, dstPageIndex)` imports one source page into the destination document.
- `wasm_pdf_import_pages(srcHandle, pageRange, dstHandle, dstPageIndex)` imports a one-based PDFium range like `"1,3,5-7"`. Pass an empty string to import all pages.

## Metadata

- `wasm_pdf_get_metadata(handle, key, outPtrPtr, outSizePtr)` writes a UTF-8 output buffer. Release non-null output with `wasm_pdf_free_buffer`.
- `wasm_pdf_set_metadata(handle, key, value)` writes metadata. `value` must be valid UTF-8.

Supported metadata keys:

- `Title`
- `Author`
- `Subject`
- `Keywords`
- `Creator`
- `Producer`
- `CreationDate`
- `ModDate`

## Text extraction and search

- `wasm_pdf_get_page_text(handle, pageIndex, outPtrPtr, outSizePtr)` writes extracted page text as UTF-8 bytes. Release with `wasm_pdf_free_buffer`.
- `wasm_pdf_search_page_text(handle, pageIndex, query, flags, outPtrPtr, outSizePtr)` writes a binary match buffer. `query` must be valid UTF-8.

Search flags:

- `1`: match case
- `2`: whole word
- `4`: consecutive

Text search result buffer layout:

- `uint32`: match count
- Per match: `int32 startIndex`, `int32 charCount`, `uint32 rectCount`
- Per rectangle: `double left`, `double bottom`, `double right`, `double top`

## Page content objects

- `wasm_pdf_page_object_count(handle, pageIndex)` returns object count, or `-1` on failure.
- `wasm_pdf_get_page_object_info(handle, pageIndex, objectIndex, typePtr, leftPtr, bottomPtr, rightPtr, topPtr)` writes object type and PDF user-space bounds.
- `wasm_pdf_delete_page_object(handle, pageIndex, objectIndex)` removes a content object and regenerates page content.
- `wasm_pdf_transform_page_object(handle, pageIndex, objectIndex, a, b, c, d, e, f)` applies an affine matrix and regenerates page content.

Page object types:

- `0`: unknown
- `1`: text
- `2`: path
- `3`: image
- `4`: shading
- `5`: form

Transform matrix:

```text
x' = a*x + c*y + e
y' = b*x + d*y + f
```

The matrix must be invertible.

## Content insertion

- `wasm_pdf_add_text_page(handle, pageIndex, text, x, y, fontSize, rgba)` inserts page text. `text` must be valid UTF-8.
- `wasm_pdf_add_rgba_image_page(handle, pageIndex, rgbaPtr, rgbaSize, imageWidth, imageHeight, x, y, displayWidth, displayHeight)` inserts an image from row-major 8-bit RGBA pixels. `rgbaSize` must equal `imageWidth * imageHeight * 4`.
- `wasm_pdf_add_jpeg_image_page(handle, pageIndex, jpegPtr, jpegSize, x, y, displayWidth, displayHeight)` inserts encoded JPEG bytes using PDFium's JPEG image path.
- `wasm_pdf_add_png_image_page(handle, pageIndex, pngPtr, pngSize, x, y, displayWidth, displayHeight)` decodes PNG bytes to RGBA and inserts the image.

RGBA convention is `0xAARRGGBB`.

PNG support is intentionally small: non-interlaced, 8-bit grayscale, RGB, grayscale-alpha, and RGBA PNGs. Palette, interlaced, 16-bit, and uncommon PNG features are rejected with error code `51`.

## Annotations

- `wasm_pdf_annotation_count(handle, pageIndex)` returns annotation count, or `-1` on failure.
- `wasm_pdf_add_highlight_annotation(handle, pageIndex, left, bottom, right, top, rgba)` creates a highlight annotation with one quad.
- `wasm_pdf_add_link_annotation(handle, pageIndex, left, bottom, right, top, uri)` creates a link annotation with URI action. `uri` must be non-empty 7-bit ASCII.
- `wasm_pdf_add_text_note_annotation(handle, pageIndex, x, y, contents, rgba)` creates a text note annotation with a 20x20 icon rectangle. `contents` must be valid UTF-8.
- `wasm_pdf_add_rectangle_annotation(handle, pageIndex, left, bottom, right, top, strokeRgba, borderWidth)` creates a square/rectangle annotation.
- `wasm_pdf_add_freetext_annotation(handle, pageIndex, left, bottom, right, top, contents, fontSize, textRgba, borderRgba, borderWidth)` creates a visible FreeText annotation with a generated appearance stream.
- `wasm_pdf_set_annotation_rect(handle, pageIndex, annotationIndex, left, bottom, right, top)` updates an annotation rectangle. For markup/link annotations it also updates the first quadpoint set.
- `wasm_pdf_set_annotation_color(handle, pageIndex, annotationIndex, rgba)` updates annotation stroke/markup color.
- `wasm_pdf_set_annotation_text(handle, pageIndex, annotationIndex, contents)` updates annotation `Contents`. `contents` must be valid UTF-8.
- `wasm_pdf_set_annotation_uri(handle, pageIndex, annotationIndex, uri)` updates a link URI. `uri` must be non-empty 7-bit ASCII.

Known helper subtypes:

- `1`: text note
- `2`: link
- `3`: FreeText
- `5`: square/rectangle
- `9`: highlight

## Rendering

- `wasm_pdf_render_page_rgba(handle, pageIndex, width, height, flags, outPtrPtr, outSizePtr)` renders a full page to row-major RGBA bytes.
- `wasm_pdf_render_page_area_rgba(handle, pageIndex, left, bottom, right, top, width, height, flags, outPtrPtr, outSizePtr)` renders a PDF user-space rectangle to row-major RGBA bytes.

Release non-null render output with `wasm_pdf_free_buffer`.

Common render flag:

- `0x01`: render annotations (`FPDF_ANNOT`)

`FPDF_REVERSE_BYTE_ORDER` is ignored because this wrapper always returns RGBA.

## Error codes

`wasm_pdf_last_error()` returns:

- `0`: none
- `1`: not initialized
- `2`: invalid argument
- `3`: out of memory
- `4`: load document failed
- `5`: invalid handle
- `6`: load page failed
- `7`: create text failed
- `8`: set text failed
- `9`: set color failed
- `10`: insert object failed
- `11`: generate content failed
- `12`: save failed
- `13`: write failed
- `14`: output too large
- `15`: invalid UTF-8 text
- `16`: create page failed
- `17`: delete page failed
- `18`: copy page failed
- `19`: import pages failed
- `20`: PDFium unknown error
- `21`: PDFium file error
- `22`: PDFium format error
- `23`: PDFium password error
- `24`: PDFium security error
- `25`: PDFium page error
- `26`: page geometry failed
- `27`: metadata read failed
- `28`: metadata write failed
- `29`: load text page failed
- `30`: text extraction failed
- `31`: create image failed
- `32`: create bitmap failed
- `33`: set image bitmap failed
- `34`: set image matrix failed
- `35`: create render bitmap failed
- `36`: fill render bitmap failed
- `37`: page object lookup failed
- `38`: page object bounds failed
- `39`: page object delete failed
- `40`: page object transform failed
- `41`: text search failed
- `42`: create annotation failed
- `43`: set annotation rect failed
- `44`: set annotation color failed
- `45`: set annotation attachment failed
- `46`: set annotation URI failed
- `47`: set annotation text failed
- `48`: set annotation border failed
- `49`: generate annotation appearance failed
- `50`: load JPEG failed
- `51`: decode PNG failed
