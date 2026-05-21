# Attachments Panel Sample

Sample file: [`index.html`](index.html)

## Purpose

This sample demonstrates document-level embedded file workflows. It preloads `../demo.pdf`, renders the current page, lists embedded attachments, downloads selected attachment bytes, adds new attachments, replaces selected attachment bytes/MIME type, deletes attachments, and saves the modified PDF.

## What It Covers

- Preloads `../demo.pdf` on startup.
- Loads a replacement PDF from a local file input.
- Renders the current page with `renderPage()`.
- Lists embedded files with `attachments()`.
- Reads selected attachment bytes with `readAttachment(index)`.
- Adds embedded files with `addAttachment({ name, fileBytes, mimeType })`.
- Replaces selected embedded file bytes with `updateAttachment(index, { fileBytes, mimeType })`.
- Deletes selected embedded files with `deleteAttachment(index)`.
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
http://localhost:8080/examples/attachments-panel/
```

## Notes

- Do not open the file directly with `file://`; browser module and WASM loading rules usually block that.
- The selected PDF and embedded files stay local in the browser.
- Attachment APIs operate on document-level embedded files, not file-attachment annotations.
- Replacing an attachment keeps the existing attachment name and updates file bytes plus MIME type.
- Attachment changes are applied to the in-memory PDF first. Use **Save PDF** to download the modified file.

## Next Improvements

- Add drag-and-drop upload for new attachments.
- Add inline text preview for small text attachments.
- Add duplicate-name warnings before adding a new embedded file.
- Add a worker-backed variant using `queryAttachments`, `readAttachment`, `addAttachment`, `updateAttachment`, and `deleteAttachment`.
