import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import Database from "better-sqlite3";
import { deleteProjectImage, handle } from "./labelling-api.mjs";

console.log("=== Verifying Owner Tracking & Admin Photo Deletion ===\n");

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");
const db = new Database(dbPath);

const project = db.prepare("SELECT id, name, folder FROM projects WHERE id = 1").get();
assert(project, "Project 1 must exist for verification");
const projectFolder = path.resolve(root, project.folder);
console.log(
  `Testing with project: "${project.name}" (ID: ${project.id}, folder: ${project.folder})`,
);

// Setup test users & sessions
const testUsername = `user_${Date.now()}`;
const userToken = crypto.randomBytes(16).toString("hex");
const adminToken = crypto.randomBytes(16).toString("hex");
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const userInsert = db
  .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'hash', ?)")
  .run(testUsername, expires);
const userId = Number(userInsert.lastInsertRowid);

db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
  userToken,
  userId,
  expires,
);
db.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)").run(adminToken, expires);

const testFileName = `__test_deletion_${Date.now()}.jpg`;
const testLabelName = `__test_deletion_${Date.now()}.txt`;
const testFilePath = path.join(projectFolder, testFileName);
const testLabelPath = path.join(projectFolder, testLabelName);

fs.writeFileSync(testFilePath, "test image payload");
fs.writeFileSync(testLabelPath, "0 0.5 0.5 0.2 0.2\n");

// Insert row into images table
const imgInsert = db
  .prepare(`
  INSERT INTO images (project_id, file_path, name, status, locked_by, locked_at)
  VALUES (?, ?, ?, 'unlabeled', ?, datetime('now'))
`)
  .run(project.id, testFileName, testFileName, testUsername);
const testImageId = Number(imgInsert.lastInsertRowid);

