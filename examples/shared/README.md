# Shared Example Viewer Utilities

These modules hold reusable browser-side viewer helpers used by the examples.

## Modules

- [`pdf-coordinates.js`](pdf-coordinates.js): PDF/canvas/client coordinate conversion and rectangle tests.
- [`overlays.js`](overlays.js): DOM overlay rectangle creation and clearing.
- [`viewer-core.js`](viewer-core.js): zoom helpers, render-size calculation, and RGBA canvas drawing.
- [`hit-testing.js`](hit-testing.js): basic point and area hit-testing against selectable item rectangles.
- [`keyboard-shortcuts.js`](keyboard-shortcuts.js): keyboard shortcut classification and editable-target filtering for viewer/editor commands.
- [`pdf-history.js`](pdf-history.js): bounded full-PDF byte snapshot stacks for undo/redo foundations.
- [`selection-state.js`](selection-state.js): editor selection modes, selected/hover item state, drag state, and item identity helpers.
- [`selection-inspector.js`](selection-inspector.js): read-only selected item inspector renderer for the normalized selectable item shape.
- [`pointer-interactions.js`](pointer-interactions.js): mode-aware selectable item filtering, pointer coordinate conversion, hit testing, and rubber-band area selection helpers.
- [`selection-overlays.js`](selection-overlays.js): DOM overlay renderer for hover, selected, multi-selected, text-highlight, resize-handle, drag-ghost, and marquee UI.

## Scope

The shared code is intentionally UI-framework-free. Examples should pass plain DOM elements, PDF page sizes, render sizes, and item rectangles.

This is the foundation for the editor selection layer described in [`../../docs/EDITOR_SELECTION_PLAN.md`](../../docs/EDITOR_SELECTION_PLAN.md).
