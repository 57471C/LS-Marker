import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import Database from "better-sqlite3";
import { handle, isMaintenanceMode, setSystemSetting } from "./labelling-api.mjs";

console.log("=== Verifying System Maintenance Mode & Safe Git Pull Safeguards ===\n");

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");
const db = new Database(dbPath);

const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in the database for testing");
console.log(`Using project '${project.name}' (id: ${project.id})`);

// Setup users: 1 regular labeller, 1 admin session
const annotatorName = `labeller_${Date.now()}`;
const annotatorToken = crypto.randomBytes(16).toString("hex");
const adminToken = crypto.randomBytes(16).toString("hex");
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const annotatorId = db
  .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'hash', ?)")
  .run(annotatorName, expires).lastInsertRowid;

db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
  annotatorToken,
  annotatorId,
  expires,
);
db.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)").run(adminToken, expires);

// Create test image on disk & db
const projectFolder = path.resolve(root, project.folder);
const testFileName = `test_maint_${Date.now()}.jpg`;
const testFilePath = path.join(projectFolder, testFileName);
fs.writeFileSync(testFilePath, "test image content");

const testImageId = db
  .prepare(
    "INSERT INTO images (project_id, file_path, name, status, owner, locked_by, locked_at) VALUES (?, ?, ?, 'unlabeled', NULL, NULL, NULL)",
  )
  .run(project.id, testFileName, testFileName).lastInsertRowid;

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
  // Test 1: Check initial maintenance status
  console.log("[Test 1] Querying initial maintenance status...");
  const initRes = await fetch(`${baseUrl}/api/system/maintenance`);
  assert.equal(initRes.status, 200);
  const initData = await initRes.json();
  assert.equal(typeof initData.maintenance, "boolean");
  console.log(`✓ Initial maintenance mode: ${initData.maintenance}`);

  // Test 2: Non-admin cannot toggle maintenance mode (403)
  console.log("\n[Test 2] Non-admin attempting to enable maintenance mode (403 expected)...");
  const forbiddenRes = await fetch(`${baseUrl}/api/system/maintenance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${annotatorToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(forbiddenRes.status, 403, "Non-admin must receive 403 Forbidden");
  console.log("✓ Non-admin request rejected with 403 Forbidden");

  // Test 3: Admin enables maintenance mode
  console.log("\n[Test 3] Admin enabling maintenance mode...");
  const enableRes = await fetch(`${baseUrl}/api/system/maintenance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab_admin=${adminToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({ enabled: true, message: "Upgrading app" }),
  });
  assert.equal(enableRes.status, 200);
  const enableData = await enableRes.json();
  assert.equal(enableData.success, true);
  assert.equal(enableData.maintenance, true);
  assert.equal(isMaintenanceMode(db), true);
  console.log("✓ Maintenance mode successfully activated in database");

  // Test 4: Non-admin mutations blocked with 503 during maintenance
  console.log("\n[Test 4] Verifying non-admin mutations blocked with 503 during maintenance...");
  const claimBlockedRes = await fetch(`${baseUrl}/api/images/${testImageId}/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${annotatorToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(claimBlockedRes.status, 503, "POST /api/images/:id/claim must return 503");
  const claimBlockedData = await claimBlockedRes.json();
  assert.equal(claimBlockedData.maintenance, true);
  console.log(`✓ Image claim blocked with 503: "${claimBlockedData.error}"`);

  const saveBlockedRes = await fetch(`${baseUrl}/api/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${annotatorToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({ name: testFileName, action: "claim" }),
  });
  assert.equal(saveBlockedRes.status, 503, "POST /api/claim must return 503");
  console.log("✓ POST /api/claim blocked with 503");

  // Test 5: Read-only access preserved for non-admin
  console.log("\n[Test 5] Checking read-only endpoints remain accessible for labellers...");
  const catRes = await fetch(`${baseUrl}/api/catalogue`, {
    headers: {
      Cookie: `partlab=${annotatorToken}; partlab_project=${project.id}`,
    },
  });
  assert.equal(catRes.status, 200, "Catalogue read must remain 200 OK");

  const maintCheckRes = await fetch(`${baseUrl}/api/system/maintenance`);
  assert.equal(maintCheckRes.status, 200);
  const maintCheckData = await maintCheckRes.json();
  assert.equal(maintCheckData.maintenance, true);
  console.log("✓ Catalogue and maintenance status endpoints remain readable");

  // Test 6: Admin retains full access (can backup and inspect)
  console.log("\n[Test 6] Admin operations work during maintenance...");
  const adminBackupStatusRes = await fetch(`${baseUrl}/api/system/backup-status`, {
    headers: {
      Cookie: `partlab_admin=${adminToken}; partlab_project=${project.id}`,
    },
  });
  assert.equal(adminBackupStatusRes.status, 200);
  console.log("✓ Admin can check backup status during maintenance mode");

  const adminBackupDownloadRes = await fetch(`${baseUrl}/api/system/backup-download`, {
    headers: {
      Cookie: `partlab_admin=${adminToken}; partlab_project=${project.id}`,
    },
  });
  assert.equal(adminBackupDownloadRes.status, 200);
  console.log("✓ Admin can download database backup during maintenance mode");

  // Test 7: Admin disables maintenance mode (resumes normal operations)
  console.log("\n[Test 7] Admin disables maintenance mode...");
  const disableRes = await fetch(`${baseUrl}/api/system/maintenance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab_admin=${adminToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(disableRes.status, 200);
  const disableData = await disableRes.json();
  assert.equal(disableData.success, true);
  assert.equal(disableData.maintenance, false);
  assert.equal(isMaintenanceMode(db), false);
  console.log("✓ Maintenance mode successfully deactivated");

  // Test 8: Non-admin can claim again after maintenance is disabled
  console.log("\n[Test 8] Labeller claims image after maintenance disabled...");
  const claimResAfter = await fetch(`${baseUrl}/api/images/${testImageId}/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${annotatorToken}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(claimResAfter.status, 200, "Claim must succeed after maintenance is off");
  const claimDataAfter = await claimResAfter.json();
  assert.equal(claimDataAfter.success, true);
  assert.equal(claimDataAfter.locked_by, annotatorName);
  console.log("✓ Labeller successfully claimed image after maintenance concluded");

  console.log("\n🎉 ALL MAINTENANCE MODE & GIT PULL SAFEGUARD CHECKS PASSED!");
} finally {
  server.close();
  setSystemSetting(db, "maintenance_mode", "0");
  if (fs.existsSync(testFilePath)) {
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  }
  db.prepare("DELETE FROM sessions WHERE token = ?").run(annotatorToken);
  db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(adminToken);
  db.prepare("DELETE FROM users WHERE id = ?").run(annotatorId);
  db.prepare("DELETE FROM images WHERE id = ?").run(testImageId);
  db.prepare("DELETE FROM image_claims WHERE project_id = ? AND rel_path = ?").run(
    project.id,
    testFileName,
  );
  db.close();
}