console.log(`Created test image row ID: ${testImageId}, file: ${testFileName}`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  handle(req, res, url, root).catch((err) => {
    res.statusCode = err.status || 500;
    res.end(JSON.stringify({ error: err.message }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

try {
  // -------------------------------------------------------------
  // Test 1: Saving a photo as User A marks owner = 'User A'
  // -------------------------------------------------------------
  console.log("\n[Test 1] Testing owner assignment on label completion (PUT /api/label)...");
  const saveRes = await fetch(`${baseUrl}/api/label?name=${encodeURIComponent(testFileName)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${userToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({
      name: testFileName,
      boxes: [{ classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
    }),
  });
  assert.equal(saveRes.status, 200, "Saving label must succeed");

  const rowAfterSave = db.prepare("SELECT * FROM images WHERE id = ?").get(testImageId);
  console.log("Image row after label save:", {
    id: rowAfterSave.id,
    status: rowAfterSave.status,
    owner: rowAfterSave.owner,
    completed_at: rowAfterSave.completed_at,
  });
  assert.equal(rowAfterSave.status, "completed", "Status must be 'completed'");
  assert.equal(rowAfterSave.owner, testUsername, `Owner must be set to '${testUsername}'`);
  console.log("✓ Test 1 passed: Saving label assigns owner correctly.");

  // -------------------------------------------------------------
  // Test 2: Approving that photo as Reviewer/Admin updates owner
  // -------------------------------------------------------------
  console.log(
    "\n[Test 2] Testing owner update on review approval (POST /api/images/review/action)...",
  );
  const approveRes = await fetch(`${baseUrl}/api/images/review/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab_admin=${adminToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({
      project_id: project.id,
      image_id: testImageId,
      action: "approve",
    }),
  });
  assert.equal(approveRes.status, 200, "Review approve must return 200");

  const rowAfterApprove = db.prepare("SELECT * FROM images WHERE id = ?").get(testImageId);
  console.log("Image row after approval:", {
    id: rowAfterApprove.id,
    status: rowAfterApprove.status,
    owner: rowAfterApprove.owner,
    reviewed_by: rowAfterApprove.reviewed_by,
    reviewed_at: rowAfterApprove.reviewed_at,
  });
  assert.equal(rowAfterApprove.status, "approved", "Status must be 'approved'");
  assert.equal(rowAfterApprove.owner, "admin", "Owner must be updated to reviewer ('admin')");
  assert.equal(rowAfterApprove.reviewed_by, "admin", "reviewed_by must be set to reviewer");
  console.log("✓ Test 2 passed: Review approval updates owner to reviewer.");

  // -------------------------------------------------------------
  // Test 3: Security & Authorization (Non-admin DELETE returns 403)
  // -------------------------------------------------------------
  console.log("\n[Test 3] Testing Authorization: Non-admin DELETE must return 403 Forbidden...");
  // 3.1 Non-admin authenticated user
  const forbiddenUserRes = await fetch(`${baseUrl}/api/images/${testImageId}`, {
    method: "DELETE",
    headers: {
      Cookie: `partlab=${userToken}; partlab_project=${project.id}`,
    },
  });
  console.log("Non-admin user DELETE status:", forbiddenUserRes.status);
  assert.equal(forbiddenUserRes.status, 403, "Non-admin DELETE must return 403 Forbidden");

  // 3.2 Unauthenticated caller
  const forbiddenAnonRes = await fetch(`${baseUrl}/api/images/${testImageId}`, {
    method: "DELETE",
  });
  console.log("Unauthenticated DELETE status:", forbiddenAnonRes.status);
  assert.equal(forbiddenAnonRes.status, 403, "Unauthenticated DELETE must return 403 Forbidden");

  // Verify file and DB records remain untouched
  assert(fs.existsSync(testFilePath), "Image file must not be deleted by unauthorized request");
  assert(fs.existsSync(testLabelPath), "Label file must not be deleted by unauthorized request");
  const rowSurvives = db.prepare("SELECT id FROM images WHERE id = ?").get(testImageId);
  assert(rowSurvives, "Database record must not be deleted by unauthorized request");
  console.log(
    "✓ Test 3 passed: Non-admin and unauthenticated DELETE requests are rejected with 403.",
  );

  // -------------------------------------------------------------
  // Test 4: Admin Deletion (Files on disk and DB row removed)
  // -------------------------------------------------------------
  console.log("\n[Test 4] Testing Admin Photo Deletion (DELETE /api/images/:id)...");
  const deleteRes = await fetch(`${baseUrl}/api/images/${testImageId}`, {
    method: "DELETE",
    headers: {
      Cookie: `partlab_admin=${adminToken}; partlab_project=${project.id}`,
    },
  });
  assert.equal(deleteRes.status, 200, "Admin DELETE must return 200 OK");
  const deleteData = await deleteRes.json();
  console.log("Admin DELETE response:", deleteData);
  assert.equal(deleteData.success, true);
  assert.equal(deleteData.deletedId, testImageId);

  // Verify image file on disk is removed
  assert(!fs.existsSync(testFilePath), "Image file on disk must be deleted");
  // Verify companion .txt label file on disk is removed
  assert(!fs.existsSync(testLabelPath), "Companion .txt label file on disk must be deleted");
  // Verify SQLite row is removed
  const rowDeleted = db.prepare("SELECT * FROM images WHERE id = ?").get(testImageId);
  assert.equal(rowDeleted, undefined, "Row in images table must be deleted");
  // Verify image_claims row is removed
  const claimDeleted = db
    .prepare("SELECT * FROM image_claims WHERE project_id = ? AND rel_path = ?")
    .get(project.id, testFileName);
  assert.equal(claimDeleted, undefined, "Row in image_claims table must be deleted");
  console.log(
    "✓ Test 4 passed: Image file, companion .txt label, and SQLite rows permanently removed.",
  );

  // -------------------------------------------------------------
  // Test 5: deleteProjectImage Helper Unit Test (404 and safety checks)
  // -------------------------------------------------------------
  console.log("\n[Test 5] Verifying error handling for nonexistent image ID...");
  assert.throws(
    () => deleteProjectImage(db, root, 9999999),
    /Image not found/,
    "deleteProjectImage must throw 404 for nonexistent image",
  );
  console.log("✓ Test 5 passed: Nonexistent image throws 404.");

  console.log("\n🎉 ALL TESTS PASSED: Owner tracking and admin photo deletion are fully verified!");
} finally {
  server.close();

  // Cleanup test artifacts
  try {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    if (fs.existsSync(testLabelPath)) fs.unlinkSync(testLabelPath);
  } catch {}

  db.prepare("DELETE FROM sessions WHERE token = ?").run(userToken);
  db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(adminToken);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  db.prepare("DELETE FROM images WHERE id = ?").run(testImageId);
  db.close();
}
