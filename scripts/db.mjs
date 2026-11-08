import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool, types } = pg;

// OID 20 = INT8 (bigint): parse as integer number (COUNT, SUM, etc.)
types.setTypeParser(20, (val) => (val !== null ? parseInt(val, 10) : null));

// OID 1114 = TIMESTAMP: parse as UTC ISO string
types.setTypeParser(1114, (val) => {
  if (!val) return null;
  const iso = val.includes("T") ? `${val}Z` : `${val.replace(" ", "T")}Z`;
  return new Date(iso).toISOString();
});

// OID 1184 = TIMESTAMPTZ: parse as UTC ISO string
types.setTypeParser(1184, (val) => {
  if (!val) return null;
  return new Date(val).toISOString();
});

const clientStorage = new AsyncLocalStorage();

/**
 * Read PostgreSQL connection URL from:
 * 1. process.env.DATABASE_URL
 * 2. .env file
 * 3. labelling.config.json (databaseUrl)
 * 4. Default local development string
 * @param {string} root
 * @returns {string}
 */
export function getConnectionString(root = process.cwd()) {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  // Parse .env directly if present
  try {
    const envPath = path.join(root, ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^DATABASE_URL=(.*)$/);
        if (match) {
          const val = match[1].trim().replace(/^['"](.*)['"]$/, "$1");
          if (val) {
            process.env.DATABASE_URL = val;
            return val;
          }
        }
      }
    }
  } catch {
    /* ignore .env parse errors */
  }

  // Also check labelling.config.json if present
  try {
    const configPath = path.join(root, "labelling.config.json");
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (typeof cfg.databaseUrl === "string" && cfg.databaseUrl.trim()) {
        return cfg.databaseUrl.trim();
      }
    }
  } catch {
    /* ignore json read errors */
  }

  // Default fallback for local postgres development
  return "postgresql://ls_marker:admin@localhost:5432/ls_marker";
}

/**
 * Translate SQLite-flavored SQL queries and parameter bindings into PostgreSQL format.
 * - Named parameters (:userId, :projectId) -> $1, $2, ...
 * - Positional parameters (?) -> $1, $2, ...
 * - datetime('now', '-15 minutes') -> (CURRENT_TIMESTAMP - INTERVAL '15 minutes')
 * - INSERT OR IGNORE INTO images -> INSERT INTO images ... ON CONFLICT (project_id, file_path) DO NOTHING
 * - GROUP_CONCAT(DISTINCT ...) -> STRING_AGG(DISTINCT ..., ',')
 * - PRAGMA table_info(tbl) -> information_schema query
 * @param {string} rawSql
 * @param {any[]} args
 * @returns {{ sql: string, values: any[] }}
 */
