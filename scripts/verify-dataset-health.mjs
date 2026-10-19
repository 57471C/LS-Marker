import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import Database from "better-sqlite3";
import { computeProjectHealth, handle } from "./labelling-api.mjs";

console.log("=== Verifying Dataset Health & Class Imbalance Inspector ===");

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");
const db = new Database(dbPath);

// Find active or first project
const project = db.prepare("SELECT id, name, folder FROM projects LIMIT 1").get();
assert(project, "A project must exist in the database for testing");
console.log(
  `Testing with project '${project.name}' (id: ${project.id}, folder: ${project.folder})`,
);

const health = computeProjectHealth(root, project, db);

console.log("\nHealth Result Summary:");
console.log(JSON.stringify(health.summary, null, 2));

// 1. Verify summary fields
assert.equal(typeof health.projectName, "string");
assert.equal(typeof health.summary.totalImages, "number");
assert.equal(typeof health.summary.completedImages, "number");
assert.equal(typeof health.summary.unlabeledImages, "number");
assert.equal(typeof health.summary.cleanImages, "number");
assert.equal(typeof health.summary.totalBoxes, "number");

assert(
  health.summary.completedImages + health.summary.unlabeledImages === health.summary.totalImages,
  "completedImages + unlabeledImages must equal totalImages",
);

assert(
  health.summary.cleanImages <= health.summary.completedImages,
  "cleanImages must be <= completedImages",
);

// 2. Verify classes list
assert(Array.isArray(health.classes), "classes must be an array");
console.log(`\nFound ${health.classes.length} classes evaluated:`);

let sumBoxes = 0;
for (const cls of health.classes) {
  assert.equal(typeof cls.id, "number");
  assert.equal(typeof cls.name, "string");
  assert.equal(typeof cls.count, "number");
  assert.equal(typeof cls.percentage, "number");
  assert(["healthy", "low", "missing"].includes(cls.status), `Invalid status: ${cls.status}`);

  if (cls.count === 0) {
    assert.equal(cls.status, "missing", `Class ${cls.name} count is 0, expected 'missing'`);
  } else if (cls.count < 15) {
    assert.equal(cls.status, "low", `Class ${cls.name} count is ${cls.count}, expected 'low'`);
  } else {
    assert.equal(
      cls.status,
      "healthy",
      `Class ${cls.name} count is ${cls.count}, expected 'healthy'`,
    );
  }

  sumBoxes += cls.count;
  console.log(
    ` - [${cls.status.toUpperCase()}] Class #${cls.id} (${cls.name}): ${cls.count} boxes (${cls.percentage}%)`,
  );
}

// 3. Verify total boxes invariant
assert.equal(
  sumBoxes,
  health.summary.totalBoxes,
  `Sum of class counts (${sumBoxes}) must exactly match totalBoxes (${health.summary.totalBoxes})`,
);

// 4. Verify HTTP endpoints
console.log("\nTesting HTTP endpoints:");
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  handle(req, res, url, root).catch((err) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

try {
  const res1 = await fetch(`http://127.0.0.1:${port}/api/project/health?id=${project.id}`);
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.projectName, project.name);
  assert.equal(data1.summary.totalBoxes, health.summary.totalBoxes);
  console.log("✓ GET /api/project/health?id=... succeeded");

  const res2 = await fetch(`http://127.0.0.1:${port}/api/projects/${project.id}/health`);
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.projectName, project.name);
  console.log("✓ GET /api/projects/:id/health succeeded");

  const res3 = await fetch(`http://127.0.0.1:${port}/api/project/health`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: project.id }),
  });
  assert.equal(res3.status, 200);
  const data3 = await res3.json();
  assert.equal(data3.projectName, project.name);
  console.log("✓ POST /api/project/health succeeded");
} finally {
  server.close();
  db.close();
}

console.log("\n✅ All assertions and HTTP endpoints passed successfully!");
