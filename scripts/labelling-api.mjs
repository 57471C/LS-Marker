import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

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
function getDb(root) {
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
              PRIMARY KEY (project_id, rel_path)
            );
          `);
          ensureDefaultProject(db, root);
        }
        for (const project of db.prepare("SELECT id FROM projects").all()) {
          assignMissingColors(db, project.id);
        }
        for (const project of db.prepare("SELECT folder FROM projects").all()) {
          rememberProjectFolder(path.resolve(root, project.folder));
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
    .prepare("SELECT claimed_by FROM image_claims WHERE project_id = ? AND rel_path = ?")
    .get(projectId, rel);
  const now = new Date().toISOString();
  if (!row?.claimed_by) {
    db.prepare(
      `INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, rel_path) DO UPDATE SET claimed_by = excluded.claimed_by, claimed_at = excluded.claimed_at`,
    ).run(projectId, rel, username, now);
    return;
  }
  if (row.claimed_by !== username) throw new HttpError(409, `Claimed by ${row.claimed_by}`);
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
 */
function listImages(folder) {
  /** @type {string[]} */
  const out = [];
  /**
   * @param {string} dir
   * @param {string} rel
   * @param {number} depth
   */
  function walk(dir, rel, depth) {
    if (out.length >= MAX_IMAGES || depth > 8) return;
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
      if (out.length >= MAX_IMAGES) return;
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
 * @param {Date} date
 */
function dosStamp(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * @param {string} name
 */
function zipTxtName(name) {
  const slash = name.lastIndexOf("/");
  const dir = slash >= 0 ? name.slice(0, slash + 1) : "";
  const base = name.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${dir}${stem}.txt`;
}

/**
 * Stored (uncompressed) zip. JPEGs are already compressed.
 * @param {string} folder
 * @param {(chunk: Buffer) => void} write
 */
