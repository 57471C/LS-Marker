# PostgreSQL Migration Guide

This document describes the migration of LS-Marker from local SQLite (`better-sqlite3`) to PostgreSQL 18.

---

## 1. Overview & Connection Configuration

LS-Marker now connects to PostgreSQL using the `pg` client pool via [`scripts/db.mjs`](file:///c:/Scripts/LS-Marker/scripts/db.mjs).

### Connection String Resolution
The database connection string is resolved in the following order of priority:
1. `process.env.DATABASE_URL` environment variable.
2. Local `.env` file (`DATABASE_URL=postgresql://user:password@host:port/dbname`).
3. `labelling.config.json` (`databaseUrl` property).
4. Local development default: `postgresql://ls_marker:admin@localhost:5432/ls_marker`.

> [!IMPORTANT]
> Never commit actual database passwords to version control. The `.env` file is excluded in `.gitignore`. A template is provided in [`.env.example`](file:///c:/Scripts/LS-Marker/.env.example).

### Setting up `.env`
Copy the example file and customize credentials:
```bash
cp .env.example .env
```
Contents of `.env`:
```ini
DATABASE_URL=postgresql://ls_marker:admin@localhost:5432/ls_marker
```

---

## 2. Schema Documentation & SQLite vs PostgreSQL Mapping

PostgreSQL DDL is maintained in [`scripts/schema.sql`](file:///c:/Scripts/LS-Marker/scripts/schema.sql).

### Collation
In SQLite, case-insensitive string lookups use `COLLATE NOCASE`. In PostgreSQL, an ICU collation is created:
```sql
CREATE COLLATION IF NOT EXISTS nocase (
  provider = 'icu',
  locale = 'und-u-ks-level2',
  deterministic = false
);
```

### Table Definitions

#### `projects`
Stores labelling project configurations and image folder paths.
| Column | SQLite Type | PostgreSQL Type | Constraints |
|---|---|---|---|
| `id` | `INTEGER` | `SERIAL` | `PRIMARY KEY` |
| `name` | `TEXT` | `VARCHAR(255)` | `NOT NULL UNIQUE COLLATE nocase` |
| `folder` | `TEXT` | `TEXT` | `NOT NULL` |
| `created_at` | `TEXT` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` |

#### `users`
Stores user authentication and roles.
| Column | SQLite Type | PostgreSQL Type | Constraints |
|---|---|---|---|
| `id` | `INTEGER` | `SERIAL` | `PRIMARY KEY` |
| `username` | `TEXT` | `VARCHAR(100)` | `NOT NULL UNIQUE COLLATE nocase` |
| `password_hash` | `TEXT` | `TEXT` | `NOT NULL` |
| `created_at` | `TEXT` | `TIMESTAMP` | `DEFAULT CURRENT_TIMESTAMP` |

#### `sessions`
Annotator user web session leases.
| Column | SQLite Type | PostgreSQL Type | Constraints |
|---|---|---|---|
| `token` | `TEXT` | `VARCHAR(255)` | `PRIMARY KEY` |
| `user_id` | `INTEGER` | `INTEGER` | `REFERENCES users(id) ON DELETE CASCADE` |
| `expires_at` | `TEXT` | `TIMESTAMP` | `NOT NULL` |

#### `admin_sessions`
Admin gatekeeper session leases.
| Column | SQLite Type | PostgreSQL Type | Constraints |
|---|---|---|---|
| `token` | `TEXT` | `VARCHAR(255)` | `PRIMARY KEY` |
| `expires_at` | `TEXT` | `TIMESTAMP` | `NOT NULL` |

#### `classes`
Project object classes (YOLO numeric class IDs anchored permanently).
| Column | SQLite Type | PostgreSQL Type | Constraints |
|---|---|---|---|
| `project_id` | `INTEGER` | `INTEGER` | `NOT NULL REFERENCES projects(id) ON DELETE CASCADE` |
| `id` | `INTEGER` | `INTEGER` | `NOT NULL` |
| `ic` | `TEXT` | `VARCHAR(100)` | `NOT NULL COLLATE nocase` |
| `des` | `TEXT` | `TEXT` | `NOT NULL` |
| `color` | `TEXT` | `VARCHAR(20)` | |
| `part_type` | `TEXT` | `VARCHAR(50)` | |
| `dim1_name` | `TEXT` | `VARCHAR(50)` | |
| `dim1_mm` | `REAL` | `DOUBLE PRECISION` | |
| `dim2_name` | `TEXT` | `VARCHAR(50)` | |
| `dim2_mm` | `REAL` | `DOUBLE PRECISION` | |
| `dim3_name` | `TEXT` | `VARCHAR(50)` | |
| `dim3_mm` | `REAL` | `DOUBLE PRECISION` | |

**Primary Key & Constraints**: `PRIMARY KEY (project_id, id)`, `UNIQUE (project_id, ic)`.

#### `image_claims`
Photo claim reservations and completion logs.
| Column | SQLite Type | PostgreSQL Type | Constraints |
|---|---|---|---|
| `project_id` | `INTEGER` | `INTEGER` | `NOT NULL REFERENCES projects(id) ON DELETE CASCADE` |
| `rel_path` | `TEXT` | `TEXT` | `NOT NULL` |
| `claimed_by` | `TEXT` | `VARCHAR(100)` | |
| `claimed_at` | `TEXT` | `TIMESTAMP` | |
| `status` | `TEXT` | `VARCHAR(50)` | `DEFAULT 'open'` |
| `completed_at` | `TEXT` | `TIMESTAMP` | |

**Primary Key**: `PRIMARY KEY (project_id, rel_path)`.

#### `images`
Core image registry with atomic lock leases.
| Column | SQLite Type | PostgreSQL Type | Constraints |
|---|---|---|---|
| `id` | `INTEGER` | `SERIAL` | `PRIMARY KEY` |
| `project_id` | `INTEGER` | `INTEGER` | `NOT NULL REFERENCES projects(id) ON DELETE CASCADE` |
| `file_path` | `TEXT` | `TEXT` | `NOT NULL` |
| `name` | `TEXT` | `TEXT` | |
| `status` | `TEXT` | `VARCHAR(50)` | `NOT NULL DEFAULT 'unlabeled'` |
| `owner` | `TEXT` | `VARCHAR(100)` | |
| `locked_by` | `TEXT` | `VARCHAR(100)` | |
| `locked_at` | `TEXT` | `TIMESTAMP` | |
| `completed_at` | `TEXT` | `TIMESTAMP` | |
| `reviewed_by` | `TEXT` | `VARCHAR(100)` | |
| `reviewed_at` | `TEXT` | `TIMESTAMP` | |

**Indexes & Constraints**:
- `UNIQUE (project_id, file_path)`
- `CREATE INDEX idx_images_project_status ON images(project_id, status)`
- `CREATE INDEX idx_images_project_locked ON images(project_id, locked_at)`

#### `system_settings`
Global system configuration key-value storage (maintenance mode, etc.).
| Column | SQLite Type | PostgreSQL Type | Constraints |
|---|---|---|---|
| `key` | `TEXT` | `VARCHAR(100)` | `PRIMARY KEY` |
| `value` | `TEXT` | `TEXT` | |

---

## 3. Query & Runtime Compatibility Adaptations

[`scripts/db.mjs`](file:///c:/Scripts/LS-Marker/scripts/db.mjs) translates queries dynamically to provide better-sqlite3 API compatibility:
- **Parameter Mapping**: Positional `?` markers are mapped to `$1, $2, ...`. Named parameter objects (`:projectId`, `:userId`) are mapped to positional `$1, $2, ...`.
- **Datetime Intervals**: SQLite `datetime('now', '-15 minutes')` is translated to `(CURRENT_TIMESTAMP - INTERVAL '15 minutes')`.
- **INSERT OR IGNORE**: SQLite `INSERT OR IGNORE INTO images` translates to `INSERT INTO images ... ON CONFLICT (project_id, file_path) DO NOTHING`.
- **Auto-Increment ID Resolution**: `run()` inserts on `projects`, `users`, and `images` automatically append `RETURNING id` to populate `lastInsertRowid`.
- **BigInt OID 20**: PostgreSQL `COUNT(*)` returns `int8` as string by default; parsed as integer number.
- **Timestamp OIDs 1114 / 1184**: Parsed directly to UTC ISO strings matching frontend formatting expectations.
- **Transactions**: `db.transaction(fn)` uses `AsyncLocalStorage` context to run statements within `BEGIN ... COMMIT` / `ROLLBACK` on a dedicated connection client.

---

## 4. How to Migrate Existing Data from SQLite to PostgreSQL

A migration script [`scripts/migrate-sqlite-to-pg.mjs`](file:///c:/Scripts/LS-Marker/scripts/migrate-sqlite-to-pg.mjs) is provided.

### Prerequisites
1. Ensure PostgreSQL is running.
2. Target database and user are created:
   ```sql
   CREATE USER ls_marker WITH PASSWORD 'admin';
   CREATE DATABASE ls_marker OWNER ls_marker;
   ```
3. Apply DDL schema:
   ```bash
   psql -U ls_marker -d ls_marker -f scripts/schema.sql
   ```

### Running the Data Migration
```bash
node scripts/migrate-sqlite-to-pg.mjs
```
The script reads `data/labels.db` and copies all records into PostgreSQL inside an atomic transaction, standardizing timestamps to UTC ISO strings and syncing Postgres sequence counters (`setval`).

---

## 5. Verification & Tests

Run the verification suites to confirm adapter and end-to-end API operations:
```bash
# 1. Test PostgreSQL adapter (named parameters, transactions, intervals, backups)
node scripts/test-pg-adapter.mjs

# 2. Test E2E API routes (projects, catalogue, photos, classes, claims, maintenance)
node scripts/test-api-e2e.mjs

# 3. TypeScript compiler check
npm run typecheck

# 4. Biome lint check
npm run lint
```

