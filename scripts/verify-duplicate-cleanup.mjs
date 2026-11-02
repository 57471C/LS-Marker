import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import { createServer } from "vite";
import { detectProjectDuplicates, hashFileSha256 } from "./labelling-api.mjs";

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");

console.log("=== LS-Marker SHA Duplicate Detection & Cleanup Verification ===");

const db = new Database(dbPath);
const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in labels.db");
console.log(`Using project: "${project.name}" (ID: ${project.id})`);

const projectFolder = path.resolve(root, project.folder);
assert(fs.existsSync(projectFolder), `Project folder ${projectFolder} must exist`);

// Setup test files:
// 1. Original image (100x100) + label file
const origName = "sha_verify_orig.jpg";
const origPath = path.join(projectFolder, origName);
const origTxtPath = path.join(projectFolder, "sha_verify_orig.txt");

// 2. Duplicate image (identical bytes) + duplicate label file
const dupName = "sha_verify_orig_copy.jpg";
const dupPath = path.join(projectFolder, dupName);
const dupTxtPath = path.join(projectFolder, "sha_verify_orig_copy.txt");

// 3. Export artifact directory structure (should be ignored by scanner to fix root cause)
const exportCropsDir = path.join(projectFolder, "crops");
const exportCropsSub = path.join(exportCropsDir, "bolt");
const exportCropImg = path.join(exportCropsSub, "sha_verify_crop.jpg");

const exportImagesTrainDir = path.join(projectFolder, "images", "train");
const exportTrainImg = path.join(exportImagesTrainDir, "sha_verify_train.jpg");

let viteServer = null;
let testToken = null;

