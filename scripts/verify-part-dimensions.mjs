import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildDimensionsJson,
  cleanClassDimensions,
  computeClassDimensionsStatus,
  computeProjectHealth,
  getDb,
} from "./labelling-api.mjs";

console.log("--- Starting Part Dimensions Verification ---");

// 1. Test cleanClassDimensions and computeClassDimensionsStatus
{
  const noneDims = cleanClassDimensions({ part_type: "none", dim1_mm: 20 });
  assert.equal(noneDims.part_type, null);
  assert.equal(noneDims.dim1_mm, null);
  assert.equal(computeClassDimensionsStatus(noneDims), "none");

  const boltComplete = cleanClassDimensions({
    part_type: "bolt",
    dim1_mm: "25.5",
    dim2_mm: 8,
  });
  assert.equal(boltComplete.part_type, "bolt");
  assert.equal(boltComplete.dim1_name, "Length under head");
  assert.equal(boltComplete.dim1_mm, 25.5);
  assert.equal(boltComplete.dim2_name, "Thread diameter");
  assert.equal(boltComplete.dim2_mm, 8);
  assert.equal(boltComplete.dim3_mm, null);
  assert.equal(computeClassDimensionsStatus(boltComplete), "complete");

  const boltMissing = cleanClassDimensions({
    part_type: "bolt",
    dim1_mm: 25,
    dim2_mm: "",
  });
  assert.equal(computeClassDimensionsStatus(boltMissing), "missing");

  const washerComplete = cleanClassDimensions({
    part_type: "washer",
    dim1_mm: 16,
    dim2_mm: 8.4,
    dim3_mm: 1.6,
  });
  assert.equal(washerComplete.dim3_name, "Thickness");
  assert.equal(computeClassDimensionsStatus(washerComplete), "complete");

  const washerMissing = cleanClassDimensions({
    part_type: "washer",
    dim1_mm: 16,
    dim2_mm: 8.4,
  });
  assert.equal(computeClassDimensionsStatus(washerMissing), "missing");

  const springComplete = cleanClassDimensions({
    part_type: "spring",
    dim1_mm: 35,
    dim2_mm: 12,
  });
  assert.equal(springComplete.part_type, "spring");
  assert.equal(springComplete.dim1_name, "Height");
  assert.equal(springComplete.dim1_mm, 35);
  assert.equal(springComplete.dim2_name, "Diameter");
  assert.equal(springComplete.dim2_mm, 12);
  assert.equal(springComplete.dim3_mm, null);
  assert.equal(computeClassDimensionsStatus(springComplete), "complete");

  const springMissing = cleanClassDimensions({
    part_type: "spring",
    dim1_mm: 35,
    dim2_mm: "",
  });
  assert.equal(computeClassDimensionsStatus(springMissing), "missing");

  const otherComplete = cleanClassDimensions({
    part_type: "other",
    dim1_name: "Pin length",
    dim1_mm: 42,
  });
  assert.equal(computeClassDimensionsStatus(otherComplete), "complete");

  const otherPartial = cleanClassDimensions({
    part_type: "other",
    dim1_name: "Pin length",
    dim1_mm: "",
  });
  assert.equal(computeClassDimensionsStatus(otherPartial), "missing");

  console.log("[PASS] cleanClassDimensions & computeClassDimensionsStatus");
}

// 2. Test buildDimensionsJson includes only classes that have values
{
  const classes = [
    {
      id: 0,
      ic: "IC-BOLT-M8",
      des: "M8x25 Hex Bolt",
      ...cleanClassDimensions({ part_type: "bolt", dim1_mm: 25, dim2_mm: 8 }),
    },
    {
      id: 1,
      ic: "IC-NUT-M8",
      des: "M8 Hex Nut (unset values)",
      ...cleanClassDimensions({ part_type: "nut", dim1_mm: "", dim2_mm: "" }),
    },
    {
      id: 2,
      ic: "IC-CLIP",
      des: "No part type",
      ...cleanClassDimensions({ part_type: "none" }),
    },
    {
      id: 3,
      ic: "IC-WASHER-M8",
      des: "M8 Flat Washer",
      ...cleanClassDimensions({ part_type: "washer", dim1_mm: 16, dim2_mm: 8.4, dim3_mm: 1.6 }),
    },
  ];

  const jsonStr = buildDimensionsJson({ id: 1, name: "Fastener Kit" }, classes);
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.project_name, "Fastener Kit");
  assert.equal(parsed.unit, "mm");
  assert.equal(parsed.classes.length, 2);
  assert.equal(parsed.classes[0].id, 0);
  assert.equal(parsed.classes[0].ic, "IC-BOLT-M8");
  assert.equal(parsed.classes[0].dimensions.length, 2);
  assert.equal(parsed.classes[1].id, 3);
  assert.equal(parsed.classes[1].ic, "IC-WASHER-M8");
  assert.equal(parsed.classes[1].dimensions.length, 3);

  console.log("[PASS] buildDimensionsJson filters to classes with values only");
}

// 3. Test SQLite persistence and computeProjectHealth
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-marker-dims-"));
  const db = await getDb(tmpDir);
  try {
    const projInfo = db
      .prepare("INSERT INTO projects (name, folder, created_at) VALUES (?, ?, ?)")
      .run("Health Test Project", tmpDir, new Date().toISOString());
    const projectId = Number(projInfo.lastInsertRowid);

    const insertClass = db.prepare(
      `INSERT INTO classes
         (project_id, id, ic, des, color, part_type, dim1_name, dim1_mm, dim2_name, dim2_mm, dim3_name, dim3_mm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const b1 = cleanClassDimensions({ part_type: "bolt", dim1_mm: 30, dim2_mm: 10 });
    insertClass.run(
      projectId,
      0,
      "IC-00",
      "Complete Bolt",
      "#0e7490",
      b1.part_type,
      b1.dim1_name,
      b1.dim1_mm,
      b1.dim2_name,
      b1.dim2_mm,
      b1.dim3_name,
      b1.dim3_mm,
    );

    const n1 = cleanClassDimensions({ part_type: "nut", dim1_mm: 13, dim2_mm: null });
    insertClass.run(
      projectId,
      1,
      "IC-01",
      "Incomplete Nut",
      "#0e7490",
      n1.part_type,
      n1.dim1_name,
      n1.dim1_mm,
      n1.dim2_name,
      n1.dim2_mm,
      n1.dim3_name,
      n1.dim3_mm,
    );

    const cNone = cleanClassDimensions({ part_type: "none" });
    insertClass.run(
      projectId,
      2,
      "IC-02",
      "Unset Type",
      "#0e7490",
      cNone.part_type,
      cNone.dim1_name,
      cNone.dim1_mm,
      cNone.dim2_name,
      cNone.dim2_mm,
      cNone.dim3_name,
      cNone.dim3_mm,
    );

    const health = computeProjectHealth(
      tmpDir,
      { id: projectId, name: "Health Test Project", folder: tmpDir },
      db,
    );

    assert.equal(health.summary.missingDimensionsCount, 1);
    assert.equal(health.classes.length, 3);
    assert.equal(health.classes[0].dimensionsStatus, "complete");
    assert.equal(health.classes[1].dimensionsStatus, "missing");
    assert.equal(health.classes[2].dimensionsStatus, "none");

    console.log("[PASS] SQLite schema & computeProjectHealth dimensions audit");
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log("--- All Part Dimensions Verifications Passed ---");
