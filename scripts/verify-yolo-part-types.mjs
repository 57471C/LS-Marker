import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import tar from "tar-stream";
import { createServer } from "vite";
import { getDb } from "./db.mjs";
import { loadExportClassMapping, resolveExportPartType } from "./export-class-mapping.mjs";

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

console.log("=== LS-Marker YOLO Part-Type & Class-Mapping Verification ===");

// 1. Unit tests for export-class-mapping
console.log("\n[1/3] Testing export-class-mapping resolution rules...");
const mapping = loadExportClassMapping(root);

assert.equal(resolveExportPartType({ ic: "2BBMNM08", des: "" }, mapping), "nut");
assert.equal(resolveExportPartType({ ic: "2BBN6WTZ", des: "" }, mapping), "nut");
assert.equal(resolveExportPartType({ ic: "2BB06B0BZHS", des: "" }, mapping), "bolt");
assert.equal(resolveExportPartType({ ic: "2VDSWN01", des: "" }, mapping), "label");
assert.equal(resolveExportPartType({ ic: "WSH-M8", des: "" }, mapping), "washer");
assert.equal(
  resolveExportPartType({ ic: "5ZBCB04", des: "Steel crush tube 17x13x21" }, mapping),
  "washer",
);
assert.equal(resolveExportPartType({ ic: "2BB999", des: "M10 Flat Washer" }, mapping), "washer");
assert.equal(
  resolveExportPartType({ ic: "CUSTOM-1", des: "Heavy duty", part_type: "spacer" }, mapping),
  "washer",
);
assert.equal(
  resolveExportPartType({ ic: "UNKNOWN-XYZ", des: "Mystery bracket" }, mapping),
  "other",
);

// Explicit ic_overrides should take precedence
const customDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-marker-map-cfg-"));
try {
  fs.writeFileSync(
    path.join(customDir, "export-class-mapping.json"),
    JSON.stringify({
      ic_overrides: { "2BBMNM08": "other", "MY-CUSTOM": "spring" },
      fallback: "other",
    }),
  );
  const customMapping = loadExportClassMapping(customDir);
  assert.equal(resolveExportPartType({ ic: "2BBMNM08", des: "M8 Nut" }, customMapping), "other");
  assert.equal(resolveExportPartType({ ic: "my-custom", des: "" }, customMapping), "spring");
} finally {
  fs.rmSync(customDir, { recursive: true, force: true });
}
console.log("✓ Unit tests passed for prefixes, descriptions, DB aliases, overrides, and fallback.");

// 2. End-to-end HTTP /api/export?format=yolo test
const db = await getDb(root);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ls-marker-yolo-pt-"));
let tempProjectId = null;

