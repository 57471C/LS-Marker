import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import tar from "tar-stream";

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");

console.log("=== LS-Marker Class ID Stability & COCO Export Verification ===");

// 1. Verify Class ID Stability in Database
console.log("\n[1/4] Auditing Database Class ID Stability...");
const db = new Database(dbPath);

const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in labels.db");
console.log(`Auditing project: "${project.name}" (ID: ${project.id})`);

const initialClasses = db
  .prepare("SELECT id, ic, des FROM classes WHERE project_id = ? ORDER BY id ASC")
  .all(project.id);
console.log(
  `Found ${initialClasses.length} initial classes:`,
  initialClasses.map((c) => `${c.id}:${c.ic}`),
);

// Insert dummy IC code using same logic as labelling-api.mjs
const dummyIc = `TEST_AUDIT_${Date.now()}`;
const nextIdRow = db
  .prepare("SELECT COALESCE(MAX(id), -1) + 1 AS next_id FROM classes WHERE project_id = ?")
  .get(project.id);
const expectedNextId = nextIdRow.next_id;

db.prepare(
  "INSERT INTO classes (id, project_id, ic, des, color) VALUES (?, ?, ?, 'Test dummy', '#000000')",
).run(expectedNextId, project.id, dummyIc);

const afterInsertClasses = db
  .prepare("SELECT id, ic FROM classes WHERE project_id = ? ORDER BY id ASC")
  .all(project.id);

// Check that existing class IDs never shifted
for (const initCls of initialClasses) {
  const match = afterInsertClasses.find((c) => c.ic === initCls.ic);
  assert(match, `Class ${initCls.ic} should still exist`);
  assert.equal(
    match.id,
    initCls.id,
    `Class ID for ${initCls.ic} changed! Expected ${initCls.id}, got ${match.id}`,
  );
}

const dummyRow = afterInsertClasses.find((c) => c.ic === dummyIc);
assert(dummyRow, "Dummy class should be present");
assert.equal(dummyRow.id, expectedNextId, "Dummy class must receive next available sequential ID");
console.log(
  `✓ Inserted dummy class "${dummyIc}" with ID ${dummyRow.id}. All ${initialClasses.length} existing class IDs remained unchanged.`,
);

// Clean up dummy class
db.prepare("DELETE FROM classes WHERE project_id = ? AND ic = ?").run(project.id, dummyIc);
console.log("✓ Dummy class cleaned up successfully.");

// 2. Unpack TAR utility helper
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

// 3. Test API Exports by spinning up a lightweight test server with labelling-api middleware
console.log("\n[2/4] Verifying COCO JSON & YOLO Exports via HTTP...");
import { createServer } from "vite";

const server = await createServer({
  root,
  server: { port: 3099 },
  logLevel: "warn",
});
await server.listen();
const port = server.config.server.port;
console.log(`Vite test server listening on port ${port}`);

