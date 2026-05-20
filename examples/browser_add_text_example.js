import { createPdfiumApi } from "../pdfium-api.js";

async function addTextToPdf(inputBytes, text) {
  const pdfium = await createPdfiumApi({
    locateFile(file) {
      return new URL(`../dist/${file}`, import.meta.url).href;
    },
  });

  try {
    return await pdfium.withDocument(inputBytes, (doc) => {
      doc.addText({
        pageIndex: 0,
        text,
        x: 80,
        y: 120,
        fontSize: 16,
        rgba: 0xff0066cc,
      });

      return doc.save();
    });
  } finally {
    pdfium.destroy();
  }
}

export { addTextToPdf };
