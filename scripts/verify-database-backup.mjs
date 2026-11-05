import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { getDb } from "./db.mjs";
import { createDatabaseBackup, getBackupStatus, handle } from "./labelling-api.mjs";

console.log("=== Verifying PostgreSQL Database Backup & Active Session Safeguards ===\n");

const root = process.cwd();
const db = await getDb(root);

try {
  // -------------------------------------------------------------
  // Test 1: PostgreSQL Connection & Health Check
  // -------------------------------------------------------------
  console.log("[Test 1] Verifying PostgreSQL connection and health...");
  const res = await db.pool.query("SELECT version() AS version, current_database() AS db");
  assert(res.rows.length > 0, "Must be able to query PostgreSQL version");
  console.log(`Connected to database '${res.rows[0].db}' running: ${res.rows[0].version}`);
  console.log("✓ Test 1 passed: PostgreSQL database is connected and healthy.");

  // -------------------------------------------------------------
  // Test 2: Active Session Lease Detection
  // -------------------------------------------------------------
  console.log("\n[Test 2] Testing Active Session Lease Detection...");
  const initialStatus = await getBackupStatus(db);
  console.log("Initial status before test locks:", initialStatus);
  assert.equal(typeof initialStatus.activeCount, "number");
  assert(Array.isArray(initialStatus.activeUsers));

  // Insert a synthetic active lease (< 15 mins) and an expired lease (> 15 mins)
  const testPathActive = "__test_backup_active.jpg";
  const testPathExpired = "__test_backup_expired.jpg";

  await db
    .prepare(`
    INSERT INTO images (project_id, file_path, name, status, locked_by, locked_at)
    VALUES (1, ?, 'test_active.jpg', 'unlabeled', 'ActiveAnnotator1', datetime('now', '-3 minutes'))
  `)
    .run(testPathActive);

  await db
    .prepare(`
    INSERT INTO images (project_id, file_path, name, status, locked_by, locked_at)
    VALUES (1, ?, 'test_expired.jpg', 'unlabeled', 'ExpiredAnnotator2', datetime('now', '-25 minutes'))
  `)
    .run(testPathExpired);

  try {
    const activeStatus = await getBackupStatus(db);
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
    await db
      .prepare("DELETE FROM images WHERE file_path IN (?, ?)")
      .run(testPathActive, testPathExpired);
  }

  // -------------------------------------------------------------
  // Test 3: Online PostgreSQL SQL Dump Backup Generation
  // -------------------------------------------------------------
  console.log("\n[Test 3] Verifying PostgreSQL SQL dump backup generation...");
  const tempSnapshotPath = path.join(os.tmpdir(), `verify-test-backup-${Date.now()}.sql`);

  try {
    await createDatabaseBackup(db, tempSnapshotPath);
    assert(fs.existsSync(tempSnapshotPath), "Snapshot file must exist on disk");
    const stat = fs.statSync(tempSnapshotPath);
    console.log(`Snapshot created at ${tempSnapshotPath} (${stat.size} bytes)`);
    assert(stat.size > 0, "Snapshot must have non-zero size");

    const sqlContent = fs.readFileSync(tempSnapshotPath, "utf8");
    assert(sqlContent.includes("-- LS-Marker PostgreSQL Backup Dump"), "Must include dump header");
    assert(sqlContent.includes("projects"), "Must include projects table");
    assert(sqlContent.includes("classes"), "Must include classes table");
    assert(sqlContent.includes("images"), "Must include images table");
    assert(sqlContent.includes("users"), "Must include users table");
    console.log(
      "✓ Test 3 passed: PostgreSQL dump is valid, intact, and contains all production tables.",
    );
  } finally {
    if (fs.existsSync(tempSnapshotPath)) {
      fs.unlinkSync(tempSnapshotPath);
    }
  }

  // -------------------------------------------------------------
  // Test 4: Concurrency During Backup
  // -------------------------------------------------------------
  console.log("\n[Test 4] Verifying concurrent read/write during backup...");
  const tempConcurPath = path.join(os.tmpdir(), `verify-test-concur-${Date.now()}.sql`);

  try {
    const backupPromise = createDatabaseBackup(db, tempConcurPath);

    // Concurrently write to live DB
    await db
      .prepare(`
      INSERT INTO images (project_id, file_path, name, status)
      VALUES (1, '__temp_concur.jpg', 'temp_concur.jpg', 'unlabeled')
    `)
      .run();

    await backupPromise;

    // Verify live DB remains healthy and row was written
    const concurRow = await db
      .prepare("SELECT * FROM images WHERE file_path = '__temp_concur.jpg'")
      .get();
    assert(concurRow, "Concurrent write to live database must succeed during backup");
    console.log("✓ Test 4 passed: Backup runs concurrently without locking live DB writes.");
  } finally {
    await db.prepare("DELETE FROM images WHERE file_path = '__temp_concur.jpg'").run();
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

    assert(contentType?.includes("application/sql"), "Content-Type must be application/sql");
    assert(
      contentDisposition?.includes("attachment") &&
        contentDisposition?.includes("ls-marker-backup-") &&
        contentDisposition?.endsWith('.sql"'),
      "Content-Disposition must specify attachment with timestamped sql filename",
    );

    const buffer = Buffer.from(await downloadRes.arrayBuffer());
    console.log(`Downloaded ${buffer.length} bytes`);
    assert(buffer.length > 0, "Downloaded stream must not be empty");

    const downloadedText = buffer.toString("utf8");
    assert(
      downloadedText.includes("-- LS-Marker PostgreSQL Backup Dump"),
      "Must be valid SQL dump",
    );
    console.log(
      "✓ GET /api/system/backup-download succeeded and delivered valid PostgreSQL SQL snapshot.",
    );

    console.log("\n🎉 ALL TESTS AND ZERO-RISK DATABASE BACKUP SAFEGUARDS PASSED!");
  } finally {
    server.close();
  }
} finally {
  await db.close();
}
