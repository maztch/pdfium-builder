export function renderSelectionInspector(container, selection) {
  container.replaceChildren();

  if (!selection?.selectedItems?.length) {
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "Select text, an object, an annotation, or a form widget to inspect it.";
    container.append(empty);
    return;
  }

  if (selection.selectedItems.length > 1) {
    appendMetric(container, "Selected items", String(selection.selectedItems.length));
    const list = document.createElement("div");
    list.className = "inspector-list";
    selection.selectedItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "inspector-row";
      row.textContent = `${item.kind}: ${item.label || item.key || item.index}`;
      list.append(row);
    });
    container.append(list);
    return;
  }

  const item = selection.selectedItems[0];
  appendMetric(container, "Type", item.kind || "-");
  appendMetric(container, "Label", item.label || "-");
  appendMetric(container, "Page", Number.isInteger(item.pageIndex) ? String(item.pageIndex + 1) : "-");
  appendMetric(container, "Index", Number.isInteger(item.index) ? String(item.index) : "-");
  appendMetric(container, "Key", item.key || "-");
  appendRect(container, item.rect);
  appendKindDetails(container, item);
}

function appendKindDetails(container, item) {
  const data = item.data || {};
  if (item.kind === "text") {
    appendMetric(container, "Text", item.text || data.text || "-");
    appendMetric(container, "Start index", valueOrDash(item.startIndex ?? data.startIndex));
    appendMetric(container, "Character count", valueOrDash(item.charCount ?? data.charCount));
    return;
  }

  if (item.kind === "pageObject" || item.kind === "image") {
    appendMetric(container, "Object type", item.typeName || data.typeName || "-");
    appendMetric(container, "Object type id", valueOrDash(item.type ?? data.type));
    if (item.kind === "image") appendMetric(container, "Selectable kind", "image page object");
    return;
  }

  if (item.kind === "annotation") {
    appendMetric(container, "Subtype", item.subtypeName || data.subtypeName || "-");
    appendMetric(container, "Flags", valueOrDash(item.flags ?? data.flags));
    appendMetric(container, "Color", formatRgba(item.colorRgba ?? data.colorRgba));
    appendMetric(container, "Border width", valueOrDash(item.borderWidth ?? data.borderWidth));
    appendMetric(container, "Contents", item.contents || data.contents || "-");
    appendMetric(container, "URI", item.uri || data.uri || "-");
    appendMetric(container, "Quad points", String((item.quadPoints || data.quadPoints || []).length));
    return;
  }

  if (item.kind === "formWidget") {
    const field = data.field || {};
    const widget = data.widget || {};
    appendMetric(container, "Field name", data.fieldName || field.name || "-");
    appendMetric(container, "Field type", valueOrDash(data.fieldType ?? field.type));
    appendMetric(container, "Field value", field.value || "-");
    appendMetric(container, "Widget index", valueOrDash(widget.index ?? item.index));
    appendMetric(container, "Checked", typeof widget.checked === "boolean" ? (widget.checked ? "yes" : "no") : "-");
    appendMetric(container, "Has appearance", typeof widget.hasAppearance === "boolean" ? (widget.hasAppearance ? "yes" : "no") : "-");
  }
}

function appendRect(container, rect) {
  if (!rect) {
    appendMetric(container, "Bounds", "-");
    return;
  }
  appendMetric(container, "Left", formatNumber(rect.left));
  appendMetric(container, "Bottom", formatNumber(rect.bottom));
  appendMetric(container, "Right", formatNumber(rect.right));
  appendMetric(container, "Top", formatNumber(rect.top));
  appendMetric(container, "Width", formatNumber(rect.right - rect.left));
  appendMetric(container, "Height", formatNumber(rect.top - rect.bottom));
}

function appendMetric(container, label, value) {
  const row = document.createElement("div");
  row.className = "metric inspector-metric";
  const name = document.createElement("span");
  name.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = String(value);
  row.append(name, strong);
  container.append(row);
}

function valueOrDash(value) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "-";
}

function formatRgba(value) {
  return Number.isInteger(value) ? `0x${(value >>> 0).toString(16).padStart(8, "0")}` : "-";
}
