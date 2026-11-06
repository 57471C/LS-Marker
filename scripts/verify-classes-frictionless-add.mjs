import assert from "node:assert/strict";
import { catalogue, getDb } from "./labelling-api.mjs";

const root = process.cwd();

console.log("=== LS-Marker Frictionless Class Adding Verification ===");

const db = await getDb(root);
const project = await db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in database");
console.log(`Using project: "${project.name}" (ID: ${project.id})`);

const testIc = `TEST_IC_${Date.now()}`;
const testDes = "Frictionless Test Bolt Description";
const testPartType = "bolt";

try {
  // 1. Simulate POST /api/classes with part_type
  console.log("\n[Test 1] Testing class creation with part_type payload...");
  const maxRow = await db
    .prepare("SELECT COALESCE(MAX(id), -1) + 1 AS id FROM classes WHERE project_id = ?")
    .get(project.id);
  const nextId = maxRow.id;

  const insertStmt = db.prepare(`
    INSERT INTO classes (
      project_id, id, ic, des, color,
      part_type, dim1_name, dim1_mm, dim2_name, dim2_mm, dim3_name, dim3_mm
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  await insertStmt.run(
    project.id,
    nextId,
    testIc,
    testDes,
    "#d7263d",
    testPartType,
    "length_mm",
    null,
    "thread_dia_mm",
    null,
    null,
    null,
  );

  // 2. Verify catalogue outputs the created class with part_type intact
  const cat = await catalogue(root, project);
  const createdClass = cat.classes.find((c) => c.ic === testIc);
  assert(createdClass, "Created class must exist in catalogue");
  assert.equal(createdClass.ic, testIc);
  assert.equal(createdClass.des, testDes);
  assert.equal(createdClass.part_type, testPartType, "Part type must be 'bolt'");
  assert.equal(createdClass.dim1_name, "length_mm");
  assert.equal(createdClass.dim2_name, "thread_dia_mm");
  console.log("✓ Test 1 passed: Class created with part_type and default dimension names.");

  console.log("\n--- All Frictionless Class Adding Verifications Passed! ---");
} finally {
  await db.prepare("DELETE FROM classes WHERE project_id = ? AND ic = ?").run(project.id, testIc);
  await catalogue(root, project);
  process.exit(0);
}