export function translateSqlAndParams(rawSql, args) {
  let sql = rawSql
    // Replace SQLite datetime calculations
    .replace(
      /datetime\s*\(\s*['"]now['"]\s*,\s*['"]-(\d+)\s+minutes['"]\s*\)/gi,
      "(CURRENT_TIMESTAMP - INTERVAL '$1 minutes')",
    )
    .replace(
      /datetime\s*\(\s*['"]now['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gi,
      "(CURRENT_TIMESTAMP + INTERVAL '$1')",
    )
    // Replace GROUP_CONCAT
    .replace(/GROUP_CONCAT\s*\(\s*DISTINCT\s+([^)]+)\)/gi, "STRING_AGG(DISTINCT $1, ',')")
    .replace(/GROUP_CONCAT\s*\(\s*([^)]+)\)/gi, "STRING_AGG($1, ',')")
    // Replace INSERT OR IGNORE for images table
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO\s+images/gi, "INSERT INTO images");

  if (
    /INSERT\s+INTO\s+images/i.test(sql) &&
    /INSERT\s+OR\s+IGNORE/i.test(rawSql) &&
    !/ON\s+CONFLICT/i.test(sql)
  ) {
    sql += " ON CONFLICT (project_id, file_path) DO NOTHING";
  }

  // Check if PRAGMA table_info
  const pragmaMatch = rawSql.match(/PRAGMA\s+table_info\s*\(\s*['"]?([a-zA-Z0-9_]+)['"]?\s*\)/i);
  if (pragmaMatch) {
    const tableName = pragmaMatch[1].toLowerCase();
    return {
      sql: `SELECT column_name AS name, data_type AS type, (is_nullable = 'NO')::int AS notnull, column_default AS dflt_value
            FROM information_schema.columns
            WHERE table_name = $1
            ORDER BY ordinal_position`,
      values: [tableName],
    };
  }

  // Check if named parameters object was passed
  const isNamed =
    args.length === 1 &&
    typeof args[0] === "object" &&
    args[0] !== null &&
    !Array.isArray(args[0]) &&
    !(args[0] instanceof Date) &&
    !Buffer.isBuffer(args[0]);

  if (isNamed) {
    const obj = args[0];
    const nameMap = new Map();
    const values = [];
    sql = sql.replace(/:([a-zA-Z0-9_]+)/g, (_match, name) => {
      if (!nameMap.has(name)) {
        nameMap.set(name, values.length + 1);
        values.push(obj[name] !== undefined ? obj[name] : null);
      }
      return `$${nameMap.get(name)}`;
    });
    return { sql, values };
  }

  // Positional parameters
  const flatArgs = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  let idx = 1;
  sql = sql.replace(/\?/g, () => `$${idx++}`);
  return { sql, values: flatArgs };
}

export class PreparedStatement {
  /**
   * @param {PostgresDatabase} db
   * @param {string} sql
   */
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }

  /**
   * Run query and return all row objects.
   * @param  {...any} args
   * @returns {Promise<any[]>}
   */
  async all(...args) {
    const { sql, values } = translateSqlAndParams(this.sql, args);
    const client = clientStorage.getStore() || this.db.pool;
    const res = await client.query(sql, values);
    return res.rows;
  }

  /**
   * Run query and return first row object or undefined.
   * @param  {...any} args
   * @returns {Promise<any | undefined>}
   */
  async get(...args) {
    const { sql, values } = translateSqlAndParams(this.sql, args);
    const client = clientStorage.getStore() || this.db.pool;
    const res = await client.query(sql, values);
    return res.rows[0];
  }

  /**
   * Run INSERT/UPDATE/DELETE query and return { changes, lastInsertRowid }.
   * @param  {...any} args
   * @returns {Promise<{ changes: number, lastInsertRowid?: number }>}
   */
  async run(...args) {
    let rawSql = this.sql;
    // For auto-increment tables, append RETURNING id if not already returning
    if (
      /^\s*INSERT\s+INTO\s+(?:projects|users|images)\b/i.test(rawSql) &&
      !/\bRETURNING\b/i.test(rawSql)
    ) {
      rawSql += " RETURNING id";
    }
    const { sql, values } = translateSqlAndParams(rawSql, args);
    const client = clientStorage.getStore() || this.db.pool;
    const res = await client.query(sql, values);
    const lastInsertRowid = res.rows[0]?.id !== undefined ? Number(res.rows[0].id) : undefined;
    return {
      changes: res.rowCount ?? 0,
      lastInsertRowid,
    };
  }
}

export class PostgresDatabase {
  /**
   * @param {import("pg").Pool} pool
   */
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Prepare a query statement compatible with better-sqlite3 API.
   * @param {string} sql
   * @returns {PreparedStatement}
   */
  prepare(sql) {
    return new PreparedStatement(this, sql);
  }

  /**
   * Execute raw SQL statements.
   * @param {string} sql
   */
  async exec(sql) {
    const client = clientStorage.getStore() || this.pool;
    await client.query(sql);
  }

  /**
   * SQLite pragma placeholder (no-op in Postgres).
   */
  pragma() {
    return null;
  }

  /**
   * Wrap operations in an atomic PostgreSQL transaction.
   * Returns an async callable function matching better-sqlite3 transaction pattern.
   * @param {Function} fn
   * @returns {(...args: any[]) => Promise<any>}
   */
  transaction(fn) {
    return async (...args) => {
      // If already in an active transaction, execute directly
      if (clientStorage.getStore()) {
        return fn(...args);
      }
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const res = await clientStorage.run(client, () => fn(...args));
        await client.query("COMMIT");
        return res;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    };
  }

  /**
   * Create a database backup file (SQL dump format) at destPath.
   * @param {string} destPath
   */
  async backup(destPath) {
    const client = await this.pool.connect();
    try {
      const tables = [
        "projects",
        "users",
        "sessions",
        "admin_sessions",
        "classes",
        "image_claims",
        "images",
        "system_settings",
      ];
      let dump = `-- LS-Marker PostgreSQL Backup Dump\n-- Created at: ${new Date().toISOString()}\n\n`;

      for (const table of tables) {
        const res = await client.query(`SELECT * FROM ${table}`);
        dump += `-- Table: ${table} (${res.rows.length} rows)\n`;
        if (res.rows.length > 0) {
          const cols = Object.keys(res.rows[0]);
          for (const row of res.rows) {
            const vals = cols.map((col) => {
              const v = row[col];
              if (v === null || v === undefined) return "NULL";
              if (typeof v === "number" || typeof v === "boolean") return String(v);
              return `'${String(v).replace(/'/g, "''")}'`;
            });
            dump += `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${vals.join(", ")}) ON CONFLICT DO NOTHING;\n`;
          }
        }
        dump += "\n";
      }

      fs.writeFileSync(destPath, dump, "utf8");
      return destPath;
    } finally {
      client.release();
    }
  }

  /**
   * Close pool connections.
   */
  async close() {
    await this.pool.end();
  }
}

/** @type {PostgresDatabase | null} */
let instance = null;

/**
 * Initialize and get singleton Postgres database connection.
 * @param {string} root
 * @returns {Promise<PostgresDatabase>}
 */
export async function getDb(root = process.cwd()) {
  if (instance) return instance;

  const connectionString = getConnectionString(root);
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
  });

  // Verify connection
  const client = await pool.connect();
  try {
    // Ensure schema and nocase collation exist
    const schemaPath = path.join(root, "scripts", "schema.sql");
    if (fs.existsSync(schemaPath)) {
      const ddl = fs.readFileSync(schemaPath, "utf8");
      await client.query(ddl);
    }
    // Additive schema migrations for structured dimensions
    await client.query(`
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS thread TEXT;
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS length_mm DOUBLE PRECISION;
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS head_type TEXT;
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS af_mm DOUBLE PRECISION;
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS height_mm DOUBLE PRECISION;
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS od_mm DOUBLE PRECISION;
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS id_mm DOUBLE PRECISION;
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS thickness_mm DOUBLE PRECISION;
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS width_mm DOUBLE PRECISION;
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS note TEXT;
      ALTER TABLE classes ADD COLUMN IF NOT EXISTS dimensions TEXT;

      CREATE TABLE IF NOT EXISTS part_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        fields TEXT NOT NULL,
        required_fields TEXT NOT NULL,
        display_format TEXT,
        archived BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const ptCountRes = await client.query("SELECT COUNT(*) as count FROM part_types");
    if (parseInt(ptCountRes.rows[0].count, 10) === 0) {
      for (const pt of DEFAULT_PART_TYPES) {
        await client.query(
          `INSERT INTO part_types (id, name, fields, required_fields, display_format, archived)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [
            pt.id,
            pt.name,
            JSON.stringify(pt.fields),
            JSON.stringify(pt.required_fields),
            pt.display_format,
            false,
          ],
        );
      }
    }
  } finally {
    client.release();
  }

  instance = new PostgresDatabase(pool);
  return instance;
}

