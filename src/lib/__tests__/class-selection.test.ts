import assert from "node:assert";
import { describe, it } from "node:test";
import {
  applyRowClick,
  clampMenuPosition,
  emptyClassSelection,
  formatIcCodes,
  icCodesForSelection,
  selectionForContextMenu,
  singleClassSelection,
} from "../class-selection.ts";

const ORDER = [10, 20, 30, 40, 50];

describe("formatIcCodes", () => {
  it("writes one code per line with no quotes, padding, or trailing blank line", () => {
    const text = formatIcCodes(["2BB06B0BZHS", "2BB06B2SZ", "2BB08D2HZ"]);
    assert.strictEqual(text, "2BB06B0BZHS\n2BB06B2SZ\n2BB08D2HZ");
    assert.strictEqual(text.endsWith("\n"), false);
    assert.strictEqual(text.includes('"'), false);
    assert.strictEqual(text.includes("'"), false);
    assert.strictEqual(text.includes(" "), false);
  });

  it("trims each code and drops blank lines", () => {
    assert.strictEqual(
      formatIcCodes(["  2BB06B0BZHS  ", " ", "\n2BB06B2SZ\r"]),
      "2BB06B0BZHS\n2BB06B2SZ",
    );
    assert.strictEqual(formatIcCodes(["  2BB08D2HZ  "]), "2BB08D2HZ");
    assert.strictEqual(formatIcCodes([]), "");
  });

  it("pastes into the label-code splitter as the same codes", () => {
    const text = formatIcCodes(["2BB06B0BZHS", "2BB06B2SZ", "2BB08D2HZ"]);
    const tokens = text
      .split(/[\s,;]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    assert.deepStrictEqual(tokens, ["2BB06B0BZHS", "2BB06B2SZ", "2BB08D2HZ"]);
  });
});

describe("icCodesForSelection", () => {
  const rows = [
    { id: 1, ic: "2BB06B0BZHS" },
    { id: 2, ic: "2BB06B2SZ" },
    { id: 3, ic: "2BB08D2HZ" },
  ];

  it("emits selected codes in table order, not click order", () => {
    assert.strictEqual(icCodesForSelection(rows, new Set([3, 1])), "2BB06B0BZHS\n2BB08D2HZ");
  });
});

describe("applyRowClick", () => {
  it("plain click selects only that row", () => {
    const start = applyRowClick({
      selection: singleClassSelection(10),
      orderedIds: ORDER,
      clickedId: 30,
      ctrl: true,
      shift: false,
    });
    const next = applyRowClick({
      selection: start,
      orderedIds: ORDER,
      clickedId: 50,
      ctrl: false,
      shift: false,
    });
    assert.deepStrictEqual([...next.ids], [50]);
    assert.strictEqual(next.anchorId, 50);
    assert.strictEqual(next.activeId, 50);
  });

  it("ctrl+click toggles rows and keeps the inspector row until it is removed", () => {
    let selection = singleClassSelection(10);
    selection = applyRowClick({
      selection,
      orderedIds: ORDER,
      clickedId: 30,
      ctrl: true,
      shift: false,
    });
    assert.deepStrictEqual(
      [...selection.ids].sort((a, b) => a - b),
      [10, 30],
    );
    assert.strictEqual(selection.activeId, 10);
    assert.strictEqual(selection.anchorId, 30);

    selection = applyRowClick({
      selection,
      orderedIds: ORDER,
      clickedId: 50,
      ctrl: true,
      shift: false,
    });
    assert.deepStrictEqual(
      [...selection.ids].sort((a, b) => a - b),
      [10, 30, 50],
    );
    assert.strictEqual(selection.activeId, 10);

    selection = applyRowClick({
      selection,
      orderedIds: ORDER,
      clickedId: 10,
      ctrl: true,
      shift: false,
    });
    assert.deepStrictEqual(
      [...selection.ids].sort((a, b) => a - b),
      [30, 50],
    );
    assert.strictEqual(selection.activeId, 50);
  });

  it("ctrl+click on the only selected row leaves it selected", () => {
    const next = applyRowClick({
      selection: singleClassSelection(20),
      orderedIds: ORDER,
      clickedId: 20,
      ctrl: true,
      shift: false,
    });
    assert.deepStrictEqual([...next.ids], [20]);
    assert.strictEqual(next.activeId, 20);
  });

  it("shift+click selects the inclusive range and does not move the anchor", () => {
    const next = applyRowClick({
      selection: singleClassSelection(20),
      orderedIds: ORDER,
      clickedId: 50,
      ctrl: false,
      shift: true,
    });
    assert.deepStrictEqual([...next.ids], [20, 30, 40, 50]);
    assert.strictEqual(next.anchorId, 20);
    assert.strictEqual(next.activeId, 20);
  });

  it("shift+click upward selects the range back to the anchor", () => {
    const next = applyRowClick({
      selection: singleClassSelection(40),
      orderedIds: ORDER,
      clickedId: 10,
      ctrl: false,
      shift: true,
    });
    assert.deepStrictEqual([...next.ids], [10, 20, 30, 40]);
    assert.strictEqual(next.activeId, 40);
  });

  it("a later shift+click replaces the range from the same anchor", () => {
    const first = applyRowClick({
      selection: singleClassSelection(20),
      orderedIds: ORDER,
      clickedId: 50,
      ctrl: false,
      shift: true,
    });
    const next = applyRowClick({
      selection: first,
      orderedIds: ORDER,
      clickedId: 30,
      ctrl: false,
      shift: true,
    });
    assert.deepStrictEqual([...next.ids], [20, 30]);
    assert.strictEqual(next.anchorId, 20);
  });

  it("shift+click points the inspector at the clicked row when the old one is outside the range", () => {
    const next = applyRowClick({
      selection: { ids: new Set([10]), anchorId: 30, activeId: 10 },
      orderedIds: ORDER,
      clickedId: 50,
      ctrl: false,
      shift: true,
    });
    assert.deepStrictEqual([...next.ids], [30, 40, 50]);
    assert.strictEqual(next.anchorId, 30);
    assert.strictEqual(next.activeId, 50);
  });
});

describe("selectionForContextMenu", () => {
  it("keeps every selected row when the menu opens on one of them", () => {
    const selection = applyRowClick({
      selection: singleClassSelection(10),
      orderedIds: ORDER,
      clickedId: 30,
      ctrl: true,
      shift: false,
    });
    assert.strictEqual(selectionForContextMenu(selection, 30), selection);
  });

  it("selects only the row when the menu opens outside the selection", () => {
    const selection = singleClassSelection(10);
    const next = selectionForContextMenu(selection, 40);
    assert.deepStrictEqual([...next.ids], [40]);
    assert.strictEqual(next.activeId, 40);
  });

  it("copies the opened selection in table order", () => {
    const rows = [
      { id: 10, ic: "2BB06B0BZHS" },
      { id: 20, ic: "2BB06B2SZ" },
      { id: 30, ic: "2BB08D2HZ" },
    ];
    let selection = emptyClassSelection();
    selection = applyRowClick({
      selection,
      orderedIds: [10, 20, 30],
      clickedId: 30,
      ctrl: false,
      shift: false,
    });
    selection = applyRowClick({
      selection,
      orderedIds: [10, 20, 30],
      clickedId: 10,
      ctrl: true,
      shift: false,
    });
    const opened = selectionForContextMenu(selection, 10);
    assert.strictEqual(icCodesForSelection(rows, opened.ids), "2BB06B0BZHS\n2BB08D2HZ");
  });
});

describe("clampMenuPosition", () => {
  it("keeps the menu inside the viewport", () => {
    assert.deepStrictEqual(clampMenuPosition(900, 700, { width: 800, height: 600 }), {
      x: 636,
      y: 672,
    });
    assert.deepStrictEqual(clampMenuPosition(-20, -10, { width: 800, height: 600 }), {
      x: 4,
      y: 4,
    });
  });
});
