import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import Database from "better-sqlite3";
import { catalogue, handle } from "./labelling-api.mjs";

console.log("=== Verifying Approved Photo Safeguards & Read-Only / Unlock ===");

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");
const db = new Database(dbPath);

const project = db.prepare("SELECT id, name, folder FROM projects WHERE id = 1").get();
assert(project, "Project 1 must exist for verification");
const projectFolder = path.resolve(root, project.folder);

// Setup test users & sessions
const annotatorName = `annotator_${Date.now()}`;
const adminName = `admin_${Date.now()}`;
const annotatorToken = crypto.randomBytes(16).toString("hex");
const adminToken = crypto.randomBytes(16).toString("hex");
const adminSessionCookie = crypto.randomBytes(16).toString("hex");
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const annotatorInsert = db
  .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'hash', ?)")
  .run(annotatorName, expires);
const annotatorId = Number(annotatorInsert.lastInsertRowid);

const adminInsert = db
  .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'hash', ?)")
  .run(adminName, expires);
const adminId = Number(adminInsert.lastInsertRowid);

db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
  annotatorToken,
  annotatorId,
  expires,
);
db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
  adminToken,
  adminId,
  expires,
);
db.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)").run(
  adminSessionCookie,
  expires,
);

const testFileName = `__test_approved_${Date.now()}.jpg`;
const testLabelName = `__test_approved_${Date.now()}.txt`;
const testFilePath = path.join(projectFolder, testFileName);
const testLabelPath = path.join(projectFolder, testLabelName);

fs.writeFileSync(testFilePath, "test image bytes");
fs.writeFileSync(testLabelPath, "0 0.5 0.5 0.2 0.2\n");

// Insert an approved row
const imgInsert = db
  .prepare(`
  INSERT INTO images (project_id, file_path, name, status, owner, reviewed_by, reviewed_at)
  VALUES (?, ?, ?, 'approved', ?, 'QA_Lead', datetime('now'))
`)
  .run(project.id, testFileName, testFileName, annotatorName);
const testImageId = Number(imgInsert.lastInsertRowid);

db.prepare(`
  INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
  VALUES (?, ?, NULL, NULL, 'approved', datetime('now'))
`).run(project.id, testFileName);

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
  // Test 1: Check Catalogue Output for Approved Image
  console.log("\n[Test 1] Checking catalogue status for approved image...");
  const cat = await catalogue(root, project);
  const found = cat.images.find((img) => img.name === testFileName);
  assert(found, "Test image must exist in catalogue");
  assert.equal(found.status, "approved", "Status must be 'approved'");
  assert.equal(found.is_claimed, false, "Approved photo must not be active leased");
  assert.equal(found.claimedBy, null, "Approved photo claimedBy must be null");
  console.log("✓ Test 1 passed: Catalogue returns status 'approved' and unleased state.");

  // Test 2: Annotator attempting to claim approved image must be rejected with 403
  console.log(
    "\n[Test 2] Annotator attempting to claim approved photo via POST /api/images/:id/claim...",
  );
  const claimRes = await fetch(`${baseUrl}/api/images/${testImageId}/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${annotatorToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(claimRes.status, 403, "Claiming approved photo must return 403 Forbidden");
  const claimData = await claimRes.json();
  assert(
    claimData.error.includes("approved and locked"),
    "Error message must explain photo is locked",
  );
  console.log(`✓ Test 2 passed: Claim rejected with 403 (${claimData.error})`);

  // Test 3: Annotator attempting to save labels directly on approved photo must be rejected with 403
  console.log(
    "\n[Test 3] Annotator attempting to save labels directly on approved photo via PUT /api/label...",
  );
  const saveRes = await fetch(`${baseUrl}/api/label?name=${encodeURIComponent(testFileName)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${annotatorToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({
      boxes: [{ classId: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    }),
  });
  assert.equal(saveRes.status, 403, "Saving over approved photo must return 403 Forbidden");
  console.log("✓ Test 3 passed: Direct label save on approved photo is blocked with 403.");

  // Test 4: Non-admin user attempting to unlock approved photo must be rejected with 403
  console.log("\n[Test 4] Non-admin attempting to unlock approved photo...");
  const nonAdminUnlock = await fetch(`${baseUrl}/api/images/${testImageId}/unlock`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${annotatorToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({ action: "unlock-approved" }),
  });
  assert.equal(nonAdminUnlock.status, 403, "Non-admin unlock must return 403");
  console.log("✓ Test 4 passed: Non-admin unlock rejected with 403.");

  // Test 5: Admin / Reviewer unlocking approved photo
  console.log(
    "\n[Test 5] Admin / Reviewer unlocking approved photo (POST /api/images/:id/unlock)...",
  );
  const adminUnlock = await fetch(`${baseUrl}/api/images/${testImageId}/unlock`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${adminToken}; partlab_admin=${adminSessionCookie}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({ action: "unlock-approved" }),
  });
  assert.equal(adminUnlock.status, 200, "Admin unlock must return 200 OK");
  const unlockData = await adminUnlock.json();
  assert.equal(unlockData.ok, true, "Response ok must be true");
  assert.equal(unlockData.status, "complete", "Status downgraded back to complete");
  assert.equal(unlockData.lockedBy, adminName, "Active lease granted to admin");
  assert.equal(unlockData.is_claimed, true, "Image is now actively claimed");

  // Verify database record
  const unlockedRow = db.prepare("SELECT * FROM images WHERE id = ?").get(testImageId);
  assert.equal(unlockedRow.status, "completed", "DB status must be completed");
  assert.equal(unlockedRow.reviewed_by, null, "reviewed_by must be cleared to NULL");
  assert.equal(unlockedRow.reviewed_at, null, "reviewed_at must be cleared to NULL");
  assert.equal(unlockedRow.locked_by, adminName, "locked_by must be set to unlocker");
  console.log("✓ Test 5 passed: QA approval revoked, status downgraded, and active lease granted.");

  // Test 6: Now that photo is unlocked, the lease holder can edit and save labels
  console.log("\n[Test 6] Lease holder saving updated labels on unlocked photo...");
  const editRes = await fetch(`${baseUrl}/api/label?name=${encodeURIComponent(testFileName)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${adminToken}; partlab_admin=${adminSessionCookie}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({
      boxes: [{ classId: 1, x: 0.25, y: 0.25, w: 0.3, h: 0.3 }],
    }),
  });
  assert.equal(editRes.status, 200, "Saving labels on unlocked photo must succeed");
  console.log("✓ Test 6 passed: Editing unlocked photo succeeds.");

  console.log("\n🎉 ALL APPROVED READ-ONLY & UNLOCK TESTS PASSED!");
} finally {
  server.close();
  // Cleanup
  db.prepare("DELETE FROM images WHERE id = ?").run(testImageId);
  db.prepare("DELETE FROM image_claims WHERE project_id = ? AND rel_path = ?").run(
    project.id,
    testFileName,
  );
  db.prepare("DELETE FROM sessions WHERE token IN (?, ?)").run(annotatorToken, adminToken);
  db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(adminSessionCookie);
  db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(annotatorId, adminId);
  if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  if (fs.existsSync(testLabelPath)) fs.unlinkSync(testLabelPath);
  db.close();
}