function writeYoloZip(folder, write) {
  const when = dosStamp(new Date());
  /** @type {{ name: Buffer, crc: number, size: number, offset: number }[]} */
  const entries = [];
  let offset = 0;

  /**
   * @param {string} name
   * @param {Buffer} data
   */
  function add(name, data) {
    const nameBuf = Buffer.from(name.replaceAll("\\", "/"), "utf8");
    const crc = zlib.crc32(data) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(when.time, 10);
    header.writeUInt16LE(when.day, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    entries.push({ name: nameBuf, crc, size: data.length, offset });
    write(header);
    write(nameBuf);
    write(data);
    offset += header.length + nameBuf.length + data.length;
  }

  for (const name of listImages(folder)) {
    const imageFull = resolveInside(folder, name);
    let image;
    try {
      image = fs.readFileSync(imageFull);
    } catch {
      continue;
    }
    add(name, image);
    const txtPath = labelFileFor(imageFull);
    if (!fs.existsSync(txtPath)) continue;
    try {
      add(zipTxtName(name), fs.readFileSync(txtPath));
    } catch {
      /* skip a label that disappeared mid-export */
    }
  }
  const classesPath = path.join(folder, "classes.txt");
  if (fs.existsSync(classesPath)) {
    try {
      add("classes.txt", fs.readFileSync(classesPath));
    } catch {
      /* class list is optional in the zip */
    }
  }

  const centralStart = offset;
  for (const entry of entries) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(when.time, 12);
    central.writeUInt16LE(when.day, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.size, 20);
    central.writeUInt32LE(entry.size, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt32LE(entry.offset, 42);
    write(central);
    write(entry.name);
    offset += central.length + entry.name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  write(end);
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
 */
function publicProject(root, project) {
  const resolvedFolder = path.resolve(root, project.folder);
  const error = folderError(resolvedFolder);
  return {
    id: project.id,
    name: project.name,
    folder: project.folder,
    resolvedFolder,
    folderOk: !error,
    folderError: error,
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
  if (!project) throw new HttpError(409, "Open a project");
  return project;
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
async function catalogue(root, project) {
  const db = await getDb(root);
  const resolvedFolder = path.resolve(root, project.folder);
  const error = folderError(resolvedFolder);
  /** @type {{ name: string, labelled: boolean, claimedBy: string | null, claimedAt: string | null }[]} */
  let images = [];
  if (!error) {
    try {
      writeClassesFile(db, project.id, resolvedFolder);
    } catch (err) {
      console.error("[label-api] classes.txt", err);
    }
    const claims = new Map(
      db
        .prepare("SELECT rel_path, claimed_by, claimed_at FROM image_claims WHERE project_id = ?")
        .all(project.id)
        .map((row) => [row.rel_path, row]),
    );
    images = listImages(resolvedFolder).map((name) => {
      const claim = claims.get(name);
      return {
        name,
        labelled: fs.existsSync(labelFileFor(resolveInside(resolvedFolder, name))),
        claimedBy: claim?.claimed_by || null,
        claimedAt: claim?.claimed_at || null,
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
        .prepare("SELECT claimed_by FROM image_claims WHERE project_id = ? AND rel_path = ?")
        .get(project.id, name);
      if (row?.claimed_by && row.claimed_by !== user.username && !body.takeover) {
        throw new HttpError(409, `Claimed by ${row.claimed_by}`);
      }
      db.prepare(
        `INSERT INTO image_claims (project_id, rel_path, claimed_by, claimed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, rel_path) DO UPDATE SET claimed_by = excluded.claimed_by, claimed_at = excluded.claimed_at`,
      ).run(project.id, name, user.username, now);
      send(res, 200, { name, claimedBy: user.username, claimedAt: now });
      return true;
    }
    if (method === "DELETE") {
      const name = url.searchParams.get("name") || "";
      resolveInside(resolvedFolder, name);
      const row = db
        .prepare("SELECT claimed_by FROM image_claims WHERE project_id = ? AND rel_path = ?")
        .get(project.id, name);
      if (row?.claimed_by && row.claimed_by !== user.username) {
        throw new HttpError(403, `Claimed by ${row.claimed_by}`);
      }
      db.prepare("DELETE FROM image_claims WHERE project_id = ? AND rel_path = ?").run(
        project.id,
        name,
      );
      send(res, 200, { ok: true });
      return true;
    }
    throw new HttpError(404, "Not found");
  }

  if (method === "GET" && pathname === "/api/catalogue" && admin) return false;

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
    send(res, 200, { project: project ? publicProject(root, project) : null });
    return;
  }

  if (method === "GET" && pathname === "/api/projects") {
    const db = await getDb(root);
    const rows = db
      .prepare("SELECT id, name, folder FROM projects ORDER BY name COLLATE NOCASE")
      .all();
    send(res, 200, { projects: rows.map((row) => publicProject(root, row)) });
    return;
  }

  if (method === "POST" && pathname === "/api/projects") {
    const db = await getDb(root);
    const body = await readBody(req);
    const name = cleanText(body.name, "Name", 60);
    const folder = cleanText(body.folder, "Folder", 1000);
    const project = createProject(db, root, name, folder);
    writeCookie(res, "partlab_project", String(project.id), Math.floor(SESSION_MS / 1000));
    send(res, 200, { project: publicProject(root, project) });
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
    send(res, 200, { project: publicProject(root, project) });
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
    const project = requireProject(db, req);
    const resolvedFolder = path.resolve(root, project.folder);
    const error = folderError(resolvedFolder);
    if (error) throw new HttpError(400, error);
    try {
      writeClassesFile(db, project.id, resolvedFolder);
    } catch (err) {
      console.error("[label-api] classes.txt", err);
    }
    res.statusCode = 200;
    res.setHeader("content-type", "application/zip");
    res.setHeader("content-disposition", 'attachment; filename="yolo.zip"');
    res.setHeader("cache-control", "no-store");
    writeYoloZip(resolvedFolder, (chunk) => {
      res.write(chunk);
    });
    res.end();
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