/**
 * Get sanitized connection information for UI and settings displays.
 * @param {string} root
 */
export function getDbConnectionInfo(root = process.cwd()) {
  const rawUrl = getConnectionString(root);
  try {
    const u = new URL(rawUrl);
    const maskedUrl = `${u.protocol}//${u.username ? `${u.username}:••••••@` : ""}${u.host}${u.pathname}`;
    let source = "Default fallback";
    if (process.env.DATABASE_URL) {
      source = "process.env.DATABASE_URL";
    }
    const envPath = path.join(root, ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      if (/^DATABASE_URL=/m.test(content)) {
        source = ".env file";
      }
    }
    return {
      host: u.hostname,
      port: u.port || "5432",
      database: u.pathname.replace(/^\//, ""),
      user: u.username,
      source,
      maskedUrl,
    };
  } catch {
    return {
      host: "localhost",
      port: "5432",
      database: "ls_marker",
      user: "ls_marker",
      source: "unknown",
      maskedUrl: "postgresql://***",
    };
  }
}

/**
 * Test a candidate PostgreSQL connection URL.
 * @param {string} testUrl
 */
export async function testDbConnection(testUrl) {
  const pool = new Pool({
    connectionString: testUrl,
    connectionTimeoutMillis: 5000,
  });
  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      const res = await client.query("SELECT version() AS version, current_database() AS db");
      const latencyMs = Date.now() - start;
      return {
        ok: true,
        version: res.rows[0]?.version || "PostgreSQL",
        database: res.rows[0]?.db,
        latencyMs,
      };
    } finally {
      client.release();
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

/**
 * Update the database connection string in .env and reload singleton pool.
 * @param {string} root
 * @param {string} newUrl
 */
export async function updateDbConnectionString(root = process.cwd(), newUrl) {
  const testRes = await testDbConnection(newUrl);
  if (!testRes.ok) {
    throw new Error(`Connection test failed: ${testRes.error}`);
  }

  const envPath = path.join(root, ".env");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (/^DATABASE_URL=.*$/m.test(content)) {
    content = content.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${newUrl}`);
  } else {
    content = content ? `${content.trim()}\nDATABASE_URL=${newUrl}\n` : `DATABASE_URL=${newUrl}\n`;
  }
  fs.writeFileSync(envPath, content, "utf8");

  process.env.DATABASE_URL = newUrl;

  if (instance) {
    await instance.close().catch(() => {});
    instance = null;
  }

  return {
    success: true,
    info: getDbConnectionInfo(root),
  };
}

export const DEFAULT_PART_TYPES = [
  {
    id: "bolt",
    name: "Bolt",
    fields: ["thread", "length_mm", "head_type", "af_mm"],
    required_fields: ["thread", "length_mm"],
    display_format: "{thread}x{length_mm} {head_type}",
    archived: false,
  },
  {
    id: "nut",
    name: "Nut",
    fields: ["thread", "af_mm", "height_mm"],
    required_fields: ["thread", "af_mm"],
    display_format: "{thread}, AF: {af_mm}mm",
    archived: false,
  },
  {
    id: "washer",
    name: "Washer / Spacer / Crush tube",
    fields: ["od_mm", "id_mm", "thickness_mm"],
    required_fields: ["od_mm", "thickness_mm"],
    display_format: "{od_mm} × {id_mm} × {thickness_mm} mm",
    archived: false,
  },
  {
    id: "label",
    name: "Label / Sticker",
    fields: ["width_mm", "height_mm"],
    required_fields: ["width_mm", "height_mm"],
    display_format: "{width_mm}x{height_mm}mm",
    archived: false,
  },
  {
    id: "cable_tie",
    name: "Cable tie",
    fields: ["length_mm", "width_mm"],
    required_fields: ["length_mm", "width_mm"],
    display_format: "{length_mm}x{width_mm}mm",
    archived: false,
  },
  {
    id: "spring",
    name: "Spring",
    fields: ["od_mm", "length_mm", "note"],
    required_fields: ["od_mm", "length_mm"],
    display_format: "OD: {od_mm}mm, L: {length_mm}mm",
    archived: false,
  },
  {
    id: "other",
    name: "Other",
    fields: ["width_mm", "height_mm", "od_mm", "length_mm", "note"],
    required_fields: [],
    display_format: "{width_mm}x{height_mm}mm",
    archived: false,
  },
];

/**
 * Ensure SQLite part_types table exists and has default part classes seeded.
 * @param {any} db
 */
export function ensureSqlitePartTypesSchema(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS part_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        fields TEXT NOT NULL,
        required_fields TEXT NOT NULL,
        display_format TEXT DEFAULT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const count = db.prepare("SELECT COUNT(*) as count FROM part_types").get()?.count || 0;
    if (count === 0) {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO part_types (id, name, fields, required_fields, display_format, archived)
         VALUES (?, ?, ?, ?, ?, 0)`,
      );
      for (const pt of DEFAULT_PART_TYPES) {
        insert.run(
          pt.id,
          pt.name,
          JSON.stringify(pt.fields),
          JSON.stringify(pt.required_fields),
          pt.display_format,
        );
      }
    }
  } catch {
    /* ignore if sqlite not ready */
  }
}

