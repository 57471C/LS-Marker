import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import tar from "tar-stream";
import { createServer } from "vite";
import { boxTo4PointPolygon, clamp, formatYoloSegLine } from "./labelling-api.mjs";

console.log("=== LS-Marker Strict YOLO-seg Export Compliance Verification ===");

// 1. Unit Tests for Formatter & Bounding Box to Polygon Transformation
console.log("\n[1/3] Running unit tests on YOLO-seg transformations...");

// Test clamp
assert.equal(clamp(-0.000001), 0.0);
assert.equal(clamp(1.000002), 1.0);
assert.equal(clamp(0.456), 0.456);
assert.equal(clamp("0.75"), 0.75);

// Test boxTo4PointPolygon with center cx, cy
const testBoxCenter = { classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.4 };
const corners = boxTo4PointPolygon(testBoxCenter);
assert.equal(corners.length, 4);
// Top-Left: (0.4, 0.3)
assert.equal(corners[0][0], 0.4);
assert.equal(corners[0][1], 0.3);
// Top-Right: (0.6, 0.3)
assert.equal(corners[1][0], 0.6);
assert.equal(corners[1][1], 0.3);
// Bottom-Right: (0.6, 0.7)
assert.equal(corners[2][0], 0.6);
assert.equal(corners[2][1], 0.7);
// Bottom-Left: (0.4, 0.7)
assert.equal(corners[3][0], 0.4);
assert.equal(corners[3][1], 0.7);

// Test formatYoloSegLine on standard bounding box (must emit 9 tokens)
const boxSegLine = formatYoloSegLine(testBoxCenter);
const boxTokens = boxSegLine.trim().split(/\s+/);
assert.equal(boxTokens.length, 9, "Converted bounding box must have exactly 9 tokens");
assert.equal(boxTokens[0], "0");
assert.equal(boxTokens[1], "0.400000");
assert.equal(boxTokens[2], "0.300000");
assert.equal(boxTokens[3], "0.600000");
assert.equal(boxTokens[4], "0.300000");
assert.equal(boxTokens[5], "0.600000");
assert.equal(boxTokens[6], "0.700000");
assert.equal(boxTokens[7], "0.400000");
assert.equal(boxTokens[8], "0.700000");

// Test formatYoloSegLine on native polygon (must pass through untouched)
const testPolygon = {
  classId: 2,
  x: 0.5,
  y: 0.5,
  w: 0.6,
  h: 0.6,
  points: [
    [0.1, 0.2],
    [0.5, 0.8],
    [0.9, 0.2],
    [0.5, 0.1],
  ],
};
const polySegLine = formatYoloSegLine(testPolygon);
const polyTokens = polySegLine.trim().split(/\s+/);
assert.equal(polyTokens.length, 9, "4-point polygon must emit 9 tokens");
assert.equal(polyTokens[0], "2");
assert.equal(polyTokens[1], "0.100000");
assert.equal(polyTokens[2], "0.200000");
assert.equal(polyTokens[3], "0.500000");
assert.equal(polyTokens[4], "0.800000");
assert.equal(polyTokens[5], "0.900000");
assert.equal(polyTokens[6], "0.200000");
assert.equal(polyTokens[7], "0.500000");
assert.equal(polyTokens[8], "0.100000");

// Test clamping boundary floating point leaks
const leakingBox = { classId: 1, x: 0.05, y: 0.95, w: 0.2, h: 0.2 };
const leakingLine = formatYoloSegLine(leakingBox);
const leakingCoords = leakingLine.trim().split(/\s+/).slice(1).map(Number);
for (const coord of leakingCoords) {
  assert(coord >= 0.0 && coord <= 1.0, `Coordinate ${coord} must be within [0.0, 1.0]`);
}

console.log(
  "✓ Unit tests passed: 4-point conversion, 9-token format, and native polygon preservation.",
);

// Helper to unpack TAR in memory
function unpackTar(buffer) {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const files = new Map();

    extract.on("entry", (header, stream, next) => {
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        files.set(header.name, {
          header,
          content: Buffer.concat(chunks),
        });
        next();
      });
      stream.on("error", reject);
      stream.resume();
    });

    extract.on("finish", () => resolve(files));
    extract.on("error", reject);
    extract.end(buffer);
  });
}

// 2. Integration / End-to-End Export Test
const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");
const db = new Database(dbPath);
const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in labels.db for testing");

