import { getDb, catalogue, syncProjectImages } from "./labelling-api.mjs";

console.log("=== Testing Task Locking Integration with labels.db ===\n");

const root = process.cwd();
const db = await getDb(root);

// Check project 1
const project = db.prepare("SELECT * FROM projects WHERE id = 1").get();
console.log("Project 1:", project);

// Sync images
syncProjectImages(db, root, project);

// Check images table
const images = db.prepare("SELECT * FROM images WHERE project_id = 1").all();
console.log(`\nFound ${images.length} images in images table:`);
for (const img of images) {
  console.log(
    `  - [ID ${img.id}] ${img.file_path}: status=${img.status}, locked_by=${img.locked_by}, locked_at=${img.locked_at}`,
  );
}

// Test catalogue returns images with lock info
const cat = await catalogue(root, project);
console.log(`\nCatalogue returned ${cat.images.length} images.`);
const first = cat.images[0];
console.log("Sample image row in catalogue:", first);

// Test atomic checkout query from the prompt
console.log("\nSimulating Atomic Claim Query ('Get Next Image'):");
const claimQuery = db.prepare(`
  UPDATE images
  SET 
    locked_by = :userId,
    locked_at = CURRENT_TIMESTAMP
  WHERE id = (
    SELECT id FROM images
    WHERE project_id = :projectId
      AND (status = 'unlabeled' OR status IS NULL)
      AND (locked_by IS NULL OR locked_at < datetime('now', '-15 minutes'))
    ORDER BY id ASC
    LIMIT 1
  )
  RETURNING *;
`);

const user1 = claimQuery.get({ userId: "alice", projectId: project.id });
console.log("Alice checked out image:", user1);

const user2 = claimQuery.get({ userId: "bob", projectId: project.id });
console.log("Bob checked out image:", user2);

if (user1 && user2 && user1.id !== user2.id) {
  console.log(
    `\n[PASS] Atomic claim successfully assigned different images: Alice=${user1.id}, Bob=${user2.id}`,
  );
} else if (user1 && !user2) {
  console.log(
    `\n[PASS] Only 1 unlabeled image was free; Alice received ID ${user1.id} and Bob received none.`,
  );
} else {
  console.error("\n[FAIL] Collision or unexpected assignment!");
  process.exit(1);
}

// Test unlock
console.log("\nTesting Explicit Unlock Route Query:");
const unlockQuery = db.prepare(`
  UPDATE images
  SET 
    locked_by = NULL,
    locked_at = NULL
  WHERE id = :imageId AND locked_by = :userId
  RETURNING *;
`);
const unlockedBob = unlockQuery.get({
  imageId: user2 ? user2.id : user1.id,
  userId: user2 ? "bob" : "alice",
});
console.log("Unlocked row:", unlockedBob);
if (unlockedBob.locked_by === null) {
  console.log("[PASS] Image was successfully unlocked.");
}

// Reset Alice's test lock
db.prepare("UPDATE images SET locked_by = NULL, locked_at = NULL WHERE locked_by = 'alice'").run();

console.log("\nAll integration tests with labels.db passed!");
