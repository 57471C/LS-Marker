import Database from "better-sqlite3";
import fs from "node:fs";

console.log("=== LS-Marker Multi-User Task Locking Verification ===\n");

const testDbPath = "./data/verify-task-locking.db";
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const dbA = new Database(testDbPath);
dbA.pragma("journal_mode = WAL");
dbA.exec(`
  CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL DEFAULT 1,
    file_path TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'unlabeled',
    locked_by TEXT DEFAULT NULL,
    locked_at DATETIME DEFAULT NULL,
    completed_at DATETIME DEFAULT NULL,
    UNIQUE (project_id, file_path)
  );

  INSERT INTO images (project_id, file_path, name, status) VALUES (1, 'photo-01.jpg', 'photo-01.jpg', 'unlabeled');
  INSERT INTO images (project_id, file_path, name, status) VALUES (1, 'photo-02.jpg', 'photo-02.jpg', 'unlabeled');
  INSERT INTO images (project_id, file_path, name, status) VALUES (1, 'photo-03.jpg', 'photo-03.jpg', 'unlabeled');
`);

const dbB = new Database(testDbPath);

const claimNextStmt = (db) =>
  db.prepare(`
    UPDATE images
    SET 
      locked_by = :userId,
      locked_at = CURRENT_TIMESTAMP
    WHERE id = (
      SELECT id FROM images
      WHERE (status = 'unlabeled' OR status IS NULL)
        AND (locked_by IS NULL OR locked_at < datetime('now', '-15 minutes'))
      ORDER BY id ASC
      LIMIT 1
    )
    RETURNING *;
  `);

// --- Test 1: Simulate Two Simultaneous Requests ---
console.log("Test 1: Simulating two concurrent requests for the next unlabeled image...");
const userA_claim = claimNextStmt(dbA).get({ userId: "annotator_A" });
const userB_claim = claimNextStmt(dbB).get({ userId: "annotator_B" });

console.log("  Annotator A claimed:", {
  id: userA_claim.id,
  file: userA_claim.file_path,
  locked_by: userA_claim.locked_by,
  locked_at: userA_claim.locked_at,
});
console.log("  Annotator B claimed:", {
  id: userB_claim.id,
  file: userB_claim.file_path,
  locked_by: userB_claim.locked_by,
  locked_at: userB_claim.locked_at,
});

if (userA_claim.id !== userB_claim.id) {
  console.log(
    `[PASS] Annotator A and B received distinct image IDs (${userA_claim.id} vs ${userB_claim.id}).`,
  );
} else {
  console.error(`[FAIL] Concurrency collision! Both users received ID ${userA_claim.id}.`);
  process.exit(1);
}

// --- Test 2: Expired Timestamp (> 15 min) Reclaim ---
console.log("\nTest 2: Verifying automatic reclamation of expired lease (> 15 min)...");
// Set Annotator A's lease to 16 minutes in the past
dbA
  .prepare("UPDATE images SET locked_at = datetime('now', '-16 minutes') WHERE id = ?")
  .run(userA_claim.id);

const userC_claim = claimNextStmt(dbB).get({ userId: "annotator_C" });
console.log("  Annotator C claimed:", {
  id: userC_claim.id,
  file: userC_claim.file_path,
  locked_by: userC_claim.locked_by,
  locked_at: userC_claim.locked_at,
});

if (userC_claim.id === userA_claim.id && userC_claim.locked_by === "annotator_C") {
  console.log(`[PASS] Expired image ID ${userA_claim.id} successfully reclaimed by Annotator C.`);
} else {
  console.error(
    `[FAIL] Expected image ID ${userA_claim.id} to be reclaimed by Annotator C, got ID ${userC_claim?.id}.`,
  );
  process.exit(1);
}

// --- Test 3: Release Lock on Save ---
console.log("\nTest 3: Releasing lock on save / completion...");
const saveStmt = dbB.prepare(`
  UPDATE images
  SET 
    status = 'completed',
    locked_by = NULL,
    locked_at = NULL
  WHERE id = :imageId AND locked_by = :userId
  RETURNING *;
`);
const saved = saveStmt.get({ imageId: userC_claim.id, userId: "annotator_C" });
console.log("  Completed image:", saved);

if (saved.status === "completed" && saved.locked_by === null && saved.locked_at === null) {
  console.log("[PASS] Image marked as completed and lock released on save.");
} else {
  console.error("[FAIL] Lock was not released on save!");
  process.exit(1);
}

// --- Test 4: Explicit Unlock Route ---
console.log("\nTest 4: Explicit unlock (cancel / navigate without saving)...");
const userD_claim = claimNextStmt(dbA).get({ userId: "annotator_D" });
console.log(`  Annotator D locked image ID ${userD_claim.id}`);

const unlockStmt = dbA.prepare(`
  UPDATE images
  SET 
    locked_by = NULL,
    locked_at = NULL
  WHERE id = :imageId AND locked_by = :userId
  RETURNING *;
`);
const unlocked = unlockStmt.get({ imageId: userD_claim.id, userId: "annotator_D" });
console.log("  Unlocked image:", unlocked);

if (unlocked.locked_by === null && unlocked.locked_at === null) {
  console.log("[PASS] Image explicitly unlocked and returned to pool.");
} else {
  console.error("[FAIL] Explicit unlock failed!");
  process.exit(1);
}

// Clean up
dbA.close();
dbB.close();
fs.unlinkSync(testDbPath);

console.log("\nAll lease-based locking verification checks passed successfully!");