const projectFolder = path.resolve(root, project.folder);
const testBoxImg = "yolo_seg_test_box.jpg";
const testBoxTxt = "yolo_seg_test_box.txt";
const testPolyImg = "yolo_seg_test_poly.jpg";
const testPolyTxt = "yolo_seg_test_poly.txt";
const testMixedImg = "yolo_seg_test_mixed.jpg";
const testMixedTxt = "yolo_seg_test_mixed.txt";

const testBoxImgPath = path.join(projectFolder, testBoxImg);
const testBoxTxtPath = path.join(projectFolder, testBoxTxt);
const testPolyImgPath = path.join(projectFolder, testPolyImg);
const testPolyTxtPath = path.join(projectFolder, testPolyTxt);
const testMixedImgPath = path.join(projectFolder, testMixedImg);
const testMixedTxtPath = path.join(projectFolder, testMixedTxt);

// Create dummy image files
const dummyImgBuf = await sharp({
  create: { width: 100, height: 100, channels: 3, background: { r: 100, g: 150, b: 200 } },
})
  .jpeg({ quality: 80 })
  .toBuffer();

fs.writeFileSync(testBoxImgPath, dummyImgBuf);
fs.writeFileSync(testPolyImgPath, dummyImgBuf);
fs.writeFileSync(testMixedImgPath, dummyImgBuf);

// Image 1 on disk: pure standard bounding box (5 tokens)
fs.writeFileSync(testBoxTxtPath, "0 0.500000 0.500000 0.200000 0.300000\n", "utf8");

// Image 2 on disk: pure manual polygon (4 points = 9 tokens)
fs.writeFileSync(
  testPolyTxtPath,
  "0 0.150000 0.200000 0.850000 0.250000 0.800000 0.750000 0.200000 0.700000\n",
  "utf8",
);

// Image 3 on disk: mixed bounding box AND manual polygon in same image
fs.writeFileSync(
  testMixedTxtPath,
  `${[
    "0 0.250000 0.250000 0.100000 0.100000", // Box (5 tokens on disk)
    "0 0.600000 0.600000 0.900000 0.600000 0.900000 0.900000 0.600000 0.900000", // Polygon (9 tokens on disk)
  ].join("\n")}\n`,
  "utf8",
);

// Register test images in database
for (const imgName of [testBoxImg, testPolyImg, testMixedImg]) {
  db.prepare(
    `INSERT INTO images (project_id, file_path, name, status)
     VALUES (?, ?, ?, 'completed')
     ON CONFLICT(project_id, file_path) DO UPDATE SET status = 'completed'`,
  ).run(project.id, imgName, imgName);

  db.prepare(
    `INSERT INTO image_claims (project_id, rel_path, status)
     VALUES (?, ?, 'complete')
     ON CONFLICT(project_id, rel_path) DO UPDATE SET status = 'complete'`,
  ).run(project.id, imgName);
}

console.log("\n[2/3] Starting test server for export verification...");
const server = await createServer({
  root,
  server: { port: 3099 },
  logLevel: "warn",
});
await server.listen();
const port = server.config.server.port;
const baseUrl = `http://127.0.0.1:${port}`;
console.log(`Vite test server listening on port ${port}`);

