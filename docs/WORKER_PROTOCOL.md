# Worker Protocol Reference

The worker accepts request messages shaped as:

```js
{ id, type, payload }
```

Successful responses:

```js
{ id, type, ok: true, payload }
```

Error responses:

```js
{ id, type, ok: false, error: { message, code, name } }
```

`id` is caller-defined and echoed back. Use a unique string per request.

## Common Payload Fields

| Field | Type | Required | Applies to | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | All messages | Input PDF bytes. Prefer transferable `ArrayBuffer`. |
| `password` | string | No | All messages | Defaults to `""`. |
| `pageIndex` | number | No | Page-scoped messages | Defaults to `0`. |

## `queryDocument`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `password` | string | No | `""` | PDF password. |
| `includePages` | boolean | No | `true` | Include page size, rotation, and boxes. |
| `includeMetadata` | boolean | No | `true` | Include selected metadata keys. |
| `metadataKeys` | string[] | No | common keys | Metadata keys to read. |
| `includeOutlineSummary` | boolean | No | `true` | Include `outlineCount` and `hasOutline`. |
| `includeAttachmentSummary` | boolean | No | `true` | Include `attachmentCount` and `hasAttachments`. |

Returns a document summary:

```js
{
  pageCount: 1,
  permissions: 4294967295,
  pages: [
    {
      index: 0,
      width: 612,
      height: 792,
      rotation: 0,
      boxes: {
        media: { left: 0, bottom: 0, right: 612, top: 792 },
        crop: null,
        bleed: null,
        trim: null,
        art: null
      }
    }
  ],
  metadata: { Title: "Example" },
  outlineCount: 3,
  hasOutline: true,
  attachmentCount: 1,
  hasAttachments: true
}
```

## `insertBlankPage`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Destination PDF. |
| `pageIndex` | number | Yes | `0` | Insert position. A value larger than the last page appends at native level only when accepted by PDFium. |
| `width` | number | Yes | `0` | New page width in PDF user-space units. |
| `height` | number | Yes | `0` | New page height in PDF user-space units. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

## `deletePage`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Destination PDF. |
| `pageIndex` | number | Yes | `-1` | Zero-based page index to delete. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

## `copyPage`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Destination PDF. |
| `sourcePdfBytes` | `ArrayBuffer` or typed array | No | `pdfBytes` | Source PDF. Defaults to a second open handle for the destination bytes. |
| `sourcePageIndex` | number | No | `0` | Zero-based source page index. |
| `destinationPageIndex` | number | No | `0` | Zero-based insertion index in destination PDF. |
| `password` | string | No | `""` | Destination PDF password. |
| `sourcePassword` | string | No | `password` | Source PDF password. |

Returns `{ pdfBytes }`.

## `importPages`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Destination PDF. |
| `sourcePdfBytes` | `ArrayBuffer` or typed array | No | `pdfBytes` | Source PDF. Defaults to a second open handle for the destination bytes. |
| `pageRange` | string | No | `""` | One-based PDFium range like `"1,3,5-7"`. Empty imports all pages. |
| `destinationPageIndex` | number | No | `0` | Zero-based insertion index in destination PDF. |
| `password` | string | No | `""` | Destination PDF password. |
| `sourcePassword` | string | No | `password` | Source PDF password. |

Returns `{ pdfBytes }`.

## `setPageRotation`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `pageIndex` | number | No | `0` | Target page. |
| `rotation` | number | Yes | `-1` | `0`, `1`, `2`, or `3` for 0, 90, 180, or 270 degrees clockwise. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

## `setPageBox`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `pageIndex` | number | No | `0` | Target page. |
| `boxType` | number | Yes | `0` | `0` media, `1` crop, `2` bleed, `3` trim, `4` art. |
| `left`, `bottom`, `right`, `top` | number | Yes | `0` | PDF user-space rectangle. `right > left` and `top > bottom` are required. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

## `setPageSize`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `pageIndex` | number | No | `0` | Target page. |
| `width` | number | Yes | `0` | New media box width. |
| `height` | number | Yes | `0` | New media box height. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

## `addText`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `text` | string | No | `""` | Must be valid UTF-8 after JS encoding. |
| `pageIndex` | number | No | `0` | Target page. |
| `x` | number | No | `80` | PDF user-space x. |
| `y` | number | No | `120` | PDF user-space y. |
| `fontSize` | number | No | `16` | Positive size recommended. |
| `rgba` | number | No | `0xff000000` | `0xAARRGGBB`. |

Returns `{ pdfBytes }`.

