import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import tar from "tar-stream";
import { createServer } from "vite";

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");

console.log("=== LS-Marker DINO Catalogue Export Verification ===");

const db = new Database(dbPath);
const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in labels.db");
console.log(`Using project: "${project.name}" (ID: ${project.id})`);

const projectFolder = path.resolve(root, project.folder);
assert(fs.existsSync(projectFolder), `Project folder ${projectFolder} must exist`);

// Helper to unpack TAR in memory
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

// 1. Ensure at least one class has dimensions and part type for the test
const existingClasses = db
  .prepare("SELECT id, ic, des, part_type, dim1_mm FROM classes WHERE project_id = ?")
  .all(project.id);

let testClassId = null;
let testIc = "DINO_TEST_BOLT";

const foundWithDims = existingClasses.find(
  (c) => c.part_type && c.part_type !== "none" && c.dim1_mm != null,
);

if (foundWithDims) {
  testClassId = foundWithDims.id;
  testIc = foundWithDims.ic;
} else {
  // Update the first class or insert one with dimensions
  if (existingClasses.length > 0) {
    testClassId = existingClasses[0].id;
    testIc = existingClasses[0].ic;
    db.prepare(
      `UPDATE classes 
       SET part_type = 'bolt', dim1_name = 'Length under head', dim1_mm = 25, 
           dim2_name = 'Thread diameter', dim2_mm = 8, des = 'Hex Bolt M8x25'
       WHERE project_id = ? AND id = ?`,
    ).run(project.id, testClassId);
  } else {
    testClassId = 0;
    db.prepare(
      `INSERT INTO classes (project_id, id, ic, des, color, part_type, dim1_name, dim1_mm, dim2_name, dim2_mm)
       VALUES (?, ?, ?, 'Hex Bolt M8x25', '#ff0000', 'bolt', 'Length under head', 25, 'Thread diameter', 8)`,
    ).run(project.id, testClassId, testIc);
  }
}

// 2. Ensure at least one test image and label file exist
const testImgPath = path.join(projectFolder, "dino_test_image.jpg");
const testTxtPath = path.join(projectFolder, "dino_test_image.txt");

// Generate a 200x200 test JPEG image
await sharp({
  create: {
    width: 200,
    height: 200,
    channels: 3,
    background: { r: 80, g: 120, b: 160 },
  },
})
  .jpeg({ quality: 90 })
  .toFile(testImgPath);

// Create a bounding box for our test class
fs.writeFileSync(testTxtPath, `${testClassId} 0.5 0.5 0.4 0.4\n`);

// Mark as completed in DB
db.prepare(
  `INSERT INTO images (project_id, file_path, name, status)
   VALUES (?, 'dino_test_image.jpg', 'dino_test_image.jpg', 'completed')
   ON CONFLICT(project_id, file_path) DO UPDATE SET status = 'completed'`,
).run(project.id);

console.log("✓ Test image and annotations ready.");

// 3. Start Vite test server
const server = await createServer({
  root,
  server: { port: 3098 },
  logLevel: "warn",
});
await server.listen();
const port = server.config.server.port;
console.log(`Vite test server listening on port ${port}`);

