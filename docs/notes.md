# Notes

- PDFium only exposes public metadata read APIs, so metadata write support uses PDFium internal `/Info` dictionary APIs in this custom wrapper build.
- FreeText annotation creation uses PDFium appearance-generation internals so visible editable text boxes render immediately after creation.