## `addImage`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `imageFormat` | string | No | inferred | `"rgba"`, `"jpeg"`, `"jpg"`, or `"png"`. |
| `rgbaBytes` | `ArrayBuffer` or typed array | For RGBA | | Row-major RGBA pixels. |
| `imageBytes` | `ArrayBuffer` or typed array | For JPEG/PNG | | Encoded bytes. |
| `jpegBytes` | `ArrayBuffer` or typed array | No | | Alternative to `imageBytes`; infers JPEG. |
| `pngBytes` | `ArrayBuffer` or typed array | No | | Alternative to `imageBytes`; infers PNG. |
| `imageWidth` | number | For RGBA | `0` | Pixel width for RGBA input. |
| `imageHeight` | number | For RGBA | `0` | Pixel height for RGBA input. |
| `x` | number | No | `0` | PDF user-space x. |
| `y` | number | No | `0` | PDF user-space y. |
| `displayWidth` | number | Required by native API | `0` | PDF user-space display width. |
| `displayHeight` | number | Required by native API | `0` | PDF user-space display height. |

Returns `{ pdfBytes }`.

PNG support is limited to non-interlaced 8-bit grayscale, RGB, grayscale-alpha, and RGBA PNGs.

## `addAnnotation`

Common fields:

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `annotationType` | string | Yes | | `highlight`, `link`, `textNote`, `rectangle`, `freeText`. |
| `pageIndex` | number | No | `0` | Target page. |

Rectangle-style annotations use `left`, `bottom`, `right`, `top` in PDF user-space coordinates.

| Type | Required fields | Optional fields | Returns |
|---|---|---|---|
| `highlight` | `left`, `bottom`, `right`, `top` | `rgba` defaults to `0x80ffff00` | `{ pdfBytes }` |
| `link` | `left`, `bottom`, `right`, `top`, `uri` | | `{ pdfBytes }` |
| `textNote` | `x`, `y`, `contents` | `rgba` defaults to `0xffffff00` | `{ pdfBytes }` |
| `rectangle` | `left`, `bottom`, `right`, `top` | `rgba` defaults to `0xffff0000`, `borderWidth` defaults to `1` | `{ pdfBytes }` |
| `freeText` | `left`, `bottom`, `right`, `top`, `contents` | `fontSize` defaults to `12`, `textRgba` and `borderRgba` default to black, `borderWidth` defaults to `1` | `{ pdfBytes }` |

## `updateAnnotation`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `updateType` | string | Yes | | `rect`, `color`, `text`, or `uri`. |
| `pageIndex` | number | No | `0` | Target page. |
| `annotationIndex` | number | Yes | `-1` | Zero-based annotation index. |

| Type | Required fields | Returns |
|---|---|---|
| `rect` | `left`, `bottom`, `right`, `top` | `{ pdfBytes }` |
| `color` | `rgba` | `{ pdfBytes }` |
| `text` | `contents` | `{ pdfBytes }` |
| `uri` | `uri` | `{ pdfBytes }` |

## `queryAnnotations`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `pageIndex` | number | No | `0` | Target page. |
| `password` | string | No | `""` | PDF password. |

Returns `{ annotations }`, where each annotation has:

```js
{
  index: 0,
  subtype: 9,
  flags: 4,
  rect: { left: 72, bottom: 700, right: 260, top: 735 },
  colorRgba: 2164260864,
  borderWidth: null,
  contents: null,
  uri: null,
  quadPoints: [{ x1, y1, x2, y2, x3, y3, x4, y4 }]
}
```

`colorRgba`, `borderWidth`, `contents`, and `uri` are `null` when unavailable.

## `deleteAnnotation`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `pageIndex` | number | No | `0` | Target page. |
| `annotationIndex` | number | Yes | `-1` | Zero-based annotation index. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

## `renderPage`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `width` | number | Yes | `0` | Output pixel width. |
| `height` | number | Yes | `0` | Output pixel height. |
| `flags` | number | No | `0` | Use `0x01` to render annotations. |

Returns `{ rgbaBytes, width, height }`.

## `renderPageArea`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `left` | number | Yes | `0` | PDF user-space crop rectangle. |
| `bottom` | number | Yes | `0` | PDF user-space crop rectangle. |
| `right` | number | Yes | `0` | Must be greater than `left`. |
| `top` | number | Yes | `0` | Must be greater than `bottom`. |
| `width` | number | Yes | `0` | Output pixel width. |
| `height` | number | Yes | `0` | Output pixel height. |
| `flags` | number | No | `0` | Use `0x01` to render annotations. |

Returns `{ rgbaBytes, width, height }`.

## `queryPageObjects`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pageIndex` | number | No | `0` | Target page. |

Returns `{ objects }`, where each object has:

```js
{ index, type, left, bottom, right, top }
```

