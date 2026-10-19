import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import Database from "better-sqlite3";
import { handle, normalizePath, rescanProjectImages } from "./labelling-api.mjs";

console.log("=== Verifying Safe Rescan / Sync Images with Zero-Risk Guards ===\n");

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");
const db = new Database(dbPath);

const project = db.prepare("SELECT id, name, folder FROM projects WHERE id = 1").get();
assert(project, "Project 1 must exist for testing");
console.log(
  `Testing with project: "${project.name}" (ID: ${project.id}, folder: ${project.folder})`,
);

const projectDir = path.resolve(root, project.folder);

// -------------------------------------------------------------
// Test 1: Rescanning with NO changes
// -------------------------------------------------------------
console.log("\n[Test 1] Rescanning existing project with NO file changes...");
const beforeRows = db
  .prepare("SELECT * FROM images WHERE project_id = ? ORDER BY id ASC")
  .all(project.id);

const result1 = rescanProjectImages(db, root, project);
console.log("Result:", result1);

assert.equal(result1.newlyAdded, 0, "newlyAdded must be 0 when no files added");
assert.equal(result1.pruned, 0, "pruned must be 0 when no files removed");
assert.equal(result1.prunedUnlabeled, 0, "prunedUnlabeled must be 0");
assert.equal(result1.missingCompleted, 0, "missingCompleted must be 0");
assert.equal(result1.restored, 0, "restored must be 0");
assert.equal(result1.totalInProject, beforeRows.length, "totalInProject must match existing count");

const afterRows = db
  .prepare("SELECT * FROM images WHERE project_id = ? ORDER BY id ASC")
  .all(project.id);

assert.deepEqual(
  beforeRows,
  afterRows,
  "Database rows must be completely unaltered when no changes exist on disk",
);
console.log("✓ Test 1 passed: 0 changes, 0 altered rows.");

// -------------------------------------------------------------
// Test 2: Circuit Breaker Safety
// -------------------------------------------------------------
console.log("\n[Test 2] Testing Circuit Breaker when directory is empty/unmounted...");
const fakeEmptyProject = {
  id: project.id,
  name: project.name,
  folder: "data/non_existent_or_empty_test_folder",
};
const fakeDir = path.resolve(root, fakeEmptyProject.folder);
fs.mkdirSync(fakeDir, { recursive: true });

try {
  let circuitBreakerTriggered = false;
  try {
    rescanProjectImages(db, root, fakeEmptyProject);
  } catch (err) {
    circuitBreakerTriggered = true;
    assert.match(
      err.message,
      /Disk directory appears empty or unmounted/,
      "Error message must specify circuit breaker reason",
    );
    console.log("✓ Circuit breaker caught error:", err.message);
  }
  assert(
    circuitBreakerTriggered,
    "Circuit breaker MUST throw when folder is empty but DB has images",
  );

  // Ensure DB rows for project were NOT deleted
  const checkRows = db
    .prepare("SELECT count(*) as cnt FROM images WHERE project_id = ?")
    .get(project.id);
  assert.equal(
    checkRows.cnt,
    beforeRows.length,
    "Database rows must NOT be deleted during empty scan",
  );
  console.log("✓ Test 2 passed: Zero rows pruned during empty scan.");
} finally {
  try {
    fs.rmdirSync(fakeDir);
  } catch {}
}

// -------------------------------------------------------------
// Test 3: Path Normalization Standard (Windows \ vs POSIX /)
// -------------------------------------------------------------
console.log("\n[Test 3] Testing Path Normalization...");
assert.equal(normalizePath("sub\\folder\\image.jpg"), "sub/folder/image.jpg");
assert.equal(normalizePath("sub/folder/image.jpg"), "sub/folder/image.jpg");
assert.equal(normalizePath("image.jpg"), "image.jpg");
assert.equal(normalizePath(""), "");

// Insert a temporary test row with Windows backslashes
const winPath = "temp_win\\test_image.jpg";
const posixPath = "temp_win/test_image.jpg";
const tempImgFile = path.join(projectDir, "temp_win", "test_image.jpg");
fs.mkdirSync(path.dirname(tempImgFile), { recursive: true });
fs.writeFileSync(tempImgFile, "test image bytes");

try {
  // Insert with backslashes
  db.prepare(
    "INSERT INTO images (project_id, file_path, name, status) VALUES (?, ?, ?, 'unlabeled')",
  ).run(project.id, winPath, winPath);

  // Run rescan
  const rescanWin = rescanProjectImages(db, root, project);
  // It shouldn't double-insert since normalized path matches
  assert.equal(rescanWin.newlyAdded, 0, "Should recognize Windows-path row and not double insert");

  // Check that row path got standardized to POSIX
  const normRow = db
    .prepare("SELECT file_path FROM images WHERE project_id = ? AND file_path = ?")
    .get(project.id, posixPath);
  assert(normRow, "Row file_path must be normalized to forward slashes");
  console.log("✓ Test 3 passed: Path normalization seamlessly handles Windows backslashes.");
} finally {
  // Clean up
  db.prepare("DELETE FROM images WHERE project_id = ? AND (file_path = ? OR file_path = ?)").run(
    project.id,
    winPath,
    posixPath,
  );
  try {
    fs.unlinkSync(tempImgFile);
    fs.rmdirSync(path.dirname(tempImgFile));
  } catch {}
}