try {
  // 4. Fetch DINO Catalogue export
  console.log("\n[1/3] Fetching DINO Catalogue export via HTTP...");
  const res = await fetch(`http://127.0.0.1:${port}/api/export?id=${project.id}&format=dino`);
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const disposition = res.headers.get("content-disposition");
  assert(disposition?.includes("_dino_catalogue.tar"), "Tar filename must match dino catalogue");
  console.log(`✓ Received Content-Disposition: ${disposition}`);

  const tarBuffer = Buffer.from(await res.arrayBuffer());
  const files = await unpackTar(tarBuffer);
  console.log(`✓ Tar unpacked successfully: ${files.size} entries found.`);

  // 5. Verify archive structure
  console.log("\n[2/3] Verifying Catalogue Schema & Cropped Images...");
  assert(files.has("catalogue.json"), "Archive must contain catalogue.json at root");

  const catalogueContent = files.get("catalogue.json").content.toString("utf8");
  const catalogue = JSON.parse(catalogueContent);

  assert.equal(catalogue.project_name, project.name, "project_name must match");
  assert.equal(catalogue.unit, "mm", "unit must be mm");
  assert(Array.isArray(catalogue.classes), "catalogue.classes must be an array");
  assert(catalogue.classes.length > 0, "Must contain at least 1 class");

  const exportedClass = catalogue.classes.find((c) => c.id === testClassId);
  assert(exportedClass, `Class ID ${testClassId} must be present in catalogue.json`);
  assert.equal(exportedClass.ic, testIc);
  assert.equal(exportedClass.part_type, "bolt");
  assert.equal(exportedClass.dim1_name, "Length under head");
  assert.equal(exportedClass.dim1_mm, 25);
  assert.equal(exportedClass.dim2_name, "Thread diameter");
  assert.equal(exportedClass.dim2_mm, 8);
  assert(Array.isArray(exportedClass.dimensions), "exportedClass.dimensions must be an array");
  assert.equal(exportedClass.dimensions.length, 2);
  assert(Array.isArray(exportedClass.crops), "exportedClass.crops must be an array");
  assert(exportedClass.crops.length >= 1, "Must have at least 1 crop relative path");

  console.log("✓ Class metadata in catalogue.json matches dimensions and part type.");

  // Check the crop image file
  const firstCropPath = exportedClass.crops[0];
  console.log(`Validating crop file: ${firstCropPath}`);
  assert(files.has(firstCropPath), `Archive must contain the crop image at ${firstCropPath}`);

  const cropBuf = files.get(firstCropPath).content;
  const cropMeta = await sharp(cropBuf).metadata();
  assert.equal(cropMeta.format, "jpeg", "Crop must be saved as JPEG format");
  assert(cropMeta.width >= 1 && cropMeta.height >= 1, "Crop dimensions must be valid");
  console.log(
    `✓ Crop image verified: format=${cropMeta.format}, width=${cropMeta.width}, height=${cropMeta.height}`,
  );

  // Verify no train/val split exists in DINO Catalogue
  const fileKeys = Array.from(files.keys());
  assert(
    !fileKeys.some((k) => k.includes("images/train/") || k.includes("images/val/")),
    "DINO Catalogue must not split into train/val",
  );
  assert(
    !fileKeys.some((k) => k.includes("labels/train/") || k.includes("labels/val/")),
    "DINO Catalogue must not split labels into train/val",
  );
  console.log("✓ Verified no train/val split is applied.");

  // 6. Verify YOLO & COCO unchanged and no longer include dimensions.json
  console.log("\n[3/3] Verifying YOLO and COCO exports remain intact...");
  const yoloRes = await fetch(
    `http://127.0.0.1:${port}/api/export?id=${project.id}&format=yolo&type=labels_only`,
  );
  assert.equal(yoloRes.status, 200);
  const yoloFiles = await unpackTar(Buffer.from(await yoloRes.arrayBuffer()));
  assert(yoloFiles.has("data.yaml"), "YOLO must contain data.yaml");
  assert(!yoloFiles.has("dimensions.json"), "YOLO must not contain dead dimensions.json");

  const cocoRes = await fetch(
    `http://127.0.0.1:${port}/api/export?id=${project.id}&format=coco&type=labels_only`,
  );
  assert.equal(cocoRes.status, 200);
  const cocoFiles = await unpackTar(Buffer.from(await cocoRes.arrayBuffer()));
  assert(
    cocoFiles.has("annotations/instances_train.json"),
    "COCO must contain instances_train.json",
  );
  assert(!cocoFiles.has("dimensions.json"), "COCO must not contain dead dimensions.json");
  console.log("✓ YOLO and COCO exports verified without dead dimensions.json.");

  console.log("\n--- All DINO Catalogue Export Verifications Passed! ---");
} finally {
  await server.close();
  // Clean up test image and txt
  try {
    if (fs.existsSync(testImgPath)) fs.unlinkSync(testImgPath);
    if (fs.existsSync(testTxtPath)) fs.unlinkSync(testTxtPath);
    db.prepare("DELETE FROM images WHERE project_id = ? AND file_path = 'dino_test_image.jpg'").run(
      project.id,
    );
  } catch {
    /* ignore */
  }
}
process.exit(0);