Object types are listed in [API Reference](API.md#page-content-objects).

## `searchPageText`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `query` | string | Yes | `""` | Search text. |
| `pageIndex` | number | No | `0` | Target page. |
| `flags` | number | No | `0` | `1` match case, `2` whole word, `4` consecutive. |

Returns `{ matches }`, where each match has:

```js
{ startIndex, charCount, rects }
```

## `queryOutline`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `password` | string | No | `""` | PDF password. |

Returns `{ outline }`, where `outline` is a nested bookmark tree:

```js
{
  index: 0,
  depth: 0,
  title: "Chapter 1",
  childCount: 2,
  isOpen: true,
  actionType: 1,
  destination: {
    pageIndex: 0,
    viewMode: 1,
    viewParams: [0, 792, 0],
    x: 0,
    y: 792,
    zoom: null
  },
  uri: null,
  filePath: null,
  children: []
}
```

`destination` is `null` when the bookmark has no local destination. URI bookmarks set `uri`; launch or remote-goto bookmarks can set `filePath`.

## `queryAttachments`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `password` | string | No | `""` | PDF password. |

Returns `{ attachments }`, where each attachment has:

```js
{ index, name, mimeType, fileSize }
```

`mimeType` is `null` when absent. `fileSize` is `-1` when file bytes are not readable.

## `queryFormFields`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `password` | string | No | `""` | PDF password. |

Returns `{ fields }`, where each field has:

```js
{
  index,
  type,
  flags,
  controlCount,
  name,
  alternateName,
  value,
  defaultValue,
  widgets: [
    {
      index,
      pageIndex,
      rect: { left, bottom, right, top },
      checked,
      defaultChecked,
      hasAppearance,
      exportValue,
      onStateName
    }
  ]
}
```

Form field type values are listed in [API Reference](API.md#forms).

## `setFormFieldValue`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `name` | string | Yes | `""` | Fully qualified AcroForm field name. |
| `value` | string | Yes | `""` | Replacement field value. Must be valid UTF-8. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

This updates AcroForm field values and regenerates text, combo, and list widget appearances when possible. It sets `/NeedAppearances` only when a widget still lacks a normal appearance. It does not run PDF JavaScript, calculation, validation, or XFA flows.

## `setFormFieldChecked`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `name` | string | Yes | `""` | Fully qualified checkbox or radio field name. |
| `controlIndex` | number | No | `0` | Zero-based widget/control index within the field. Radio groups use this to choose an option. |
| `checked` | boolean | Yes | `false` | Checked/selected state. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

This updates checkbox and radio widgets and selects the appropriate existing appearance state. It sets `/NeedAppearances` only when a widget still lacks a normal appearance.

## `readAttachment`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `attachmentIndex` | number | Yes | `-1` | Zero-based attachment index. |
| `password` | string | No | `""` | PDF password. |

Returns `{ attachment }`, where `attachment.fileBytes` is an `ArrayBuffer`.

## `addAttachment`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `name` | string | Yes | `""` | Embedded file name. Must be non-empty valid UTF-8. |
| `fileBytes` | `ArrayBuffer` or typed array | Yes | | Embedded file bytes. |
| `mimeType` | string | No | `""` | Optional MIME type. Must be 7-bit ASCII when present. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

## `updateAttachment`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `attachmentIndex` | number | Yes | `-1` | Zero-based attachment index. |
| `fileBytes` | `ArrayBuffer` or typed array | Yes | | Replacement embedded file bytes. |
| `mimeType` | string | No | `""` | Optional replacement MIME type. Must be 7-bit ASCII when present. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

## `deleteAttachment`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pdfBytes` | `ArrayBuffer` or typed array | Yes | | Input PDF. |
| `attachmentIndex` | number | Yes | `-1` | Zero-based attachment index. |
| `password` | string | No | `""` | PDF password. |

Returns `{ pdfBytes }`.

## `deletePageObject`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pageIndex` | number | No | `0` | Target page. |
| `objectIndex` | number | Yes | | Zero-based page object index. |

Returns `{ pdfBytes }`.

## `transformPageObject`

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `pageIndex` | number | No | `0` | Target page. |
| `objectIndex` | number | Yes | | Zero-based page object index. |
| `a`, `b`, `c`, `d`, `e`, `f` | number | Yes | | Affine matrix. Must be invertible. |

Returns `{ pdfBytes }`.

Matrix convention:

```text
x' = a*x + c*y + e
y' = b*x + d*y + f
```

## Transferables

Transfer input and output `ArrayBuffer` values when possible:

```js
worker.postMessage({ id, type, payload }, [payload.pdfBytes]);
```

After transfer, the original buffer is detached. Keep a copy if you need to reuse the same bytes for a later request.
