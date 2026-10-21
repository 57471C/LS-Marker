import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import Database from "better-sqlite3";
import { handle } from "./labelling-api.mjs";

console.log("=== Verifying Git Pull & Server Restart in Maintenance Mode ===\n");

const root = process.cwd();
const dbPath = path.join(root, "data", "labels.db");
const db = new Database(dbPath);

const annotatorName = `annotator_${Date.now()}`;
const adminName = `admin_${Date.now()}`;
const annotatorToken = crypto.randomBytes(16).toString("hex");
const adminToken = crypto.randomBytes(16).toString("hex");
const adminSessionCookie = crypto.randomBytes(16).toString("hex");
const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const annotatorInsert = db
  .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'hash', ?)")
  .run(annotatorName, expires);
const annotatorId = Number(annotatorInsert.lastInsertRowid);

const adminInsert = db
  .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'hash', ?)")
  .run(adminName, expires);
const adminId = Number(adminInsert.lastInsertRowid);

db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
  annotatorToken,
  annotatorId,
  expires,
);
db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
  adminToken,
  adminId,
  expires,
);
db.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)").run(
  adminSessionCookie,
  expires,
);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  handle(req, res, url, root).catch((err) => {
    res.statusCode = err.status || 500;
    res.end(JSON.stringify({ error: err.message }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;

try {
  // Ensure maintenance mode is initially OFF
  db.prepare(
    "INSERT INTO system_settings (key, value) VALUES ('maintenance_mode', '0') ON CONFLICT(key) DO UPDATE SET value = '0'",
  ).run();

  // Test 1: Non-admin calling git pull must be rejected with 403
  console.log("[Test 1] Non-admin attempting POST /api/system/git-pull (403 expected)...");
  const nonAdminPull = await fetch(`${baseUrl}/api/system/git-pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${annotatorToken}`,
    },
    body: JSON.stringify({ restart: false }),
  });
  assert.equal(nonAdminPull.status, 403, "Non-admin must receive 403");
  console.log("✓ Test 1 passed: Non-admin rejected with 403.");

  // Test 2: Admin calling git pull when maintenance mode is OFF must be rejected with 400
  console.log(
    "\n[Test 2] Admin attempting POST /api/system/git-pull when maintenance mode is OFF (400 expected)...",
  );
  const pullWhileOff = await fetch(`${baseUrl}/api/system/git-pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${adminToken}; partlab_admin=${adminSessionCookie}`,
    },
    body: JSON.stringify({ restart: false }),
  });
  assert.equal(pullWhileOff.status, 400, "Must be rejected when maintenance mode is OFF");
  const errData = await pullWhileOff.json();
  assert(
    errData.error.includes("Maintenance mode must be active"),
    "Error must specify maintenance mode required",
  );
  console.log("✓ Test 2 passed: Git pull rejected because maintenance mode is OFF.");

  // Test 3: Enable maintenance mode and call git pull
  console.log(
    "\n[Test 3] Admin enabling maintenance mode and executing POST /api/system/git-pull...",
  );
  db.prepare(
    "INSERT INTO system_settings (key, value) VALUES ('maintenance_mode', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
  ).run();

  const pullRes = await fetch(`${baseUrl}/api/system/git-pull`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${adminToken}; partlab_admin=${adminSessionCookie}`,
    },
    body: JSON.stringify({ restart: false }),
  });
  assert.equal(pullRes.status, 200, "Git pull must succeed with 200 OK");
  const pullData = await pullRes.json();
  assert.equal(pullData.ok, true, "Response ok must be true");
  assert.equal(pullData.success, true, "Response success must be true");
  assert(typeof pullData.output === "string", "Git output must be returned as string");
  console.log(`Git pull output received:\n${pullData.output}`);
  console.log("✓ Test 3 passed: Git pull executed safely in maintenance mode.");

  // Test 4: Verify restart-server endpoint security
  console.log("\n[Test 4] Verifying restart-server endpoint security...");
  const nonAdminRestart = await fetch(`${baseUrl}/api/system/restart-server`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `partlab=${annotatorToken}`,
    },
  });
  assert.equal(nonAdminRestart.status, 403, "Non-admin server restart must return 403");
  console.log("✓ Test 4 passed: Non-admin server restart rejected with 403.");

  console.log("\n🎉 ALL GIT PULL & SERVER RESTART CHECKS PASSED!");
} finally {
  server.close();
  // Restore maintenance mode to 0
  db.prepare(
    "INSERT INTO system_settings (key, value) VALUES ('maintenance_mode', '0') ON CONFLICT(key) DO UPDATE SET value = '0'",
  ).run();
  db.prepare("DELETE FROM sessions WHERE token IN (?, ?)").run(annotatorToken, adminToken);
  db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(adminSessionCookie);
  db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(annotatorId, adminId);
  db.close();
}