try {
  // Test A: Standard format=yolo on a project containing mixed annotations
  console.log("\nFetching YOLO export for project with mixed annotations...");
  const exportRes = await fetch(
    `${baseUrl}/api/export?id=${project.id}&format=yolo&type=labels_only`,
  );
  assert.equal(exportRes.status, 200, "Export request must succeed with 200");
  const tarBuf = Buffer.from(await exportRes.arrayBuffer());
  const files = await unpackTar(tarBuf);

  assert(files.has("data.yaml"), "Archive must contain data.yaml");
  assert(files.has("export_manifest.json"), "Archive must contain export_manifest.json");

  const manifest = JSON.parse(files.get("export_manifest.json").content.toString("utf8"));
  assert.equal(
    manifest.export_format,
    "yolo-seg",
    "Manifest must identify export_format as yolo-seg",
  );
  assert.equal(manifest.is_segmentation, true, "Manifest must flag is_segmentation as true");

  console.log("✓ Manifest correctly flagged export as yolo-seg.");

  // Inspect all exported label text files
  let totalLabelFiles = 0;
  let totalAnnotationLines = 0;

  for (const [filename, fileObj] of files.entries()) {
    if (!filename.startsWith("labels/") || !filename.endsWith(".txt")) continue;
    totalLabelFiles++;
    const text = fileObj.content.toString("utf8").trim();
    if (!text) continue;

    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      totalAnnotationLines++;
      const tokens = trimmed.split(/\s+/);

      // Verify every single line contains at least 9 tokens (1 class index + at least 8 coordinate floats)
      assert(
        tokens.length >= 9,
        `Line in ${filename} must contain at least 9 tokens, found ${tokens.length}: "${trimmed}"`,
      );

      // Confirm there are NO 5-token lines (class cx cy w h) in the segmentation export
      assert.notEqual(
        tokens.length,
        5,
        `Line in ${filename} MUST NOT be a 5-token bounding box line: "${trimmed}"`,
      );

      // Verify coordinates are numbers strictly within [0.000000, 1.000000]
      const coords = tokens.slice(1).map(Number);
      for (const coord of coords) {
        assert(Number.isFinite(coord), `Coordinate must be finite number: ${coord}`);
        assert(
          coord >= 0.0 && coord <= 1.0,
          `Coordinate ${coord} in ${filename} must be within [0.000000, 1.000000]`,
        );
      }
    }
  }

  assert(totalLabelFiles > 0, "Must have exported label files");
  assert(totalAnnotationLines > 0, "Must have exported annotation lines");
  console.log(
    `✓ Verified ${totalLabelFiles} label files with ${totalAnnotationLines} annotation lines:`,
  );
  console.log("   - Every single line contains at least 9 tokens.");
  console.log("   - ZERO 5-token lines exist.");
  console.log("   - All coordinates strictly clamped within [0.000000, 1.000000].");

  // Test B: Verify converted bounding box coordinates match 4 corners
  console.log("\n[3/3] Verifying converted bounding box corner geometry...");
  // testBoxTxt had: "0 0.500000 0.500000 0.200000 0.300000"
  // cx = 0.5, cy = 0.5, w = 0.2, h = 0.3
  // x_min = 0.4, x_max = 0.6, y_min = 0.35, y_max = 0.65
  // Corners: (0.4, 0.35), (0.6, 0.35), (0.6, 0.65), (0.4, 0.65)
  // Expected line: "0 0.400000 0.350000 0.600000 0.350000 0.600000 0.650000 0.400000 0.650000"
  let foundConvertedBox = false;
  for (const [filename, fileObj] of files.entries()) {
    if (filename.includes("yolo_seg_test_box.txt")) {
      const content = fileObj.content.toString("utf8").trim();
      assert.equal(
        content,
        "0 0.400000 0.350000 0.600000 0.350000 0.600000 0.650000 0.400000 0.650000",
        `Converted box coordinates must match expected 4 corners in ${filename}`,
      );
      foundConvertedBox = true;
    }
  }
  assert(foundConvertedBox, "Must find converted yolo_seg_test_box.txt in export");
  console.log("✓ Converted bounding box matches expected 4 corners (TL, TR, BR, BL).");

  // Test C: Explicit format=yolo-seg export
  console.log("\nTesting explicit format=yolo-seg query param...");
  const segRes = await fetch(
    `${baseUrl}/api/export?id=${project.id}&format=yolo-seg&type=labels_only`,
  );
  assert.equal(segRes.status, 200);
  const segTarBuf = Buffer.from(await segRes.arrayBuffer());
  const segFiles = await unpackTar(segTarBuf);
  assert(segFiles.has("data.yaml"));
  assert(segFiles.has("export_manifest.json"));
  console.log("✓ format=yolo-seg query param successfully streams segmentation export.");

  console.log("\n🎉 ALL YOLO-SEG EXPORT COMPLIANCE CHECKS PASSED SUCCESSFULLY!");
} finally {
  await server.close();
  try {
    for (const f of [
      testBoxImgPath,
      testBoxTxtPath,
      testPolyImgPath,
      testPolyTxtPath,
      testMixedImgPath,
      testMixedTxtPath,
    ]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    db.prepare("DELETE FROM images WHERE project_id = ? AND file_path IN (?, ?, ?)").run(
      project.id,
      testBoxImg,
      testPolyImg,
      testMixedImg,
    );
    db.prepare("DELETE FROM image_claims WHERE project_id = ? AND rel_path IN (?, ?, ?)").run(
      project.id,
      testBoxImg,
      testPolyImg,
      testMixedImg,
    );
  } catch {
    /* ignore cleanup error */
  }
}
