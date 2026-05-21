# AGENTS.md

Guidance for coding agents working in this repository.

## Project Shape

- This repo builds a PDFium WebAssembly wrapper with native exports in `wasm/pdfium_edit_wrapper.cc`.
- `pdfium-api.js` is the preferred direct ES module wrapper for app/sample code. Add helpers here when a feature would otherwise require manual `_malloc`, `ccall`, output-pointer, or handle cleanup in examples.
- `worker/pdfium-worker.js` exposes the worker protocol for browser background usage.
- Browser examples live under `examples/<sample-name>/` and should each include a local `README.md`.
- Documentation lives under `docs/`.
- `tests/smoke_node.cjs` is the main regression smoke test.

## Development Rules

- Do not edit `third_party/` unless explicitly requested.
- Do not revert user changes. The worktree may be dirty.
- Prefer direct wrapper helpers in `pdfium-api.js` over raw native calls in examples.
- Keep examples browser-friendly and serve them with `npm run examples`; do not rely on `file://`.
- Standalone examples should preload `examples/demo.pdf` and still allow a user-selected local PDF.
- Keep generated native output buffers balanced with `wasm_pdf_free_buffer` when working below `pdfium-api.js`.
- Keep document handles balanced with `wasm_pdf_close` / `doc.close()`.
- For worker request handlers, close document handles and free request-local allocations in `finally` paths.

## Validation

Run targeted checks after changes:

```bash
node --check pdfium-api.js
node --check tests/smoke_node.cjs
npm run smoke
```

For HTML examples with embedded ES modules, extract the module and check it:

```bash
node - <<'NODE'
const fs = require('fs');
const html = fs.readFileSync('examples/<sample>/index.html', 'utf8');
const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!match) throw new Error('module script not found');
fs.writeFileSync('/tmp/example-module.js', match[1]);
NODE
node --check /tmp/example-module.js
```

Check docs fences when editing markdown:

```bash
node - <<'NODE'
const fs = require('fs');
for (const file of ['docs/VIEWER_SAMPLES.md', 'examples/README.md']) {
  const text = fs.readFileSync(file, 'utf8');
  const fences = (text.match(new RegExp('`{3}', 'g')) || []).length;
  if (fences % 2) throw new Error(`${file}: unbalanced markdown fences`);
}
NODE
```

Run whitespace validation on touched files:

```bash
git diff --check -- <touched-files>
```

## Example Expectations

Each browser example should usually include:

- `index.html`
- `README.md`
- automatic `../demo.pdf` preload
- local file input replacement
- clear status/error reporting
- Save PDF when the sample mutates the document
- `beforeunload` cleanup for open documents and API instances

## Current Editor Roadmap

The selection/editor roadmap is documented in:

- `docs/EDITOR_SELECTION_PLAN.md`

Before implementing deep editor behavior, prefer closing these gaps:

- shared viewer coordinate/overlay utilities
- direct page object helpers
- direct annotation helpers
- text-run or character-box API
- shared selection model and hit testing
- undo/redo snapshot foundation
