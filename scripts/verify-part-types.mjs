/**
 * Standalone verification script for dynamic part types (Class adder) scoped to projects.
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

console.log("=== Verifying Project-Scoped Dynamic Part Types (Class Adder) ===");

const testDbPath = path.resolve(process.cwd(), "tmp_test_part_types.db");
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const db = new Database(testDbPath);
db.pragma("journal_mode = WAL");

try {
  // 1. Verify schema migration and seeding for multiple projects
  console.log("1. Testing SQLite schema migration and per-project seeding...");
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
      part_type TEXT DEFAULT NULL,
      PRIMARY KEY (project_id, id)
    );
    INSERT INTO projects (id, name, folder) VALUES (1, 'Project Alpha', 'C:/data/alpha');
    INSERT INTO projects (id, name, folder) VALUES (2, 'Project Beta', 'C:/data/beta');

    -- Project 1 uses bolt and nut
    INSERT INTO classes (project_id, id, ic, des, color, part_type)
    VALUES (1, 0, 'B01', 'Bolt M8x40', '#ff0000', 'bolt');
    INSERT INTO classes (project_id, id, ic, des, color, part_type)
    VALUES (1, 1, 'N01', 'Nut M8', '#00ff00', 'nut');

    -- Project 2 uses washer and label
    INSERT INTO classes (project_id, id, ic, des, color, part_type)
    VALUES (2, 0, 'W01', 'Washer M8', '#0000ff', 'washer');
    INSERT INTO classes (project_id, id, ic, des, color, part_type)
    VALUES (2, 1, 'L01', 'Warning Label', '#ffff00', 'label');
  `);

  ensureSqliteClassesSchema(db);

  const seededTypesP1 = db
    .prepare("SELECT * FROM part_types WHERE project_id = 1 ORDER BY id ASC")
    .all();
  const seededIdsP1 = seededTypesP1.map((t) => t.id);
  assert.ok(seededIdsP1.includes("bolt"), "bolt should be seeded in project 1");
  assert.ok(seededIdsP1.includes("nut"), "nut should be seeded in project 1");
  assert.equal(
    seededIdsP1.includes("washer"),
    false,
    "washer should NOT be in project 1 (only used classes are kept)",
  );
  console.log("  ✓ Project 1 has only its used classes:", seededIdsP1.join(", "));

  const seededTypesP2 = db
    .prepare("SELECT * FROM part_types WHERE project_id = 2 ORDER BY id ASC")
    .all();
  const seededIdsP2 = seededTypesP2.map((t) => t.id);
  assert.ok(seededIdsP2.includes("washer"), "washer should be seeded in project 2");
  assert.ok(seededIdsP2.includes("label"), "label should be seeded in project 2");
  assert.equal(seededIdsP2.includes("bolt"), false, "bolt should NOT be in project 2");
  console.log("  ✓ Project 2 has only its used classes:", seededIdsP2.join(", "));

  // 2. Test getPartTypesMap project scoping
  console.log("2. Testing getPartTypesMap with project scoping...");
  clearPartTypesCache();
  const mapP1 = await getPartTypesMap(db, 1, true);
  assert.ok(mapP1.has("bolt"));
  assert.deepEqual(mapP1.get("bolt").required_fields, ["thread", "length_mm"]);
  assert.equal(mapP1.get("bolt").length_rule, "length_mm", "bolt length_rule should be length_mm");
  assert.equal(mapP1.get("bolt").diameter_rule, "thread", "bolt diameter_rule should be thread");
  assert.equal(mapP1.get("nut").length_rule, "height_mm", "nut length_rule should be height_mm");
  assert.equal(mapP1.get("nut").diameter_rule, "af_mm", "nut diameter_rule should be af_mm");
  console.log("  ✓ Project 1 getPartTypesMap loaded correctly with default measurement rules");

  // 3. Create a custom part type (e.g. Resin) in Project 1 ONLY
  console.log("3. Testing custom part type insertion scoped to Project 1...");
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
    INSERT INTO part_types (project_id, id, name, fields, required_fields, display_format, length_rule, diameter_rule, note, archived, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    1, // project 1
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

  clearPartTypesCache(1);
  clearPartTypesCache(2);

  const updatedP1 = await getPartTypesMap(db, 1, true);
  const updatedP2 = await getPartTypesMap(db, 2, true);

  assert.ok(updatedP1.has("resin"), "Resin should be present in Project 1");
  assert.equal(
    updatedP2.has("resin"),
    false,
    "Resin must NOT be present in Project 2 (isolated scope)",
  );
  console.log(
    "  ✓ Multi-project isolation confirmed: 'resin' is in Project 1, but NOT in Project 2",
  );

  const resinLoaded = updatedP1.get("resin");
  assert.equal(resinLoaded.name, "Resin");
  assert.deepEqual(resinLoaded.fields, resinDef.fields);
  assert.deepEqual(resinLoaded.required_fields, resinDef.required_fields);
  assert.equal(resinLoaded.length_rule, "height_mm");
  assert.equal(resinLoaded.diameter_rule, "width_mm");

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

  // 6. Test soft-delete (archive) isolation between projects
  console.log("6. Testing archiving isolation between projects...");
  // Let's add bolt to project 2 as well to test archive isolation
  db.prepare(`
    INSERT INTO part_types (project_id, id, name, fields, required_fields, display_format, length_rule, diameter_rule, note, archived)
    VALUES (2, 'bolt', 'Bolt', '["thread","length_mm"]', '["thread","length_mm"]', '{thread}x{length_mm}', 'length_mm', 'thread', null, 0)
  `).run();

  db.prepare("UPDATE part_types SET archived = 1 WHERE project_id = 1 AND id = ?").run("bolt");
  clearPartTypesCache(1);
  clearPartTypesCache(2);

  const p1AfterArchive = await getPartTypesMap(db, 1, true);
  const p2AfterArchive = await getPartTypesMap(db, 2, true);

  assert.equal(p1AfterArchive.get("bolt").archived, true, "Bolt in Project 1 should be archived");
  assert.equal(p2AfterArchive.get("bolt").archived, false, "Bolt in Project 2 must REMAIN ACTIVE");
  console.log(
    "  ✓ Project-scoped archiving verified: Project 1 archived bolt without affecting Project 2",
  );

  console.log("=== All Dynamic Part Types & Scoping Tests Passed! ===");
} finally {
  db.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
}
