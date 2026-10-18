import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import tar from "tar-stream";

/**
 * Local labelling API. Vite middleware so `npm run dev` is one process on 8080.
 *
 * classes(id, ic, des, color) — id is the YOLO class index and is not reused.
 * color is assigned automatically and is not written into the label files.
 * image_claims(rel_path, claimed_by, claimed_at) — reserved, unused.
 */

const CLASS_PALETTE = [
  "#d7263d",
  "#e07a14",
  "#1f8a4c",
  "#2c6fbb",
  "#7b3ff2",
  "#c43e8a",
  "#8a5a12",
  "#0e7490",
];
const MAX_IMAGES = 5000;
const CONFIG_NAME = "labelling.config.json";
const ADMIN_PASSWORD = "admin";
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const ADMIN_MS = 12 * 60 * 60 * 1000;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);

/** @type {{ at: number, dir: string }} */
let imageDirCache = { at: 0, dir: "" };

/** @type {Set<string>} */
const projectFolders = new Set();

/**
 * @param {string} folder
 */
export function rememberProjectFolder(folder) {
  if (typeof folder === "string" && folder) projectFolders.add(path.resolve(folder));
}

/**
 * @param {string} root
 * @param {string} dir
 * @param {string} file
 */
function insideFolder(root, dir, file) {
  const fromRoot = path.relative(root, dir);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return false;
  const fromDir = path.relative(dir, file);
  return fromDir === "" || (!fromDir.startsWith("..") && !path.isAbsolute(fromDir));
}

/**
 * Photo folders live inside the project by default (`samples`). Vite would
 * otherwise treat every saved .txt as a source change and reload the app.
 * @param {string} file
 */
export function ignoreLabelFolder(file) {
  const root = process.cwd();
  const now = Date.now();
  if (now - imageDirCache.at > 2000 || !imageDirCache.dir) {
    let dir = path.resolve(root, "samples");
    try {
      const config = JSON.parse(fs.readFileSync(path.join(root, CONFIG_NAME), "utf8"));
      if (config && typeof config.imageFolder === "string" && config.imageFolder.trim()) {
        dir = path.resolve(root, config.imageFolder.trim());
      }
    } catch {
      /* default samples */
    }
    imageDirCache = { at: now, dir };
  }
  if (insideFolder(root, imageDirCache.dir, file)) return true;
  for (const dir of projectFolders) {
    if (insideFolder(root, dir, file)) return true;
  }
  return false;
}

class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** @type {Promise<import("better-sqlite3").Database> | null} */
let dbPromise = null;

/**
 * @param {string} root
 */
export function getDb(root) {
  if (!dbPromise) {
    dbPromise = import("better-sqlite3")
      .then((mod) => {
        const Database = mod.default;
        const dir = path.join(root, "data");
        fs.mkdirSync(dir, { recursive: true });
        const db = new Database(path.join(dir, "labels.db"));
        db.pragma("journal_mode = WAL");
        db.exec(`
          CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            folder TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires_at TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS admin_sessions (
            token TEXT PRIMARY KEY,
            expires_at TEXT NOT NULL
          );
        `);
        const classCols = db.prepare("PRAGMA table_info(classes)").all();
        if (classCols.length && !classCols.some((col) => col.name === "color")) {
          db.exec("ALTER TABLE classes ADD COLUMN color TEXT");
        }
        if (classCols.length && !classCols.some((col) => col.name === "project_id")) {
          migrateLegacy(db, root);
        } else {
          db.exec(`
            CREATE TABLE IF NOT EXISTS classes (
              project_id INTEGER NOT NULL,
              id INTEGER NOT NULL,
              ic TEXT NOT NULL,
              des TEXT NOT NULL,
              color TEXT,
              PRIMARY KEY (project_id, id),
              UNIQUE (project_id, ic)
            );
            CREATE TABLE IF NOT EXISTS image_claims (
              project_id INTEGER NOT NULL,
              rel_path TEXT NOT NULL,
              claimed_by TEXT,
              claimed_at TEXT,
              status TEXT DEFAULT 'open',
              completed_at TEXT,
              PRIMARY KEY (project_id, rel_path)
            );
            CREATE TABLE IF NOT EXISTS images (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER NOT NULL DEFAULT 1,
              file_path TEXT NOT NULL,
              name TEXT NOT NULL,
              status TEXT DEFAULT 'unlabeled',
              locked_by TEXT DEFAULT NULL,
              locked_at DATETIME DEFAULT NULL,
              completed_at DATETIME DEFAULT NULL,
              UNIQUE (project_id, file_path)
            );
          `);
          const claimCols = db.prepare("PRAGMA table_info(image_claims)").all();
          if (claimCols.length && !claimCols.some((col) => col.name === "status")) {
            db.exec("ALTER TABLE image_claims ADD COLUMN status TEXT DEFAULT 'open'");
          }
          if (claimCols.length && !claimCols.some((col) => col.name === "completed_at")) {
            db.exec("ALTER TABLE image_claims ADD COLUMN completed_at TEXT");
          }
          const imgCols = db.prepare("PRAGMA table_info(images)").all();
          if (imgCols.length && !imgCols.some((col) => col.name === "locked_by")) {
            db.exec("ALTER TABLE images ADD COLUMN locked_by TEXT DEFAULT NULL");
          }
          if (imgCols.length && !imgCols.some((col) => col.name === "locked_at")) {
            db.exec("ALTER TABLE images ADD COLUMN locked_at DATETIME DEFAULT NULL");
          }
          if (imgCols.length && !imgCols.some((col) => col.name === "name")) {
            db.exec("ALTER TABLE images ADD COLUMN name TEXT");
          }
          if (imgCols.length && !imgCols.some((col) => col.name === "file_path")) {
            db.exec("ALTER TABLE images ADD COLUMN file_path TEXT");
          }
          if (imgCols.length && !imgCols.some((col) => col.name === "project_id")) {
            db.exec("ALTER TABLE images ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1");
          }
          if (imgCols.length && !imgCols.some((col) => col.name === "status")) {
            db.exec("ALTER TABLE images ADD COLUMN status TEXT DEFAULT 'unlabeled'");
          }
          if (imgCols.length && !imgCols.some((col) => col.name === "completed_at")) {
            db.exec("ALTER TABLE images ADD COLUMN completed_at DATETIME DEFAULT NULL");
          }
          ensureDefaultProject(db, root);
        }
        for (const project of db.prepare("SELECT id, folder FROM projects").all()) {
          assignMissingColors(db, project.id);
          rememberProjectFolder(path.resolve(root, project.folder));
          try {
            syncProjectImages(db, root, project);
          } catch {
            /* folder may not be ready */
          }
        }
        return db;
      })
      .catch((err) => {
        dbPromise = null;
        throw err;
      });
  }
  return dbPromise;
}

const DEMO_CLASSES = [
  [0, "HX-M8", "Hex bolt M8"],
  [1, "HX-M10", "Hex bolt M10"],
  [2, "NUT-M8", "Hex nut M8"],
  [3, "WSH-M8", "Flat washer M8"],
  [4, "CSK-M6", "Countersunk screw M6"],
];

/**
 * Move the single global class list and claims onto project 1.
 * @param {import("better-sqlite3").Database} db
 * @param {string} root
 */
function migrateLegacy(db, root) {
  const config = readConfig(root);
  const folder = config.imageFolder;
  const base = path.basename(path.resolve(root, folder)) || "Project";
  const name = base.toLowerCase() === "samples" ? "Samples" : base;
  const info = db
    .prepare("INSERT INTO projects (name, folder, created_at) VALUES (?, ?, ?)")
    .run(name, folder, new Date().toISOString());
  const projectId = Number(info.lastInsertRowid);
  db.exec(`
    CREATE TABLE classes_next (
      project_id INTEGER NOT NULL,
      id INTEGER NOT NULL,
      ic TEXT NOT NULL,
      des TEXT NOT NULL,
      color TEXT,
      PRIMARY KEY (project_id, id),
      UNIQUE (project_id, ic)
    );
  `);
  db.prepare(
    `INSERT INTO classes_next (project_id, id, ic, des, color)
     SELECT ?, id, ic, des, color FROM classes`,
  ).run(projectId);
  db.exec("DROP TABLE classes");
  db.exec("ALTER TABLE classes_next RENAME TO classes");
  db.exec(`
    CREATE TABLE claims_next (
      project_id INTEGER NOT NULL,
      rel_path TEXT NOT NULL,
      claimed_by TEXT,
      claimed_at TEXT,
      PRIMARY KEY (project_id, rel_path)
    );
  `);
  const claimCols = db.prepare("PRAGMA table_info(image_claims)").all();
  if (claimCols.length) {
    db.prepare(
      `INSERT INTO claims_next (project_id, rel_path, claimed_by, claimed_at)
       SELECT ?, rel_path, claimed_by, claimed_at FROM image_claims`,
    ).run(projectId);
    db.exec("DROP TABLE image_claims");
  }
  db.exec("ALTER TABLE claims_next RENAME TO image_claims");
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} projectId
 */
function seedProject(db, projectId) {
  const insert = db.prepare("INSERT INTO classes (project_id, id, ic, des) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    for (const row of DEMO_CLASSES) insert.run(projectId, row[0], row[1], row[2]);
  })();
}

