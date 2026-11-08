import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { ensureSqliteClassesSchema } from "./db.mjs";
import {
  formatCanonicalDimensions,
  cleanClassDimensions,
  computeClassDimensionsStatus,
} from "./labelling-api.mjs";
import { parseLegacyDimensions, migrateDatabaseDimensions } from "./migrate-dimensions.mjs";

console.log("--- Starting Dimension Migration & Metrology Verification ---");

// Test 1: Canonical display string generation
{
  // Bolt
  const bolt1 = formatCanonicalDimensions({
    part_type: "bolt",
    thread: "M6",
    length_mm: 30,
    head_type: "Hex",
  });
  assert.equal(bolt1, "M6x30 Hex");

  const bolt2 = formatCanonicalDimensions({
    part_type: "bolt",
    thread: "M6",
    length_mm: 30,
    head_type: "Hex",
    af_mm: 10,
  });
  assert.equal(bolt2, "M6x30 Hex (AF: 10mm)");

  const boltSimple = formatCanonicalDimensions({
    part_type: "bolt",
    thread: "M6",
    length_mm: 30,
  });
  assert.equal(boltSimple, "M6x30");

  // Nut
  const nut1 = formatCanonicalDimensions({
    part_type: "nut",
    thread: "M8",
    af_mm: 13,
  });
  assert.equal(nut1, "M8, AF: 13mm");

  const nut2 = formatCanonicalDimensions({
    part_type: "nut",
    thread: "M8",
    af_mm: 13,
    height_mm: 6.5,
  });
  assert.equal(nut2, "M8, AF: 13mm, H: 6.5mm");

  // Washer
  const washer = formatCanonicalDimensions({
    part_type: "washer",
    od_mm: 16,
    id_mm: 8.4,
    thickness_mm: 1.6,
  });
  assert.equal(washer, "16 × 8.4 × 1.6 mm");

  // Label / Sticker
  const label = formatCanonicalDimensions({
    part_type: "label",
    width_mm: 130,
    height_mm: 37,
  });
  assert.equal(label, "130x37mm");

  // Cable tie
  const cableTie = formatCanonicalDimensions({
    part_type: "cable_tie",
    length_mm: 200,
    width_mm: 4.8,
  });
  assert.equal(cableTie, "200x4.8mm");

  // Spring
  const spring1 = formatCanonicalDimensions({
    part_type: "spring",
    od_mm: 12,
    length_mm: 35,
  });
  assert.equal(spring1, "OD: 12mm, L: 35mm");

  const spring2 = formatCanonicalDimensions({
    part_type: "spring",
    od_mm: 12,
    length_mm: 35,
    note: "compression",
  });
  assert.equal(spring2, "OD: 12mm, L: 35mm (compression)");

  console.log("✓ Test 1 passed: Canonical display string formatting verified.");
}

