import assert from "node:assert/strict";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.mjs";
import { handle } from "./labelling-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

console.log("--- Starting E2E API Verification with PostgreSQL ---");

// Helper to simulate HTTP requests against handle()
function makeRequest(method, pathname, searchParams = {}, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`http://127.0.0.1:8080${pathname}`);
    for (const [k, v] of Object.entries(searchParams)) {
      url.searchParams.set(k, String(v));
    }

    const bodyStr = body ? JSON.stringify(body) : "";
    const reqHeaders = {
      host: "127.0.0.1:8080",
      ...headers,
    };
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

    let statusCode = 200;
    const resHeaders = {};
    const chunks = [];

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
      res.headersSent = true;
      statusCode = res.statusCode;
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let json = null;
      try {
        json = JSON.parse(rawBody);
      } catch {
        // not json
      }
      resolve({ statusCode, headers: resHeaders, body: rawBody, json });
    });

    handle(req, res, url, root).catch(reject);
  });
}

async function run() {
  const db = await getDb(root);

  // Unlock admin session
  const unlockRes = await makeRequest("POST", "/api/admin/unlock", {}, { password: "admin" });
  assert.equal(unlockRes.statusCode, 200, "POST /api/admin/unlock should succeed");
  const setCookie = unlockRes.headers["set-cookie"] || "";
  const adminCookieMatch = String(setCookie).match(/partlab_admin=([^;]+)/);
  const adminToken = adminCookieMatch ? adminCookieMatch[1] : "";
  assert(adminToken, "Admin token should be returned");
  console.log("✓ Admin unlocked successfully");

  // 1. Check Projects List
  const projRes = await makeRequest("GET", "/api/projects", {}, null, {
    cookie: `partlab_admin=${adminToken}`,
  });
  assert.equal(projRes.statusCode, 200, "GET /api/projects should return 200");
  assert(Array.isArray(projRes.json?.projects), "projects array expected");
  console.log(`✓ 1. /api/projects: returned ${projRes.json.projects.length} project(s)`);

  const project = projRes.json.projects[0];
  assert(project, "Default project should exist");
  const projectId = project.id;

  // 2. Check Catalogue
  const catRes = await makeRequest("GET", "/api/catalogue", { project_id: projectId }, null, {
    cookie: `partlab_project=${projectId}; partlab_admin=${adminToken}`,
  });
  assert.equal(catRes.statusCode, 200, "GET /api/catalogue should return 200");
  assert(Array.isArray(catRes.json?.classes), "catalogue classes expected");
  console.log(`✓ 2. /api/catalogue: returned ${catRes.json.classes.length} classes`);

  // 3. Check Photos List
  const photosRes = await makeRequest("GET", `/api/projects/${projectId}/photos`, {}, null, {
    cookie: `partlab_project=${projectId}; partlab_admin=${adminToken}`,
  });
  assert.equal(photosRes.statusCode, 200, "GET /api/projects/:id/photos should return 200");
  assert(Array.isArray(photosRes.json?.images), "images array expected");
  console.log(`✓ 3. Photos endpoint: returned ${photosRes.json.images.length} images`);

  // 4. Test Class Creation & Deletion
  const newClassRes = await makeRequest(
    "POST",
    "/api/classes",
    {},
    { ic: "TEST-IC-99", des: "Test part 99" },
    { cookie: `partlab_project=${projectId}; partlab_admin=${adminToken}` },
  );
  assert.equal(newClassRes.statusCode, 200, "POST /api/classes should succeed");
  const createdClassId = newClassRes.json?.id;
  assert.equal(typeof createdClassId, "number", "Created class must have numeric id");
  console.log(`✓ 4. POST /api/classes created class ID ${createdClassId}`);

  // Clean up created class
  const delClassRes = await makeRequest("DELETE", "/api/classes", { id: createdClassId }, null, {
    cookie: `partlab_project=${projectId}; partlab_admin=${adminToken}`,
  });
  assert.equal(delClassRes.statusCode, 200, "DELETE /api/classes should succeed");
  console.log(`✓ 5. DELETE /api/classes removed class ID ${createdClassId}`);

  // 5. Test Maintenance Mode
  const maintGetRes = await makeRequest("GET", "/api/system/maintenance", {}, null, {
    cookie: `partlab_admin=${adminToken}`,
  });
  assert.equal(maintGetRes.statusCode, 200, "GET /api/system/maintenance should return 200");
  assert("maintenance" in maintGetRes.json, "maintenance boolean expected");
  console.log(`✓ 6. /api/system/maintenance: active = ${maintGetRes.json.maintenance}`);

  // 6. Test Backup Status
  const backupRes = await makeRequest("GET", "/api/system/backup-status", {}, null, {
    cookie: `partlab_admin=${adminToken}`,
  });
  assert.equal(backupRes.statusCode, 200, "GET /api/system/backup-status should return 200");
  assert(Array.isArray(backupRes.json?.activeUsers), "activeUsers array expected");
  assert(typeof backupRes.json?.activeCount === "number", "activeCount expected");
  console.log(
    `✓ 7. /api/system/backup-status: active count = ${backupRes.json.activeCount}, users = ${JSON.stringify(backupRes.json.activeUsers)}`,
  );

  // 7. Test User Session & Next Image Claiming
  const testUser = await db.prepare("SELECT id, username FROM users LIMIT 1").get();
  assert(testUser, "Test user should exist");
  const userToken = "test_e2e_session_token_12345";
  const userExpiry = new Date(Date.now() + 3600000).toISOString();
  await db.prepare("DELETE FROM sessions WHERE token = ?").run(userToken);
  await db
    .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(userToken, testUser.id, userExpiry);

  const nextRes = await makeRequest("GET", "/api/images/next", { project_id: projectId }, null, {
    cookie: `partlab=${userToken}; partlab_project=${projectId}`,
  });
  assert.equal(nextRes.statusCode, 200, "GET /api/images/next should return 200");
  assert(nextRes.json?.ok, "next image should be claimed successfully");
  const claimedImgId = nextRes.json.id;
  console.log(`✓ 8. /api/images/next claimed image ID ${claimedImgId} (${nextRes.json.name})`);

  // Release the claim
  const unlockRes2 = await makeRequest(
    "POST",
    `/api/images/${claimedImgId}/unlock`,
    {},
    { id: claimedImgId },
    { cookie: `partlab=${userToken}; partlab_project=${projectId}` },
  );
  assert.equal(unlockRes2.statusCode, 200, "POST /api/images/:id/unlock should return 200");
  console.log(`✓ 9. Released claim on image ID ${claimedImgId}`);

  // Clean up test user session
  await db.prepare("DELETE FROM sessions WHERE token = ?").run(userToken);

  // 8. Test Backup Download
  const dlRes = await makeRequest("GET", "/api/system/backup-download", {}, null, {
    cookie: `partlab_admin=${adminToken}`,
  });
  assert.equal(dlRes.statusCode, 200, "GET /api/system/backup-download should return 200");
  assert.equal(
    dlRes.headers["content-type"],
    "application/sql",
    "content-type should be application/sql",
  );
  assert(
    dlRes.body.includes("-- LS-Marker PostgreSQL Backup Dump"),
    "Backup file should be valid SQL dump",
  );
  console.log("✓ 10. /api/system/backup-download returned valid PostgreSQL dump stream");

  await db.close();
  console.log("\nAll E2E API tests passed against PostgreSQL successfully!");
}

run().catch((err) => {
  console.error("E2E Test Failed:", err);
  process.exit(1);
});
