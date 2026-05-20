# Feature Matrix

This matrix shows what is implemented in the native WASM wrapper, what has a worker-level convenience message, what is covered by the smoke test, and where the detailed docs live.

Status legend:

- Stable: implemented, documented, and covered by smoke tests.
- Partial: implemented but missing worker coverage, broader examples, or deeper tests.
- Planned: not implemented yet.

## Core Lifecycle

| Feature | Native API | Worker support | Smoke tested | Docs | Status | Notes |
|---|---|---:|---:|---|---|---|
| Initialize/destroy PDFium | `wasm_pdfium_init`, `wasm_pdfium_destroy` | Indirect | Yes | [API](API.md#lifecycle), [Usage](USAGE.md#load-the-module) | Stable | Worker initializes once and reuses the module. |
| Open PDF from bytes | `wasm_pdf_open_from_bytes` | Indirect | Yes | [API](API.md#lifecycle), [Usage](USAGE.md#basic-lifecycle) | Stable | Worker opens per request and closes in `finally`. |
| Save copy | `wasm_pdf_save_copy` | Indirect | Yes | [API](API.md#lifecycle), [Usage](USAGE.md#minimal-direct-example) | Stable | Worker mutation requests return saved `pdfBytes`. |
| Free output buffers | `wasm_pdf_free_buffer` | Indirect | Yes | [Usage](USAGE.md#memory-ownership-rules), [Internals](INTERNALS.md#output-buffers) | Stable | Required for every non-null wrapper output buffer. |
| Close document handle | `wasm_pdf_close` | Indirect | Yes | [Usage](USAGE.md#memory-ownership-rules) | Stable | Required for every opened document handle. |
| Structured errors | `wasm_pdf_last_error` | Yes | Yes | [API](API.md#error-codes), [Internals](INTERNALS.md#error-model) | Stable | Worker maps numeric errors to names. |

## Document And Page Queries

| Feature | Native API | Worker support | Smoke tested | Docs | Status | Notes |
|---|---|---:|---:|---|---|---|
| Page count | `wasm_pdf_page_count` | No | Yes | [API](API.md#page-queries-and-geometry) | Partial | Candidate for a `queryDocument` worker message. |
| Page size | `wasm_pdf_get_page_size` | No | Yes | [API](API.md#page-queries-and-geometry) | Partial | Worker currently has no page geometry query message. |
| Page rotation query | `wasm_pdf_get_page_rotation` | No | Yes | [API](API.md#page-queries-and-geometry) | Partial | Native read path is stable. |
| Page box query | `wasm_pdf_get_page_box` | No | Yes | [API](API.md#page-queries-and-geometry) | Partial | Supports media/crop/bleed/trim/art boxes. |
| Permissions query | `wasm_pdf_get_permissions` | No | Yes | [API](API.md#page-queries-and-geometry) | Partial | Native read path is stable. |
| Metadata read | `wasm_pdf_get_metadata` | No | Yes | [API](API.md#metadata) | Partial | Candidate for worker query support. |
| Outline/bookmarks read | `wasm_pdf_get_outline` | `queryOutline` | Yes | [API](API.md#outline-and-bookmarks), [Worker Protocol](WORKER_PROTOCOL.md#queryoutline) | Stable | Returns a depth-first navigation tree with page destinations and URI/file actions. |
| Text extraction | `wasm_pdf_get_page_text` | No | Yes | [API](API.md#text-extraction-and-search) | Partial | Worker supports search, but not full extraction. |
| Text search with bounding boxes | `wasm_pdf_search_page_text` | `searchPageText` | Yes | [API](API.md#text-extraction-and-search), [Worker](WORKER.md#message-protocol) | Stable | Returns match indexes and per-match rectangles. |
| Annotation count | `wasm_pdf_annotation_count` | No | Yes | [API](API.md#annotations) | Partial | Worker can add/update but not list annotations. |
| Page object count/info | `wasm_pdf_page_object_count`, `wasm_pdf_get_page_object_info` | `queryPageObjects` | Yes | [API](API.md#page-content-objects), [Worker](WORKER.md#message-protocol) | Stable | Used for object selection UIs. |

## Page Mutations

| Feature | Native API | Worker support | Smoke tested | Docs | Status | Notes |
|---|---|---:|---:|---|---|---|
| Set page rotation | `wasm_pdf_set_page_rotation` | No | Yes | [API](API.md#page-queries-and-geometry) | Partial | Candidate for worker mutation support. |
| Set page boxes | `wasm_pdf_set_page_box` | No | Yes | [API](API.md#page-queries-and-geometry) | Partial | Native validates rectangle shape. |
| Set page size | `wasm_pdf_set_page_size` | No | Yes | [API](API.md#page-queries-and-geometry) | Partial | Sets media box to `[0, 0, width, height]`. |
| Insert blank page | `wasm_pdf_insert_blank_page` | No | Yes | [API](API.md#pages) | Partial | Candidate for worker mutation support. |
| Delete page | `wasm_pdf_delete_page` | No | Yes | [API](API.md#pages) | Partial | Candidate for worker mutation support. |
| Copy page between documents | `wasm_pdf_copy_page` | No | Yes | [API](API.md#pages) | Partial | Direct API requires two open handles. |
| Import page ranges | `wasm_pdf_import_pages` | No | Yes | [API](API.md#pages) | Partial | Direct API supports PDFium one-based page ranges. |

## Content Editing

| Feature | Native API | Worker support | Smoke tested | Docs | Status | Notes |
|---|---|---:|---:|---|---|---|
| Add text page object | `wasm_pdf_add_text_page` | `addText` | Yes | [API](API.md#content-insertion), [Usage](USAGE.md#minimal-direct-example), [Worker](WORKER.md#message-protocol) | Stable | UTF-8 input is strictly decoded. |
| Add RGBA image | `wasm_pdf_add_rgba_image_page` | `addImage` with `imageFormat: "rgba"` | Yes | [API](API.md#content-insertion), [Worker](WORKER.md#message-protocol) | Stable | Expects row-major RGBA bytes. |
| Add JPEG image | `wasm_pdf_add_jpeg_image_page` | `addImage` with `imageFormat: "jpeg"` | Yes | [API](API.md#content-insertion), [Worker](WORKER.md#message-protocol) | Stable | Uses PDFium's encoded JPEG image path. |
| Add PNG image | `wasm_pdf_add_png_image_page` | `addImage` with `imageFormat: "png"` | Yes | [API](API.md#content-insertion), [Worker](WORKER.md#message-protocol) | Stable | Supports common non-interlaced 8-bit PNGs. |
| Enumerate page objects | `wasm_pdf_page_object_count`, `wasm_pdf_get_page_object_info` | `queryPageObjects` | Yes | [API](API.md#page-content-objects), [Worker](WORKER.md#message-protocol) | Stable | Returns object index, type, and bounds. |
| Delete page object | `wasm_pdf_delete_page_object` | `deletePageObject` | Yes | [API](API.md#page-content-objects), [Worker](WORKER.md#message-protocol) | Stable | Regenerates page content after deletion. |
| Transform page object | `wasm_pdf_transform_page_object` | `transformPageObject` | Yes | [API](API.md#page-content-objects), [Worker](WORKER.md#message-protocol) | Stable | Matrix must be invertible. |

## Annotations

| Feature | Native API | Worker support | Smoke tested | Docs | Status | Notes |
|---|---|---:|---:|---|---|---|
| Add highlight | `wasm_pdf_add_highlight_annotation` | `addAnnotation` with `highlight` | Yes | [API](API.md#annotations), [Worker](WORKER.md#message-protocol) | Stable | Creates one quad from the provided rectangle. |
| Add link | `wasm_pdf_add_link_annotation` | `addAnnotation` with `link` | Yes | [API](API.md#annotations), [Worker](WORKER.md#message-protocol) | Stable | URI must be non-empty 7-bit ASCII. |
| Add text note | `wasm_pdf_add_text_note_annotation` | `addAnnotation` with `textNote` | Yes | [API](API.md#annotations), [Worker](WORKER.md#message-protocol) | Stable | Contents must be valid UTF-8. |
| Add rectangle | `wasm_pdf_add_rectangle_annotation` | `addAnnotation` with `rectangle` | Yes | [API](API.md#annotations), [Worker](WORKER.md#message-protocol) | Stable | Supports stroke color and border width. |
| Add FreeText box | `wasm_pdf_add_freetext_annotation` | `addAnnotation` with `freeText` | Yes | [API](API.md#annotations), [Worker](WORKER.md#message-protocol) | Stable | Generates an appearance stream so it is visible immediately. |
| Update annotation rect | `wasm_pdf_set_annotation_rect` | `updateAnnotation` with `rect` | Yes | [API](API.md#annotations), [Worker](WORKER.md#message-protocol) | Stable | Also updates first quadpoints for markup/link annotations. |
| Update annotation color | `wasm_pdf_set_annotation_color` | `updateAnnotation` with `color` | Yes | [API](API.md#annotations), [Worker](WORKER.md#message-protocol) | Stable | Updates stroke/markup color. |
| Update annotation text | `wasm_pdf_set_annotation_text` | `updateAnnotation` with `text` | Yes | [API](API.md#annotations), [Worker](WORKER.md#message-protocol) | Stable | Contents must be valid UTF-8. |
| Update link URI | `wasm_pdf_set_annotation_uri` | `updateAnnotation` with `uri` | Yes | [API](API.md#annotations), [Worker](WORKER.md#message-protocol) | Stable | URI must be non-empty 7-bit ASCII. |
| Enumerate annotation details | Planned | No | No | [Roadmap](IMPROVEMENTS_ROADMAP.md) | Planned | Count exists; subtype/rect/content enumeration is not exposed yet. |
| Delete annotation | Planned | No | No | [Roadmap](IMPROVEMENTS_ROADMAP.md) | Planned | Page-object deletion does not delete annotations. |

## Rendering

| Feature | Native API | Worker support | Smoke tested | Docs | Status | Notes |
|---|---|---:|---:|---|---|---|
| Render full page to RGBA | `wasm_pdf_render_page_rgba` | `renderPage` | Yes | [API](API.md#rendering), [Worker](WORKER.md#message-protocol) | Stable | Returns row-major RGBA bytes. |
| Render page area to RGBA | `wasm_pdf_render_page_area_rgba` | `renderPageArea` | Yes | [API](API.md#rendering), [Worker](WORKER.md#message-protocol) | Stable | Uses PDF user-space crop rectangle. |
| Render annotations | Render flag `0x01` | `flags: 0x01` | Yes | [API](API.md#rendering), [Worker](WORKER.md#message-protocol) | Stable | FreeText smoke test verifies visible non-white pixels. |

## Encoding And Data Formats

| Feature | Native API | Worker support | Smoke tested | Docs | Status | Notes |
|---|---|---:|---:|---|---|---|
| Strict UTF-8 input handling | Shared decoder | Indirect | Yes | [Usage](USAGE.md#error-handling), [Internals](INTERNALS.md#utf-8-and-strings) | Stable | Malformed text fails with error code `15`. |
| UTF-8 output buffers | Metadata/text APIs | No direct worker extraction | Yes | [API](API.md#metadata), [API](API.md#text-extraction-and-search) | Stable | Caller frees output with `wasm_pdf_free_buffer`. |
| Binary search result buffer | `wasm_pdf_search_page_text` | Parsed by worker | Yes | [API](API.md#text-extraction-and-search) | Stable | Worker returns parsed match objects. |
| Binary outline result buffer | `wasm_pdf_get_outline` | Parsed by worker | Yes | [API](API.md#outline-and-bookmarks) | Stable | Worker returns nested bookmark objects. |
| RGBA render buffers | Render APIs | `renderPage`, `renderPageArea` | Yes | [API](API.md#rendering) | Stable | Wrapper normalizes output to RGBA. |
| RGBA image input | `wasm_pdf_add_rgba_image_page` | `addImage` | Yes | [API](API.md#content-insertion) | Stable | Input is row-major RGBA. |
| JPEG image input | `wasm_pdf_add_jpeg_image_page` | `addImage` | Yes | [API](API.md#content-insertion) | Stable | Input is encoded JPEG bytes. |
| PNG image input | `wasm_pdf_add_png_image_page` | `addImage` | Yes | [API](API.md#content-insertion) | Stable | Input is encoded PNG bytes decoded by the wrapper. |

## Worker Message Coverage

| Message type | Covered operations | Returns | Status | Notes |
|---|---|---|---|---|
| `addText` | Add text page object | Saved PDF bytes | Stable | Simple text insertion convenience path. |
| `addImage` | Add RGBA, JPEG, or PNG image page object | Saved PDF bytes | Stable | Use `rgbaBytes` for RGBA or `imageFormat` plus `imageBytes` for JPEG/PNG. |
| `addAnnotation` | Highlight, link, text note, rectangle, FreeText | Saved PDF bytes | Stable | Uses `annotationType`. |
| `updateAnnotation` | Rect, color, text, URI | Saved PDF bytes | Stable | Uses `updateType`. |
| `renderPage` | Full-page rendering | RGBA bytes, width, height | Stable | Accepts render flags. |
| `renderPageArea` | Area rendering | RGBA bytes, width, height | Stable | Accepts PDF-space rectangle. |
| `queryPageObjects` | Page object count/info | Object array | Stable | Read-only. |
| `searchPageText` | Text search rectangles | Match array | Stable | Parses binary native buffer. |
| `queryOutline` | Outline/bookmark navigation | Nested outline tree | Stable | Parses binary native buffer. |
| `deletePageObject` | Delete one page object | Saved PDF bytes | Stable | Regenerates page content. |
| `transformPageObject` | Affine transform one page object | Saved PDF bytes | Stable | Matrix must be invertible. |
| `queryDocument` | Page count, metadata, permissions, page geometry | Query payload | Planned | Would fill several current worker gaps. |
| `mutatePages` | Insert/delete/copy/import pages | Saved PDF bytes | Planned | Needs protocol design for one vs two input PDFs. |

## Documentation Gap Coverage

These previously identified gaps are now covered:

| Gap | Document |
|---|---|
| Task-oriented copy-paste flows | [Examples](EXAMPLES.md) |
| Worker protocol schema with required/optional fields | [Worker Protocol Reference](WORKER_PROTOCOL.md) |
| Native API ownership and output-buffer rules | [Memory Ownership](MEMORY_OWNERSHIP.md) |
| Annotation appearance, metadata, PNG, render, and search internals | [Implementation Notes](IMPLEMENTATION_NOTES.md) |