async function fetchExport(queryParams) {
  const url = `http://127.0.0.1:${port}/api/export?id=${project.id}&${queryParams}`;
  const res = await fetch(url);
  assert.equal(res.status, 200, `Expected 200 from ${url}, got ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

try {
  // Test COCO labels_only
  console.log("\nFetching COCO labels_only export...");
  const cocoLabelsTar = await fetchExport("format=coco&type=labels_only&split=80");
  const cocoLabelsFiles = await unpackTar(cocoLabelsTar);
  console.log("COCO labels_only files:", Array.from(cocoLabelsFiles.keys()));

  assert(cocoLabelsFiles.has("export_manifest.json"), "Must contain export_manifest.json");
  assert(
    cocoLabelsFiles.has("annotations/instances_train.json"),
    "Must contain annotations/instances_train.json",
  );
  assert(
    cocoLabelsFiles.has("annotations/instances_val.json"),
    "Must contain annotations/instances_val.json",
  );

  const manifest = JSON.parse(cocoLabelsFiles.get("export_manifest.json").content.toString("utf8"));
  const trainCoco = JSON.parse(
    cocoLabelsFiles.get("annotations/instances_train.json").content.toString("utf8"),
  );
  const valCoco = JSON.parse(
    cocoLabelsFiles.get("annotations/instances_val.json").content.toString("utf8"),
  );

  console.log("\n[3/4] Validating COCO 1.0 Schema & Coordinate Constraints...");
  for (const [splitName, coco] of [
    ["train", trainCoco],
    ["val", valCoco],
  ]) {
    assert(coco.info, `${splitName}: Missing info block`);
    assert(Array.isArray(coco.licenses), `${splitName}: Missing licenses array`);
    assert(Array.isArray(coco.images), `${splitName}: Missing images array`);
    assert(Array.isArray(coco.annotations), `${splitName}: Missing annotations array`);
    assert(Array.isArray(coco.categories), `${splitName}: Missing categories array`);

    // Verify categories match manifest
    assert.equal(
      coco.categories.length,
      manifest.categories.length,
      `${splitName}: categories length mismatch`,
    );
    for (let i = 0; i < coco.categories.length; i++) {
      assert.equal(coco.categories[i].id, manifest.categories[i].id);
      assert.equal(coco.categories[i].name, manifest.categories[i].name);
      assert.equal(coco.categories[i].supercategory, "part");
    }

    // Verify bounding box coordinates
    const imageMap = new Map(coco.images.map((img) => [img.id, img]));
    for (const ann of coco.annotations) {
      assert(imageMap.has(ann.image_id), `Annotation references missing image ${ann.image_id}`);
      const img = imageMap.get(ann.image_id);
      const [x, y, w, h] = ann.bbox;

      assert(x >= 0, `x_min (${x}) must be >= 0`);
      assert(y >= 0, `y_min (${y}) must be >= 0`);
      assert(w > 0, `bbox_w (${w}) must be > 0`);
      assert(h > 0, `bbox_h (${h}) must be > 0`);
      assert(x + w <= img.width + 0.1, `x + w (${x + w}) exceeds image width (${img.width})`);
      assert(y + h <= img.height + 0.1, `y + h (${y + h}) exceeds image height (${img.height})`);
      assert.equal(
        ann.area,
        Math.round(w * h * 100) / 100,
        `Area calculation mismatch for annotation ${ann.id}`,
      );
      assert.equal(ann.iscrowd, 0);
      assert(Array.isArray(ann.segmentation));
    }
    console.log(
      `✓ ${splitName}: ${coco.images.length} images, ${coco.annotations.length} annotations validated within bounds.`,
    );
  }

  // Test YOLO labels_only for cross-format consistency
  console.log("\n[4/4] Verifying YOLO and COCO class ID consistency...");
  const yoloLabelsTar = await fetchExport("format=yolo&type=labels_only&split=80");
  const yoloLabelsFiles = await unpackTar(yoloLabelsTar);
  assert(yoloLabelsFiles.has("data.yaml"), "YOLO export must contain data.yaml");
  assert(
    yoloLabelsFiles.has("export_manifest.json"),
    "YOLO export must contain export_manifest.json",
  );

  const yoloManifest = JSON.parse(
    yoloLabelsFiles.get("export_manifest.json").content.toString("utf8"),
  );
  const dataYamlText = yoloLabelsFiles.get("data.yaml").content.toString("utf8");

  // Check categories match between COCO manifest and YOLO manifest
  assert.deepEqual(
    manifest.categories,
    yoloManifest.categories,
    "Categories between COCO and YOLO export_manifest.json must match 100%",
  );

  // Check data.yaml contains exact mapping
  for (const cat of manifest.categories) {
    const yamlLine = `  ${cat.id}: ${cat.name}`;
    assert(
      dataYamlText.includes(yamlLine) || dataYamlText.includes(`  ${cat.id}: "${cat.name}"`),
      `data.yaml missing mapping for ${cat.id}: ${cat.name}`,
    );
  }
  console.log(
    "✓ data.yaml, COCO instances_*.json, and export_manifest.json have identical class mappings.",
  );

  // Test full_tar COCO
  console.log("\nFetching COCO full_tar export...");
  const cocoFullTar = await fetchExport("format=coco&type=full_tar&split=80");
  const cocoFullFiles = await unpackTar(cocoFullTar);
  console.log("COCO full_tar file count:", cocoFullFiles.size);
  assert(cocoFullFiles.has("export_manifest.json"));
  assert(cocoFullFiles.has("annotations/instances_train.json"));
  assert(cocoFullFiles.has("annotations/instances_val.json"));

  const hasTrainImages = Array.from(cocoFullFiles.keys()).some((k) =>
    k.startsWith("images/train/"),
  );
  assert(hasTrainImages, "full_tar must contain images/train/");
  console.log("✓ COCO full_tar successfully streams images/ and annotations/.");

  console.log("\n🎉 ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!");
} finally {
  await server.close();
}
