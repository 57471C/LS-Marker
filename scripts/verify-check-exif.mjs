import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createServer } from "vite";

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");

console.log("=== LS-Marker Check EXIF Verification ===");

const db = new Database(dbPath);
const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "Project must exist");

// Start Vite test server
const server = await createServer({
  root,
  server: { port: 3098 },
  logLevel: "warn",
});
await server.listen();
const port = server.config.server.port;
console.log(`Vite test server listening on port ${port}`);

try {
  // Test 1: Check existing clean images in Samples project
  console.log(`\n[1/2] Checking EXIF for project "${project.name}" (ID: ${project.id})...`);
  const res = await fetch(`http://127.0.0.1:${port}/api/project/check-exif`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: project.id }),
  });

  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  console.log("Response:", data);

  assert.equal(data.projectName, project.name);
  assert.equal(data.totalImages, 4);
  assert.equal(data.flaggedCount, 0);
  assert.deepEqual(data.flaggedFiles, []);
  console.log("✓ Existing sample images verified: 0 EXIF orientation tags found.");

  // Test 2: Create a temporary test JPEG with EXIF orientation tag 6 (rotated 90 deg)
  console.log("\n[2/2] Testing orientation detection with synthetic EXIF image...");
  const resolvedFolder = path.resolve(root, project.folder);
  const testImagePath = path.join(resolvedFolder, "test_exif_rotated.jpg");

  // Construct a minimal valid JPEG with APP1 EXIF segment (Orientation = 6)
  // APP1: 0xFF 0xE1 [len: 2 bytes] 'Exif\0\0' [TIFF header: 'II' 0x002A 0x00000008] [IFD0: 1 entry (tag 0x0112, type 3, count 1, val 6)]
  const app1Data = Buffer.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe1, // APP1
    0x00,
    0x22, // length: 34 bytes (including these 2 bytes)
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00, // 'Exif\0\0'
    // TIFF header
    0x49,
    0x49, // Little endian ("II")
    0x2a,
    0x00, // 42
    0x08,
    0x00,
    0x00,
    0x00, // offset to IFD0 = 8
    // IFD0
    0x01,
    0x00, // 1 entry
    // Entry 0: tag 0x0112 (Orientation), type 3 (SHORT), count 1, value 6
    0x12,
    0x01, // Tag 0x0112
    0x03,
    0x00, // Type 3
    0x01,
    0x00,
    0x00,
    0x00, // Count 1
    0x06,
    0x00,
    0x00,
    0x00, // Value 6 (stored in first 2 bytes)
    0x00,
    0x00,
    0x00,
    0x00, // Next IFD offset = 0
    // Minimal SOF0 and EOI
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    0x00,
    0x0a,
    0x00,
    0x0a,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xd9, // EOI
  ]);

  fs.writeFileSync(testImagePath, app1Data);

  try {
    const resWithFlagged = await fetch(`http://127.0.0.1:${port}/api/project/check-exif`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: project.id }),
    });
    assert.equal(resWithFlagged.status, 200);
    const dataFlagged = await resWithFlagged.json();
    console.log("Response with synthetic rotated image:", dataFlagged);

    assert.equal(dataFlagged.totalImages, 5);
    assert.equal(dataFlagged.flaggedCount, 1);
    assert(dataFlagged.flaggedFiles.includes("test_exif_rotated.jpg"));
    console.log("✓ Synthetic rotated image was successfully flagged!");
  } finally {
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
  }

  // Re-verify back to clean state
  const resClean = await fetch(`http://127.0.0.1:${port}/api/project/check-exif`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: project.id }),
  });
  const dataClean = await resClean.json();
  assert.equal(dataClean.totalImages, 4);
  assert.equal(dataClean.flaggedCount, 0);

  console.log("\n🎉 ALL CHECK EXIF TESTS PASSED SUCCESSFULLY!");
} finally {
  await server.close();
}
