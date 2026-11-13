import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const page = fs.readFileSync("src/components/classes-admin.tsx", "utf8");
assert.match(page, /applyRowClick/);
assert.match(page, /event\.ctrlKey \|\| event\.metaKey/);
assert.match(page, /event\.shiftKey/);
assert.match(page, /onContextMenu/);
assert.match(page, /Copy all codes/);
assert.match(page, /aria-label="Class row menu"/);

const test = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", "src/lib/__tests__/class-selection.test.ts"],
  { stdio: "inherit" },
);
if (test.status !== 0) {
  process.exit(test.status ?? 1);
}

console.log("Class multi-select verification passed.");