try {
  const projectName = `yolo_pt_test_${Date.now()}`;
  const inserted = await db
    .prepare("INSERT INTO projects (name, folder) VALUES (?, ?) RETURNING id")
    .get(projectName, tempDir);
  tempProjectId = inserted.id;

  // Classes intentionally have part_type = null (except one explicit spacer alias)
  const testClasses = [
    { id: 0, ic: "2BBMNM08", des: "", part_type: null }, // -> nut (prefix 2BBMN)
    { id: 1, ic: "2VDSWN01", des: "", part_type: null }, // -> label (prefix 2VD)
    { id: 2, ic: "2BB06B0BZHS", des: "M6x16 Button Bolt", part_type: null }, // -> bolt
    { id: 3, ic: "WSH-M8", des: "Flat washer M8", part_type: "spacer" }, // -> washer (alias)
    { id: 4, ic: "MISC-999", des: "Unclassified bracket", part_type: null }, // -> other (fallback)
  ];

  for (const cls of testClasses) {
    await db
      .prepare(
        "INSERT INTO classes (id, project_id, ic, des, color, part_type) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(cls.id, tempProjectId, cls.ic, cls.des, "#3b82f6", cls.part_type);
  }

  const imgName = "sample_yolo_pt.jpg";
  const imgPath = path.join(tempDir, imgName);
  const txtPath = path.join(tempDir, "sample_yolo_pt.txt");
  await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 210, g: 210, b: 210 } },
  })
    .jpeg()
    .toFile(imgPath);

  // Include both standard 5-token boxes and a polygon (>= 7 tokens)
  const originalTxt = [
    "0 0.20 0.20 0.10 0.10", // 2BBMNM08 -> nut
    "1 0.40 0.20 0.10 0.10", // 2VDSWN01 -> label
    "2 0.60 0.20 0.10 0.10", // 2BB06B0BZHS -> bolt
    "3 0.20 0.70 0.10 0.10", // WSH-M8 -> washer
    "4 0.50 0.70 0.70 0.70 0.70 0.90 0.50 0.90", // MISC-999 polygon -> other
  ].join("\n");
  fs.writeFileSync(txtPath, `${originalTxt}\n`);

  await db
    .prepare(
      "INSERT INTO images (project_id, file_path, name, status) VALUES (?, ?, ?, 'completed')",
    )
    .run(tempProjectId, imgName, imgName);

  const server = await createServer({
    root,
    server: { port: 3104 },
    logLevel: "warn",
  });
  await server.listen();
  const port = server.config.server.port;

  try {
    console.log("\n[2/3] Testing default YOLO export (no class_mode param)...");
    const yoloRes = await fetch(
      `http://127.0.0.1:${port}/api/export?id=${tempProjectId}&format=yolo&type=full_tar&split=100`,
    );
    assert.equal(yoloRes.status, 200);
    const yoloTar = await unpackTar(Buffer.from(await yoloRes.arrayBuffer()));

    const dataYaml = yoloTar.get("data.yaml").content.toString("utf8");
    const manifest = JSON.parse(yoloTar.get("export_manifest.json").content.toString("utf8"));

    assert.equal(manifest.class_mode, "general");
    assert.deepEqual(manifest.classes, ["bolt", "label", "nut", "other", "washer"]);
    for (const rawIc of ["2BBMNM08", "2VDSWN01", "2BB06B0BZHS", "WSH-M8", "MISC-999"]) {
      assert(!dataYaml.includes(rawIc), `data.yaml must not contain raw IC ${rawIc}`);
    }
    for (const pt of ["bolt", "label", "nut", "other", "washer"]) {
      assert(dataYaml.includes(pt), `data.yaml must contain coarse part type '${pt}'`);
    }

    // Verify label file in TAR has remapped class IDs matching sorted part types:
    // 0=bolt, 1=label, 2=nut, 3=other, 4=washer
    const labelEntryKey = Array.from(yoloTar.keys()).find(
      (k) => k.startsWith("labels/train/") && k.endsWith(".txt"),
    );
    assert(labelEntryKey, "Exported TAR must contain a training label .txt file");
    const exportedLines = yoloTar.get(labelEntryKey).content.toString("utf8").trim().split(/\r?\n/);
    assert.equal(exportedLines.length, 5);
    assert.equal(exportedLines[0].split(/\s+/)[0], "2", "2BBMNM08 -> nut (id 2)");
    assert.equal(exportedLines[1].split(/\s+/)[0], "1", "2VDSWN01 -> label (id 1)");
    assert.equal(exportedLines[2].split(/\s+/)[0], "0", "2BB06B0BZHS -> bolt (id 0)");
    assert.equal(exportedLines[3].split(/\s+/)[0], "4", "WSH-M8 -> washer (id 4)");
    assert.equal(exportedLines[4].split(/\s+/)[0], "3", "MISC-999 -> other (id 3)");
    assert.equal(
      exportedLines[4].split(/\s+/).length,
      9,
      "Polygon vertices must be preserved on export",
    );

    // Verify source .txt on disk and DB were untouched
    assert.equal(fs.readFileSync(txtPath, "utf8"), `${originalTxt}\n`);

    console.log("\n[3/3] Testing explicit class_mode=ic fallback...");
    const icRes = await fetch(
      `http://127.0.0.1:${port}/api/export?id=${tempProjectId}&format=yolo&type=labels_only&class_mode=ic`,
    );
    assert.equal(icRes.status, 200);
    const icTar = await unpackTar(Buffer.from(await icRes.arrayBuffer()));
    const icYaml = icTar.get("data.yaml").content.toString("utf8");
    assert(icYaml.includes("2BBMNM08"), "Explicit class_mode=ic must still export raw IC codes");

    console.log("\n🎉 ALL YOLO PART-TYPE EXPORT TESTS PASSED SUCCESSFULLY!");
  } finally {
    await server.close();
  }
} finally {
  if (tempProjectId !== null) {
    await db.prepare("DELETE FROM projects WHERE id = ?").run(tempProjectId);
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}
await db.close?.();
setTimeout(() => process.exit(0), 50);