// Test 2: Unambiguous legacy text parsing
{
  // Bolt of form "Bolt: 16 × 6 mm"
  const parsedBolt = parseLegacyDimensions("Bolt: 16 × 6 mm", {
    ic: "BOLT-01",
    des: "Hex Bolt",
  });
  assert.equal(parsedBolt?.status, "parsed");
  assert.equal(parsedBolt?.structured.part_type, "bolt");
  assert.equal(parsedBolt?.structured.thread, "M6");
  assert.equal(parsedBolt?.structured.length_mm, 16);
  assert.equal(parsedBolt?.structured.head_type, "Hex");
  assert.equal(parsedBolt?.canonicalText, "M6x16 Hex");

  // Label of form "L: 130mm, H: 37mm"
  const parsedLabel = parseLegacyDimensions("L: 130mm, H: 37mm", {
    ic: "LBL-01",
    des: "Warning Sticker",
  });
  assert.equal(parsedLabel?.status, "parsed");
  assert.equal(parsedLabel?.structured.part_type, "label");
  assert.equal(parsedLabel?.structured.width_mm, 130);
  assert.equal(parsedLabel?.structured.height_mm, 37);
  assert.equal(parsedLabel?.canonicalText, "130x37mm");

  // Washer
  const parsedWasher = parseLegacyDimensions("Washer: 16 × 8.4 × 1.6 mm", {
    ic: "WSH-01",
    des: "Flat washer",
  });
  assert.equal(parsedWasher?.status, "parsed");
  assert.equal(parsedWasher?.structured.part_type, "washer");
  assert.equal(parsedWasher?.structured.od_mm, 16);
  assert.equal(parsedWasher?.structured.id_mm, 8.4);
  assert.equal(parsedWasher?.structured.thickness_mm, 1.6);
  assert.equal(parsedWasher?.canonicalText, "16 × 8.4 × 1.6 mm");

  // Cable tie
  const parsedTie = parseLegacyDimensions("Cable tie: 200 × 4.8 mm", {
    ic: "TIE-01",
    des: "Cable tie black",
  });
  assert.equal(parsedTie?.status, "parsed");
  assert.equal(parsedTie?.structured.part_type, "cable_tie");
  assert.equal(parsedTie?.structured.length_mm, 200);
  assert.equal(parsedTie?.structured.width_mm, 4.8);
  assert.equal(parsedTie?.canonicalText, "200x4.8mm");

  // Nut with thread in description
  const parsedNut = parseLegacyDimensions("Nut: 13 × 6.5 mm", {
    ic: "NUT-01",
    des: "Hex Nut M8",
  });
  assert.equal(parsedNut?.status, "parsed");
  assert.equal(parsedNut?.structured.part_type, "nut");
  assert.equal(parsedNut?.structured.thread, "M8");
  assert.equal(parsedNut?.structured.af_mm, 13);
  assert.equal(parsedNut?.structured.height_mm, 6.5);
  assert.equal(parsedNut?.canonicalText, "M8, AF: 13mm, H: 6.5mm");

  console.log("✓ Test 2 passed: Unambiguous legacy dimensions parsed correctly.");
}

// Test 3: Ambiguous rows preserved with structured fields blank and original text intact
{
  // Nut missing thread
  const ambNut = parseLegacyDimensions("Nut: 13 × 6.5 mm", {
    ic: "NUT-GENERIC",
    des: "Flanged Nut without thread code",
  });
  assert.equal(ambNut?.status, "ambiguous");
  assert.equal(ambNut?.originalText, "Nut: 13 × 6.5 mm");

  // Arbitrary text
  const ambCustom = parseLegacyDimensions("approx 50mm stamped bracket", {
    ic: "BRK-01",
    des: "Mounting bracket",
  });
  assert.equal(ambCustom?.status, "ambiguous");
  assert.equal(ambCustom?.originalText, "approx 50mm stamped bracket");

  console.log("✓ Test 3 passed: Ambiguous rows preserved with original text.");
}

