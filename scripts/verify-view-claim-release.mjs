import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createServer } from "vite";
import { catalogue } from "./labelling-api.mjs";

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");

console.log("=== LS-Marker View, Claim & Release Incomplete Verification ===");

const db = new Database(dbPath);
const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in labels.db");

const projectFolder = path.resolve(root, project.folder);
const testFileName = "test_view_claim_release.jpg";
const testFilePath = path.join(projectFolder, testFileName);

// Create dummy image file if needed
if (!fs.existsSync(testFilePath)) {
  fs.writeFileSync(testFilePath, Buffer.alloc(100));
}

// 1. Reset image record to open and unclaimed in both tables
db.prepare(
  `INSERT INTO images (project_id, file_path, name, status, locked_by, locked_at)
   VALUES (?, ?, ?, 'open', NULL, NULL)
   ON CONFLICT(project_id, file_path) DO UPDATE SET
     status = 'open', locked_by = NULL, locked_at = NULL`,
).run(project.id, testFileName, testFileName);

db.prepare(
  `INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
   VALUES (?, ?, NULL, NULL, 'open', NULL)
   ON CONFLICT(project_id, rel_path) DO UPDATE SET
     claimed_by = NULL, claimed_at = NULL, status = 'open', completed_at = NULL`,
).run(project.id, testFileName);

console.log("✓ Test image initialized as open and unclaimed.");

// Start Vite test server
const server = await createServer({
  root,
  server: { port: 3097 },
  logLevel: "warn",
});
await server.listen();
const port = server.config.server.port;
const baseUrl = `http://127.0.0.1:${port}`;
console.log(`Vite test server listening on port ${port}`);

try {
  // Create a test session
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "test_annotator", password: "123" }),
  });
  assert.equal(loginRes.status, 200, "Login must succeed");
  const cookieHeader = loginRes.headers.get("set-cookie");
  assert(cookieHeader, "Session cookie must be returned");

  const headers = {
    "content-type": "application/json",
    cookie: cookieHeader,
  };

  // Test 1: Viewing a photo (GET /api/label) does NOT claim it
  console.log("\n[Test 1] Viewing a photo does not claim it...");
  const viewRes = await fetch(`${baseUrl}/api/label?name=${encodeURIComponent(testFileName)}`, {
    headers,
  });
  assert.equal(viewRes.status, 200);

  const catAfterView = await catalogue(root, project);
  const imgAfterView = catAfterView.images.find((i) => i.name === testFileName);
  assert(imgAfterView, "Image must be in catalogue");
  assert.equal(imgAfterView.claimedBy, null, "Viewing must NOT set claimedBy");
  assert.equal(imgAfterView.lockedBy, null, "Viewing must NOT set lockedBy");
  assert.equal(imgAfterView.is_claimed, false, "Viewing must NOT set is_claimed");
  assert.equal(imgAfterView.held_by, null, "Viewing must NOT set held_by");
  console.log("✓ Confirmed: Viewing a photo leaves it unclaimed.");

  // Test 2: Explicitly clicking "Claim" claims the photo
  console.log("\n[Test 2] Claiming the photo via claim action...");
  const claimRes = await fetch(`${baseUrl}/api/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: testFileName, action: "claim" }),
  });
  assert.equal(claimRes.status, 200);
  const claimData = await claimRes.json();
  assert.equal(claimData.claimedBy, "test_annotator", "Must be claimed by test_annotator");

  const catAfterClaim = await catalogue(root, project);
  const imgAfterClaim = catAfterClaim.images.find((i) => i.name === testFileName);
  assert.equal(imgAfterClaim.claimedBy, "test_annotator");
  assert.equal(imgAfterClaim.lockedBy, "test_annotator");
  assert.equal(imgAfterClaim.is_claimed, true);
  assert.equal(imgAfterClaim.held_by, "test_annotator");
  console.log("✓ Confirmed: Explicit claim claims the photo for the user.");

  // Test 3: "Release incomplete" actually releases the photo
  console.log("\n[Test 3] Releasing incomplete...");
  const releaseRes = await fetch(`${baseUrl}/api/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: testFileName, action: "release-incomplete" }),
  });
  assert.equal(releaseRes.status, 200);
  const releaseData = await releaseRes.json();
  assert.equal(releaseData.status, "incomplete", "Returned status must be incomplete");
  assert.equal(releaseData.claimedBy, null, "Returned claimedBy must be null");

  const catAfterRelease = await catalogue(root, project);
  const imgAfterRelease = catAfterRelease.images.find((i) => i.name === testFileName);
  assert.equal(imgAfterRelease.status, "incomplete", "Image status must be incomplete");
  assert.equal(imgAfterRelease.claimedBy, null, "Image claimedBy must be null");
  assert.equal(imgAfterRelease.lockedBy, null, "Image lockedBy must be null");
  assert.equal(imgAfterRelease.is_claimed, false, "Image is_claimed must be false");
  assert.equal(imgAfterRelease.held_by, null, "Image held_by must be null");
  assert.equal(imgAfterRelease.held_minutes_remaining, 0, "Held minutes must be 0");
  console.log("✓ Confirmed: 'Release incomplete' releases the photo in SQLite and catalogue.");

  // Test 4: Viewing the photo again after release does NOT re-claim it
  console.log("\n[Test 4] Viewing the photo again after release...");
  const viewAgainRes = await fetch(
    `${baseUrl}/api/label?name=${encodeURIComponent(testFileName)}`,
    {
      headers,
    },
  );
  assert.equal(viewAgainRes.status, 200);

  const catAfterSecondView = await catalogue(root, project);
  const imgAfterSecondView = catAfterSecondView.images.find((i) => i.name === testFileName);
  assert.equal(imgAfterSecondView.status, "incomplete");
  assert.equal(imgAfterSecondView.claimedBy, null, "Still unclaimed after viewing");
  assert.equal(imgAfterSecondView.is_claimed, false, "Still not claimed");
  console.log("✓ Confirmed: Photo stays released and incomplete after being viewed.");

  // Test 5: Saving markup claims the photo
  console.log("\n[Test 5] Saving markup claims the photo...");
  const saveMarkupRes = await fetch(
    `${baseUrl}/api/label?name=${encodeURIComponent(testFileName)}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ boxes: [{ classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }] }),
    },
  );
  assert.equal(saveMarkupRes.status, 200);

  const catAfterMarkup = await catalogue(root, project);
  const imgAfterMarkup = catAfterMarkup.images.find((i) => i.name === testFileName);
  assert.equal(imgAfterMarkup.claimedBy, "test_annotator", "Saving markup claims the photo");
  console.log("✓ Confirmed: Marking up / saving claims the photo.");

  // Clean up
  await fetch(`${baseUrl}/api/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: testFileName, action: "release-incomplete" }),
  });

  console.log("\n--- All View, Claim & Release Incomplete Verifications Passed! ---");
} finally {
  await server.close();
  try {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    const txtPath = path.join(projectFolder, "test_view_claim_release.txt");
    if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
    db.prepare("DELETE FROM images WHERE project_id = ? AND file_path = ?").run(
      project.id,
      testFileName,
    );
    db.prepare("DELETE FROM image_claims WHERE project_id = ? AND rel_path = ?").run(
      project.id,
      testFileName,
    );
  } catch {
    /* ignore cleanup error */
  }
}
process.exit(0);
