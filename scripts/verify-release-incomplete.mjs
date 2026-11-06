import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { catalogue, getDb } from "./labelling-api.mjs";

const root = process.cwd();

console.log("=== LS-Marker Release Incomplete Verification ===");

const db = await getDb(root);
const project = await db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in database");
console.log(`Using project: "${project.name}" (ID: ${project.id})`);

const projectFolder = path.resolve(root, project.folder);
assert(fs.existsSync(projectFolder), `Project folder ${projectFolder} must exist`);

const user = await db.prepare("SELECT id, username FROM users LIMIT 1").get();
assert(user, "A user must exist in database");

const testFileName = "test_release_incomplete_flow.jpg";
const testFilePath = path.join(projectFolder, testFileName);
const testTxtPath = path.join(projectFolder, "test_release_incomplete_flow.txt");

// Create dummy image and label .txt file
fs.writeFileSync(testFilePath, Buffer.alloc(100));
fs.writeFileSync(testTxtPath, "0 0.5 0.5 0.2 0.2\n");

// Insert an authorized session
const testToken = `verify_incomplete_${Date.now()}`;
const expires = new Date(Date.now() + 86400000).toISOString();
await db
  .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
  .run(testToken, user.id, expires);

const server = await createServer({
  root,
  server: { port: 3098 },
  logLevel: "warn",
});
await server.listen();
const port = server.config.server.port;
const baseUrl = `http://127.0.0.1:${port}`;
const headers = {
  "content-type": "application/json",
  cookie: `partlab=${testToken}; partlab_project=${project.id}`,
};

try {
  // Test 1: Completed image with .txt on disk released as incomplete
  console.log("\n[Test 1] Previously completed image with .txt on disk...");
  await db
    .prepare(
      `INSERT INTO images (project_id, file_path, name, status, locked_by, locked_at)
     VALUES (?, ?, ?, 'completed', NULL, NULL)
     ON CONFLICT(project_id, file_path) DO UPDATE SET
       status = 'completed', locked_by = NULL, locked_at = NULL`,
    )
    .run(project.id, testFileName, testFileName);

  await db
    .prepare(
      `INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
     VALUES (?, ?, NULL, NULL, 'complete', CURRENT_TIMESTAMP)
     ON CONFLICT(project_id, rel_path) DO UPDATE SET
       claimed_by = NULL, claimed_at = NULL, status = 'complete'`,
    )
    .run(project.id, testFileName);

  // Verify catalogue initially sees it as complete
  const initialCat = await catalogue(root, project);
  const initialImg = initialCat.images.find((i) => i.name === testFileName);
  assert(initialImg, "Image must exist in catalogue");
  assert.equal(initialImg.status, "complete", "Must initially be complete");

  // Operator claims it to make a correction
  console.log("Claiming completed image...");
  const claimRes = await fetch(`${baseUrl}/api/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: testFileName, action: "claim" }),
  });
  assert.equal(claimRes.status, 200, "Claim must succeed");

  // Operator clicks 'Release Incomplete'
  console.log("Releasing incomplete...");
  const releaseRes = await fetch(`${baseUrl}/api/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: testFileName, action: "release-incomplete" }),
  });
  assert.equal(releaseRes.status, 200, "Release incomplete must return 200");
  const releaseData = await releaseRes.json();
  assert.equal(releaseData.status, "incomplete", "Returned status must be incomplete");

  // Now verify catalogue (what the photos tab fetches via GET /api/catalogue)
  console.log("Checking catalogue output for photos tab...");
  const catAfterRelease = await catalogue(root, project);
  const imgAfterRelease = catAfterRelease.images.find((i) => i.name === testFileName);
  assert(imgAfterRelease, "Image must exist in catalogue");
  assert.equal(
    imgAfterRelease.status,
    "incomplete",
    "CRITICAL: In catalogue/photos tab, status MUST be 'incomplete', NOT 'complete' even though .txt exists!",
  );
  assert.equal(imgAfterRelease.labelled, false, "Image labelled flag must be false");
  assert.equal(imgAfterRelease.claimedBy, null, "Image must have no claimedBy");
  assert.equal(imgAfterRelease.is_claimed, false, "Image is_claimed must be false");
  console.log(
    "✓ Test 1 passed: completed photo released as incomplete is listed as 'incomplete' in photos tab.",
  );

  // Test 2: Unlocking an approved image and releasing incomplete
  console.log("\n[Test 2] Unlocking approved photo and releasing as incomplete...");
  await db
    .prepare(
      `UPDATE images SET status = 'approved', reviewed_by = 'admin', reviewed_at = CURRENT_TIMESTAMP
     WHERE project_id = ? AND file_path = ?`,
    )
    .run(project.id, testFileName);
  await db
    .prepare(
      `UPDATE image_claims SET status = 'approved'
     WHERE project_id = ? AND rel_path = ?`,
    )
    .run(project.id, testFileName);

  // Admin unlocks the approved image
  const unlockRes = await fetch(`${baseUrl}/api/images/unlock`, {
    method: "POST",
    headers: { ...headers, "x-role": "reviewer" },
    body: JSON.stringify({ name: testFileName, action: "unlock-approved" }),
  });
  assert.equal(unlockRes.status, 200, "Unlock must succeed");

  // Now release incomplete
  const releaseUnlockRes = await fetch(`${baseUrl}/api/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: testFileName, action: "release-incomplete" }),
  });
  assert.equal(releaseUnlockRes.status, 200, "Release incomplete after unlock must succeed");

  // Check catalogue
  const catAfterUnlockRelease = await catalogue(root, project);
  const imgAfterUnlockRelease = catAfterUnlockRelease.images.find((i) => i.name === testFileName);
  assert.equal(
    imgAfterUnlockRelease.status,
    "incomplete",
    "CRITICAL: Unlocked approved photo released as incomplete must be listed as 'incomplete' in photos tab",
  );
  console.log(
    "✓ Test 2 passed: unlocked approved photo released as incomplete is 'incomplete' in photos tab.",
  );

  console.log("\n--- All Release Incomplete Verifications Passed! ---");
} finally {
  await server.close();
  try {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    if (fs.existsSync(testTxtPath)) fs.unlinkSync(testTxtPath);
    await db
      .prepare("DELETE FROM images WHERE project_id = ? AND file_path = ?")
      .run(project.id, testFileName);
    await db
      .prepare("DELETE FROM image_claims WHERE project_id = ? AND rel_path = ?")
      .run(project.id, testFileName);
    await db.prepare("DELETE FROM sessions WHERE token = ?").run(testToken);
  } catch {}
  process.exit(0);
}
