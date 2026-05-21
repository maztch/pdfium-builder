# API Reference

The exported API is implemented in `wasm/pdfium_edit_wrapper.cc` and linked through `scripts/build_wrapper_wasm.sh` via `-sEXPORTED_FUNCTIONS`.

All exported wrapper functions use the `wasm_pdf_*` prefix. Most mutation functions return `1` on success and `0` on failure. Query functions document their failure sentinel below. Call `wasm_pdf_last_error()` after a failure for diagnostics.

For task-oriented flows, see [Examples](EXAMPLES.md). For exact native pointer and output-buffer ownership rules, see [Memory Ownership](MEMORY_OWNERSHIP.md).

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

Metadata write internals are described in [Implementation Notes](IMPLEMENTATION_NOTES.md#metadata-writes).

## Outline and bookmarks

- `wasm_pdf_get_outline(handle, outPtrPtr, outSizePtr)` writes a binary depth-first outline buffer. Release non-null output with `wasm_pdf_free_buffer`.

Outline result buffer layout:

- `uint32`: item count
- Per item:
- `int32 depth`
- `int32 childCount`: positive means open by default, negative means closed by default, zero means no children
- `uint32 titleSize`, followed by UTF-8 title bytes
- `uint32 actionType`: PDFium `PDFACTION_*` value
- `int32 pageIndex`: zero-based target page, or `-1` when no local destination is available
- `uint32 viewMode`: PDFium `PDFDEST_VIEW_*` value
- `uint32 viewParamCount`, followed by four `double` view parameter slots
- `uint32 locationFlags`: bit `1` for x, bit `2` for y, bit `4` for zoom
- `double x`, `double y`, `double zoom`
- `uint32 uriSize`, followed by URI bytes for URI actions
- `uint32 filePathSize`, followed by file path bytes for launch or remote-goto actions

Action types:

- `0`: unsupported
- `1`: goto
- `2`: remote goto
- `3`: URI
- `4`: launch
- `5`: embedded goto

Destination view modes:

- `0`: unknown
- `1`: XYZ
- `2`: Fit
- `3`: FitH
- `4`: FitV
- `5`: FitR
- `6`: FitB
- `7`: FitBH
- `8`: FitBV

## Embedded attachments

- `wasm_pdf_attachment_count(handle)` returns the number of document-level embedded files, or `-1` on failure.
- `wasm_pdf_add_attachment(handle, name, filePtr, fileSize, mimeType)` adds an embedded file. `name` must be valid UTF-8 and non-empty. `filePtr` may be null only when `fileSize` is `0`. `mimeType` is optional but must be 7-bit ASCII when present.
- `wasm_pdf_set_attachment_file(handle, attachmentIndex, filePtr, fileSize, mimeType)` replaces an embedded file's bytes and MIME type. `filePtr` may be null only when `fileSize` is `0`; `mimeType` is optional but must be 7-bit ASCII when present.
- `wasm_pdf_delete_attachment(handle, attachmentIndex)` removes an embedded file entry by zero-based attachment index.
- `wasm_pdf_get_attachment_info(handle, attachmentIndex, outPtrPtr, outSizePtr)` writes a binary attachment info buffer. Release non-null output with `wasm_pdf_free_buffer`.
- `wasm_pdf_get_attachment_file(handle, attachmentIndex, outPtrPtr, outSizePtr)` writes attachment bytes. Release non-null output with `wasm_pdf_free_buffer`; empty files can return a null pointer with size `0`.

Attachment info buffer layout:

- `uint32 nameSize`, followed by UTF-8 file name bytes
- `uint32 mimeTypeSize`, followed by UTF-8 MIME type bytes, or size `0` when absent
- `int32 fileSize`, or `-1` when file bytes are not readable

This API covers document-level embedded files, not file-attachment annotations.

## Forms

- `wasm_pdf_get_form_fields(handle, outPtrPtr, outSizePtr)` writes a binary AcroForm field summary buffer. Release non-null output with `wasm_pdf_free_buffer`.
- `wasm_pdf_set_form_field_value(handle, fieldName, value)` updates one AcroForm field value by fully qualified field name. `fieldName` and `value` must be valid UTF-8.
- `wasm_pdf_set_form_field_checked(handle, fieldName, controlIndex, checked)` updates one checkbox or radio widget by fully qualified field name and zero-based widget/control index. `checked` is `0` or `1`.
- `wasm_pdf_set_form_field_selected_index(handle, fieldName, optionIndex)` selects one combo/list option by zero-based option index. Existing list selections are cleared first.

Form field result buffer layout:

- `uint32`: field count
- Per field:
- `int32 type`: PDFium form field type
- `uint32 flags`: field flags
- `int32 controlCount`: number of widget controls
- `uint32 nameSize`, followed by UTF-8 full field name bytes
- `uint32 alternateNameSize`, followed by UTF-8 alternate/display name bytes
- `uint32 valueSize`, followed by UTF-8 current value bytes
- `uint32 defaultValueSize`, followed by UTF-8 default value bytes
- `uint32 widgetCount`
- Per widget:
- `int32 index`: zero-based control index within the field
- `int32 pageIndex`: zero-based page index, or `-1` if the widget page cannot be resolved
- `double left`, `double bottom`, `double right`, `double top`: widget rectangle in PDF user-space
- `int32 checked`: `1` when checked/selected, otherwise `0`
- `int32 defaultChecked`: `1` when checked by default, otherwise `0`
- `int32 hasAppearance`: `1` when the widget has a normal appearance entry, otherwise `0`
- `uint32 exportValueSize`, followed by UTF-8 export value bytes
- `uint32 onStateNameSize`, followed by ASCII/UTF-8 appearance on-state name bytes
- `uint32 optionCount`
- Per option:
- `int32 index`: zero-based option index
- `int32 selected`: `1` when selected, otherwise `0`
- `int32 defaultSelected`: `1` when selected by default, otherwise `0`
- `uint32 labelSize`, followed by UTF-8 option label bytes
- `uint32 valueSize`, followed by UTF-8 export value bytes
- `uint32 selectedIndexCount`
- Per selected index:
- `int32 selectedIndex`

Known form field types:

- `0`: unknown
- `1`: push button
- `2`: check box
- `3`: radio button
- `4`: combo box
- `5`: list box
- `6`: text field
- `7`: signature

This is a basic AcroForm API. It reads field metadata, widget geometry, checkbox/radio state, choice options, selected choice indexes, and appearance presence. Text, combo, and list value writes regenerate widget appearance streams when possible. Checkbox/radio writes update widget checked state and select the appropriate existing appearance state. Choice selection writes clear previous list selections before selecting the requested option. The wrapper sets `/NeedAppearances` only when a widget still lacks a normal appearance. It does not execute PDF JavaScript, calculate fields, validate fields, or support XFA forms.

## Text extraction and search

- `wasm_pdf_get_page_text(handle, pageIndex, outPtrPtr, outSizePtr)` writes extracted page text as UTF-8 bytes. Release with `wasm_pdf_free_buffer`.
- `wasm_pdf_get_page_text_runs(handle, pageIndex, outPtrPtr, outSizePtr)` writes a binary text run buffer for hit testing. Release with `wasm_pdf_free_buffer`.
- `wasm_pdf_search_page_text(handle, pageIndex, query, flags, outPtrPtr, outSizePtr)` writes a binary match buffer. `query` must be valid UTF-8.
- `wasm_pdf_redact_page_text(handle, pageIndex, query, flags, rgba)` searches page text, removes intersecting text page objects, paints opaque redaction rectangles over match bounds, regenerates page content, and returns the number of matches redacted or `-1` on failure. `query` must be valid UTF-8.

Search flags:

- `1`: match case
- `2`: whole word
- `4`: consecutive

Text search result buffer layout:

- `uint32`: match count
- Per match: `int32 startIndex`, `int32 charCount`, `uint32 rectCount`
- Per rectangle: `double left`, `double bottom`, `double right`, `double top`

Text run result buffer layout:

- `uint32`: run count
- Per run: `int32 index`, `int32 startIndex`, `int32 charCount`
- Per run: `double left`, `double bottom`, `double right`, `double top`
- Per run: `uint32 textSize`, followed by UTF-8 text bytes

The current text run API emits one visible character per run. This gives the viewer enough geometry for hit testing and text selection. Future versions can group adjacent characters into words or layout runs while preserving the same rectangle-based selection model.

Redaction note: this build does not expose PDFium's apply-redactions API. `wasm_pdf_redact_page_text` removes whole text page objects whose bounds intersect search matches, then paints cover rectangles. This is suitable for simple generated text objects, but can remove more text than the exact match when a text object contains multiple words.

## Page content objects

- `wasm_pdf_page_object_count(handle, pageIndex)` returns object count, or `-1` on failure.
- `wasm_pdf_get_page_object_info(handle, pageIndex, objectIndex, typePtr, leftPtr, bottomPtr, rightPtr, topPtr)` writes object type and PDF user-space bounds.
- `wasm_pdf_delete_page_object(handle, pageIndex, objectIndex)` removes a content object and regenerates page content.
- `wasm_pdf_transform_page_object(handle, pageIndex, objectIndex, a, b, c, d, e, f)` applies an affine matrix and regenerates page content.
- `wasm_pdf_duplicate_page_object(handle, pageIndex, objectIndex, offsetX, offsetY)` duplicates a supported page object and returns the new object index, or `-1` on failure. Current native support is intentionally limited to text page objects because PDFium does not expose a generic public clone API for all object types.
- `wasm_pdf_replace_text_page_object(handle, pageIndex, objectIndex, text)` replaces a text page object's contents while preserving the original PDF font handle, font size, and fill color. It regenerates page content and returns `1` on success or `0` on failure.

The direct ES module wraps these as `doc.pageObjectCount(pageIndex)`, `doc.pageObjectInfo(pageIndex, objectIndex)`, `doc.pageObjects(pageIndex)`, `doc.deletePageObject(pageIndex, objectIndex)`, `doc.replaceTextPageObject(pageIndex, objectIndex, text)`, `doc.transformPageObject(pageIndex, objectIndex, matrix)`, and `doc.duplicatePageObject(pageIndex, objectIndex, { offsetX, offsetY })`. Direct page object records include `kind: "pageObject"`, `pageIndex`, `key`, `label`, `typeName`, and a PDF user-space `rect`.

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
- `wasm_pdf_add_text_box_page(handle, pageIndex, text, x, y, width, height, fontSize, rgba, fontName, align, lineHeight)` inserts one text object per laid-out line and returns the number of inserted lines, or `-1` on failure. `width > 0` enables word wrapping. `height > 0` limits lines downward from `y`. `fontName` defaults to `Helvetica` when empty. `align` is `0` left, `1` center, or `2` right. `lineHeight <= 0` uses `fontSize * 1.2`. `text` and `fontName` must be valid UTF-8.
- `wasm_pdf_add_rgba_image_page(handle, pageIndex, rgbaPtr, rgbaSize, imageWidth, imageHeight, x, y, displayWidth, displayHeight)` inserts an image from row-major 8-bit RGBA pixels. `rgbaSize` must equal `imageWidth * imageHeight * 4`.
- `wasm_pdf_add_jpeg_image_page(handle, pageIndex, jpegPtr, jpegSize, x, y, displayWidth, displayHeight)` inserts encoded JPEG bytes using PDFium's JPEG image path.
- `wasm_pdf_add_png_image_page(handle, pageIndex, pngPtr, pngSize, x, y, displayWidth, displayHeight)` decodes PNG bytes to RGBA and inserts the image.

RGBA convention is `0xAARRGGBB`.

PNG support is intentionally small: non-interlaced, 8-bit grayscale, RGB, grayscale-alpha, and RGBA PNGs. Palette, interlaced, 16-bit, and uncommon PNG features are rejected with error code `51`.

## Annotations

- `wasm_pdf_annotation_count(handle, pageIndex)` returns annotation count, or `-1` on failure.
- `wasm_pdf_get_annotation_info(handle, pageIndex, annotationIndex, outPtrPtr, outSizePtr)` writes a binary annotation info buffer. Release non-null output with `wasm_pdf_free_buffer`.
- `wasm_pdf_delete_annotation(handle, pageIndex, annotationIndex)` deletes one annotation by zero-based annotation index.
- `wasm_pdf_add_highlight_annotation(handle, pageIndex, left, bottom, right, top, rgba)` creates a highlight annotation with one quad.
- `wasm_pdf_add_link_annotation(handle, pageIndex, left, bottom, right, top, uri)` creates a link annotation with URI action. `uri` must be non-empty 7-bit ASCII.
- `wasm_pdf_add_text_note_annotation(handle, pageIndex, x, y, contents, rgba)` creates a text note annotation with a 20x20 icon rectangle. `contents` must be valid UTF-8.
- `wasm_pdf_add_rectangle_annotation(handle, pageIndex, left, bottom, right, top, strokeRgba, borderWidth)` creates a square/rectangle annotation.
- `wasm_pdf_add_freetext_annotation(handle, pageIndex, left, bottom, right, top, contents, fontSize, textRgba, borderRgba, borderWidth)` creates a visible FreeText annotation with a generated appearance stream.
- `wasm_pdf_set_annotation_rect(handle, pageIndex, annotationIndex, left, bottom, right, top)` updates an annotation rectangle. For markup/link annotations it also updates the first quadpoint set.
- `wasm_pdf_set_annotation_color(handle, pageIndex, annotationIndex, rgba)` updates annotation stroke/markup color.
- `wasm_pdf_set_annotation_border(handle, pageIndex, annotationIndex, borderWidth)` updates annotation border width.
- `wasm_pdf_set_annotation_text(handle, pageIndex, annotationIndex, contents)` updates annotation `Contents`. `contents` must be valid UTF-8.
- `wasm_pdf_set_annotation_uri(handle, pageIndex, annotationIndex, uri)` updates a link URI. `uri` must be non-empty 7-bit ASCII.

The direct ES module wraps annotation creation/read/mutation as `doc.addHighlightAnnotation(pageIndex, rect, rgba)`, `doc.addRectangleAnnotation(pageIndex, rect, { rgba, borderWidth })`, `doc.addLinkAnnotation(pageIndex, rect, uri)`, `doc.addTextNoteAnnotation(pageIndex, { x, y, contents, rgba })`, `doc.addFreeTextAnnotation(pageIndex, rect, { contents, fontSize, textRgba, borderRgba, borderWidth })`, `doc.annotationCount(pageIndex)`, `doc.annotationInfo(pageIndex, annotationIndex)`, `doc.annotations(pageIndex)`, `doc.deleteAnnotation(pageIndex, annotationIndex)`, `doc.setAnnotationRect(pageIndex, annotationIndex, rect)`, `doc.setAnnotationColor(pageIndex, annotationIndex, rgba)`, `doc.setAnnotationBorderWidth(pageIndex, annotationIndex, borderWidth)`, `doc.setAnnotationText(pageIndex, annotationIndex, contents)`, `doc.setAnnotationUri(pageIndex, annotationIndex, uri)`, and `doc.updateAnnotation(pageIndex, annotationIndex, updates)`. Direct annotation records include `kind: "annotation"`, `pageIndex`, `key`, `label`, `subtypeName`, a PDF user-space `rect`, optional `colorRgba`, optional `borderWidth`, optional `contents`, optional `uri`, and `quadPoints`.

The direct ES module also exposes `doc.getSelectableItems(pageIndex, options)`, which combines text runs, page objects, annotations, and form widgets into one common selectable item shape: `{ kind, pageIndex, index, rect, label, key, data }`. Image page objects are classified as `kind: "image"` in this combined query while retaining their page-object metadata in `data`. Use boolean options `text`, `pageObjects`, `annotations`, and `formWidgets` to include or exclude sources.

Known helper subtypes:

- `1`: text note
- `2`: link
- `3`: FreeText
- `5`: square/rectangle
- `9`: highlight

Annotation info buffer layout:

- `int32 subtype`: PDFium `FPDF_ANNOT_*` subtype.
- `int32 flags`: annotation flags.
- `double left`, `double bottom`, `double right`, `double top`: annotation rectangle in PDF user-space.
- `int32 hasColor`: `1` when color is available, otherwise `0`.
- `int32 colorRgba`: `0xAARRGGBB`; meaningful only when `hasColor` is `1`.
- `double borderWidth`: border width, or `-1` when unavailable.
- `uint32 contentsSize`, followed by UTF-8 `Contents` bytes.
- `uint32 uriSize`, followed by URI bytes for link annotations.
- `uint32 quadPointCount`.
- Per quadpoint set: `double x1`, `double y1`, `double x2`, `double y2`, `double x3`, `double y3`, `double x4`, `double y4`.

FreeText appearance generation is described in [Implementation Notes](IMPLEMENTATION_NOTES.md#freetext-annotation-appearance).

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
- `52`: outline read failed
- `53`: add attachment failed
- `54`: attachment read failed
- `55`: attachment write failed
- `56`: annotation read failed
- `57`: annotation delete failed
- `58`: attachment delete failed
- `59`: form read failed
- `60`: form write failed
- `61`: redaction failed
- `62`: text layout failed
- `63`: page object duplicate failed
