import { describe, it } from "node:test";
import assert from "node:assert";
import { classFill, inkOn } from "../class-color.ts";

describe("class-color", () => {
  describe("classFill", () => {
    it("returns stored color if valid", () => {
      assert.strictEqual(classFill(1, "#ff0000"), "#ff0000");
      assert.strictEqual(classFill(1, "#00FF00"), "#00FF00");
    });

    it("returns fallback color if stored color is invalid", () => {
      assert.match(classFill(1, "red"), /^#[0-9a-fA-F]{6}$/);
      assert.match(classFill(1, "#fff"), /^#[0-9a-fA-F]{6}$/); // too short
      assert.match(classFill(1, "#ffffffff"), /^#[0-9a-fA-F]{6}$/); // too long
    });

    it("returns fallback color if stored color is null or undefined", () => {
      assert.match(classFill(1, null), /^#[0-9a-fA-F]{6}$/);
      assert.match(classFill(1), /^#[0-9a-fA-F]{6}$/);
    });

    it("generates consistent color based on id", () => {
      const color1 = classFill(1);
      const color2 = classFill(1);
      assert.strictEqual(color1, color2);
    });

    it("handles negative ids", () => {
      const colorPos = classFill(1);
      const colorNeg = classFill(-1);
      assert.strictEqual(colorPos, colorNeg);
    });
  });

  describe("inkOn", () => {
    it("returns light text (#faf9f7) for dark backgrounds", () => {
      assert.strictEqual(inkOn("#000000"), "#faf9f7");
      assert.strictEqual(inkOn("#d7263d"), "#faf9f7");
      assert.strictEqual(inkOn("#2c6fbb"), "#faf9f7");
    });

    it("returns dark text (#1c1b19) for light backgrounds", () => {
      assert.strictEqual(inkOn("#ffffff"), "#1c1b19");
      assert.strictEqual(inkOn("#ffff00"), "#1c1b19");
    });

    it("returns fallback light text for invalid colors", () => {
      assert.strictEqual(inkOn("not-a-color"), "#faf9f7");
    });
  });
});
