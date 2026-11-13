export type ClassSelection = {
  ids: ReadonlySet<number>;
  anchorId: number | null;
  activeId: number | null;
};

export function emptyClassSelection(): ClassSelection {
  return { ids: new Set(), anchorId: null, activeId: null };
}

export function singleClassSelection(id: number): ClassSelection {
  return { ids: new Set([id]), anchorId: id, activeId: id };
}

/**
 * Clipboard text for the labeler's "Paste item codes" box.
 * One trimmed IC per line, no wrapping quotes, no trailing blank line.
 */
export function formatIcCodes(codes: readonly string[]): string {
  const lines: string[] = [];
  for (const code of codes) {
    const trimmed = code.replace(/[\r\n]+/g, "").trim();
    if (trimmed.length > 0) lines.push(trimmed);
  }
  return lines.join("\n");
}

export function icCodesForSelection(
  rows: readonly { id: number; ic: string }[],
  selectedIds: ReadonlySet<number>,
): string {
  const codes: string[] = [];
  for (const row of rows) {
    if (selectedIds.has(row.id)) codes.push(row.ic);
  }
  return formatIcCodes(codes);
}

function activeIn(
  ids: ReadonlySet<number>,
  orderedIds: readonly number[],
  preferred: number | null,
  fallback: number,
): number {
  if (preferred != null && ids.has(preferred)) return preferred;
  for (let i = orderedIds.length - 1; i >= 0; i--) {
    const id = orderedIds[i];
    if (id !== undefined && ids.has(id)) return id;
  }
  return fallback;
}

export function applyRowClick(args: {
  selection: ClassSelection;
  orderedIds: readonly number[];
  clickedId: number;
  ctrl: boolean;
  shift: boolean;
}): ClassSelection {
  const { selection, orderedIds, clickedId, ctrl, shift } = args;
  const anchorIndex = selection.anchorId == null ? -1 : orderedIds.indexOf(selection.anchorId);
  const clickIndex = orderedIds.indexOf(clickedId);

  if (shift && anchorIndex >= 0 && clickIndex >= 0) {
    const start = Math.min(anchorIndex, clickIndex);
    const end = Math.max(anchorIndex, clickIndex);
    const ids = ctrl ? new Set(selection.ids) : new Set<number>();
    for (let i = start; i <= end; i++) {
      const id = orderedIds[i];
      if (id !== undefined) ids.add(id);
    }
    if (ids.size === 0) ids.add(clickedId);
    const activeId =
      selection.activeId != null && ids.has(selection.activeId) ? selection.activeId : clickedId;
    return {
      ids,
      anchorId: selection.anchorId,
      activeId,
    };
  }

  if (ctrl) {
    const ids = new Set(selection.ids);
    if (ids.has(clickedId) && ids.size > 1) {
      ids.delete(clickedId);
      return {
        ids,
        anchorId: clickedId,
        activeId: activeIn(ids, orderedIds, selection.activeId, clickedId),
      };
    }
    if (!ids.has(clickedId)) {
      ids.add(clickedId);
      return {
        ids,
        anchorId: clickedId,
        activeId: activeIn(ids, orderedIds, selection.activeId, clickedId),
      };
    }
    return { ids, anchorId: clickedId, activeId: clickedId };
  }

  return singleClassSelection(clickedId);
}

/** Right-click keeps a multi-selection when the row is already in it. */
export function selectionForContextMenu(
  selection: ClassSelection,
  clickedId: number,
): ClassSelection {
  if (selection.ids.has(clickedId)) return selection;
  return singleClassSelection(clickedId);
}

export function clampMenuPosition(
  x: number,
  y: number,
  viewport: { width: number; height: number },
  menu: { width: number; height: number } = { width: 160, height: 28 },
): { x: number; y: number } {
  let left = x;
  let top = y;
  if (left + menu.width > viewport.width - 4) left = viewport.width - menu.width - 4;
  if (top + menu.height > viewport.height - 4) top = y - menu.height;
  if (left < 4) left = 4;
  if (top < 4) top = 4;
  return { x: left, y: top };
}

export async function copyPlainText(text: string): Promise<void> {
  const canUseClipboard =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function" &&
    window.isSecureContext;
  if (canUseClipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("Could not copy codes to the clipboard");
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.width = "1px";
  area.style.height = "1px";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } finally {
    document.body.removeChild(area);
  }
  if (!ok) throw new Error("Could not copy codes to the clipboard");
}
