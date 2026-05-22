export const KEYBOARD_ACTIONS = Object.freeze({
  CLEAR_SELECTION: "clearSelection",
  DELETE_SELECTION: "deleteSelection",
  SAVE: "save",
  NUDGE: "nudge",
  UNDO: "undo",
  REDO: "redo",
});

const ARROW_DELTAS = Object.freeze({
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
});

export function isEditableShortcutTarget(target) {
  return Boolean(target?.isContentEditable || target?.closest?.("input,textarea,select,[contenteditable]:not([contenteditable=false])"));
}

export function keyboardShortcutFromEvent(event) {
  const key = event.key;
  const command = event.metaKey || event.ctrlKey;

  if (key === "Escape") {
    return { action: KEYBOARD_ACTIONS.CLEAR_SELECTION, preventDefault: false };
  }

  if (key === "Delete" || key === "Backspace") {
    return { action: KEYBOARD_ACTIONS.DELETE_SELECTION, preventDefault: true };
  }

  if (command && key.toLowerCase() === "s") {
    return { action: KEYBOARD_ACTIONS.SAVE, preventDefault: true };
  }

  if (command && key.toLowerCase() === "z") {
    return {
      action: event.shiftKey ? KEYBOARD_ACTIONS.REDO : KEYBOARD_ACTIONS.UNDO,
      preventDefault: true,
    };
  }

  if (ARROW_DELTAS[key]) {
    const multiplier = event.altKey ? 0.25 : event.shiftKey ? 10 : 1;
    return {
      action: KEYBOARD_ACTIONS.NUDGE,
      preventDefault: true,
      delta: {
        x: ARROW_DELTAS[key].x * multiplier,
        y: ARROW_DELTAS[key].y * multiplier,
      },
    };
  }

  return null;
}