try {
  // Generate original image bytes
  const imgBuffer = await sharp({
    create: {
      width: 120,
      height: 120,
      channels: 3,
      background: { r: 90, g: 150, b: 210 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  fs.writeFileSync(origPath, imgBuffer);
  fs.writeFileSync(dupPath, imgBuffer); // Exact identical bytes for duplicate

  fs.writeFileSync(origTxtPath, "0 0.5 0.5 0.2 0.2\n");
  fs.writeFileSync(dupTxtPath, "0 0.5 0.5 0.2 0.2\n");

  // Create export artifact folders and dummy images
  fs.mkdirSync(exportCropsSub, { recursive: true });
  fs.writeFileSync(exportCropImg, imgBuffer);

  fs.mkdirSync(exportImagesTrainDir, { recursive: true });
  fs.writeFileSync(exportTrainImg, imgBuffer);

  // Set DB records: original is 'completed', duplicate is 'unlabeled'
  db.prepare(
    `INSERT INTO images (project_id, file_path, name, status)
     VALUES (?, ?, ?, 'completed')
     ON CONFLICT(project_id, file_path) DO UPDATE SET status = 'completed'`,
  ).run(project.id, origName, origName);

  db.prepare(
    `INSERT INTO images (project_id, file_path, name, status)
     VALUES (?, ?, ?, 'unlabeled')
     ON CONFLICT(project_id, file_path) DO UPDATE SET status = 'unlabeled'`,
  ).run(project.id, dupName, dupName);

  console.log("✓ Test duplicate image files and database entries created.");

  // Test 1: Verify SHA-256 hash calculation matches
  const hash1 = await hashFileSha256(origPath);
  const hash2 = await hashFileSha256(dupPath);
  assert.equal(typeof hash1, "string");
  assert.equal(hash1.length, 64);
  assert.equal(hash1, hash2, "Identical files must produce identical SHA-256 hashes");
  console.log(`✓ Test 1 passed: SHA-256 hash verified (${hash1.slice(0, 12)}…).`);

  // Test 2: Verify detectProjectDuplicates
  const detection = await detectProjectDuplicates(root, project, db);
  assert(detection.duplicateSets >= 1, "Must detect at least 1 duplicate set");
  assert(detection.totalDuplicates >= 1, "Must detect at least 1 duplicate extra file");

  const testGroup = detection.groups.find((g) => g.hash === hash1);
  assert(testGroup, "Must find duplicate group matching test image hash");
  assert.equal(testGroup.kept.relPath, origName, "Must select 'completed' original as KEPT");
  assert.equal(testGroup.kept.status, "completed");
  assert.equal(testGroup.kept.boxesCount, 1);

  const extraFound = testGroup.extras.some((e) => e.relPath === dupName);
  assert(extraFound, "Duplicate copy must be flagged as extra to remove");
  console.log(
    `✓ Test 2 passed: Duplicates detected correctly (Kept: ${testGroup.kept.relPath}, Remove: ${dupName}).`,
  );

  // Test 3: Root cause prevention - verify export directories ('crops', 'images/train') are ignored by scanner
  const allGroupFiles = detection.groups.flatMap((g) => [
    g.kept.relPath,
    ...g.extras.map((e) => e.relPath),
  ]);
  assert(
    !allGroupFiles.some((f) => f.includes("crops/")),
    "Scanner must ignore 'crops/' directory",
  );
  assert(
    !allGroupFiles.some((f) => f.includes("images/train")),
    "Scanner must ignore 'images/train/' directory",
  );
  console.log(
    "✓ Test 3 passed: Export artifact folders (crops/, images/train/) ignored at source.",
  );

  // Test 4: Verify HTTP endpoints via Vite server
  viteServer = await createServer({
    server: { port: 8089, host: "127.0.0.1" },
    logLevel: "error",
  });
  await viteServer.listen();
  const address = viteServer.httpServer.address();
  const port = typeof address === "object" && address ? address.port : 8089;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Session token for authenticated calls
  const user = db.prepare("SELECT id, username FROM users LIMIT 1").get();
  assert(user, "A user must exist in labels.db");
  testToken = `verify_sha_token_${Date.now()}`;
  const expires = new Date(Date.now() + 86400000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
    testToken,
    user.id,
    expires,
  );

  const cookieHeader = `partlab=${testToken}; partlab_project=${project.id}`;

  // Call GET /api/project/duplicates
  const dupRes = await fetch(`${baseUrl}/api/project/duplicates?id=${project.id}`, {
    headers: { cookie: cookieHeader },
  });
  assert.equal(dupRes.status, 200);
  const dupData = await dupRes.json();
  assert(dupData.totalDuplicates >= 1, "API must return duplicate summary");
  console.log("✓ Test 4 passed: GET /api/project/duplicates returns active duplicates.");

  // Call POST /api/project/cleanup-duplicates
  const cleanupRes = await fetch(`${baseUrl}/api/project/cleanup-duplicates`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ id: project.id, projectId: project.id }),
  });
  assert.equal(cleanupRes.status, 200);
  const cleanupData = await cleanupRes.json();
  assert(cleanupData.ok, "Cleanup response must be ok");
  assert(cleanupData.removedCount >= 1, "Must remove at least 1 duplicate");
  assert(
    cleanupData.removed.some((r) => r.relPath === dupName),
    "Removed log must contain the duplicate copy",
  );
  console.log(
    `✓ Test 5 passed: POST /api/project/cleanup-duplicates succeeded (${cleanupData.message}).`,
  );

  // Verify disk files
  assert(!fs.existsSync(dupPath), "Duplicate image file must be deleted from disk");
  assert(!fs.existsSync(dupTxtPath), "Duplicate label .txt file must be deleted from disk");
  assert(fs.existsSync(origPath), "Original kept image must remain on disk intact");
  assert(fs.existsSync(origTxtPath), "Original kept label .txt must remain on disk intact");
  console.log(
    "✓ Test 6 passed: Disk state verified (duplicate + .txt deleted, original + .txt intact).",
  );

  // Verify database state
  const dupRow = db
    .prepare("SELECT id FROM images WHERE project_id = ? AND file_path = ?")
    .get(project.id, dupName);
  assert(!dupRow, "Duplicate row must be deleted from SQLite");

  const origRow = db
    .prepare("SELECT id, status FROM images WHERE project_id = ? AND file_path = ?")
    .get(project.id, origName);
  assert(origRow, "Original kept row must remain in SQLite");
  assert.equal(
    origRow.status,
    "completed",
    "Kept status must remain 'completed' without data loss",
  );
  console.log(
    "✓ Test 7 passed: SQLite state verified (duplicate pruned, completed original preserved).",
  );

  // Verify post-cleanup duplicates count is zero for this set
  const postDetect = await detectProjectDuplicates(root, project, db);
  const remainingTestDup = postDetect.groups.find((g) => g.hash === hash1);
  assert(!remainingTestDup, "Duplicate group must no longer exist after cleanup");
  console.log("✓ Test 8 passed: Post-cleanup duplicate detection reports 0 duplicates.");

  console.log("\n>>> ALL SHA DUPLICATE DETECTION & CLEANUP CHECKS PASSED SUCCESSFULLY! <<<");
} finally {
  // Clean up test session
  if (testToken) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(testToken);
  }

  // Clean up test image and label files
  if (fs.existsSync(origPath)) fs.unlinkSync(origPath);
  if (fs.existsSync(origTxtPath)) fs.unlinkSync(origTxtPath);
  if (fs.existsSync(dupPath)) fs.unlinkSync(dupPath);
  if (fs.existsSync(dupTxtPath)) fs.unlinkSync(dupTxtPath);

  if (fs.existsSync(exportCropImg)) fs.unlinkSync(exportCropImg);
  if (fs.existsSync(exportCropsSub)) fs.rmdirSync(exportCropsSub);
  if (fs.existsSync(exportCropsDir)) fs.rmdirSync(exportCropsDir);

  if (fs.existsSync(exportTrainImg)) fs.unlinkSync(exportTrainImg);
  if (fs.existsSync(exportImagesTrainDir)) fs.rmdirSync(exportImagesTrainDir);
  const imagesDir = path.join(projectFolder, "images");
  if (fs.existsSync(imagesDir)) {
    try {
      fs.rmdirSync(imagesDir);
    } catch {
      /* ignore if not empty */
    }
  }

  db.prepare("DELETE FROM images WHERE project_id = ? AND file_path IN (?, ?)").run(
    project.id,
    origName,
    dupName,
  );

  if (viteServer) {
    await viteServer.close();
  }
}
