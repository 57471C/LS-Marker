import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import pg from "pg";

const { Pool } = pg;

// Read .env if available
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    /* ignore if .env not present */
  }
}

const connectionString =
  process.env.DATABASE_URL || "postgresql://ls_marker:admin@localhost:5432/ls_marker";

console.log(
  `[migration] Connecting to PostgreSQL at ${connectionString.replace(/:[^@]+@/, ":****@")}...`,
);

const pool = new Pool({ connectionString });
const root = process.cwd();
const sqlitePath = path.join(root, "data", "labels.db");

function normalizeDate(d) {
  if (!d) return null;
  const str = String(d).trim();
  if (!str) return null;
  if (str.endsWith("Z") || /[+-]\d{2}(:\d{2})?$/.test(str)) {
    return new Date(str);
  }
  return new Date(str.includes("T") ? `${str}Z` : `${str.replace(" ", "T")}Z`);
}

async function run() {
  const client = await pool.connect();
  try {
    console.log("[migration] Applying schema.sql...");
    const schemaSql = fs.readFileSync(path.join(root, "scripts", "schema.sql"), "utf8");
    await client.query(schemaSql);
    console.log("[migration] Schema applied successfully.");

    if (!fs.existsSync(sqlitePath)) {
      console.log("[migration] No SQLite database found at", sqlitePath);
      return;
    }

    const sqlite = new Database(sqlitePath, { readonly: true });
    console.log("[migration] Migrating data from SQLite to PostgreSQL...");

    await client.query("BEGIN");

    // 1. Projects
    const projects = sqlite.prepare("SELECT * FROM projects ORDER BY id").all();
    for (const p of projects) {
      await client.query(
        `INSERT INTO projects (id, name, folder, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, folder = EXCLUDED.folder`,
        [p.id, p.name, p.folder, normalizeDate(p.created_at)],
      );
    }
    console.log(`[migration] Migrated ${projects.length} projects.`);

    // 2. Users
    const users = sqlite.prepare("SELECT * FROM users ORDER BY id").all();
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, username, password_hash, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`,
        [u.id, u.username, u.password_hash, normalizeDate(u.created_at)],
      );
    }
    console.log(`[migration] Migrated ${users.length} users.`);

    // 3. Sessions
    const sessions = sqlite.prepare("SELECT * FROM sessions").all();
    for (const s of sessions) {
      await client.query(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at`,
        [s.token, s.user_id, normalizeDate(s.expires_at)],
      );
    }
    console.log(`[migration] Migrated ${sessions.length} sessions.`);

    // 4. Admin Sessions
    const adminSessions = sqlite.prepare("SELECT * FROM admin_sessions").all();
    for (const s of adminSessions) {
      await client.query(
        `INSERT INTO admin_sessions (token, expires_at)
         VALUES ($1, $2)
         ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [s.token, normalizeDate(s.expires_at)],
      );
    }
    console.log(`[migration] Migrated ${adminSessions.length} admin sessions.`);

    // 5. Classes
    const classes = sqlite.prepare("SELECT * FROM classes ORDER BY project_id, id").all();
    for (const c of classes) {
      await client.query(
        `INSERT INTO classes (project_id, id, ic, des, color, part_type, dim1_name, dim1_mm, dim2_name, dim2_mm, dim3_name, dim3_mm)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (project_id, id) DO UPDATE SET
           ic = EXCLUDED.ic,
           des = EXCLUDED.des,
           color = EXCLUDED.color,
           part_type = EXCLUDED.part_type,
           dim1_name = EXCLUDED.dim1_name,
           dim1_mm = EXCLUDED.dim1_mm,
           dim2_name = EXCLUDED.dim2_name,
           dim2_mm = EXCLUDED.dim2_mm,
           dim3_name = EXCLUDED.dim3_name,
           dim3_mm = EXCLUDED.dim3_mm`,
        [
          c.project_id,
          c.id,
          c.ic,
          c.des,
          c.color,
          c.part_type ?? null,
          c.dim1_name ?? null,
          c.dim1_mm ?? null,
          c.dim2_name ?? null,
          c.dim2_mm ?? null,
          c.dim3_name ?? null,
          c.dim3_mm ?? null,
        ],
      );
    }
    console.log(`[migration] Migrated ${classes.length} classes.`);

    // 6. Image Claims
    const claims = sqlite.prepare("SELECT * FROM image_claims").all();
    for (const c of claims) {
      await client.query(
        `INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (project_id, rel_path) DO UPDATE SET
           claimed_by = EXCLUDED.claimed_by,
           claimed_at = EXCLUDED.claimed_at,
           status = EXCLUDED.status,
           completed_at = EXCLUDED.completed_at`,
        [
          c.project_id,
          c.rel_path,
          c.claimed_by ?? null,
          normalizeDate(c.claimed_at),
          c.status || "open",
          normalizeDate(c.completed_at),
        ],
      );
    }
    console.log(`[migration] Migrated ${claims.length} image claims.`);

    // 7. Images
    const images = sqlite.prepare("SELECT * FROM images ORDER BY id").all();
    for (const img of images) {
      await client.query(
        `INSERT INTO images (id, project_id, file_path, name, status, locked_by, locked_at, completed_at, reviewed_by, reviewed_at, owner)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (project_id, file_path) DO UPDATE SET
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           locked_by = EXCLUDED.locked_by,
           locked_at = EXCLUDED.locked_at,
           completed_at = EXCLUDED.completed_at,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at,
           owner = EXCLUDED.owner`,
        [
          img.id,
          img.project_id,
          img.file_path,
          img.name,
          img.status,
          img.locked_by ?? null,
          normalizeDate(img.locked_at),
          normalizeDate(img.completed_at),
          img.reviewed_by ?? null,
          normalizeDate(img.reviewed_at),
          img.owner ?? null,
        ],
      );
    }
    console.log(`[migration] Migrated ${images.length} images.`);

    // 8. System Settings
    const settings = sqlite.prepare("SELECT * FROM system_settings").all();
    for (const s of settings) {
      await client.query(
        `INSERT INTO system_settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [s.key, s.value],
      );
    }
    console.log(`[migration] Migrated ${settings.length} system settings.`);

    // Reset sequences
    await client.query(
      `SELECT setval('projects_id_seq', COALESCE((SELECT MAX(id) FROM projects), 1), true)`,
    );
    await client.query(
      `SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`,
    );
    await client.query(
      `SELECT setval('images_id_seq', COALESCE((SELECT MAX(id) FROM images), 1), true)`,
    );

    await client.query("COMMIT");
    sqlite.close();
    console.log("[migration] All data migrated and sequences updated successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[migration] Migration failed, transaction rolled back:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
