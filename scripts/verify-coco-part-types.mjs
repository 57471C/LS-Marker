import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import tar from "tar-stream";
import { createServer } from "vite";
import { getDb } from "./db.mjs";

const root = process.cwd();

function unpackTar(buffer) {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const files = new Map();

    extract.on("entry", (header, stream, next) => {
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        files.set(header.name, {
          header,
          content: Buffer.concat(chunks),
        });
        next();
      });
      stream.on("error", reject);
      stream.resume();
    });

    extract.on("finish", () => resolve(files));
    extract.on("error", reject);
    extract.end(buffer);
  });
}

console.log("=== LS-Marker COCO Part-Type Export Verification ===");

const db = await getDb(root);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-marker-coco-pt-"));
let tempProjectId = null;

try {
  // 1. Create a temporary project with 53 IC codes across 5 part types
  const projectName = `coco_pt_test_${Date.now()}`;
  const inserted = await db
    .prepare("INSERT INTO projects (name, folder) VALUES (?, ?) RETURNING id")
    .get(projectName, tempDir);
  tempProjectId = inserted.id;

  const partTypesDistribution = [
    { type: "washer", count: 10 },
    { type: "bolt", count: 20 },
    { type: "cable_tie", count: 5 },
    { type: "nut", count: 15 },
    { type: "label", count: 3 },
  ];

  let classId = 0;
  const createdClasses = [];
  for (const { type, count } of partTypesDistribution) {
    for (let i = 1; i <= count; i++) {
      const ic = `IC-${type.toUpperCase()}-${String(i).padStart(2, "0")}`;
      await db
        .prepare(
          "INSERT INTO classes (id, project_id, ic, des, color, part_type) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(classId, tempProjectId, ic, `${type} variant ${i}`, "#3b82f6", type);
      createdClasses.push({ id: classId, ic, part_type: type });
      classId++;
    }
  }
  assert.equal(createdClasses.length, 53, "Test project must have 53 IC classes");

  // Create 2 sample images with annotations from different IC codes of the same and different part types
  for (let imgIdx = 1; imgIdx <= 2; imgIdx++) {
    const imgName = `sample_${imgIdx}.jpg`;
    const imgPath = path.join(tempDir, imgName);
    const txtPath = path.join(tempDir, `sample_${imgIdx}.txt`);

    await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
      .jpeg()
      .toFile(imgPath);

    // Pick two different bolt ICs, one nut IC, one cable_tie IC, one washer IC
    const bolt1 = createdClasses.find((c) => c.ic === "IC-BOLT-01");
    const bolt2 = createdClasses.find((c) => c.ic === "IC-BOLT-15");
    const nut1 = createdClasses.find((c) => c.ic === "IC-NUT-07");
    const tie1 = createdClasses.find((c) => c.ic === "IC-CABLE_TIE-03");
    const washer1 = createdClasses.find((c) => c.ic === "IC-WASHER-05");

    const lines = [
      `${bolt1.id} 0.25 0.25 0.1 0.1`,
      `${bolt2.id} 0.50 0.25 0.1 0.1`,
      `${nut1.id} 0.75 0.25 0.1 0.1`,
      `${tie1.id} 0.25 0.75 0.2 0.1`,
      `${washer1.id} 0.75 0.75 0.1 0.1`,
    ];
    fs.writeFileSync(txtPath, `${lines.join("\n")}\n`);

    await db
      .prepare(
        "INSERT INTO images (project_id, file_path, name, status) VALUES (?, ?, ?, 'completed')",
      )
      .run(tempProjectId, imgName, imgName);
  }

  // 2. Start Vite server and test /api/export?format=coco
  const server = await createServer({
    root,
    server: { port: 3102 },
    logLevel: "warn",
  });
  await server.listen();
  const port = server.config.server.port;

  try {
    console.log("\n[1/4] Testing COCO export (default without class_mode param)...");
    const cocoRes = await fetch(
      `http://127.0.0.1:${port}/api/export?id=${tempProjectId}&format=coco&type=full_tar&split=50`,
    );
    assert.equal(cocoRes.status, 200);
    const cocoTar = await unpackTar(Buffer.from(await cocoRes.arrayBuffer()));

    const manifest = JSON.parse(cocoTar.get("export_manifest.json").content.toString("utf8"));
    const trainCoco = JSON.parse(
      cocoTar.get("annotations/instances_train.json").content.toString("utf8"),
    );
    const valCoco = JSON.parse(
      cocoTar.get("annotations/instances_val.json").content.toString("utf8"),
    );

    // Confirm only 5 unique part types (not 53 IC codes)
    const expectedTypes = ["bolt", "cable_tie", "label", "nut", "washer"];
    assert.equal(trainCoco.categories.length, 5, "Expected 5 part type categories, not 53 ICs");
    assert.deepEqual(
      trainCoco.categories.map((c) => c.name),
      expectedTypes,
      "Categories must be sorted unique part types",
    );
    assert.deepEqual(
      trainCoco.categories.map((c) => c.id),
      [0, 1, 2, 3, 4],
      "Category IDs must be stable 0..N-1 based on part type",
    );

    // Confirm IC-BOLT-01 and IC-BOLT-15 share the same category_id (0 = bolt) and preserve original IC
    const allAnns = [...trainCoco.annotations, ...valCoco.annotations];
    assert.equal(allAnns.length, 10, "Expected 10 total annotations across train & val");

    const boltAnns = allAnns.filter((a) => a.category_id === 0);
    assert.equal(boltAnns.length, 4, "Both bolt ICs across 2 images should share category_id 0");
    assert(
      boltAnns.some((a) => a.ic === "IC-BOLT-01"),
      "Annotation must carry IC-BOLT-01",
    );
    assert(
      boltAnns.some((a) => a.ic === "IC-BOLT-15"),
      "Annotation must carry IC-BOLT-15",
    );

    assert.equal(
      manifest.export_summary,
      "Exported 5 part types (10 annotations)",
      "Manifest must record export summary",
    );
    console.log("✓ COCO export produced 5 part types (10 annotations) from 53 IC classes.");

    // 3. Add another IC code for 'bolt' and verify category IDs remain identical
    console.log("\n[2/4] Verifying category ID stability when adding a new IC code...");
    await db
      .prepare(
        "INSERT INTO classes (id, project_id, ic, des, color, part_type) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(classId, tempProjectId, "IC-BOLT-99", "Extra bolt", "#3b82f6", "bolt");

    const cocoRes2 = await fetch(
      `http://127.0.0.1:${port}/api/export?id=${tempProjectId}&format=coco&type=labels_only&split=50`,
    );
    assert.equal(cocoRes2.status, 200);
    const cocoTar2 = await unpackTar(Buffer.from(await cocoRes2.arrayBuffer()));
    const trainCoco2 = JSON.parse(
      cocoTar2.get("annotations/instances_train.json").content.toString("utf8"),
    );
    assert.deepEqual(
      trainCoco2.categories.map((c) => ({ id: c.id, name: c.name })),
      trainCoco.categories.map((c) => ({ id: c.id, name: c.name })),
      "Adding a new IC code must not shift category IDs",
    );
    console.log("✓ Category IDs remained stable after adding a new IC code.");

    // 4. Verify DINOv2 export is completely unchanged (still uses IC codes)
    console.log("\n[3/4] Verifying DINOv2 export behaviour is unchanged...");
    const dinoRes = await fetch(
      `http://127.0.0.1:${port}/api/export?id=${tempProjectId}&format=dino&type=full_tar`,
    );
    assert.equal(dinoRes.status, 200);
    const dinoTar = await unpackTar(Buffer.from(await dinoRes.arrayBuffer()));
    assert(dinoTar.has("catalogue.json"), "DINO export must contain catalogue.json");
    const catalogue = JSON.parse(dinoTar.get("catalogue.json").content.toString("utf8"));
    const dinoIcs = catalogue.classes.map((c) => c.ic);
    assert(dinoIcs.includes("IC-BOLT-01"), "DINO must still export IC-BOLT-01");
    assert(dinoIcs.includes("IC-BOLT-15"), "DINO must still export IC-BOLT-15");
    console.log("✓ DINOv2 export still exports individual IC codes untouched.");

    // 5. Verify existing project (Project 1: Samples) re-exports cleanly
    console.log("\n[4/4] Testing COCO re-export on existing Project 1 (Samples)...");
    const samplesRes = await fetch(
      `http://127.0.0.1:${port}/api/export?id=1&format=coco&type=labels_only`,
    );
    assert.equal(samplesRes.status, 200);
    const samplesTar = await unpackTar(Buffer.from(await samplesRes.arrayBuffer()));
    assert(samplesTar.has("annotations/instances_train.json"));
    assert(samplesTar.has("annotations/instances_val.json"));
    console.log("✓ Existing project re-exported cleanly.");

    console.log("\n🎉 ALL COCO PART-TYPE EXPORT VERIFICATION CHECKS PASSED!");
  } finally {
    await server.close();
  }
} finally {
  if (tempProjectId !== null) {
    await db.prepare("DELETE FROM projects WHERE id = ?").run(tempProjectId);
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}
process.exit(0);
