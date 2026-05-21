# Forms Demo Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample demonstrates basic AcroForm inspection and editing. It preloads `../demo.pdf`, renders pages, lists form fields, previews widget geometry over the canvas, edits supported field values, and saves the modified PDF.

## What It Covers

- Preloads `../demo.pdf` on startup.
- Loads a replacement PDF from a local file input.
- Renders the current page with `renderPage()`.
- Lists AcroForm fields with `formFields()`.
- Shows field type, flags, value, default value, widget count, widget geometry, checked state, choice options, and appearance state.
- Draws form widget rectangles over the rendered canvas.
- Edits text fields with `setFormFieldValue(name, value)`.
- Toggles checkbox widgets with `setFormFieldChecked(name, checked, controlIndex)`.
- Selects radio widgets with `setFormFieldChecked(name, true, controlIndex)`.
- Selects combo/list options with `setFormFieldSelectedIndex(name, optionIndex)`.
- Saves the modified PDF with `doc.save()`.

## Run

Build the wrapper first:

```bash
./scripts/build_wrapper_wasm.sh
```

Serve the repository root:

```bash
npm run examples
```

Open:

```text
http://localhost:8080/examples/forms-demo/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF stays local in the browser.
- The sample preloads `../demo.pdf` on startup. Use the file input to replace it with a PDF containing AcroForm fields if the demo file has no fields.
- This sample uses the direct API on the main thread.
- PDF coordinates use a bottom-left origin; canvas coordinates use a top-left origin. The sample uses `pdfRectToCanvasRect()` to convert widget rectangles for overlays.
- Text, combo, and list updates regenerate supported widget appearances. Checkbox/radio updates select existing appearance states.
- The API does not run PDF JavaScript, calculations, validation, or XFA flows.

## Next Improvements

- Add a bundled tiny AcroForm fixture for guaranteed form interactions.
- Add field filtering by type and page.
- Add read-only/required flag decoding instead of showing raw flag bits only.
- Add a worker-backed variant using `queryFormFields`, `setFormFieldValue`, `setFormFieldChecked`, and `setFormFieldSelectedIndex`.