/**
 * Add missing structured dimensions columns to SQLite classes table additively.
 * @param {any} db
 */
export function ensureSqliteClassesSchema(db) {
  try {
    ensureSqlitePartTypesSchema(db);
    const currentCols = db.prepare("PRAGMA table_info(classes)").all();
    if (!Array.isArray(currentCols) || currentCols.length === 0) return;
    const colNames = new Set(currentCols.map((c) => c.name));
    const addCol = (name, type) => {
      if (!colNames.has(name)) {
        db.exec(`ALTER TABLE classes ADD COLUMN ${name} ${type}`);
        colNames.add(name);
      }
    };
    addCol("part_type", "TEXT DEFAULT NULL");
    addCol("thread", "TEXT DEFAULT NULL");
    addCol("length_mm", "REAL DEFAULT NULL");
    addCol("head_type", "TEXT DEFAULT NULL");
    addCol("af_mm", "REAL DEFAULT NULL");
    addCol("height_mm", "REAL DEFAULT NULL");
    addCol("od_mm", "REAL DEFAULT NULL");
    addCol("id_mm", "REAL DEFAULT NULL");
    addCol("thickness_mm", "REAL DEFAULT NULL");
    addCol("width_mm", "REAL DEFAULT NULL");
    addCol("note", "TEXT DEFAULT NULL");
    addCol("dimensions", "TEXT DEFAULT NULL");
    addCol("dim1_name", "TEXT DEFAULT NULL");
    addCol("dim1_mm", "REAL DEFAULT NULL");
    addCol("dim2_name", "TEXT DEFAULT NULL");
    addCol("dim2_mm", "REAL DEFAULT NULL");
    addCol("dim3_name", "TEXT DEFAULT NULL");
    addCol("dim3_mm", "REAL DEFAULT NULL");
  } catch {
    /* ignore if classes table doesn't exist yet */
  }
}
