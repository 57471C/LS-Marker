import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createDatabaseBackup, getBackupStatus, handle } from "./labelling-api.mjs";

console.log("=== Verifying Database Backup & Active Session Safeguards ===\n");

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");
const db = new Database(dbPath);

try {
  // -------------------------------------------------------------
  // Test 1: SQLite WAL Mode Integrity Check
  // -------------------------------------------------------------
  console.log("[Test 1] Verifying SQLite WAL mode is preserved...");
  const journalMode = db.pragma("journal_mode", { simple: true });
  console.log(`Current journal_mode: ${journalMode}`);
  assert.equal(
    String(journalMode).toLowerCase(),
    "wal",
    "Database must be in WAL mode per zero-downtime production rules",
  );
  console.log("✓ Test 1 passed: WAL mode is active.");

  // -------------------------------------------------------------
  // Test 2: Active Session Lease Detection
  // -------------------------------------------------------------
  console.log("\n[Test 2] Testing Active Session Lease Detection...");
  const initialStatus = getBackupStatus(db);
  console.log("Initial status before test locks:", initialStatus);
  assert.equal(typeof initialStatus.activeCount, "number");
  assert(Array.isArray(initialStatus.activeUsers));

  // Insert a synthetic active lease (< 15 mins) and an expired lease (> 15 mins)
  const testPathActive = "__test_backup_active.jpg";
  const testPathExpired = "__test_backup_expired.jpg";

  db.prepare(`
    INSERT INTO images (project_id, file_path, name, status, locked_by, locked_at)
    VALUES (1, ?, 'test_active.jpg', 'unlabeled', 'ActiveAnnotator1', datetime('now', '-3 minutes'))
  `).run(testPathActive);

  db.prepare(`
    INSERT INTO images (project_id, file_path, name, status, locked_by, locked_at)
    VALUES (1, ?, 'test_expired.jpg', 'unlabeled', 'ExpiredAnnotator2', datetime('now', '-25 minutes'))
  `).run(testPathExpired);

  try {
    const activeStatus = getBackupStatus(db);
    console.log("Status with test active & expired leases:", activeStatus);
    assert(
      activeStatus.activeUsers.includes("ActiveAnnotator1"),
      "ActiveAnnotator1 must appear in activeUsers",
    );
    assert(
      !activeStatus.activeUsers.includes("ExpiredAnnotator2"),
      "ExpiredAnnotator2 (>15m) must NOT appear in activeUsers",
    );
    assert.equal(
      activeStatus.activeCount,
      initialStatus.activeCount + 1,
      "activeCount must increment by exactly 1 for the unexpired lease",
    );
    console.log("✓ Test 2 passed: Active lease queries accurately filter by 15-minute TTL.");
  } finally {
    db.prepare("DELETE FROM images WHERE file_path IN (?, ?)").run(testPathActive, testPathExpired);
  }

  // -------------------------------------------------------------
  // Test 3: Native Online SQLite Backup & Table Querying
  // -------------------------------------------------------------
  console.log("\n[Test 3] Verifying native online SQLite backup generation...");
  const tempSnapshotPath = path.join(os.tmpdir(), `verify-test-backup-${Date.now()}.sqlite`);

  try {
    await createDatabaseBackup(db, tempSnapshotPath);
    assert(fs.existsSync(tempSnapshotPath), "Snapshot file must exist on disk");
    const stat = fs.statSync(tempSnapshotPath);
    console.log(`Snapshot created at ${tempSnapshotPath} (${stat.size} bytes)`);
    assert(stat.size > 0, "Snapshot must have non-zero size");

    // Open the snapshot independently with better-sqlite3
    const snapshotDb = new Database(tempSnapshotPath, { readonly: true });
    const tables = snapshotDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC")
      .all()
      .map((r) => r.name);
    console.log("Tables in snapshot database:", tables);

    assert(tables.includes("projects"), "Snapshot must include projects table");
    assert(tables.includes("classes"), "Snapshot must include classes table");
    assert(tables.includes("images"), "Snapshot must include images table");
    assert(tables.includes("users"), "Snapshot must include users table");

    const liveProjectsCount = db.prepare("SELECT COUNT(*) AS c FROM projects").get().c;
    const snapshotProjectsCount = snapshotDb.prepare("SELECT COUNT(*) AS c FROM projects").get().c;
    assert.equal(
      snapshotProjectsCount,
      liveProjectsCount,
      "Projects count in snapshot must match live database",
    );

    snapshotDb.close();
    console.log("✓ Test 3 passed: Native SQLite snapshot is valid, intact, and queryable.");
  } finally {
    if (fs.existsSync(tempSnapshotPath)) {
      fs.unlinkSync(tempSnapshotPath);
    }
  }

  // -------------------------------------------------------------
  // Test 4: WAL Non-Blocking Concurrency Verification
  // -------------------------------------------------------------
  console.log("\n[Test 4] Verifying concurrent read/write during backup...");
  const tempConcurPath = path.join(os.tmpdir(), `verify-test-concur-${Date.now()}.sqlite`);

  try {
    const backupPromise = createDatabaseBackup(db, tempConcurPath);

    // Concurrently write to live DB in WAL mode
    db.prepare(`
      INSERT INTO images (project_id, file_path, name, status)
      VALUES (1, '__temp_concur.jpg', 'temp_concur.jpg', 'unlabeled')
    `).run();

    await backupPromise;

    // Verify live DB remains healthy and row was written
    const concurRow = db
      .prepare("SELECT * FROM images WHERE file_path = '__temp_concur.jpg'")
      .get();
    assert(concurRow, "Concurrent write to live database must succeed during backup");
    console.log("✓ Test 4 passed: Backup runs concurrently without locking live DB writes.");
  } finally {
    db.prepare("DELETE FROM images WHERE file_path = '__temp_concur.jpg'").run();
    if (fs.existsSync(tempConcurPath)) {
      fs.unlinkSync(tempConcurPath);
    }
  }

  // -------------------------------------------------------------
  // Test 5: HTTP Endpoints (/api/system/backup-status & /api/system/backup-download)
  // -------------------------------------------------------------
  console.log("\n[Test 5] Testing HTTP Endpoints...");
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
    // 5.1 GET /api/system/backup-status
    const statusRes = await fetch(`http://127.0.0.1:${port}/api/system/backup-status`);
    assert.equal(statusRes.status, 200, "backup-status must return 200");
    const statusData = await statusRes.json();
    console.log("HTTP /api/system/backup-status response:", statusData);
    assert.equal(typeof statusData.activeCount, "number");
    assert(Array.isArray(statusData.activeUsers));
    console.log("✓ GET /api/system/backup-status succeeded");

    // 5.2 GET /api/system/backup-download
    const downloadRes = await fetch(`http://127.0.0.1:${port}/api/system/backup-download`);
    assert.equal(downloadRes.status, 200, "backup-download must return 200");

    const contentType = downloadRes.headers.get("content-type");
    const contentDisposition = downloadRes.headers.get("content-disposition");
    console.log("Content-Type:", contentType);
    console.log("Content-Disposition:", contentDisposition);

    assert(
      contentType?.includes("application/vnd.sqlite3"),
      "Content-Type must be application/vnd.sqlite3",
    );
    assert(
      contentDisposition?.includes("attachment") &&
        contentDisposition?.includes("ls-marker-backup-") &&
        contentDisposition?.endsWith('.sqlite"'),
      "Content-Disposition must specify attachment with timestamped sqlite filename",
    );

    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    console.log(`Downloaded ${buffer.length} bytes`);
    assert(buffer.length > 0, "Downloaded stream must not be empty");

    // Verify downloaded buffer is a valid SQLite DB file
    const downloadedTemp = path.join(os.tmpdir(), `verify-http-download-${Date.now()}.sqlite`);
    fs.writeFileSync(downloadedTemp, buffer);

    const downloadedDb = new Database(downloadedTemp, { readonly: true });
    const downloadedTables = downloadedDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    assert(downloadedTables.length > 0, "Downloaded SQLite file must have tables");
    downloadedDb.close();
    fs.unlinkSync(downloadedTemp);
    console.log("✓ GET /api/system/backup-download succeeded and delivered valid SQLite snapshot.");

    console.log("\n🎉 ALL TESTS AND ZERO-RISK DATABASE BACKUP SAFEGUARDS PASSED!");
  } finally {
    server.close();
  }
} finally {
  db.close();
}