// -------------------------------------------------------------
// Test 4: Add New Files & Handle Removed Unlabeled Files
// -------------------------------------------------------------
console.log("\n[Test 4] Testing addition of new file & pruning of unlabeled file...");
const tempAddedFile = path.join(projectDir, "z_temp_new_image.jpg");
fs.writeFileSync(tempAddedFile, "new photo");

try {
  const rescanAdd = rescanProjectImages(db, root, project);
  assert.equal(rescanAdd.newlyAdded, 1, "Must report 1 newly added photo");
  console.log("✓ Added 1 new image, newlyAdded reported 1.");

  const row = db
    .prepare("SELECT * FROM images WHERE project_id = ? AND file_path = ?")
    .get(project.id, "z_temp_new_image.jpg");
  assert(row, "New image must be inserted into database");
  assert.equal(row.status, "unlabeled", "New image must have status 'unlabeled'");

  // Now delete file from disk and rescan
  fs.unlinkSync(tempAddedFile);
  const rescanDel = rescanProjectImages(db, root, project);
  assert.equal(rescanDel.pruned, 1, "Must report 1 pruned unlabeled photo");

  const rowAfterDel = db
    .prepare("SELECT * FROM images WHERE project_id = ? AND file_path = ?")
    .get(project.id, "z_temp_new_image.jpg");
  assert(!rowAfterDel, "Unlabeled deleted file must be pruned from database");
  console.log("✓ Test 4 passed: New unlabeled file added and subsequently pruned when removed.");
} finally {
  if (fs.existsSync(tempAddedFile)) fs.unlinkSync(tempAddedFile);
}

// -------------------------------------------------------------
// Test 5: Protect Completed & Approved Annotations (Missing Flagging)
// -------------------------------------------------------------
console.log("\n[Test 5] Testing protection of completed/approved annotations...");
const completedImg = path.join(projectDir, "temp_completed.jpg");
fs.writeFileSync(completedImg, "completed photo content");

try {
  // Insert row as completed
  db.prepare(
    "INSERT INTO images (project_id, file_path, name, status, completed_at) VALUES (?, ?, ?, 'completed', CURRENT_TIMESTAMP)",
  ).run(project.id, "temp_completed.jpg", "temp_completed.jpg");

  // Temporarily remove file from disk
  fs.unlinkSync(completedImg);

  const rescanMissing = rescanProjectImages(db, root, project);
  assert.equal(rescanMissing.missingCompleted, 1, "Must flag missing completed file");
  assert.equal(rescanMissing.pruned, 0, "Must NEVER prune completed annotations");

  const missingRow = db
    .prepare("SELECT * FROM images WHERE project_id = ? AND file_path = ?")
    .get(project.id, "temp_completed.jpg");
  assert(missingRow, "Completed row must NEVER be deleted");
  assert.equal(
    missingRow.status,
    "missing",
    "Missing completed file status must be updated to 'missing'",
  );

  // Re-create file on disk and rescan
  fs.writeFileSync(completedImg, "completed photo content restored");
  const rescanRestored = rescanProjectImages(db, root, project);
  assert.equal(rescanRestored.restored, 1, "Must report 1 restored file");

  const restoredRow = db
    .prepare("SELECT * FROM images WHERE project_id = ? AND file_path = ?")
    .get(project.id, "temp_completed.jpg");
  assert.equal(restoredRow.status, "completed", "Status must be restored to 'completed'");
  console.log(
    "✓ Test 5 passed: Completed annotations safely preserved as 'missing' and restored when file reappears.",
  );
} finally {
  db.prepare("DELETE FROM images WHERE project_id = ? AND file_path = ?").run(
    project.id,
    "temp_completed.jpg",
  );
  if (fs.existsSync(completedImg)) fs.unlinkSync(completedImg);
}

// -------------------------------------------------------------
// Test 6: HTTP Endpoints
// -------------------------------------------------------------
console.log("\n[Test 6] Testing HTTP API Endpoints...");
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  handle(req, res, url, root).catch((err) => {
    res.statusCode = err.status || 500;
    res.end(JSON.stringify({ error: err.message }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

try {
  // 1. POST /api/projects/:id/sync-images
  const res1 = await fetch(`http://127.0.0.1:${port}/api/projects/${project.id}/sync-images`, {
    method: "POST",
  });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.ok, true);
  assert.equal(data1.projectName, project.name);
  assert.equal(typeof data1.totalInProject, "number");
  assert.equal(data1.newlyAdded, 0);
  console.log("✓ POST /api/projects/:id/sync-images succeeded");

  // 2. POST /api/project/sync-images with JSON body
  const res2 = await fetch(`http://127.0.0.1:${port}/api/project/sync-images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: project.id }),
  });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.ok, true);
  assert.equal(data2.newlyAdded, 0);
  console.log("✓ POST /api/project/sync-images succeeded");

  console.log("\n🎉 ALL TESTS AND ZERO-RISK SAFETY CHECKS PASSED SUCCESSFULLY!");
} finally {
  server.close();
  db.close();
}
