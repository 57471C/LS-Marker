import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import Database from "better-sqlite3";
import { catalogue, handle } from "./labelling-api.mjs";

console.log("=== Verifying Claim Persistence & Lease Tracking ===");

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");
const db = new Database(dbPath);

const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in the database for testing");
console.log(`Using project '${project.name}' (id: ${project.id})`);

// Setup 2 test users & sessions
const userA_name = `user_a_${Date.now()}`;
const userB_name = `user_b_${Date.now()}`;
const tokenA = crypto.randomBytes(16).toString("hex");
const tokenB = crypto.randomBytes(16).toString("hex");
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const userA_id = db
  .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'hash', ?)")
  .run(userA_name, expires).lastInsertRowid;
const userB_id = db
  .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'hash', ?)")
  .run(userB_name, expires).lastInsertRowid;

db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
  tokenA,
  userA_id,
  expires,
);
db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
  tokenB,
  userB_id,
  expires,
);

// Create a test image on disk and in db
const projectFolder = path.resolve(root, project.folder);
const testFileName = `test_claim_${Date.now()}.jpg`;
const testFilePath = path.join(projectFolder, testFileName);
fs.writeFileSync(testFilePath, "dummy image content");

const testImageId = db
  .prepare(
    "INSERT INTO images (project_id, file_path, name, status, owner, locked_by, locked_at) VALUES (?, ?, ?, 'unlabeled', NULL, NULL, NULL)",
  )
  .run(project.id, testFileName, testFileName).lastInsertRowid;

console.log(`Created test image id: ${testImageId}`);

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
  // Test 1: User A claims image via POST /api/images/:id/claim
  console.log("\n[Test 1] User A claims image...");
  const claimResA = await fetch(`${baseUrl}/api/images/${testImageId}/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${tokenA}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({}),
  });
  if (claimResA.status !== 200) {
    console.error("claimResA error:", await claimResA.text());
  }
  assert.equal(claimResA.status, 200, `Expected 200, got ${claimResA.status}`);
  const claimDataA = await claimResA.json();
  assert.equal(claimDataA.success, true);
  assert.equal(claimDataA.is_claimed, true);
  assert.equal(claimDataA.held_by, userA_name);
  assert.equal(claimDataA.locked_by, userA_name);
  assert.equal(claimDataA.held_minutes_remaining, 15);
  console.log("✓ User A successfully claimed the image for 15 minutes");

  // Test 2: User B tries to claim the same image within 15 minutes -> 409 Conflict
  console.log("\n[Test 2] User B attempts to claim the same image...");
  const claimResB = await fetch(`${baseUrl}/api/images/${testImageId}/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${tokenB}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(claimResB.status, 409, `Expected 409 Conflict, got ${claimResB.status}`);
  const conflictData = await claimResB.json();
  assert.match(
    conflictData.error,
    new RegExp(`Image currently claimed by ${userA_name}`),
    `Unexpected conflict message: ${conflictData.error}`,
  );
  console.log(`✓ 409 Conflict returned correctly: "${conflictData.error}"`);

  // Test 3: Catalogue & Photos endpoint returns computed lease fields
  console.log("\n[Test 3] Checking catalogue & photos endpoint lease data...");
  const cat = await catalogue(root, project);
  const catImage = cat.images.find((img) => img.id === testImageId);
  assert(catImage, "Image must be found in catalogue");
  assert.equal(catImage.is_claimed, true);
  assert.equal(catImage.held_by, userA_name);
  assert(catImage.held_minutes_remaining >= 14, "held_minutes_remaining should be ~15m");

  const photosRes = await fetch(`${baseUrl}/api/images?project_id=${project.id}`, {
    headers: {
      Cookie: `partlab=${tokenA}; partlab_project=${project.id}`,
    },
  });
  assert.equal(photosRes.status, 200);
  const photosData = await photosRes.json();
  const photoImage = photosData.images.find((img) => img.id === testImageId);
  assert(photoImage, "Image must be found in /api/images");
  assert.equal(photoImage.is_claimed, true);
  assert.equal(photoImage.held_by, userA_name);
  assert(photoImage.held_minutes_remaining >= 14);
  console.log("✓ Catalogue and /api/images reflect live claim and lease time remaining");

  // Test 4: Expired lease allows User B to claim
  console.log("\n[Test 4] Simulating expired lease (> 15 minutes ago)...");
  db.prepare("UPDATE images SET locked_at = datetime('now', '-16 minutes') WHERE id = ?").run(
    testImageId,
  );

  const claimResBExpired = await fetch(`${baseUrl}/api/images/${testImageId}/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${tokenB}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(
    claimResBExpired.status,
    200,
    `Expected 200 after lease expiry, got ${claimResBExpired.status}`,
  );
  const claimDataB = await claimResBExpired.json();
  assert.equal(claimDataB.success, true);
  assert.equal(claimDataB.is_claimed, true);
  assert.equal(claimDataB.held_by, userB_name);
  assert.equal(claimDataB.locked_by, userB_name);
  console.log("✓ User B successfully claimed image after User A's lease expired");

  // Test 5: Explicit release frees the image
  console.log("\n[Test 5] Explicit release incomplete...");
  const releaseRes = await fetch(`${baseUrl}/api/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${tokenB}; partlab_project=${project.id}`,
    },
    body: JSON.stringify({ name: testFileName, action: "release-incomplete" }),
  });
  assert.equal(releaseRes.status, 200);

  const catAfterRelease = await catalogue(root, project);
  const releasedImg = catAfterRelease.images.find((img) => img.id === testImageId);
  assert.equal(releasedImg.is_claimed, false);
  assert.equal(releasedImg.held_by, null);
  assert.equal(releasedImg.held_minutes_remaining, 0);
  console.log("✓ Image successfully released and marked free in catalogue");

  console.log("\nALL CLAIM PERSISTENCE & LEASE VERIFICATIONS PASSED!");
} finally {
  server.close();
  if (fs.existsSync(testFilePath)) {
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  }
  // Cleanup
  db.prepare("DELETE FROM sessions WHERE token IN (?, ?)").run(tokenA, tokenB);
  db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(userA_id, userB_id);
  db.prepare("DELETE FROM images WHERE id = ?").run(testImageId);
  db.prepare("DELETE FROM image_claims WHERE project_id = ? AND rel_path = ?").run(
    project.id,
    testFileName,
  );
  db.close();
}