// Test 4: SQLite full migration round-trip
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-marker-migration-test-"));
  const dbPath = path.join(tmpDir, "test.db");
  const db = new Database(dbPath);

  try {
    db.exec(`
      CREATE TABLE classes (
        project_id INTEGER NOT NULL,
        id INTEGER NOT NULL,
        ic TEXT NOT NULL,
        des TEXT NOT NULL,
        color TEXT,
        part_type TEXT DEFAULT NULL,
        dim1_name TEXT DEFAULT NULL,
        dim1_mm REAL DEFAULT NULL,
        dim2_name TEXT DEFAULT NULL,
        dim2_mm REAL DEFAULT NULL,
        dim3_name TEXT DEFAULT NULL,
        dim3_mm REAL DEFAULT NULL,
        PRIMARY KEY (project_id, id)
      );
    `);

    // Ensure additive schema works
    ensureSqliteClassesSchema(db);

    const cols = db
      .prepare("PRAGMA table_info(classes)")
      .all()
      .map((c) => c.name);
    assert.ok(cols.includes("thread"), "Must have thread column");
    assert.ok(cols.includes("length_mm"), "Must have length_mm column");
    assert.ok(cols.includes("head_type"), "Must have head_type column");
    assert.ok(cols.includes("af_mm"), "Must have af_mm column");
    assert.ok(cols.includes("od_mm"), "Must have od_mm column");
    assert.ok(cols.includes("id_mm"), "Must have id_mm column");
    assert.ok(cols.includes("dimensions"), "Must have dimensions column");

    const insert = db.prepare(
      `INSERT INTO classes (project_id, id, ic, des, color, part_type, dimensions)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    // Row 1: Unambiguous bolt
    insert.run(1, 0, "IC-BOLT", "Hex Bolt", "#1473e6", "bolt", "Bolt: 16 × 6 mm");
    // Row 2: Unambiguous label
    insert.run(1, 1, "IC-LABEL", "Serial Tag", "#1473e6", "label", "L: 130mm, H: 37mm");
    // Row 3: Ambiguous row
    insert.run(
      1,
      2,
      "IC-CUSTOM",
      "Special Bracket",
      "#1473e6",
      "other",
      "approx 50mm stamped bracket",
    );
    // Row 4: Nut missing thread
    insert.run(1, 3, "IC-NUT-UNKNOWN", "Nut", "#1473e6", "nut", "Nut: 13 × 6.5 mm");

    // Run migration
    const stats = await migrateDatabaseDimensions(db, "Test-SQLite", false);
    assert.equal(stats.total, 4);
    assert.equal(stats.migratedCount, 2);
    assert.equal(stats.ambiguousCount, 2);

    // Verify row 1
    const r1 = db.prepare("SELECT * FROM classes WHERE id = 0").get();
    assert.equal(r1.thread, "M6");
    assert.equal(r1.length_mm, 16);
    assert.equal(r1.head_type, "Hex");
    assert.equal(r1.dimensions, "M6x16 Hex");

    // Verify row 2
    const r2 = db.prepare("SELECT * FROM classes WHERE id = 1").get();
    assert.equal(r2.width_mm, 130);
    assert.equal(r2.height_mm, 37);
    assert.equal(r2.dimensions, "130x37mm");

    // Verify row 3 (ambiguous: structured fields null, dimensions intact)
    const r3 = db.prepare("SELECT * FROM classes WHERE id = 2").get();
    assert.equal(r3.thread, null);
    assert.equal(r3.length_mm, null);
    assert.equal(r3.dimensions, "approx 50mm stamped bracket");

    // Verify row 4 (nut missing thread: structured fields null, dimensions intact)
    const r4 = db.prepare("SELECT * FROM classes WHERE id = 3").get();
    assert.equal(r4.thread, null);
    assert.equal(r4.af_mm, null);
    assert.equal(r4.dimensions, "Nut: 13 × 6.5 mm");

    console.log("✓ Test 4 passed: SQLite migration round-trip verified.");
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Test 5: cleanClassDimensions & computeClassDimensionsStatus with structured metrology
{
  // Bolt complete
  const boltClean = cleanClassDimensions({
    part_type: "bolt",
    thread: "M8",
    length_mm: 30,
    head_type: "Hex",
    af_mm: 13,
  });
  assert.equal(boltClean.thread, "M8");
  assert.equal(boltClean.length_mm, 30);
  assert.equal(boltClean.head_type, "Hex");
  assert.equal(boltClean.af_mm, 13);
  assert.equal(boltClean.dimensions, "M8x30 Hex (AF: 13mm)");
  assert.equal(computeClassDimensionsStatus(boltClean), "complete");

  // Bolt missing length
  const boltIncomplete = cleanClassDimensions({
    part_type: "bolt",
    thread: "M8",
    head_type: "Hex",
  });
  assert.equal(computeClassDimensionsStatus(boltIncomplete), "missing");

  // Nut complete
  const nutClean = cleanClassDimensions({
    part_type: "nut",
    thread: "M10",
    af_mm: 17,
  });
  assert.equal(nutClean.dimensions, "M10, AF: 17mm");
  assert.equal(computeClassDimensionsStatus(nutClean), "complete");

  // Label complete
  const labelClean = cleanClassDimensions({
    part_type: "label",
    width_mm: 130,
    height_mm: 37,
  });
  assert.equal(labelClean.dimensions, "130x37mm");
  assert.equal(computeClassDimensionsStatus(labelClean), "complete");

  console.log("✓ Test 5 passed: cleanClassDimensions & computeClassDimensionsStatus verified.");
}

// Test 6: Production backup dump verification
{
  const backupPath =
    "C:/Users/Terry.minett/.gemini/antigravity/brain/e4eea422-1613-4b0a-8271-13a2e4f0e892/.user_uploaded/media_1794117299719_b6fa25fc.sql";
  if (fs.existsSync(backupPath)) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-marker-backup-test-"));
    const dbPath = path.join(tmpDir, "backup_test.db");
    const db = new Database(dbPath);

    try {
      db.exec(`
        CREATE TABLE classes (
          project_id INTEGER NOT NULL,
          id INTEGER NOT NULL,
          ic TEXT NOT NULL,
          des TEXT NOT NULL,
          color TEXT,
          part_type TEXT DEFAULT NULL,
          dim1_name TEXT DEFAULT NULL,
          dim1_mm REAL DEFAULT NULL,
          dim2_name TEXT DEFAULT NULL,
          dim2_mm REAL DEFAULT NULL,
          dim3_name TEXT DEFAULT NULL,
          dim3_mm REAL DEFAULT NULL,
          PRIMARY KEY (project_id, id)
        );
      `);

      const content = fs.readFileSync(backupPath, "utf8");
      const insertLines = content.split("\n").filter((l) => l.startsWith("INSERT INTO classes"));

      const insertStmt = db.transaction((lines) => {
        for (const line of lines) {
          // Replace PostgreSQL ON CONFLICT DO NOTHING with SQLite syntax or execute directly
          const sqliteLine = line.replace(" ON CONFLICT DO NOTHING;", ";");
          db.exec(sqliteLine);
        }
      });
      insertStmt(insertLines);

      const beforeCount = db.prepare("SELECT COUNT(*) as count FROM classes").get().count;
      assert.equal(beforeCount, 56, "Expected 56 classes from backup");

      // Ensure additive columns
      ensureSqliteClassesSchema(db);

      // Run migration
      const stats = await migrateDatabaseDimensions(db, "Production-Backup-SQLite", false);
      assert.equal(stats.total, 56);
      assert.ok(
        stats.migratedCount >= 48,
        `Expected at least 48 migrated classes, got ${stats.migratedCount}`,
      );

      // Verify label migration
      const labelRow = db.prepare("SELECT * FROM classes WHERE ic = '2VDSWN02'").get();
      assert.equal(labelRow.part_type, "label");
      assert.equal(labelRow.width_mm, 130);
      assert.equal(labelRow.height_mm, 37);
      assert.equal(labelRow.dimensions, "130x37mm");

      // Verify imperial nut migration
      const nutRow = db.prepare("SELECT * FROM classes WHERE ic = '2BBN6WTZ'").get();
      assert.equal(nutRow.part_type, "nut");
      assert.equal(nutRow.thread, "3/8 UNC");
      assert.equal(nutRow.af_mm, 14.15);
      assert.equal(nutRow.height_mm, 8.3);
      assert.equal(nutRow.dimensions, "3/8 UNC, AF: 14.15mm, H: 8.3mm");

      // Verify button head bolt migration
      const boltRow = db.prepare("SELECT * FROM classes WHERE ic = '2BB06B0BZHS'").get();
      assert.equal(boltRow.part_type, "bolt");
      assert.equal(boltRow.thread, "M6");
      assert.equal(boltRow.length_mm, 16);
      assert.equal(boltRow.head_type, "Button");
      assert.equal(boltRow.dimensions, "M6x16 Button");

      // Verify crush tube migration
      const crushRow = db.prepare("SELECT * FROM classes WHERE ic = '5ZBCB04'").get();
      assert.equal(crushRow.part_type, "washer");
      assert.equal(crushRow.od_mm, 17);
      assert.equal(crushRow.id_mm, 13);
      assert.equal(crushRow.thickness_mm, 21);
      assert.equal(crushRow.dimensions, "17 × 13 × 21 mm");

      // Verify 0 rows deleted
      const afterCount = db.prepare("SELECT COUNT(*) as count FROM classes").get().count;
      assert.equal(afterCount, 56, "Zero data loss: class count must not change");

      console.log(
        `✓ Test 6 passed: Production backup dump (56 rows) migrated and verified with 0 data-loss.`,
      );
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } else {
    console.log(`⚠ Test 6 skipped: Backup file not found at ${backupPath}`);
  }
}

console.log("--- All Dimension Migration & Metrology Verifications Passed ---");
process.exit(0);
