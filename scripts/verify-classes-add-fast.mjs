import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.mjs";
import { flushClassesFileWrites, handle } from "./labelling-api.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("=== LS-Marker fast class add ===");

const unit = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", "src/lib/__tests__/class-list.test.ts"],
  { cwd: root, encoding: "utf8" },
);
if (unit.stdout) process.stdout.write(unit.stdout);
if (unit.status !== 0) {
  if (unit.stderr) process.stderr.write(unit.stderr);
  throw new Error("class list unit tests failed");
}
console.log("✓ Class list merge and filter stay fast for a large table");

function makeRequest(method, pathname, searchParams = {}, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`http://127.0.0.1:8080${pathname}`);
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, String(value));
    }
    const bodyStr = body ? JSON.stringify(body) : "";
    const reqHeaders = { host: "127.0.0.1:8080", ...headers };
    if (body) {
      reqHeaders["content-type"] = "application/json";
      reqHeaders["content-length"] = Buffer.byteLength(bodyStr);
    }
    const req = new Readable({
      read() {
        if (bodyStr) this.push(bodyStr);
        this.push(null);
      },
    });
    req.method = method;
    req.url = `${url.pathname}${url.search}`;
    req.headers = reqHeaders;

    const chunks = [];
    const resHeaders = {};
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
    res.statusCode = 200;
    res.headersSent = false;
    res.setHeader = (name, value) => {
      resHeaders[name.toLowerCase()] = value;
    };
    res.getHeader = (name) => resHeaders[name.toLowerCase()];
    res.on("finish", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let json = null;
      try {
        json = JSON.parse(rawBody);
      } catch {
        /* not json */
      }
      resolve({ statusCode: res.statusCode, headers: resHeaders, json });
    });
    handle(req, res, url, root).catch(reject);
  });
}

const adminSource = fs.readFileSync(path.resolve(root, "src/components/classes-admin.tsx"), "utf8");
assert.match(adminSource, /fetchClasses\(/);
assert.doesNotMatch(adminSource, /fetchCatalogue\(/);
const addStart = adminSource.indexOf("async function handleAddClass");
const addEnd = adminSource.indexOf("const handleDimensionKeyDown", addStart);
assert.ok(addStart >= 0 && addEnd > addStart, "handleAddClass must exist");
const addFn = adminSource.slice(addStart, addEnd);
assert.match(addFn, /mergeClassRow\(/);
assert.doesNotMatch(addFn, /await load\(/);
assert.match(adminSource, /function ClassTable/);
assert.match(adminSource, /useColumnResize/);
assert.match(adminSource, /overflow-x-auto/);
console.log("✓ Classes page adds a row locally and does not reload the catalogue");

const apiSource = fs.readFileSync(path.resolve(root, "scripts/labelling-api.mjs"), "utf8");
const getStart = apiSource.indexOf('if (method === "GET" && pathname === "/api/classes")');
const getEnd = apiSource.indexOf('if (method === "POST" && pathname === "/api/classes/import")');
assert.ok(getStart >= 0 && getEnd > getStart, "GET /api/classes must exist");
const getHandler = apiSource.slice(getStart, getEnd);
assert.match(getHandler, /listClasses\(/);
assert.doesNotMatch(getHandler, /syncProjectImages|catalogue\(|writeClassesFile/);
const postStart = apiSource.indexOf('if (method === "POST" && pathname === "/api/classes")');
const postEnd = apiSource.indexOf('if (method === "PATCH" && pathname === "/api/classes")');
assert.ok(postStart >= 0 && postEnd > postStart, "POST /api/classes must exist");
const postHandler = apiSource.slice(postStart, postEnd);
assert.match(postHandler, /scheduleClassesFileWrite\(/);
assert.doesNotMatch(postHandler, /await writeClassesFile|writeFileSync|readFileSync/);
console.log("✓ GET /api/classes does not rescan images or rewrite classes.txt");
console.log("✓ POST /api/classes does not wait on a synchronous classes.txt write");

const db = await getDb(root);
const unlockRes = await makeRequest("POST", "/api/admin/unlock", {}, { password: "admin" });
assert.equal(unlockRes.statusCode, 200);
const adminToken = String(unlockRes.headers["set-cookie"] || "").match(
  /partlab_admin=([^;]+)/,
)?.[1];
assert.ok(adminToken, "admin session cookie");
const projects = await db.prepare("SELECT id FROM projects ORDER BY id ASC").all();
assert.ok(projects.length > 0, "a project must exist");
const projectId = projects[0].id;
const cookie = `partlab_admin=${adminToken}; partlab_project=${projectId}`;

const testIc = `FAST_${Date.now()}`.slice(0, 40);
let createdId = null;
try {
  const listed = await makeRequest("GET", "/api/classes", {}, null, { cookie });
  assert.equal(listed.statusCode, 200);
  assert.ok(Array.isArray(listed.json?.classes), "classes array");
  assert.equal(listed.json.images, undefined, "class list must not include images");
  const before = listed.json.classes.length;

  const started = performance.now();
  const createdRes = await makeRequest(
    "POST",
    "/api/classes",
    {},
    { ic: testIc, des: "Fast add verification" },
    { cookie },
  );
  assert.equal(createdRes.statusCode, 200, createdRes.json?.error || "POST /api/classes");
  const created = createdRes.json;
  createdId = created.id;
  assert.equal(typeof created.id, "number");
  assert.equal(created.ic, testIc);

  const after = await makeRequest("GET", "/api/classes", {}, null, { cookie });
  assert.equal(after.statusCode, 200);
  assert.ok(after.json.classes.some((row) => row.id === created.id && row.ic === testIc));
  assert.equal(after.json.classes.length, before + 1);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 5000, `create + class list took ${elapsed.toFixed(0)}ms`);
  console.log(
    `✓ POST one class and read the class list in ${elapsed.toFixed(0)}ms (${before} -> ${before + 1})`,
  );
} finally {
  if (createdId != null) {
    const removed = await makeRequest("DELETE", "/api/classes", { id: createdId }, null, {
      cookie,
    });
    assert.equal(removed.statusCode, 200, "test class must be removed");
  }
  await flushClassesFileWrites();
}

console.log("--- Class add stays off the image-rescan path ---");
process.exit(0);
