/**
 * Standalone verification script for dynamic part types (Class adder).
 * Run with: node scripts/verify-part-types.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ensureSqliteClassesSchema } from "./db.mjs";
import {
  cleanClassDimensions,
  computeClassDimensionsStatus,
  getPartTypesMap,
  clearPartTypesCache,
} from "./labelling-api.mjs";

console.log("=== Verifying Dynamic Part Types (Class Adder) ===");

// Create a temporary in-memory or file-based SQLite database for testing
const testDbPath = path.resolve(process.cwd(), "tmp_test_part_types.db");
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const db = new Database(testDbPath);
db.pragma("journal_mode = WAL");

try {
  // 1. Verify schema migration and seeding
  console.log("1. Testing SQLite schema migration and initial seed...");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      folder TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS classes (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      ic TEXT NOT NULL,
      des TEXT NOT NULL,
      color TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    );
  `);

  ensureSqliteClassesSchema(db);

  const seededTypes = db.prepare("SELECT * FROM part_types ORDER BY id ASC").all();
  assert.ok(seededTypes.length >= 7, "Expected at least 7 default part types seeded");
  const seededIds = seededTypes.map((t) => t.id);
  assert.ok(seededIds.includes("bolt"), "bolt should be seeded");
  assert.ok(seededIds.includes("nut"), "nut should be seeded");
  assert.ok(seededIds.includes("washer"), "washer should be seeded");
  assert.ok(seededIds.includes("label"), "label should be seeded");
  assert.ok(seededIds.includes("cable_tie"), "cable_tie should be seeded");
  assert.ok(seededIds.includes("spring"), "spring should be seeded");
  assert.ok(seededIds.includes("other"), "other should be seeded");
  console.log("  ✓ Seeded part types verified:", seededIds.join(", "));

  // 2. Test getPartTypesMap
  console.log("2. Testing getPartTypesMap...");
  clearPartTypesCache();
  const map = await getPartTypesMap(db, true);
  assert.ok(map.has("bolt"));
  assert.deepEqual(map.get("bolt").required_fields, ["thread", "length_mm"]);
  assert.equal(map.get("bolt").length_rule, "length_mm", "bolt length_rule should be length_mm");
  assert.equal(map.get("bolt").diameter_rule, "thread", "bolt diameter_rule should be thread");
  assert.equal(map.get("nut").length_rule, "height_mm", "nut length_rule should be height_mm");
  assert.equal(map.get("nut").diameter_rule, "af_mm", "nut diameter_rule should be af_mm");
  assert.equal(map.get("label").length_rule, "height_mm", "label length_rule should be height_mm");
  assert.equal(
    map.get("label").diameter_rule,
    "width_mm",
    "label diameter_rule should be width_mm",
  );
  console.log("  ✓ getPartTypesMap loaded correctly from DB with default measurement rules");

  // 3. Create a custom part type (e.g. Resin)
  console.log("3. Testing custom part type insertion...");
  const resinDef = {
    id: "resin",
    name: "Resin",
    fields: ["width_mm", "height_mm", "thickness_mm", "note"],
    required_fields: ["width_mm", "height_mm"],
    display_format: "{width_mm}x{height_mm}mm ({thickness_mm}mm)",
    length_rule: "height_mm",
    diameter_rule: "width_mm",
    note: "UV cured cartridge",
    archived: false,
    created_at: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO part_types (id, name, fields, required_fields, display_format, length_rule, diameter_rule, note, archived, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    resinDef.id,
    resinDef.name,
    JSON.stringify(resinDef.fields),
    JSON.stringify(resinDef.required_fields),
    resinDef.display_format,
    resinDef.length_rule,
    resinDef.diameter_rule,
    resinDef.note,
    0,
    resinDef.created_at,
  );

  clearPartTypesCache();
  const updatedMap = await getPartTypesMap(db, true);
  assert.ok(updatedMap.has("resin"), "Resin should be in updated map");
  const resinLoaded = updatedMap.get("resin");
  assert.equal(resinLoaded.name, "Resin");
  assert.deepEqual(resinLoaded.fields, resinDef.fields);
  assert.deepEqual(resinLoaded.required_fields, resinDef.required_fields);
  assert.equal(resinLoaded.length_rule, "height_mm");
  assert.equal(resinLoaded.diameter_rule, "width_mm");
  assert.equal(resinLoaded.note, "UV cured cartridge");
  console.log(
    "  ✓ Custom part type 'resin' with measurement rules created and loaded successfully",
  );

  // 4. Test formatCanonicalDimensions and cleanClassDimensions with custom class
  console.log("4. Testing canonical formatting and cleaning for custom class...");
  const rawBody = {
    part_type: "resin",
    width_mm: 50.5,
    height_mm: 25.0,
    thickness_mm: 3.2,
    thread: "M10", // not allowed in resin
    note: "UV cured clear",
  };

  const cleaned = cleanClassDimensions(rawBody, resinLoaded);
  assert.equal(cleaned.part_type, "resin");
  assert.equal(cleaned.width_mm, 50.5);
  assert.equal(cleaned.height_mm, 25.0);
  assert.equal(cleaned.thickness_mm, 3.2);
  assert.equal(
    cleaned.thread,
    null,
    "thread should be filtered out because it is not in resin fields",
  );
  assert.equal(cleaned.dimensions, "50.5x25mm (3.2mm)", "dimensions should match template");
  console.log("  ✓ Canonical format generated:", cleaned.dimensions);

  // 5. Test computeClassDimensionsStatus with custom required fields
  console.log("5. Testing computeClassDimensionsStatus for dynamic class...");
  const completeStatus = computeClassDimensionsStatus(
    { width_mm: 50.5, height_mm: 25.0, thickness_mm: 3.2, part_type: "resin" },
    resinLoaded,
  );
  assert.equal(completeStatus, "complete", "Both width and height present -> complete");

  const missingStatus = computeClassDimensionsStatus(
    { width_mm: 50.5, height_mm: null, part_type: "resin" },
    resinLoaded,
  );
  assert.equal(missingStatus, "missing", "Height is required and missing -> missing");
  console.log("  ✓ Required metrology validation passed");

  // 6. Test soft-delete (archive) and restore
  console.log("6. Testing archiving and restoration (zero data-loss)...");
  db.prepare("UPDATE part_types SET archived = 1 WHERE id = ?").run("resin");
  clearPartTypesCache();
  const mapAfterArchive = await getPartTypesMap(db, true);
  assert.equal(mapAfterArchive.get("resin").archived, true, "Resin should be marked archived");

  // Unarchive/restore
  db.prepare("UPDATE part_types SET archived = 0 WHERE id = ?").run("resin");
  clearPartTypesCache();
  const mapAfterRestore = await getPartTypesMap(db, true);
  assert.equal(mapAfterRestore.get("resin").archived, false, "Resin should be active again");
  console.log("  ✓ Soft-delete (archive) and restore verified without data loss");

  console.log("=== All Dynamic Part Types Tests Passed! ===");
} finally {
  db.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
}
