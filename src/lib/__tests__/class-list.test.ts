import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildClassSearch, filterClassSearch, mergeClassRow } from "../class-list.ts";
import type { ClassRow } from "../label-client.ts";

function row(id: number, ic = `IC-${id}`, des = `Desc ${id}`): ClassRow {
  return { id, ic, des, color: "#112233" };
}

describe("class list updates", () => {
  it("appends a new highest id without copying the other rows", () => {
    const existing = [row(0), row(1), row(4)];
    const created = row(5, "NEW", "New class");
    const next = mergeClassRow(existing, created);
    assert.equal(next.length, 4);
    assert.equal(next[3], created);
    assert.equal(next[0], existing[0]);
    assert.equal(next[1], existing[1]);
    assert.equal(next[2], existing[2]);
  });

  it("replaces one row and keeps every other object", () => {
    const existing = [row(0), row(1), row(2)];
    const next = mergeClassRow(existing, { ...existing[1], des: "Edited" });
    assert.equal(next[0], existing[0]);
    assert.equal(next[2], existing[2]);
    assert.equal(next[1].des, "Edited");
    assert.notEqual(next[1], existing[1]);
  });

  it("inserts an out-of-order id without a full sort of the other rows", () => {
    const existing = [row(0), row(2), row(4)];
    const next = mergeClassRow(existing, row(3));
    assert.deepEqual(
      next.map((item) => item.id),
      [0, 2, 3, 4],
    );
    assert.equal(next[0], existing[0]);
    assert.equal(next[1], existing[1]);
    assert.equal(next[3], existing[2]);
  });

  it("filters from a prebuilt index and returns the same array when the query is empty", () => {
    const classes = [row(0, "HX-M8", "Hex bolt"), row(12, "NUT-M8", "Hex nut")];
    const index = buildClassSearch(classes);
    assert.equal(filterClassSearch(classes, index, "   "), classes);
    assert.deepEqual(
      filterClassSearch(classes, index, "nut").map((item) => item.id),
      [12],
    );
    assert.deepEqual(
      filterClassSearch(classes, index, "hx").map((item) => item.id),
      [0],
    );
    assert.deepEqual(
      filterClassSearch(classes, index, "12").map((item) => item.id),
      [12],
    );
  });

  it("merges and filters a large class list quickly", () => {
    const classes: ClassRow[] = [];
    for (let id = 0; id < 20000; id += 1) classes.push(row(id));
    const started = performance.now();
    const merged = mergeClassRow(classes, row(20000, "FAST-ADD", "Added class"));
    const index = buildClassSearch(merged);
    const matched = filterClassSearch(merged, index, "fast-add");
    const elapsed = performance.now() - started;
    assert.equal(merged.length, 20001);
    assert.equal(merged[0], classes[0]);
    assert.equal(merged[19999], classes[19999]);
    assert.equal(matched.length, 1);
    assert.equal(matched[0].ic, "FAST-ADD");
    assert.ok(elapsed < 250, `large class update took ${elapsed.toFixed(1)}ms`);
  });
});