/**
 * First launch: the configured folder becomes the Samples project.
 * @param {import("better-sqlite3").Database} db
 * @param {string} root
 */
function ensureDefaultProject(db, root) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM projects").get();
  if (count && count.n > 0) return;
  const config = readConfig(root);
  const folder = config.imageFolder;
  const base = path.basename(path.resolve(root, folder)) || "Project";
  const name = base.toLowerCase() === "samples" ? "Samples" : base;
  const info = db
    .prepare("INSERT INTO projects (name, folder, created_at) VALUES (?, ?, ?)")
    .run(name, folder, new Date().toISOString());
  if (name === "Samples") seedProject(db, Number(info.lastInsertRowid));
}

/**
 * Synchronize images from the project folder into the SQLite images table.
 * @param {import("better-sqlite3").Database} db
 * @param {string} root
 * @param {{ id: number, folder: string }} project
 */
export function syncProjectImages(db, root, project) {
  const resolvedFolder = path.resolve(root, project.folder);
  if (folderError(resolvedFolder)) return [];
  const fileNames = listImages(resolvedFolder);
  const existing = new Map(
    db
      .prepare("SELECT * FROM images WHERE project_id = ?")
      .all(project.id)
      .map((r) => [r.file_path, r]),
  );
  const claims = new Map(
    db
      .prepare("SELECT * FROM image_claims WHERE project_id = ?")
      .all(project.id)
      .map((r) => [r.rel_path, r]),
  );

  const insert = db.prepare(`
    INSERT INTO images (project_id, file_path, name, status, locked_by, locked_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const name of fileNames) {
      const full = resolveInside(resolvedFolder, name);
      const labelled = fs.existsSync(labelFileFor(full));
      const claim = claims.get(name);
      const isComplete = labelled || claim?.status === "complete";
      const status = isComplete
        ? "completed"
        : claim?.status === "incomplete"
          ? "incomplete"
          : "unlabeled";
      const existingRow = existing.get(name);
      if (!existingRow) {
        insert.run(
          project.id,
          name,
          name,
          status,
          claim?.claimed_by || null,
          claim?.claimed_at || null,
          claim?.completed_at || (isComplete ? new Date().toISOString() : null),
        );
      } else {
        if (isComplete && existingRow.status !== "completed") {
          db.prepare(
            "UPDATE images SET status = 'completed', locked_by = NULL, locked_at = NULL WHERE id = ?",
          ).run(existingRow.id);
        }
      }
    }
  });
  tx();
  return fileNames;
}

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hslToHex(hue, sat, light) {
  const s = sat / 100;
  const l = light / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const channel = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * channel)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * @param {Set<string>} used
 * @param {number} id
 */
function spareColor(used, id) {
  for (let step = 0; step < 360; step += 1) {
    const hue = Math.round((id * 137.508 + step * 47) % 360);
    const color = hslToHex(hue, 62, 38);
    if (!used.has(color)) return color;
  }
  return "#3d4c5c";
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} projectId
 */
function usedColors(db, projectId) {
  return new Set(
    db
      .prepare("SELECT color FROM classes WHERE project_id = ?")
      .all(projectId)
      .map((row) => row.color)
      .filter(isHexColor),
  );
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} projectId
 */
function pickColor(db, projectId) {
  const used = usedColors(db, projectId);
  const free = CLASS_PALETTE.filter((color) => !used.has(color));
  if (free.length > 0) return free[Math.floor(Math.random() * free.length)];
  const next = db
    .prepare("SELECT COALESCE(MAX(id), 0) AS id FROM classes WHERE project_id = ?")
    .get(projectId);
  return spareColor(used, next.id + 1);
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} projectId
 */
function assignMissingColors(db, projectId) {
  const rows = db.prepare("SELECT id, color FROM classes WHERE project_id = ?").all(projectId);
  const missing = rows.filter((row) => !isHexColor(row.color));
  if (missing.length === 0) return;
  const used = usedColors(db, projectId);
  const free = shuffle(CLASS_PALETTE.filter((color) => !used.has(color)));
  const update = db.prepare("UPDATE classes SET color = ? WHERE project_id = ? AND id = ?");
  db.transaction(() => {
    for (const row of missing) {
      const color = free.pop() ?? spareColor(used, row.id);
      used.add(color);
      update.run(color, projectId, row.id);
    }
  })();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1];
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, salt, 32);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function sameSecret(input, expected) {
  const a = Buffer.from(String(input));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function readCookies(req) {
  const header = req.headers.cookie || "";
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/**
 * @param {import("http").ServerResponse} res
 * @param {string} name
 * @param {string} value
 * @param {number} maxAge
 */
function writeCookie(res, name, value, maxAge) {
  const cookie = `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
  const existing = res.getHeader("set-cookie");
  const list =
    existing == null ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  list.push(cookie);
  res.setHeader("set-cookie", list);
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {import("http").IncomingMessage} req
 */
function currentUser(db, req) {
  const token = readCookies(req).partlab;
  if (!token) return null;
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT users.id AS id, users.username AS username
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ? AND sessions.expires_at > ?`,
    )
    .get(token, now);
  return row && typeof row.username === "string" ? { id: row.id, username: row.username } : null;
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {import("http").IncomingMessage} req
 */
function adminOpen(db, req) {
  const token = readCookies(req).partlab_admin;
  if (!token) return false;
  const now = new Date().toISOString();
  const row = db
    .prepare("SELECT token FROM admin_sessions WHERE token = ? AND expires_at > ?")
    .get(token, now);
  return Boolean(row);
}

function cleanUsername(value) {
  const text = cleanText(value, "Username", 32);
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(text)) {
    throw new HttpError(400, "Username must be 2–32 letters, numbers, dots, dashes or underscores");
  }
  return text;
}

function cleanPassword(value) {
  if (typeof value !== "string" || value.length < 4 || value.length > 72) {
    throw new HttpError(400, "Password must be 4–72 characters");
  }
  return value;
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} projectId
 * @param {string} rel
 * @param {string} username
 */
function claimForWrite(db, projectId, rel, username) {
  const row = db
    .prepare(
      "SELECT claimed_by, claimed_at FROM image_claims WHERE project_id = ? AND rel_path = ?",
    )
    .get(projectId, rel);
  const now = new Date().toISOString();
  const isExpired =
    row?.claimed_at && new Date(row.claimed_at).getTime() < Date.now() - 15 * 60 * 1000;
  if (!row?.claimed_by || isExpired || row.claimed_by === username) {
    db.prepare(
      `INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status) VALUES (?, ?, ?, ?, 'open')
       ON CONFLICT(project_id, rel_path) DO UPDATE SET
         claimed_by = excluded.claimed_by,
         claimed_at = excluded.claimed_at,
         status = CASE WHEN image_claims.status = 'incomplete' THEN 'open' ELSE COALESCE(image_claims.status, 'open') END`,
    ).run(projectId, rel, username, now);
    db.prepare(
      "UPDATE images SET locked_by = ?, locked_at = CURRENT_TIMESTAMP WHERE project_id = ? AND file_path = ?",
    ).run(username, projectId, rel);
    return;
  }
  throw new HttpError(409, `Claimed by ${row.claimed_by}`);
}

/**
 * @param {import("http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

/**
 * @param {import("http").IncomingMessage} req
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8_000_000) {
        reject(new HttpError(413, "Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, "Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * @param {string} root
 */
function readConfig(root) {
  const file = path.join(root, CONFIG_NAME);
  if (!fs.existsSync(file)) {
    const initial = { imageFolder: "samples" };
    fs.writeFileSync(file, `${JSON.stringify(initial, null, 2)}\n`);
    return initial;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new HttpError(500, "labelling.config.json is not valid JSON");
  }
  if (!parsed || typeof parsed.imageFolder !== "string" || !parsed.imageFolder.trim()) {
    throw new HttpError(500, "labelling.config.json needs an imageFolder string");
  }
  return { imageFolder: parsed.imageFolder.trim() };
}

/**
 * @param {string} value
 * @param {string} field
 * @param {number} max
 */
function cleanText(value, field, max) {
  if (typeof value !== "string") throw new HttpError(400, `${field} is required`);
  const text = value.trim();
  if (!text) throw new HttpError(400, `${field} is required`);
  if (text.length > max) throw new HttpError(400, `${field} is too long`);
  if (/[\r\n]/.test(text)) throw new HttpError(400, `${field} cannot contain line breaks`);
  return text;
}

/**
 * @param {string} text
 * @param {string} delim
 */
function parseCsvTable(text, delim) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delim) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((part) => part.trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((part) => part.trim())) rows.push(row);
  return rows;
}

/**
 * @param {string} text
 */
function parseClassCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = (first.match(/,/g) ?? []).length;
  const semis = (first.match(/;/g) ?? []).length;
  const table = parseCsvTable(text, semis > commas ? ";" : ",");
  if (table.length === 0) return [];
  const head = table[0].map((cell) => cell.trim().toLowerCase());
  const icIdx = head.indexOf("ic");
  const desIdx = head.indexOf("des");
  const hasHeader = icIdx !== -1 && desIdx !== -1;
  const iCol = hasHeader ? icIdx : 0;
  const dCol = hasHeader ? desIdx : 1;
  return table.slice(hasHeader ? 1 : 0).map((row) => ({
    ic: (row[iCol] ?? "").trim(),
    des: (row[dCol] ?? "").trim(),
  }));
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} projectId
 * @param {{ ic: string, des: string }[]} rows
 */
function importClasses(db, projectId, rows) {
  const seen = new Set(
    db
      .prepare("SELECT ic FROM classes WHERE project_id = ?")
      .all(projectId)
      .map((row) => String(row.ic).trim().toLowerCase()),
  );
  const used = usedColors(db, projectId);
  const free = shuffle(CLASS_PALETTE.filter((color) => !used.has(color)));
  let nextId = db
    .prepare("SELECT COALESCE(MAX(id), -1) + 1 AS id FROM classes WHERE project_id = ?")
    .get(projectId).id;
  const insert = db.prepare(
    "INSERT INTO classes (project_id, id, ic, des, color) VALUES (?, ?, ?, ?, ?)",
  );
  let added = 0;
  let skipped = 0;
  let invalid = 0;
  db.transaction(() => {
    for (const row of rows) {
      const ic = row.ic.trim();
      const des = row.des.trim();
      if (
        !ic ||
        !des ||
        ic.length > 40 ||
        des.length > 120 ||
        /[\r\n]/.test(ic) ||
        /[\r\n]/.test(des)
      ) {
        invalid += 1;
        continue;
      }
      const key = ic.toLowerCase();
      if (seen.has(key)) {
        skipped += 1;
        continue;
      }
      seen.add(key);
      const color = free.pop() ?? spareColor(used, nextId);
      used.add(color);
      insert.run(projectId, nextId, ic, des, color);
      nextId += 1;
      added += 1;
    }
  })();
  return { added, skipped, invalid };
}

/**
 * @param {string} folder
 */
function folderError(folder) {
  try {
    const stat = fs.statSync(folder);
    if (!stat.isDirectory()) return "Not a folder";
    return null;
  } catch {
    return "Folder not found";
  }
}

/**
 * @param {string} folder
 * @param {number} [limit]
 */
function listImages(folder, limit = MAX_IMAGES) {
  /** @type {string[]} */
  const out = [];
  /**
   * @param {string} dir
   * @param {string} rel
   * @param {number} depth
   */
  function walk(dir, rel, depth) {
    if (out.length >= limit || depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(path.join(dir, ent.name), childRel, depth + 1);
      } else if (IMAGE_EXT.has(path.extname(ent.name).toLowerCase())) {
        out.push(childRel);
      }
      if (out.length >= limit) return;
    }
  }
  walk(folder, "", 0);
  return out;
}

/**
 * @param {string} folder
 * @param {string} relName
 */
function resolveInside(folder, relName) {
  if (typeof relName !== "string" || !relName) throw new HttpError(400, "Bad image name");
  const normalized = relName.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) {
    throw new HttpError(400, "Bad image name");
  }
  const full = path.resolve(folder, ...parts);
  const root = path.resolve(folder);
  const fullNorm = process.platform === "win32" ? full.toLowerCase() : full;
  const rootNorm = process.platform === "win32" ? root.toLowerCase() : root;
  if (fullNorm !== rootNorm && !fullNorm.startsWith(rootNorm + path.sep)) {
    throw new HttpError(400, "Bad image name");
  }
  return full;
}

/**
 * @param {string} imageFull
 */
function labelFileFor(imageFull) {
  const ext = path.extname(imageFull);
  const base = path.basename(imageFull, ext);
  return path.join(path.dirname(imageFull), `${base}.txt`);
}

/**
 * Recursively remove all .txt files in a folder, leaving all other files (photos) and folder structure alone.
 * @param {string} dir
 */
function removeTxtFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      removeTxtFiles(full);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".txt")) {
      try {
        fs.unlinkSync(full);
      } catch (err) {
        console.error(`[label-api] Failed to delete ${full}:`, err);
      }
    }
  }
}

/**
 * @param {string} val
 */
function formatYamlValue(val) {
  const str = String(val);
  if (!str || /^[\s:#{}[\],&*?|<>!=%@\\'"-]|[\s:#]$/.test(str) || /[:#\r\n]/.test(str)) {
    return JSON.stringify(str);
  }
  return str;
}

/**
 * @param {{ id: number, ic: string }[]} classes
 * @param {"labels_only" | "full_tar"} exportType
 */
function buildDataYaml(classes, exportType) {
  const trainTarget = exportType === "labels_only" ? "train.txt" : "images/train";
  const valTarget = exportType === "labels_only" ? "val.txt" : "images/val";
  const lines = ["path: .", `train: ${trainTarget}`, `val: ${valTarget}`];
  if (classes.length === 0) {
    lines.push("names: {}");
  } else {
    lines.push("names:");
    for (const cls of classes) {
      lines.push(`  ${cls.id}: ${formatYamlValue(cls.ic)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Fast synchronous dimension extractor for JPEG, PNG, WebP, BMP.
 * Reads only the required header bytes from disk without loading full multi-MB files.
 * @param {string} filePath
 * @returns {{ width: number, height: number }}
 */
function getImageDimensions(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(65536);
    const bytesRead = fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);
    fd = undefined;

    // PNG
    if (
      bytesRead >= 24 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }

    // BMP
    if (bytesRead >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
      return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
    }

    // WebP
    if (
      bytesRead >= 30 &&
      buf.toString("ascii", 0, 4) === "RIFF" &&
      buf.toString("ascii", 8, 12) === "WEBP"
    ) {
      const tag = buf.toString("ascii", 12, 16);
      if (tag === "VP8 " && bytesRead >= 30) {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (tag === "VP8L" && bytesRead >= 25 && buf[20] === 0x2f) {
        const b0 = buf[21];
        const b1 = buf[22];
        const b2 = buf[23];
        const b3 = buf[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width, height };
      }
      if (tag === "VP8X" && bytesRead >= 30) {
        const width = 1 + buf.readUIntLE(24, 3);
        const height = 1 + buf.readUIntLE(27, 3);
        return { width, height };
      }
    }

    // JPEG
    if (bytesRead >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < bytesRead) {
        if (buf[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buf[offset + 1];
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          const height = buf.readUInt16BE(offset + 5);
          const width = buf.readUInt16BE(offset + 7);
          return { width, height };
        }
        const segmentLength = buf.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
      }
    }
  } catch {
    /* fallback to default */
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
  return { width: 1920, height: 1080 };
}

/**
 * @param {{ name: string }} project
 * @param {{ id: number, ic: string }[]} classes
 * @param {Array<{ id: number, relName: string, source_image_path: string, export_image_relative: string, split: string, txt_full_path: string }>} items
 * @param {"labels_only" | "full_tar"} exportType
 */
function buildCocoDatasets(project, classes, items, exportType) {
  const categories = classes.map((cls) => ({
    id: cls.id,
    name: cls.ic,
    supercategory: "part",
  }));

  const createdDate = new Date().toISOString();
  const year = new Date().getFullYear();

  function makeSplitJson(splitName) {
    const splitItems = items.filter((item) => item.split === splitName);
    const images = [];
    const annotations = [];
    let annotationId = 1;

    for (const item of splitItems) {
      const dimensions = getImageDimensions(item.source_image_path);
      const W = dimensions.width;
      const H = dimensions.height;
      const fileName =
        exportType === "full_tar" ? path.basename(item.export_image_relative) : item.relName;

      images.push({
        id: item.id,
        file_name: fileName,
        width: W,
        height: H,
      });

      const boxes = readBoxes(item.txt_full_path);
      for (const box of boxes) {
        let x_min = (box.x - box.w / 2) * W;
        let y_min = (box.y - box.h / 2) * H;
        let bbox_w = box.w * W;
        let bbox_h = box.h * H;

        // Clamp to image dimensions
        x_min = Math.max(0, Math.min(W, x_min));
        y_min = Math.max(0, Math.min(H, y_min));
        bbox_w = Math.max(0, Math.min(W - x_min, bbox_w));
        bbox_h = Math.max(0, Math.min(H - y_min, bbox_h));

        x_min = Math.round(x_min * 100) / 100;
        y_min = Math.round(y_min * 100) / 100;
        bbox_w = Math.round(bbox_w * 100) / 100;
        bbox_h = Math.round(bbox_h * 100) / 100;
        const area = Math.round(bbox_w * bbox_h * 100) / 100;

        annotations.push({
          id: annotationId++,
          image_id: item.id,
          category_id: box.classId,
          bbox: [x_min, y_min, bbox_w, bbox_h],
          area,
          segmentation: [],
          iscrowd: 0,
        });
      }
    }

    const data = {
      info: {
        description: `${project.name} LS-Marker Dataset Export`,
        version: "1.0",
        year,
        date_created: createdDate,
      },
      licenses: [],
      images,
      annotations,
      categories,
    };

    return `${JSON.stringify(data, null, 2)}\n`;
  }

  return {
    trainJson: makeSplitJson("train"),
    valJson: makeSplitJson("val"),
  };
}

/**
 * @param {import("tar-stream").Pack} pack
 * @param {string} name
 * @param {Buffer | string} content
 */
function addTarBuffer(pack, name, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return new Promise((resolve, reject) => {
    pack.entry({ name, size: buf.length, mode: 0o644, mtime: new Date() }, buf, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * @param {import("tar-stream").Pack} pack
 * @param {string} name
 */
function addTarDirectory(pack, name) {
  const dirName = name.endsWith("/") ? name : `${name}/`;
  return new Promise((resolve, reject) => {
    pack.entry({ name: dirName, type: "directory", mode: 0o755, mtime: new Date() }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Streams a single file from disk directly into the TAR pack stream with zero full-file RAM buffering.
 * @param {import("tar-stream").Pack} pack
 * @param {string} entryName
 * @param {string} filePath
 * @param {() => boolean} isAborted
 * @param {(stream: import("node:fs").ReadStream | null) => void} setActiveStream
 */
async function streamFileIntoTar(pack, entryName, filePath, isAborted, setActiveStream) {
  if (isAborted()) return;
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    await addTarBuffer(pack, entryName, Buffer.alloc(0));
    return;
  }
  if (!stat.isFile() || stat.size === 0) {
    await addTarBuffer(pack, entryName, Buffer.alloc(0));
    return;
  }
  await new Promise((resolve, reject) => {
    if (isAborted()) {
      resolve();
      return;
    }
    const entry = pack.entry(
      { name: entryName, size: stat.size, mode: 0o644, mtime: stat.mtime },
      (err) => {
        setActiveStream(null);
        if (err && !isAborted()) reject(err);
        else resolve();
      },
    );
    const readStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
    setActiveStream(readStream);
    readStream.on("error", (err) => {
      setActiveStream(null);
      entry.destroy(err);
      if (isAborted()) resolve();
      else reject(err);
    });
    entry.on("error", (err) => {
      setActiveStream(null);
      readStream.destroy();
      if (isAborted()) resolve();
      else reject(err);
    });
    readStream.pipe(entry);
  });
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {{ id: number, name: string, folder: string }} project
 * @param {string} resolvedFolder
 * @param {"labels_only" | "full_tar"} exportType
 * @param {number} trainSplitPct
 * @param {"yolo" | "coco"} [exportFormat]
 */
function prepareExportPlan(
  db,
  project,
  resolvedFolder,
  exportType,
  trainSplitPct,
  exportFormat = "yolo",
) {
  /** @type {{ id: number, ic: string }[]} */
  let classes = listClasses(db, project.id).map((c) => ({ id: c.id, ic: c.ic }));
  if (classes.length === 0) {
    const classesFile = path.join(resolvedFolder, "classes.txt");
    if (fs.existsSync(classesFile)) {
      try {
        const lines = fs.readFileSync(classesFile, "utf8").split(/\r?\n/);
        classes = lines
          .map((line, idx) => ({ id: idx, ic: line.trim() }))
          .filter((row) => Boolean(row.ic));
      } catch {
        /* ignore classes.txt fallback error */
      }
    }
  }

  const claimsMap = new Map(
    db
      .prepare("SELECT rel_path, status FROM image_claims WHERE project_id = ?")
      .all(project.id)
      .map((r) => [r.rel_path, r.status]),
  );

  const allRelImages = listImages(resolvedFolder, Infinity);
  const candidates = [];
  for (const relName of allRelImages) {
    const imageFull = resolveInside(resolvedFolder, relName);
    if (!fs.existsSync(imageFull)) continue;
    const txtFull = labelFileFor(imageFull);
    const hasTxt = fs.existsSync(txtFull);
    const status = claimsMap.get(relName);
    const completed = status === "complete" || (hasTxt && status !== "incomplete");
    candidates.push({ relName, imageFull, txtFull, completed });
  }

  const completedOnly = candidates.filter((c) => c.completed);
  const selected = completedOnly.length > 0 ? completedOnly : candidates;

  const total = selected.length;
  let trainCount = Math.round((total * trainSplitPct) / 100);
  if (total >= 2 && trainSplitPct > 0 && trainSplitPct < 100) {
    trainCount = Math.max(1, Math.min(total - 1, trainCount));
  }

  const items = selected.map((entry, index) => {
    const id = index + 1;
    const paddedId = String(id).padStart(6, "0");
    const rawExt = path.extname(entry.imageFull);
    const ext = rawExt || ".jpg";
    const baseName = path.basename(entry.imageFull, rawExt);
    const uniqueStem = `${paddedId}_${baseName}`;
    const split = index < trainCount ? "train" : "val";
    return {
      id,
      relName: entry.relName,
      source_image_path: entry.imageFull,
      export_image_relative: `images/${split}/${uniqueStem}${ext}`,
      export_label_relative: `labels/${split}/${uniqueStem}.txt`,
      split,
      txt_full_path: entry.txtFull,
    };
  });

  const manifest = {
    project_name: project.name,
    export_format: exportFormat,
    export_type: exportType,
    exported_at: new Date().toISOString(),
    total_items: items.length,
    classes: classes.map((c) => c.ic),
    categories: classes.map((c) => ({
      id: c.id,
      name: c.ic,
      supercategory: "part",
    })),
    class_to_id: Object.fromEntries(classes.map((c) => [c.ic, c.id])),
    id_to_class: Object.fromEntries(classes.map((c) => [c.id, c.ic])),
    items: items.map((item) => ({
      id: item.id,
      source_image_path: item.source_image_path,
      export_image_relative: item.export_image_relative,
      export_label_relative: item.export_label_relative,
      split: item.split,
    })),
  };

  return { classes, items, manifest };
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {import("better-sqlite3").Database} db
 * @param {{ id: number, name: string, folder: string }} project
 * @param {string} resolvedFolder
 * @param {"labels_only" | "full_tar"} exportType
 * @param {number} trainSplitPct
 */
async function streamYoloExport(req, res, db, project, resolvedFolder, exportType, trainSplitPct) {
  const { classes, items, manifest } = prepareExportPlan(
    db,
    project,
    resolvedFolder,
    exportType,
    trainSplitPct,
  );
  const dataYaml = buildDataYaml(classes, exportType);
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, "_") || "yolo";
  const fileName =
    exportType === "labels_only" ? `${safeName}_labels_yolo.tar` : `${safeName}_yolo.tar`;

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-tar");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Cache-Control", "no-store");

  let aborted = false;
  /** @type {import("node:fs").ReadStream | null} */
  let activeReadStream = null;
  const pack = tar.pack();

  const onDisconnect = () => {
    if (!res.writableEnded) {
      aborted = true;
      if (activeReadStream) {
        activeReadStream.destroy();
        activeReadStream = null;
      }
      pack.destroy();
    }
  };

  req.on("aborted", onDisconnect);
  res.on("close", onDisconnect);

  const streamFinished = new Promise((resolve, reject) => {
    res.on("finish", resolve);
    res.on("close", resolve);
    res.on("error", (err) => {
      if (aborted) resolve();
      else reject(err);
    });
    pack.on("error", (err) => {
      if (aborted) resolve();
      else reject(err);
    });
  });

  pack.pipe(res);

  try {
    await addTarBuffer(pack, "data.yaml", dataYaml);
    await addTarBuffer(pack, "export_manifest.json", manifestJson);

    if (exportType === "labels_only") {
      const trainPaths = items
        .filter((item) => item.split === "train")
        .map((item) => item.source_image_path);
      const valPaths = items
        .filter((item) => item.split === "val")
        .map((item) => item.source_image_path);

      await addTarBuffer(pack, "train.txt", trainPaths.length ? `${trainPaths.join("\n")}\n` : "");
      await addTarBuffer(pack, "val.txt", valPaths.length ? `${valPaths.join("\n")}\n` : "");
      await addTarDirectory(pack, "labels/train/");
      await addTarDirectory(pack, "labels/val/");

      for (const item of items) {
        if (aborted) break;
        await streamFileIntoTar(
          pack,
          item.export_label_relative,
          item.txt_full_path,
          () => aborted,
          (s) => {
            activeReadStream = s;
          },
        );
      }
    } else {
      await addTarDirectory(pack, "images/train/");
      await addTarDirectory(pack, "images/val/");
      await addTarDirectory(pack, "labels/train/");
      await addTarDirectory(pack, "labels/val/");

      for (const item of items) {
        if (aborted) break;
        await streamFileIntoTar(
          pack,
          item.export_image_relative,
          item.source_image_path,
          () => aborted,
          (s) => {
            activeReadStream = s;
          },
        );
        if (aborted) break;
        await streamFileIntoTar(
          pack,
          item.export_label_relative,
          item.txt_full_path,
          () => aborted,
          (s) => {
            activeReadStream = s;
          },
        );
      }
    }

    if (!aborted) {
      pack.finalize();
      await streamFinished;
    }
  } finally {
    req.off("aborted", onDisconnect);
    res.off("close", onDisconnect);
  }
}

/**
 * Streams COCO dataset export directly to response.
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {import("better-sqlite3").Database} db
 * @param {{ id: number, name: string, folder: string }} project
 * @param {string} resolvedFolder
 * @param {"labels_only" | "full_tar"} exportType
 * @param {number} trainSplitPct
 */
async function streamCocoExport(req, res, db, project, resolvedFolder, exportType, trainSplitPct) {
  const { classes, items, manifest } = prepareExportPlan(
    db,
    project,
    resolvedFolder,
    exportType,
    trainSplitPct,
    "coco",
  );
  const { trainJson, valJson } = buildCocoDatasets(project, classes, items, exportType);
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, "_") || "coco";
  const fileName =
    exportType === "labels_only" ? `${safeName}_coco_annotations.tar` : `${safeName}_coco.tar`;

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-tar");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Cache-Control", "no-store");

  let aborted = false;
  /** @type {import("node:fs").ReadStream | null} */
  let activeReadStream = null;
  const pack = tar.pack();

  const onDisconnect = () => {
    if (!res.writableEnded) {
      aborted = true;
      if (activeReadStream) {
        activeReadStream.destroy();
        activeReadStream = null;
      }
      pack.destroy();
    }
  };

  req.on("aborted", onDisconnect);
  res.on("close", onDisconnect);

  const streamFinished = new Promise((resolve, reject) => {
    res.on("finish", resolve);
    res.on("close", resolve);
    res.on("error", (err) => {
      if (aborted) resolve();
      else reject(err);
    });
    pack.on("error", (err) => {
      if (aborted) resolve();
      else reject(err);
    });
  });

  pack.pipe(res);

  try {
    await addTarBuffer(pack, "export_manifest.json", manifestJson);
    await addTarDirectory(pack, "annotations/");
    await addTarBuffer(pack, "annotations/instances_train.json", trainJson);
    await addTarBuffer(pack, "annotations/instances_val.json", valJson);

    if (exportType === "full_tar") {
      await addTarDirectory(pack, "images/train/");
      await addTarDirectory(pack, "images/val/");

      for (const item of items) {
        if (aborted) break;
        await streamFileIntoTar(
          pack,
          item.export_image_relative,
          item.source_image_path,
          () => aborted,
          (s) => {
            activeReadStream = s;
          },
        );
      }
    }

    if (!aborted) {
      pack.finalize();
      await streamFinished;
    }
  } finally {
    req.off("aborted", onDisconnect);
    res.off("close", onDisconnect);
  }
}

/**
 * @param {string} file
 */
function readBoxes(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  /** @type {{ classId: number, x: number, y: number, w: number, h: number }[]} */
  const boxes = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const classId = Number(parts[0]);
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const w = Number(parts[3]);
    const h = Number(parts[4]);
    if (![classId, x, y, w, h].every(Number.isFinite)) continue;
    boxes.push({ classId, x, y, w, h });
  }
  return boxes;
}

/**
 * @param {unknown} input
 */
function cleanBoxes(input) {
  if (!Array.isArray(input)) throw new HttpError(400, "boxes must be a list");
  if (input.length > MAX_IMAGES) throw new HttpError(400, "Too many boxes");
  return input.map((box, index) => {
    if (!box || typeof box !== "object") throw new HttpError(400, `Bad box ${index + 1}`);
    const classId = Number(box.classId);
    const x = Number(box.x);
    const y = Number(box.y);
    const w = Number(box.w);
    const h = Number(box.h);
    if (!Number.isInteger(classId) || classId < 0 || classId > 9999) {
      throw new HttpError(400, `Bad class on box ${index + 1}`);
    }
    if (![x, y, w, h].every(Number.isFinite)) throw new HttpError(400, `Bad box ${index + 1}`);
    if (w <= 0 || h <= 0 || w > 1 || h > 1 || x < 0 || y < 0 || x > 1 || y > 1) {
      throw new HttpError(400, `Bad box ${index + 1}`);
    }
    return { classId, x, y, w, h };
  });
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} projectId
 * @param {string} folder
 */
function writeClassesFile(db, projectId, folder) {
  if (folderError(folder)) return;
  const rows = db
    .prepare("SELECT id, ic FROM classes WHERE project_id = ? ORDER BY id")
    .all(projectId);
  const max = rows.reduce((acc, row) => Math.max(acc, row.id), -1);
  const byId = new Map(rows.map((row) => [row.id, row.ic]));
  const lines = [];
  for (let id = 0; id <= max; id += 1) lines.push(byId.get(id) ?? "");
  const next = lines.length ? `${lines.join("\n")}\n` : "";
  const file = path.join(folder, "classes.txt");
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === next) return;
  } catch {
    /* rewrite below */
  }
  fs.writeFileSync(file, next);
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {number} projectId
 */
function listClasses(db, projectId) {
  return db
    .prepare("SELECT id, ic, des, color FROM classes WHERE project_id = ? ORDER BY id")
    .all(projectId);
}

/**
 * @param {string} root
 * @param {{ id: number, name: string, folder: string }} project
 * @param {import("better-sqlite3").Database} [db]
 */
function publicProject(root, project, db) {
  const resolvedFolder = path.resolve(root, project.folder);
  const error = folderError(resolvedFolder);
  let totalPhotos = 0;
  let completePhotos = 0;
  if (!error) {
    try {
      const images = listImages(resolvedFolder);
      totalPhotos = images.length;
      let claimsMap = null;
      if (db) {
        claimsMap = new Map(
          db
            .prepare("SELECT rel_path, status FROM image_claims WHERE project_id = ?")
            .all(project.id)
            .map((r) => [r.rel_path, r.status]),
        );
      }
      for (const name of images) {
        const full = resolveInside(resolvedFolder, name);
        const hasTxt = fs.existsSync(labelFileFor(full));
        const status = claimsMap?.get(name);
        if (status === "complete" || (!status && hasTxt)) {
          completePhotos++;
        }
      }
    } catch {
      /* ignore file reading errors */
    }
  }
  return {
    id: project.id,
    name: project.name,
    folder: project.folder,
    resolvedFolder,
    folderOk: !error,
    folderError: error,
    totalPhotos,
    completePhotos,
  };
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {import("http").IncomingMessage} req
 */
function currentProject(db, req) {
  const id = Number(readCookies(req).partlab_project);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = db.prepare("SELECT id, name, folder FROM projects WHERE id = ?").get(id);
  return row && typeof row.name === "string" ? row : null;
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {import("http").IncomingMessage} req
 */
function requireProject(db, req) {
  const project = currentProject(db, req);
  if (project) return project;
  const all = db.prepare("SELECT id, name, folder FROM projects").all();
  if (all.length === 1) return all[0];
  throw new HttpError(409, "Open a project");
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {string} root
 * @param {string} name
 * @param {string} folder
 */
function createProject(db, root, name, folder) {
  const resolved = path.resolve(root, folder);
  const error = folderError(resolved);
  if (error) throw new HttpError(400, `${error}: ${resolved}`);
  const taken = db
    .prepare("SELECT id, folder FROM projects")
    .all()
    .some((row) => path.resolve(root, row.folder) === resolved);
  if (taken) throw new HttpError(409, "That folder is already a project");
  const info = db
    .prepare("INSERT INTO projects (name, folder, created_at) VALUES (?, ?, ?)")
    .run(name, folder, new Date().toISOString());
  rememberProjectFolder(resolved);
  const row = db
    .prepare("SELECT id, name, folder FROM projects WHERE id = ?")
    .get(Number(info.lastInsertRowid));
  return row;
}

/**
 * @param {string} root
 * @param {{ id: number, name: string, folder: string }} project
 */
export async function catalogue(root, project) {
  const db = await getDb(root);
  const resolvedFolder = path.resolve(root, project.folder);
  const error = folderError(resolvedFolder);
  /** @type {{ id: number, name: string, labelled: boolean, claimedBy: string | null, claimedAt: string | null, status: string, completedAt: string | null, lockedBy: string | null, lockedAt: string | null }[]} */
  let images = [];
  if (!error) {
    try {
      writeClassesFile(db, project.id, resolvedFolder);
    } catch (err) {
      console.error("[label-api] classes.txt", err);
    }
    syncProjectImages(db, root, project);
    const dbImages = db
      .prepare(
        "SELECT id, project_id, file_path, name, status, locked_by, locked_at, completed_at FROM images WHERE project_id = ? ORDER BY id ASC",
      )
      .all(project.id);
    const nowTime = Date.now();
    images = dbImages.map((row) => {
      const isComplete =
        row.status === "completed" ||
        fs.existsSync(labelFileFor(resolveInside(resolvedFolder, row.file_path)));
      const isLocked =
        !isComplete &&
        Boolean(row.locked_by) &&
        new Date(row.locked_at).getTime() > nowTime - 15 * 60 * 1000;
      const activeHolder = isLocked ? row.locked_by : null;
      const activeLockedAt = isLocked ? row.locked_at : null;
      const status = isComplete ? "complete" : row.status === "incomplete" ? "incomplete" : "open";
      return {
        id: row.id,
        name: row.file_path,
        labelled: isComplete,
        claimedBy: activeHolder,
        claimedAt: activeLockedAt,
        status,
        completedAt: row.completed_at || null,
        lockedBy: activeHolder,
        lockedAt: activeLockedAt,
      };
    });
  }
  return {
    project: { id: project.id, name: project.name },
    imageFolder: project.folder,
    resolvedFolder,
    folderOk: !error,
    folderError: error,
    images,
    classes: listClasses(db, project.id),
  };
}

/**
 * Auth, settings, and claims. Returns true when the request is finished.
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {URL} url
 * @param {string} root
 * @param {string} method
 * @param {string} pathname
 */
async function guard(req, res, url, root, method, pathname) {
  const db = await getDb(root);
  const now = new Date().toISOString();

  if (method === "GET" && pathname === "/api/me") {
    send(res, 200, { user: currentUser(db, req) });
    return true;
  }

  if (method === "POST" && pathname === "/api/login") {
    const body = await readBody(req);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const row = username
      ? db.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(username)
      : null;
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new HttpError(401, "Wrong username or password");
    }
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + SESSION_MS).toISOString();
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
      token,
      row.id,
      expires,
    );
    writeCookie(res, "partlab", token, Math.floor(SESSION_MS / 1000));
    send(res, 200, { id: row.id, username });
    return true;
  }

  if (method === "POST" && pathname === "/api/logout") {
    const token = readCookies(req).partlab;
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    writeCookie(res, "partlab", "", 0);
    send(res, 200, { ok: true });
    return true;
  }

  if (method === "GET" && pathname === "/api/admin") {
    send(res, 200, { unlocked: adminOpen(db, req) });
    return true;
  }

  if (method === "POST" && pathname === "/api/admin/unlock") {
    const body = await readBody(req);
    const password = typeof body.password === "string" ? body.password : "";
    if (!sameSecret(password, ADMIN_PASSWORD)) throw new HttpError(401, "Wrong settings password");
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now);
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + ADMIN_MS).toISOString();
    db.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)").run(token, expires);
    writeCookie(res, "partlab_admin", token, Math.floor(ADMIN_MS / 1000));
    send(res, 200, { unlocked: true });
    return true;
  }

  if (method === "POST" && pathname === "/api/admin/lock") {
    const token = readCookies(req).partlab_admin;
    if (token) db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
    writeCookie(res, "partlab_admin", "", 0);
    send(res, 200, { unlocked: false });
    return true;
  }

  const user = currentUser(db, req);
  const admin = adminOpen(db, req);

  if (pathname === "/api/users") {
    if (!admin) throw new HttpError(401, "Settings locked");
    if (method === "GET") {
      send(res, 200, {
        users: db
          .prepare(
            "SELECT id, username, created_at AS createdAt FROM users ORDER BY username COLLATE NOCASE",
          )
          .all(),
      });
      return true;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const username = cleanUsername(body.username);
      const password = cleanPassword(body.password);
      try {
        const info = db
          .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
          .run(username, hashPassword(password), now);
        send(res, 200, { id: Number(info.lastInsertRowid), username });
      } catch (err) {
        if (String(err).includes("UNIQUE"))
          throw new HttpError(409, "That username already exists");
        throw err;
      }
      return true;
    }
    if (method === "PATCH") {
      const body = await readBody(req);
      const id = Number(body.id);
      if (!Number.isInteger(id)) throw new HttpError(400, "Bad id");
      const password = cleanPassword(body.password);
      const result = db
        .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
        .run(hashPassword(password), id);
      if (result.changes === 0) throw new HttpError(404, "User not found");
      send(res, 200, { ok: true });
      return true;
    }
    if (method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id)) throw new HttpError(400, "Bad id");
      const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
      if (!existing) throw new HttpError(404, "User not found");
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
      send(res, 200, { ok: true });
      return true;
    }
    throw new HttpError(404, "Not found");
  }

  if (pathname === "/api/images/next" || (pathname === "/api/claim/next" && method === "POST")) {
    if (!user) throw new HttpError(401, "Sign in");
    const project = requireProject(db, req);
    syncProjectImages(db, root, project);

    const claimQuery = `
      UPDATE images
      SET 
        locked_by = :userId,
        locked_at = CURRENT_TIMESTAMP
      WHERE id = (
        SELECT id FROM images
        WHERE project_id = :projectId
          AND (status = 'unlabeled' OR status IS NULL)
          AND (locked_by IS NULL OR locked_at < datetime('now', '-15 minutes'))
        ORDER BY id ASC
        LIMIT 1
      )
      RETURNING *;
    `;
    const claimed = db.prepare(claimQuery).get({ userId: user.username, projectId: project.id });
    if (!claimed) {
      send(res, 200, { image: null, message: "No unlabeled photos available" });
      return true;
    }
    db.prepare(`
      INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
      VALUES (?, ?, ?, ?, 'open', NULL)
      ON CONFLICT(project_id, rel_path) DO UPDATE SET
        claimed_by = excluded.claimed_by,
        claimed_at = excluded.claimed_at,
        status = 'open',
        completed_at = NULL
    `).run(project.id, claimed.file_path, user.username, claimed.locked_at);

    send(res, 200, {
      ok: true,
      image: claimed,
      id: claimed.id,
      name: claimed.file_path,
      claimedBy: claimed.locked_by,
      claimedAt: claimed.locked_at,
      status: claimed.status,
    });
    return true;
  }

  if (pathname === "/api/images/lock" && method === "POST") {
    if (!user) throw new HttpError(401, "Sign in");
    const project = requireProject(db, req);
    syncProjectImages(db, root, project);
    const body = await readBody(req);
    const imageId = Number(body.id);
    const name = typeof body.name === "string" ? body.name : "";

    const lockQuery = `
      UPDATE images
      SET 
        locked_by = :userId,
        locked_at = CURRENT_TIMESTAMP
      WHERE id = (
        SELECT id FROM images
        WHERE project_id = :projectId
          AND (id = :imageId OR file_path = :name)
          AND (locked_by IS NULL OR locked_by = :userId OR locked_at < datetime('now', '-15 minutes'))
        LIMIT 1
      )
      RETURNING *;
    `;
    const locked = db.prepare(lockQuery).get({
      userId: user.username,
      projectId: project.id,
      imageId: Number.isInteger(imageId) ? imageId : -1,
      name,
    });
    if (!locked) {
      const existing = db
        .prepare(
          "SELECT locked_by, locked_at FROM images WHERE project_id = ? AND (id = ? OR file_path = ?)",
        )
        .get(project.id, Number.isInteger(imageId) ? imageId : -1, name);
      if (existing?.locked_by && existing.locked_by !== user.username) {
        throw new HttpError(409, `Locked by ${existing.locked_by}`);
      }
      throw new HttpError(404, "Image not found");
    }
    db.prepare(`
      INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
      VALUES (?, ?, ?, ?, 'open', NULL)
      ON CONFLICT(project_id, rel_path) DO UPDATE SET
        claimed_by = excluded.claimed_by,
        claimed_at = excluded.claimed_at,
        status = 'open',
        completed_at = NULL
    `).run(project.id, locked.file_path, user.username, locked.locked_at);

    send(res, 200, {
      ok: true,
      image: locked,
      id: locked.id,
      name: locked.file_path,
      claimedBy: locked.locked_by,
      claimedAt: locked.locked_at,
    });
    return true;
  }

  if ((pathname === "/api/images/unlock" || pathname === "/api/unlock") && method === "POST") {
    if (!user) throw new HttpError(401, "Sign in");
    const project = requireProject(db, req);
    const body = await readBody(req);
    const imageId = Number(body.id);
    const name = typeof body.name === "string" ? body.name : "";

    const unlockQuery = `
      UPDATE images
      SET 
        locked_by = NULL,
        locked_at = NULL
      WHERE project_id = :projectId
        AND (id = :imageId OR file_path = :name)
        AND (locked_by = :userId OR :admin = 1);
    `;
    db.prepare(unlockQuery).run({
      userId: user.username,
      projectId: project.id,
      imageId: Number.isInteger(imageId) ? imageId : -1,
      name,
      admin: admin ? 1 : 0,
    });

    if (name) {
      db.prepare(`
        UPDATE image_claims
        SET claimed_by = NULL, claimed_at = NULL
        WHERE project_id = ? AND rel_path = ? AND (claimed_by = ? OR ? = 1)
      `).run(project.id, name, user.username, admin ? 1 : 0);
    }

    send(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/images/skip" && method === "POST") {
    if (!user) throw new HttpError(401, "Sign in");
    const project = requireProject(db, req);
    const body = await readBody(req);
    const imageId = Number(body.id);
    const name = typeof body.name === "string" ? body.name : "";

    const skipQuery = `
      UPDATE images
      SET 
        status = 'incomplete',
        locked_by = NULL,
        locked_at = NULL
      WHERE project_id = :projectId
        AND (id = :imageId OR file_path = :name)
        AND (locked_by = :userId OR locked_by IS NULL OR :admin = 1);
    `;
    db.prepare(skipQuery).run({
      userId: user.username,
      projectId: project.id,
      imageId: Number.isInteger(imageId) ? imageId : -1,
      name,
      admin: admin ? 1 : 0,
    });

    if (name) {
      db.prepare(`
        INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
        VALUES (?, ?, NULL, NULL, 'incomplete', NULL)
        ON CONFLICT(project_id, rel_path) DO UPDATE SET
          claimed_by = NULL,
          claimed_at = NULL,
          status = 'incomplete',
          completed_at = NULL
      `).run(project.id, name);
    }

    send(res, 200, { ok: true, status: "incomplete" });
    return true;
  }

  if (pathname === "/api/claim") {
    if (!user) throw new HttpError(401, "Sign in");
    const project = requireProject(db, req);
    const resolvedFolder = path.resolve(root, project.folder);
    const folderProblem = folderError(resolvedFolder);
    if (folderProblem) throw new HttpError(400, folderProblem);
    if (method === "POST") {
      const body = await readBody(req);
      const name = typeof body.name === "string" ? body.name : "";
      const imageFull = resolveInside(resolvedFolder, name);
      if (!fs.existsSync(imageFull) || !fs.statSync(imageFull).isFile()) {
        throw new HttpError(404, "Image not found");
      }
      const row = db
        .prepare(
          "SELECT claimed_by, claimed_at, status, completed_at FROM image_claims WHERE project_id = ? AND rel_path = ?",
        )
        .get(project.id, name);
      const action = typeof body.action === "string" ? body.action : "claim";

      if (action === "release-incomplete") {
        const isExpired =
          row?.claimed_at && new Date(row.claimed_at).getTime() < Date.now() - 15 * 60 * 1000;
        if (
          row?.claimed_by &&
          row.claimed_by !== user.username &&
          !body.takeover &&
          !admin &&
          !isExpired
        ) {
          throw new HttpError(403, `Claimed by ${row.claimed_by}`);
        }
        db.prepare(
          `INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
           VALUES (?, ?, NULL, NULL, 'incomplete', NULL)
           ON CONFLICT(project_id, rel_path) DO UPDATE SET
             claimed_by = NULL,
             claimed_at = NULL,
             status = 'incomplete',
             completed_at = NULL`,
        ).run(project.id, name);
        db.prepare(
          "UPDATE images SET status = 'incomplete', locked_by = NULL, locked_at = NULL WHERE project_id = ? AND file_path = ?",
        ).run(project.id, name);
        send(res, 200, {
          name,
          claimedBy: null,
          claimedAt: null,
          status: "incomplete",
          completedAt: null,
        });
        return true;
      }

      if (action === "complete") {
        const isExpired =
          row?.claimed_at && new Date(row.claimed_at).getTime() < Date.now() - 15 * 60 * 1000;
        if (row?.claimed_by && row.claimed_by !== user.username && !body.takeover && !isExpired) {
          throw new HttpError(409, `Claimed by ${row.claimed_by}`);
        }
        if (body.boxes !== undefined) {
          const boxes = cleanBoxes(body.boxes);
          const lines = boxes.map(
            (box) =>
              `${box.classId} ${box.x.toFixed(6)} ${box.y.toFixed(6)} ${box.w.toFixed(6)} ${box.h.toFixed(6)}`,
          );
          fs.writeFileSync(labelFileFor(imageFull), lines.length ? `${lines.join("\n")}\n` : "");
        }
        const claimedAt = row?.claimed_at || now;
        db.prepare(
          `INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
           VALUES (?, ?, ?, ?, 'complete', ?)
           ON CONFLICT(project_id, rel_path) DO UPDATE SET
             claimed_by = excluded.claimed_by,
             claimed_at = COALESCE(image_claims.claimed_at, excluded.claimed_at),
             status = 'complete',
             completed_at = excluded.completed_at`,
        ).run(project.id, name, user.username, claimedAt, now);
        db.prepare(
          "UPDATE images SET status = 'completed', locked_by = NULL, locked_at = NULL, completed_at = CURRENT_TIMESTAMP WHERE project_id = ? AND file_path = ?",
        ).run(project.id, name);
        send(res, 200, {
          name,
          claimedBy: user.username,
          claimedAt,
          status: "complete",
          completedAt: now,
        });
        return true;
      }

      const isExpired =
        row?.claimed_at && new Date(row.claimed_at).getTime() < Date.now() - 15 * 60 * 1000;
      if (row?.claimed_by && row.claimed_by !== user.username && !body.takeover && !isExpired) {
        throw new HttpError(409, `Claimed by ${row.claimed_by}`);
      }
      db.prepare(
        `INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
         VALUES (?, ?, ?, ?, 'open', NULL)
         ON CONFLICT(project_id, rel_path) DO UPDATE SET
           claimed_by = excluded.claimed_by,
           claimed_at = excluded.claimed_at,
           status = 'open',
           completed_at = NULL`,
      ).run(project.id, name, user.username, now);
      db.prepare(
        "UPDATE images SET locked_by = ?, locked_at = CURRENT_TIMESTAMP WHERE project_id = ? AND file_path = ?",
      ).run(user.username, project.id, name);
      send(res, 200, {
        name,
        claimedBy: user.username,
        claimedAt: now,
        status: "open",
        completedAt: null,
      });
      return true;
    }
    if (method === "DELETE") {
      const name = url.searchParams.get("name") || "";
      resolveInside(resolvedFolder, name);
      const row = db
        .prepare(
          "SELECT claimed_by, claimed_at FROM image_claims WHERE project_id = ? AND rel_path = ?",
        )
        .get(project.id, name);
      const isExpired =
        row?.claimed_at && new Date(row.claimed_at).getTime() < Date.now() - 15 * 60 * 1000;
      if (row?.claimed_by && row.claimed_by !== user.username && !admin && !isExpired) {
        throw new HttpError(403, `Claimed by ${row.claimed_by}`);
      }
      db.prepare(
        `INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
         VALUES (?, ?, NULL, NULL, 'incomplete', NULL)
         ON CONFLICT(project_id, rel_path) DO UPDATE SET
           claimed_by = NULL,
           claimed_at = NULL,
           status = 'incomplete',
           completed_at = NULL`,
      ).run(project.id, name);
      db.prepare(
        "UPDATE images SET status = 'incomplete', locked_by = NULL, locked_at = NULL WHERE project_id = ? AND file_path = ?",
      ).run(project.id, name);
      send(res, 200, { ok: true, status: "incomplete" });
      return true;
    }
    throw new HttpError(404, "Not found");
  }

  if (admin) return false;
  if (method === "GET" && pathname === "/api/projects") return false;
  if (method === "DELETE" && pathname === "/api/projects") return false;
  if (method === "GET" && pathname === "/api/export") return false;

  if (!user) throw new HttpError(401, "Sign in");
  return false;
}

/**
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse} res
 * @param {URL} url
 * @param {string} root
 */
async function handle(req, res, url, root) {
  const method = (req.method || "GET").toUpperCase();
  const pathname = url.pathname;
  if (await guard(req, res, url, root, method, pathname)) return;

  if (method === "GET" && pathname === "/api/project") {
    const db = await getDb(root);
    const project = currentProject(db, req);
    send(res, 200, { project: project ? publicProject(root, project, db) : null });
    return;
  }

  if (method === "GET" && pathname === "/api/projects") {
    const db = await getDb(root);
    const rows = db
      .prepare("SELECT id, name, folder FROM projects ORDER BY name COLLATE NOCASE")
      .all();
    send(res, 200, { projects: rows.map((row) => publicProject(root, row, db)) });
    return;
  }

  if (method === "POST" && pathname === "/api/projects") {
    const db = await getDb(root);
    const body = await readBody(req);
    const name = cleanText(body.name, "Name", 60);
    const folder = cleanText(body.folder, "Folder", 1000);
    const project = createProject(db, root, name, folder);
    writeCookie(res, "partlab_project", String(project.id), Math.floor(SESSION_MS / 1000));
    send(res, 200, { project: publicProject(root, project, db) });
    return;
  }

  if (method === "POST" && pathname === "/api/projects/open") {
    const db = await getDb(root);
    const body = await readBody(req);
    const id = Number(body.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Bad id");
    const project = db.prepare("SELECT id, name, folder FROM projects WHERE id = ?").get(id);
    if (!project) throw new HttpError(404, "Project not found");
    writeCookie(res, "partlab_project", String(project.id), Math.floor(SESSION_MS / 1000));
    send(res, 200, { project: publicProject(root, project, db) });
    return;
  }

  if (method === "DELETE" && pathname === "/api/projects") {
    const db = await getDb(root);
    let body = {};
    try {
      body = await readBody(req);
    } catch {
      /* body optional if params provided */
    }
    const id = Number(body.id ?? url.searchParams.get("id"));
    if (!Number.isInteger(id)) throw new HttpError(400, "Bad id");
    const password =
      typeof body.password === "string" ? body.password : url.searchParams.get("password") || "";
    if (!sameSecret(password, ADMIN_PASSWORD)) throw new HttpError(401, "Wrong admin password");
    const project = db.prepare("SELECT id, name, folder FROM projects WHERE id = ?").get(id);
    if (!project) throw new HttpError(404, "Project not found");

    const resolvedFolder = path.resolve(root, project.folder);
    if (!folderError(resolvedFolder)) {
      removeTxtFiles(resolvedFolder);
    }

    db.transaction(() => {
      db.prepare("DELETE FROM image_claims WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM images WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM classes WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    })();

    projectFolders.delete(resolvedFolder);
    const curId = Number(readCookies(req).partlab_project);
    if (curId === id) {
      writeCookie(res, "partlab_project", "", 0);
    }
    send(res, 200, { ok: true, id });
    return;
  }

  if (method === "GET" && pathname === "/api/catalogue") {
    const db = await getDb(root);
    send(res, 200, await catalogue(root, requireProject(db, req)));
    return;
  }

  if (method === "POST" && pathname === "/api/classes/import") {
    const db = await getDb(root);
    const project = requireProject(db, req);
    const body = await readBody(req);
    if (typeof body.csv !== "string" || !body.csv.trim()) throw new HttpError(400, "CSV is empty");
    const rows = parseClassCsv(body.csv);
    if (rows.length === 0) throw new HttpError(400, "CSV has no rows");
    if (rows.length > 20000) throw new HttpError(400, "CSV is limited to 20000 rows");
    const result = importClasses(db, project.id, rows);
    writeClassesFile(db, project.id, path.resolve(root, project.folder));
    send(res, 200, result);
    return;
  }

  if (method === "POST" && pathname === "/api/classes") {
    const db = await getDb(root);
    const project = requireProject(db, req);
    const body = await readBody(req);
    const ic = cleanText(body.ic, "Item code", 40);
    const des = cleanText(body.des, "Description", 120);
    const next = db
      .prepare("SELECT COALESCE(MAX(id), -1) + 1 AS id FROM classes WHERE project_id = ?")
      .get(project.id);
    const color = pickColor(db, project.id);
    try {
      db.prepare("INSERT INTO classes (project_id, id, ic, des, color) VALUES (?, ?, ?, ?, ?)").run(
        project.id,
        next.id,
        ic,
        des,
        color,
      );
    } catch (err) {
      if (String(err).includes("UNIQUE")) throw new HttpError(409, "That item code already exists");
      throw err;
    }
    writeClassesFile(db, project.id, path.resolve(root, project.folder));
    send(res, 200, { id: next.id, ic, des, color });
    return;
  }

  if (method === "PATCH" && pathname === "/api/classes") {
    const db = await getDb(root);
    const project = requireProject(db, req);
    const body = await readBody(req);
    const id = Number(body.id);
    if (!Number.isInteger(id)) throw new HttpError(400, "Bad id");
    const ic = cleanText(body.ic, "Item code", 40);
    const des = cleanText(body.des, "Description", 120);
    const existing = db
      .prepare("SELECT id FROM classes WHERE project_id = ? AND id = ?")
      .get(project.id, id);
    if (!existing) throw new HttpError(404, "Class not found");
    try {
      db.prepare("UPDATE classes SET ic = ?, des = ? WHERE project_id = ? AND id = ?").run(
        ic,
        des,
        project.id,
        id,
      );
    } catch (err) {
      if (String(err).includes("UNIQUE")) throw new HttpError(409, "That item code already exists");
      throw err;
    }
    writeClassesFile(db, project.id, path.resolve(root, project.folder));
    const row = db
      .prepare("SELECT id, ic, des, color FROM classes WHERE project_id = ? AND id = ?")
      .get(project.id, id);
    send(res, 200, row);
    return;
  }

  if (method === "DELETE" && pathname === "/api/classes") {
    const db = await getDb(root);
    const project = requireProject(db, req);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id)) throw new HttpError(400, "Bad id");
    const result = db
      .prepare("DELETE FROM classes WHERE project_id = ? AND id = ?")
      .run(project.id, id);
    if (result.changes === 0) throw new HttpError(404, "Class not found");
    writeClassesFile(db, project.id, path.resolve(root, project.folder));
    send(res, 200, { ok: true });
    return;
  }

  if (method === "GET" && pathname === "/api/export") {
    const db = await getDb(root);
    const idParam = url.searchParams.get("id");
    let project;
    if (idParam) {
      const id = Number(idParam);
      if (!Number.isInteger(id)) throw new HttpError(400, "Bad id");
      project = db.prepare("SELECT id, name, folder FROM projects WHERE id = ?").get(id);
      if (!project) throw new HttpError(404, "Project not found");
    } else {
      project = requireProject(db, req);
    }
    const resolvedFolder = path.resolve(root, project.folder);
    const error = folderError(resolvedFolder);
    if (error) throw new HttpError(400, error);

    const rawType = (
      url.searchParams.get("type") ??
      url.searchParams.get("export_type") ??
      url.searchParams.get("mode") ??
      "full_tar"
    )
      .trim()
      .toLowerCase();
    /** @type {"labels_only" | "full_tar"} */
    let exportType;
    if (rawType === "labels_only" || rawType === "labels") {
      exportType = "labels_only";
    } else if (rawType === "full_tar" || rawType === "full" || rawType === "tar") {
      exportType = "full_tar";
    } else {
      throw new HttpError(400, "Invalid export type; expected labels_only or full_tar");
    }

    const rawSplit =
      url.searchParams.get("split") ??
      url.searchParams.get("trainSplit") ??
      url.searchParams.get("train_split") ??
      "80";
    const parsedSplit = Number(rawSplit);
    if (!Number.isFinite(parsedSplit) || parsedSplit < 0 || parsedSplit > 100) {
      throw new HttpError(400, "Invalid train/val split; expected 0 to 100");
    }
    const trainSplitPct =
      parsedSplit > 0 && parsedSplit < 1 && String(rawSplit).includes(".")
        ? Math.round(parsedSplit * 100)
        : Math.round(parsedSplit);

    const rawFormat = (
      url.searchParams.get("format") ??
      url.searchParams.get("export_format") ??
      "yolo"
    )
      .trim()
      .toLowerCase();
    /** @type {"yolo" | "coco"} */
    const exportFormat = rawFormat === "coco" ? "coco" : "yolo";

    try {
      writeClassesFile(db, project.id, resolvedFolder);
    } catch (err) {
      console.error("[label-api] classes.txt", err);
    }

    if (exportFormat === "coco") {
      await streamCocoExport(req, res, db, project, resolvedFolder, exportType, trainSplitPct);
    } else {
      await streamYoloExport(req, res, db, project, resolvedFolder, exportType, trainSplitPct);
    }
    return;
  }

  if (pathname === "/api/label" || pathname === "/api/image") {
    const db = await getDb(root);
    const project = requireProject(db, req);
    const resolvedFolder = path.resolve(root, project.folder);
    const error = folderError(resolvedFolder);
    if (error) throw new HttpError(400, error);
    const name = url.searchParams.get("name") || "";
    const imageFull = resolveInside(resolvedFolder, name);
    if (!fs.existsSync(imageFull) || !fs.statSync(imageFull).isFile()) {
      throw new HttpError(404, "Image not found");
    }
    if (!IMAGE_EXT.has(path.extname(imageFull).toLowerCase())) {
      throw new HttpError(400, "Not an image");
    }

    if (method === "GET" && pathname === "/api/label") {
      send(res, 200, { boxes: readBoxes(labelFileFor(imageFull)) });
      return;
    }

    if (method === "PUT" && pathname === "/api/label") {
      const body = await readBody(req);
      const boxes = cleanBoxes(body.boxes);
      const user = currentUser(db, req);
      if (!user) throw new HttpError(401, "Sign in");
      claimForWrite(db, project.id, name, user.username);
      const lines = boxes.map(
        (box) =>
          `${box.classId} ${box.x.toFixed(6)} ${box.y.toFixed(6)} ${box.w.toFixed(6)} ${box.h.toFixed(6)}`,
      );
      fs.writeFileSync(labelFileFor(imageFull), lines.length ? `${lines.join("\n")}\n` : "");
      db.prepare(`
        UPDATE images
        SET 
          status = 'completed',
          locked_by = NULL,
          locked_at = NULL,
          completed_at = CURRENT_TIMESTAMP
        WHERE project_id = ? AND file_path = ?
      `).run(project.id, name);
      db.prepare(`
        INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at, status, completed_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'complete', CURRENT_TIMESTAMP)
        ON CONFLICT(project_id, rel_path) DO UPDATE SET
          claimed_by = excluded.claimed_by,
          status = 'complete',
          completed_at = excluded.completed_at
      `).run(project.id, name, user.username);
      send(res, 200, { ok: true, boxes });
      return;
    }

    if (method === "GET" && pathname === "/api/image") {
      const types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
      };
      const ext = path.extname(imageFull).toLowerCase();
      res.statusCode = 200;
      res.setHeader("content-type", types[ext] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      const stream = fs.createReadStream(imageFull);
      stream.on("error", () => {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
      stream.pipe(res);
      return;
    }
  }

  send(res, 404, { error: "Not found" });
}

export function labellingApiPlugin() {
  return {
    name: "labelling-api",
    configureServer(server) {
      mount(server);
    },
    configurePreviewServer(server) {
      mount(server);
    },
  };
}

/**
 * @param {import("vite").ViteDevServer} server
 */
function mount(server) {
  server.middlewares.use((req, res, next) => {
    const raw = req.url || "/";
    let url;
    try {
      url = new URL(raw, "http://127.0.0.1");
    } catch {
      next();
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }
    handle(req, res, url, server.config.root).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Server error";
      if (status === 500) console.error("[label-api]", err);
      if (!res.headersSent) send(res, status, { error: message });
    });
  });
}
