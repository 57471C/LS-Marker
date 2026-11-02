import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import { createServer } from "vite";

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");

console.log("=== LS-Marker Lossless ROI Crop Tool Verification ===");

const db = new Database(dbPath);
const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in labels.db");
console.log(`Using project: "${project.name}" (ID: ${project.id})`);

const projectFolder = path.resolve(root, project.folder);
assert(fs.existsSync(projectFolder), `Project folder ${projectFolder} must exist`);

// 1. Create a 500x400 test image and label file
const testImgName = "roi_crop_test_image.jpg";
const testImgPath = path.join(projectFolder, testImgName);
const testTxtPath = path.join(projectFolder, "roi_crop_test_image.txt");

await sharp({
  create: {
    width: 500,
    height: 400,
    channels: 3,
    background: { r: 180, g: 120, b: 60 },
  },
})
  .jpeg({ quality: 95 })
  .toFile(testImgPath);

// One box inside the crop region and one outside
// Inside: center at (200, 160), width 50, height 40
// Normalised: x = 200/500 = 0.40, y = 160/400 = 0.40, w = 50/500 = 0.10, h = 40/400 = 0.10
// Outside: center at (450, 350)
fs.writeFileSync(
  testTxtPath,
  "0 0.400000 0.400000 0.100000 0.100000\n0 0.900000 0.875000 0.050000 0.050000\n",
);

db.prepare(
  `INSERT INTO images (project_id, file_path, name, status)
   VALUES (?, ?, ?, 'completed')
   ON CONFLICT(project_id, file_path) DO UPDATE SET status = 'completed'`,
).run(project.id, testImgName, testImgName);

console.log("✓ Test image (500x400) and label file created.");

// Create an authorized test session
const user = db.prepare("SELECT id, username FROM users LIMIT 1").get();
assert(user, "A user must exist in labels.db");
const testToken = `verify_crop_token_${Date.now()}`;
const expires = new Date(Date.now() + 86400000).toISOString();
db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
  testToken,
  user.id,
  expires,
);

const authHeaders = {
  "content-type": "application/json",
  cookie: `partlab=${testToken}`,
};

console.log(`✓ Test session authorized for user "${user.username}".`);

// 2. Start Vite test server
const server = await createServer({
  root,
  server: { port: 3097 },
  logLevel: "warn",
});
await server.listen();
const port = server.config.server.port;
console.log(`Vite test server listening on port ${port}`);

