import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import tar from "tar-stream";
import { createServer } from "vite";

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");

console.log("=== LS-Marker Dual Export (Combo) Verification ===");

const db = new Database(dbPath);
const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in labels.db");
console.log(`Using project: "${project.name}" (ID: ${project.id})`);

const projectFolder = path.resolve(root, project.folder);
assert(fs.existsSync(projectFolder), `Project folder ${projectFolder} must exist`);

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

// 1. Prepare classes with part_type: bolt and nut
const existingClasses = db
  .prepare("SELECT id, ic, des, part_type FROM classes WHERE project_id = ?")
  .all(project.id);

let boltClassId;
let boltIc = "COMBO_TEST_BOLT";
let nutClassId;
let nutIc = "COMBO_TEST_NUT";

if (existingClasses.length >= 2) {
  boltClassId = existingClasses[0].id;
  boltIc = existingClasses[0].ic;
  nutClassId = existingClasses[1].id;
  nutIc = existingClasses[1].ic;
  db.prepare("UPDATE classes SET part_type = 'bolt' WHERE project_id = ? AND id = ?").run(
    project.id,
    boltClassId,
  );
  db.prepare("UPDATE classes SET part_type = 'nut' WHERE project_id = ? AND id = ?").run(
    project.id,
    nutClassId,
  );
} else {
  boltClassId = 0;
  nutClassId = 1;
  db.prepare(
    `INSERT INTO classes (project_id, id, ic, des, color, part_type)
     VALUES (?, ?, ?, 'Combo Test Bolt', '#ff0000', 'bolt')
     ON CONFLICT(project_id, id) DO UPDATE SET part_type = 'bolt'`,
  ).run(project.id, boltClassId, boltIc);
  db.prepare(
    `INSERT INTO classes (project_id, id, ic, des, color, part_type)
     VALUES (?, ?, ?, 'Combo Test Nut', '#00ff00', 'nut')
     ON CONFLICT(project_id, id) DO UPDATE SET part_type = 'nut'`,
  ).run(project.id, nutClassId, nutIc);
}

// 2. Prepare test image and labels
const testImgPath = path.join(projectFolder, "combo_test_image.jpg");
const testTxtPath = path.join(projectFolder, "combo_test_image.txt");

await sharp({
  create: {
    width: 200,
    height: 200,
    channels: 3,
    background: { r: 100, g: 150, b: 200 },
  },
})
  .jpeg({ quality: 90 })
  .toFile(testImgPath);

// Box 1 for bolt, Box 2 for nut
fs.writeFileSync(testTxtPath, `${boltClassId} 0.3 0.3 0.2 0.2\n${nutClassId} 0.7 0.7 0.2 0.2\n`);

db.prepare(
  `INSERT INTO images (project_id, file_path, name, status)
   VALUES (?, 'combo_test_image.jpg', 'combo_test_image.jpg', 'completed')
   ON CONFLICT(project_id, file_path) DO UPDATE SET status = 'completed'`,
).run(project.id);

console.log("✓ Test setup ready with bolt and nut classes.");

// 3. Start Vite test server
const server = await createServer({
  root,
  server: { port: 3099 },
  logLevel: "warn",
});
await server.listen();
const port = server.config.server.port;
console.log(`Vite test server listening on port ${port}`);

