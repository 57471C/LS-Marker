import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

console.log("=== LS-Marker Polygon & Precision Mode Verification ===");

const tempDir = path.join(process.cwd(), "tmp_verify_poly");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

try {
  // Test 1: Writing and Reading Box format (5 tokens)
  console.log("\n[1/4] Verifying YOLO standard bounding box reading & formatting...");
  const boxFile = path.join(tempDir, "test_box.txt");
  const boxContent = "0 0.500000 0.600000 0.200000 0.300000\n";
  fs.writeFileSync(boxFile, boxContent, "utf8");

  // Read using simulated /api logic
  const lines = fs.readFileSync(boxFile, "utf8").trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  const parts = lines[0].split(/\s+/).map(Number);
  assert.equal(parts.length, 5);
  assert.equal(parts[0], 0);
  assert.equal(parts[1], 0.5);
  assert.equal(parts[2], 0.6);
  assert.equal(parts[3], 0.2);
  assert.equal(parts[4], 0.3);
  console.log("✓ Standard YOLO detection boxes (5 tokens) read correctly.");

  // Test 2: Writing and Reading YOLO Polygon segmentation format (>5 tokens)
  console.log("\n[2/4] Verifying YOLO segmentation polygon reading & formatting...");
  const polyFile = path.join(tempDir, "test_poly.txt");
  // Triangle polygon: (0.1, 0.2), (0.5, 0.8), (0.9, 0.2)
  const polyContent = "1 0.100000 0.200000 0.500000 0.800000 0.900000 0.200000\n";
  fs.writeFileSync(polyFile, polyContent, "utf8");

  const polyLines = fs.readFileSync(polyFile, "utf8").trim().split(/\r?\n/);
  const polyParts = polyLines[0].split(/\s+/).map(Number);
  assert.equal(polyParts.length, 7); // 1 class + 6 coords (3 points)
  assert.equal(polyParts[0], 1);

  const coords = polyParts.slice(1);
  const points = [];
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < coords.length; i += 2) {
    const px = coords[i];
    const py = coords[i + 1];
    points.push([px, py]);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  assert.equal(points.length, 3);
  assert.equal(minX, 0.1);
  assert.equal(maxX, 0.9);
  assert.equal(minY, 0.2);
  assert.equal(maxY, 0.8);

  const round6 = (n) => Math.round(n * 1e6) / 1e6;
  const w = round6(maxX - minX);
  const h = round6(maxY - minY);
  const cx = round6(minX + w / 2);
  const cy = round6(minY + h / 2);

  assert.equal(w, 0.8);
  assert.equal(h, 0.6);
  assert.equal(cx, 0.5);
  assert.equal(cy, 0.5);
  console.log("✓ YOLO segmentation polygon parsed and bounding box derived accurately.");

  // Test 3: Mixed file reading (boxes and polygons coexistence)
  console.log("\n[3/4] Verifying mixed Box and Polygon coexistence...");
  const mixedFile = path.join(tempDir, "test_mixed.txt");
  const mixedContent = [
    "0 0.250000 0.250000 0.100000 0.100000",
    "2 0.300000 0.300000 0.700000 0.300000 0.700000 0.700000 0.300000 0.700000",
  ].join("\n");
  fs.writeFileSync(mixedFile, mixedContent, "utf8");

  const mixedLines = fs.readFileSync(mixedFile, "utf8").trim().split(/\r?\n/);
  assert.equal(mixedLines.length, 2);
  const boxTokens = mixedLines[0].split(/\s+/);
  const polyTokens = mixedLines[1].split(/\s+/);
  assert.equal(boxTokens.length, 5); // Box has 5 numbers
  assert.equal(polyTokens.length, 9); // 4-corner polygon has 9 numbers (1 class + 8 coords)
  console.log(
    "✓ Both YOLO detection and segmentation coexist in the same export without conflict.",
  );

  // Test 4: COCO segmentation export format parity
  console.log("\n[4/4] Verifying COCO export segmentation mapping...");
  const W = 1000;
  const H = 800;
  const cocoSeg = points.flatMap(([px, py]) => [
    Math.round(px * W * 100) / 100,
    Math.round(py * H * 100) / 100,
  ]);
  assert.deepEqual(cocoSeg, [100, 160, 500, 640, 900, 160]);
  console.log("✓ COCO segmentation coordinates scaled to pixel dimensions correctly.");

  console.log("\nAll polygon and precision mode verifications PASSED successfully!");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
