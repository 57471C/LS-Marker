import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

console.log("Starting Column Resize verification...");

// 1. Check file existence
const hookPath = path.resolve("src/lib/use-column-resize.tsx");
assert.ok(fs.existsSync(hookPath), "src/lib/use-column-resize.tsx must exist");

const hookContent = fs.readFileSync(hookPath, "utf-8");
assert.ok(hookContent.includes("useColumnResize"), "Must export useColumnResize");
assert.ok(hookContent.includes("ColumnResizeHandle"), "Must export ColumnResizeHandle");
assert.ok(hookContent.includes("localStorage.setItem"), "Must persist to localStorage");

// 2. Check PhotosPage integration
const photosPagePath = path.resolve("src/components/photos-page.tsx");
const photosContent = fs.readFileSync(photosPagePath, "utf-8");
assert.ok(photosContent.includes("useColumnResize"), "PhotosPage must use useColumnResize");
assert.ok(photosContent.includes("ColumnResizeHandle"), "PhotosPage must use ColumnResizeHandle");
assert.ok(
  photosContent.includes("ls_marker_photos_col_widths"),
  "PhotosPage must have localStorage key",
);
assert.ok(photosContent.includes("PHOTO_COLUMNS"), "PhotosPage must define PHOTO_COLUMNS");
assert.ok(
  photosContent.includes("overflow-x-auto"),
  "PhotosPage must allow horizontal scroll if columns widen",
);

// 3. Check ClassesAdmin integration
const classesPagePath = path.resolve("src/components/classes-admin.tsx");
const classesContent = fs.readFileSync(classesPagePath, "utf-8");
assert.ok(classesContent.includes("useColumnResize"), "ClassesAdmin must use useColumnResize");
assert.ok(
  classesContent.includes("ColumnResizeHandle"),
  "ClassesAdmin must use ColumnResizeHandle",
);
assert.ok(
  classesContent.includes("ls_marker_classes_col_widths"),
  "ClassesAdmin must have localStorage key",
);
assert.ok(classesContent.includes("CLASS_COLUMNS"), "ClassesAdmin must define CLASS_COLUMNS");
assert.ok(
  classesContent.includes("overflow-x-auto"),
  "ClassesAdmin must allow horizontal scroll if columns widen",
);

console.log("All Column Resize verification checks passed successfully!");
process.exit(0);