try {
  // Test 1: YOLO with general classes & custom filename
  console.log("\n[Test 1] Verifying YOLO with class_mode=general & custom filename...");
  const yoloRes = await fetch(
    `http://127.0.0.1:${port}/api/export?id=${project.id}&type=full_tar&format=yolo&class_mode=general&filename=${project.name}-yolo.tar`,
  );
  assert.equal(yoloRes.status, 200);
  const yoloDisp = yoloRes.headers.get("content-disposition");
  assert(
    yoloDisp?.includes(`filename="${project.name}-yolo.tar"`),
    `Expected custom filename in header, got: ${yoloDisp}`,
  );

  const yoloTar = await unpackTar(Buffer.from(await yoloRes.arrayBuffer()));
  assert(yoloTar.has("data.yaml"), "YOLO export must include data.yaml");
  const dataYaml = yoloTar.get("data.yaml").content.toString("utf8");
  console.log(`data.yaml content:\n${dataYaml.trim()}`);
  assert(dataYaml.includes("bolt"), "data.yaml must contain general class 'bolt'");
  assert(dataYaml.includes("nut"), "data.yaml must contain general class 'nut'");
  assert(
    !dataYaml.includes(boltIc) || boltIc.toLowerCase() === "bolt",
    "data.yaml should use general class names instead of specific IC codes",
  );

  assert(yoloTar.has("export_manifest.json"), "YOLO export must include manifest");
  const manifest = JSON.parse(yoloTar.get("export_manifest.json").content.toString("utf8"));
  assert.equal(manifest.class_mode, "general", "manifest must record class_mode: general");
  console.log("✓ YOLO general class export verified successfully.");

  // Test 2: COCO with general classes & custom filename
  console.log("\n[Test 2] Verifying COCO with class_mode=general & custom filename...");
  const cocoRes = await fetch(
    `http://127.0.0.1:${port}/api/export?id=${project.id}&type=full_tar&format=coco&class_mode=general&filename=${project.name}-coco.tar`,
  );
  assert.equal(cocoRes.status, 200);
  const cocoDisp = cocoRes.headers.get("content-disposition");
  assert(
    cocoDisp?.includes(`filename="${project.name}-coco.tar"`),
    `Expected custom filename in header, got: ${cocoDisp}`,
  );

  const cocoTar = await unpackTar(Buffer.from(await cocoRes.arrayBuffer()));
  assert(
    cocoTar.has("annotations/instances_train.json") ||
      cocoTar.has("annotations/instances_val.json"),
    "COCO export must contain instances_train.json or instances_val.json",
  );
  const instancesKey = cocoTar.has("annotations/instances_train.json")
    ? "annotations/instances_train.json"
    : "annotations/instances_val.json";
  const instances = JSON.parse(cocoTar.get(instancesKey).content.toString("utf8"));
  const catNames = instances.categories.map((c) => c.name);
  console.log("COCO categories:", catNames);
  assert(catNames.includes("bolt"), "COCO categories must include general class 'bolt'");
  assert(catNames.includes("nut"), "COCO categories must include general class 'nut'");
  console.log("✓ COCO general class export verified successfully.");

  // Test 3: DINO catalogue with custom filename
  console.log("\n[Test 3] Verifying DINO Catalogue with custom filename...");
  const dinoRes = await fetch(
    `http://127.0.0.1:${port}/api/export?id=${project.id}&type=full_tar&format=dino&class_mode=ic&filename=${project.name}-dino.tar`,
  );
  assert.equal(dinoRes.status, 200);
  const dinoDisp = dinoRes.headers.get("content-disposition");
  assert(
    dinoDisp?.includes(`filename="${project.name}-dino.tar"`),
    `Expected custom filename in header, got: ${dinoDisp}`,
  );

  const dinoTar = await unpackTar(Buffer.from(await dinoRes.arrayBuffer()));
  assert(dinoTar.has("catalogue.json"), "DINO export must contain catalogue.json");
  const dinoCatalogue = JSON.parse(dinoTar.get("catalogue.json").content.toString("utf8"));
  const dinoIcs = dinoCatalogue.classes.map((c) => c.ic);
  console.log("DINO catalogue ICs:", dinoIcs);
  assert(
    dinoIcs.includes(boltIc) || dinoIcs.includes(nutIc),
    "DINO catalogue must use specific IC codes",
  );
  console.log("✓ DINO catalogue export verified successfully.");

  // Test 4: Single format export remains strictly unchanged (class_mode=ic by default)
  console.log("\n[Test 4] Verifying default single YOLO export remains unchanged (ic codes)...");
  const defaultRes = await fetch(
    `http://127.0.0.1:${port}/api/export?id=${project.id}&type=full_tar&format=yolo`,
  );
  assert.equal(defaultRes.status, 200);
  const defaultTar = await unpackTar(Buffer.from(await defaultRes.arrayBuffer()));
  const defaultYaml = defaultTar.get("data.yaml").content.toString("utf8");
  assert(
    defaultYaml.includes(boltIc) || defaultYaml.includes(nutIc),
    "Default single export must retain original IC codes",
  );
  const defaultManifest = JSON.parse(
    defaultTar.get("export_manifest.json").content.toString("utf8"),
  );
  assert.equal(
    defaultManifest.class_mode,
    "ic",
    "Default single export must remain class_mode: ic",
  );
  console.log("✓ Default single export verified completely unchanged.");

  console.log("\n🎉 ALL COMBO EXPORT TESTS PASSED SUCCESSFULLY!");
} finally {
  await server.close();
  // Cleanup test files from disk
  if (fs.existsSync(testImgPath)) fs.unlinkSync(testImgPath);
  if (fs.existsSync(testTxtPath)) fs.unlinkSync(testTxtPath);
  db.prepare("DELETE FROM images WHERE project_id = ? AND file_path = 'combo_test_image.jpg'").run(
    project.id,
  );
  db.close();
}