try {
  // Test 1: Fetch initial crop-info
  console.log("\n[Test 1] Checking initial crop-info...");
  const infoRes1 = await fetch(`http://127.0.0.1:${port}/api/image/crop-info?name=${testImgName}`, {
    headers: authHeaders,
  });
  assert.equal(infoRes1.status, 200);
  const info1 = await infoRes1.json();
  assert.equal(info1.isCropped, false, "Image should not be cropped initially");
  assert.equal(info1.current.width, 500);
  assert.equal(info1.current.height, 400);
  console.log("✓ Initial crop-info verified: 500x400 uncropped.");

  // Test 2: Apply lossless crop with snapping to multiples of 32
  // Requested: left=50, top=40, width=330, height=260
  // Snapped width: floor(330/32)*32 = 320
  // Snapped height: floor(260/32)*32 = 256
  console.log("\n[Test 2] Applying crop (330x260 -> snapped to 320x256)...");
  const cropRes = await fetch(`http://127.0.0.1:${port}/api/image/crop`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: testImgName,
      rect: { x: 50, y: 40, width: 330, height: 260 },
    }),
  });
  assert.equal(cropRes.status, 200);
  const cropData = await cropRes.json();
  assert.equal(cropData.ok, true);
  assert.equal(cropData.width, 320, "Width must snap to 320 (multiple of 32)");
  assert.equal(cropData.height, 256, "Height must snap to 256 (multiple of 32)");
  assert.equal(cropData.width % 32, 0, "Width must be divisible by 32");
  assert.equal(cropData.height % 32, 0, "Height must be divisible by 32");

  // Verify the image file on disk was replaced with the cropped version
  const croppedMeta = await sharp(testImgPath).metadata();
  assert.equal(croppedMeta.width, 320);
  assert.equal(croppedMeta.height, 256);
  assert.equal(croppedMeta.format, "jpeg");
  console.log("✓ Cropped image on disk verified: 320x256 JPEG.");

  // Verify untouched original backup in .originals/
  const origPath = path.join(projectFolder, ".originals", testImgName);
  assert(fs.existsSync(origPath), ".originals backup must exist");
  const origMeta = await sharp(origPath).metadata();
  assert.equal(origMeta.width, 500);
  assert.equal(origMeta.height, 400);
  console.log("✓ Pristine original backup verified in .originals: 500x400.");

  // Verify labels remapping: box inside is remapped, box outside is filtered out
  const labelText = fs.readFileSync(testTxtPath, "utf8").trim();
  const labelLines = labelText.split(/\r?\n/).filter(Boolean);
  assert.equal(labelLines.length, 1, "Only 1 box should remain after crop");
  const tokens = labelLines[0].split(/\s+/).map(Number);
  assert.equal(tokens[0], 0, "Class ID must remain 0");
  for (let i = 1; i < tokens.length; i++) {
    assert(tokens[i] >= 0 && tokens[i] <= 1, "Normalized coordinates must be within [0, 1]");
  }
  console.log("✓ Remapped bounding box verified:", labelLines[0]);

  // Test 3: Fetch updated crop-info
  console.log("\n[Test 3] Checking crop-info after crop...");
  const infoRes2 = await fetch(`http://127.0.0.1:${port}/api/image/crop-info?name=${testImgName}`, {
    headers: authHeaders,
  });
  assert.equal(infoRes2.status, 200);
  const info2 = await infoRes2.json();
  assert.equal(info2.isCropped, true, "Image must now be reported as cropped");
  assert.equal(info2.current.width, 320);
  assert.equal(info2.current.height, 256);
  assert.equal(info2.original.width, 500);
  assert.equal(info2.original.height, 400);
  console.log("✓ Crop-info verified: isCropped=true, original=500x400, current=320x256.");

  // Test 4: Re-crop support (crop again on cropped image)
  console.log("\n[Test 4] Re-cropping image (repair workflow)...");
  const recropRes = await fetch(`http://127.0.0.1:${port}/api/image/crop`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: testImgName,
      rect: { x: 10, y: 10, width: 256, height: 192 },
    }),
  });
  assert.equal(recropRes.status, 200);
  const recropData = await recropRes.json();
  assert.equal(recropData.width, 256);
  assert.equal(recropData.height, 192);

  // Original in .originals must still be the untouched 500x400 photo
  const origMetaAfterRecrop = await sharp(origPath).metadata();
  assert.equal(origMetaAfterRecrop.width, 500, "Pristine backup must not be overwritten");
  assert.equal(origMetaAfterRecrop.height, 400, "Pristine backup must not be overwritten");
  console.log("✓ Re-crop verified: pristine original preserved.");

  // Test 5: Revert / uncrop (undo)
  console.log("\n[Test 5] Reverting crop (undo)...");
  const uncropRes = await fetch(`http://127.0.0.1:${port}/api/image/uncrop`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ name: testImgName }),
  });
  assert.equal(uncropRes.status, 200);
  const uncropData = await uncropRes.json();
  assert.equal(uncropData.ok, true);

  // Verify image on disk is restored to 500x400
  const restoredMeta = await sharp(testImgPath).metadata();
  assert.equal(restoredMeta.width, 500);
  assert.equal(restoredMeta.height, 400);

  // Verify backup was cleaned up
  assert(!fs.existsSync(origPath), ".originals backup should be cleaned up on uncrop");

  // Verify both original labels are restored
  const restoredTxt = fs.readFileSync(testTxtPath, "utf8").trim();
  const restoredLines = restoredTxt.split(/\r?\n/).filter(Boolean);
  assert.equal(restoredLines.length, 2, "Both original boxes must be restored");
  console.log("✓ Crop reverted successfully: image and labels fully restored to original.");

  // Test 6: Approved photo protection (AGENTS.md Rule #1)
  console.log("\n[Test 6] Verifying approved photo safeguard...");
  db.prepare("UPDATE images SET status = 'approved' WHERE project_id = ? AND file_path = ?").run(
    project.id,
    testImgName,
  );
  const approvedCropRes = await fetch(`http://127.0.0.1:${port}/api/image/crop`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      name: testImgName,
      rect: { x: 0, y: 0, width: 64, height: 64 },
    }),
  });
  assert.equal(
    approvedCropRes.status,
    403,
    "Cropping approved photo must return 403 Forbidden unless unlocked",
  );
  console.log("✓ Approved photo crop blocked with 403 Forbidden as required by AGENTS.md.");

  console.log("\n🎉 ALL ROI CROP TESTS PASSED SUCCESSFULLY!");
} finally {
  await server.close();
  // Cleanup test files
  if (fs.existsSync(testImgPath)) fs.unlinkSync(testImgPath);
  if (fs.existsSync(testTxtPath)) fs.unlinkSync(testTxtPath);
  const origPath = path.join(projectFolder, ".originals", testImgName);
  if (fs.existsSync(origPath)) fs.unlinkSync(origPath);
  const origTxt = `${origPath}.txt`;
  if (fs.existsSync(origTxt)) fs.unlinkSync(origTxt);
  const origMeta = `${origPath}.meta.json`;
  if (fs.existsSync(origMeta)) fs.unlinkSync(origMeta);
  db.prepare("DELETE FROM images WHERE project_id = ? AND file_path = ?").run(
    project.id,
    testImgName,
  );
  db.prepare("DELETE FROM sessions WHERE token = ?").run(testToken);
  db.close();
}
