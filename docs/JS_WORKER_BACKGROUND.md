# Running as a JavaScript Worker (Background)

## Why use a Worker

PDF parsing/editing can block the main UI thread. A Worker moves that work to background execution.

## Current build support

The linker already includes:
- `-sENVIRONMENT=web,worker,node`

So the generated module can run inside a Web Worker.

## Worker integration pattern

### 1) Create worker file

Example `worker/pdfium-worker.js`:

```js
import PdfiumWasm from "../dist/pdfium.js";

let modPromise = null;

async function getModule() {
  if (!modPromise) {
    modPromise = PdfiumWasm();
  }
  return modPromise;
}

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === "addText") {
    try {
      const mod = await getModule();
      mod.ccall("wasm_pdfium_init", "number", [], []);

      const inBytes = new Uint8Array(payload.pdfBytes);
      const inPtr = mod._malloc(inBytes.length);
      mod.HEAPU8.set(inBytes, inPtr);

      const handle = mod.ccall(
        "wasm_pdf_open_from_bytes",
        "number",
        ["number", "number", "string"],
        [inPtr, inBytes.length, ""]
      );

      if (!handle) throw new Error("open failed");

      const ok = mod.ccall(
        "wasm_pdf_add_text_page",
        "number",
        ["number", "number", "string", "number", "number", "number", "number"],
        [handle, payload.pageIndex ?? 0, payload.text, payload.x ?? 80, payload.y ?? 120, payload.fontSize ?? 16, payload.rgba ?? 0xff000000]
      );

      if (!ok) throw new Error("add text failed");

      const outPtrPtr = mod._malloc(4);
      const outSizePtr = mod._malloc(4);

      const saved = mod.ccall("wasm_pdf_save_copy", "number", ["number", "number", "number"], [handle, outPtrPtr, outSizePtr]);
      if (!saved) throw new Error("save failed");

      const outPtr = mod.getValue(outPtrPtr, "i32");
      const outSize = mod.getValue(outSizePtr, "i32");
      const out = new Uint8Array(mod.HEAPU8.subarray(outPtr, outPtr + outSize));

      mod.ccall("wasm_pdf_free_buffer", null, ["number"], [outPtr]);
      mod.ccall("wasm_pdf_close", null, ["number"], [handle]);
      mod._free(inPtr);
      mod._free(outPtrPtr);
      mod._free(outSizePtr);

      self.postMessage({ type: "ok", payload: out.buffer }, [out.buffer]);
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }
};
```

### 2) Main thread usage

```js
const worker = new Worker(new URL("./worker/pdfium-worker.js", import.meta.url), { type: "module" });

worker.onmessage = (e) => {
  if (e.data.type === "ok") {
    const bytes = new Uint8Array(e.data.payload);
    // use resulting PDF bytes
  }
};

worker.postMessage(
  {
    type: "addText",
    payload: { pdfBytes: inputBytes.buffer, text: "Hello from worker" }
  },
  [inputBytes.buffer]
);
```

## Important notes

- Use transferable objects (`ArrayBuffer`) to avoid copies.
- Initialize module once per worker and reuse it.
- Keep all `malloc/free` balanced in worker code.
- If your bundler rewrites asset paths, configure `locateFile` for `.wasm` resolution.
