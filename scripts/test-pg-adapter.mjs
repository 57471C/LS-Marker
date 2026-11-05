import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "./db.mjs";

console.log("=== Testing PostgreSQL Database Adapter ===");

const db = await getDb();
console.log("Connected to PostgreSQL successfully.");

// 1. Test .get() and .all()
const project = await db.prepare("SELECT * FROM projects WHERE id = ?").get(1);
assert(project, "Project 1 should exist");
assert.equal(project.id, 1);
console.log("✓ Test 1 passed: .get() returned project:", project.name);

const images = await db.prepare("SELECT * FROM images WHERE project_id = ? ORDER BY id ASC").all(1);
assert(Array.isArray(images), "images should be an array");
console.log(`✓ Test 2 passed: .all() returned ${images.length} images.`);

// 2. Test named parameters
const namedTest = await db
  .prepare(
    "SELECT id, status FROM images WHERE (project_id = :projectId OR :projectId = -1) AND id = :imageId",
  )
  .get({ projectId: 1, imageId: 1 });
assert(namedTest, "Named parameter query should find row");
assert.equal(namedTest.id, 1);
console.log("✓ Test 3 passed: Named parameter mapping works.");

// 3. Test transactions and rollback
console.log("Testing transaction rollback on error...");
let rolledBack = false;
try {
  const tx = db.transaction(async () => {
    await db
      .prepare("UPDATE system_settings SET value = 'test_tx' WHERE key = 'maintenance_mode'")
      .run();
    throw new Error("Simulated rollback error");
  });
  await tx();
} catch {
  rolledBack = true;
}
assert(rolledBack, "Transaction should have thrown error");
const settingAfter = await db
  .prepare("SELECT value FROM system_settings WHERE key = 'maintenance_mode'")
  .get();
assert.notEqual(settingAfter?.value, "test_tx", "Transaction should have rolled back update");
console.log("✓ Test 4 passed: Transaction rollback works correctly.");

// 4. Test transaction commit
const txCommit = db.transaction(async () => {
  await db
    .prepare(
      "INSERT INTO system_settings (key, value) VALUES ('test_key', 'test_val') ON CONFLICT (key) DO UPDATE SET value = 'test_val'",
    )
    .run();
});
await txCommit();
const testKeyRow = await db
  .prepare("SELECT value FROM system_settings WHERE key = 'test_key'")
  .get();
assert.equal(testKeyRow?.value, "test_val", "Committed value should persist");
await db.prepare("DELETE FROM system_settings WHERE key = 'test_key'").run();
console.log("✓ Test 5 passed: Transaction commit works correctly.");

// 5. Test datetime('now', '-15 minutes')
const dateQuery = await db
  .prepare("SELECT COUNT(*) AS count FROM images WHERE locked_at < datetime('now', '-15 minutes')")
  .get();
assert(typeof dateQuery?.count === "number", "Count should be a number");
console.log(
  "✓ Test 6 passed: datetime('now', '-15 minutes') translation works, count =",
  dateQuery?.count,
);

// 6. Test database backup
const tmpBackup = path.join(os.tmpdir(), `test-backup-${Date.now()}.sql`);
await db.backup(tmpBackup);
assert(fs.existsSync(tmpBackup), "Backup file should exist");
const backupContent = fs.readFileSync(tmpBackup, "utf8");
assert(backupContent.includes("LS-Marker PostgreSQL Backup Dump"), "Backup header present");
fs.unlinkSync(tmpBackup);
console.log("✓ Test 7 passed: db.backup() generates valid SQL dump.");

console.log("\nALL POSTGRES ADAPTER TESTS PASSED!");
await db.close();
