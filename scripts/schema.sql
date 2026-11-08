-- LS-Marker PostgreSQL Schema DDL
-- Generated for PostgreSQL 18+

-- Collation for case-insensitive text matching (COLLATE nocase)
CREATE COLLATION IF NOT EXISTS nocase (
    provider = icu,
    locale = 'und-u-ks-level2',
    deterministic = false
);

-- 1. Projects table
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 4. Admin Sessions table
CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);

-- 5. Classes table
CREATE TABLE IF NOT EXISTS classes (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    id INTEGER NOT NULL,
    ic TEXT NOT NULL,
    des TEXT NOT NULL,
    color TEXT,
    part_type TEXT DEFAULT NULL,
    thread TEXT DEFAULT NULL,
    length_mm DOUBLE PRECISION DEFAULT NULL,
    head_type TEXT DEFAULT NULL,
    af_mm DOUBLE PRECISION DEFAULT NULL,
    height_mm DOUBLE PRECISION DEFAULT NULL,
    od_mm DOUBLE PRECISION DEFAULT NULL,
    id_mm DOUBLE PRECISION DEFAULT NULL,
    thickness_mm DOUBLE PRECISION DEFAULT NULL,
    width_mm DOUBLE PRECISION DEFAULT NULL,
    note TEXT DEFAULT NULL,
    dimensions TEXT DEFAULT NULL,
    dim1_name TEXT DEFAULT NULL,
    dim1_mm DOUBLE PRECISION DEFAULT NULL,
    dim2_name TEXT DEFAULT NULL,
    dim2_mm DOUBLE PRECISION DEFAULT NULL,
    dim3_name TEXT DEFAULT NULL,
    dim3_mm DOUBLE PRECISION DEFAULT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT uq_classes_project_ic UNIQUE (project_id, ic)
);

-- 6. Image Claims table
CREATE TABLE IF NOT EXISTS image_claims (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL,
    claimed_by TEXT,
    claimed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'open',
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (project_id, rel_path)
);

-- 7. Images table
CREATE TABLE IF NOT EXISTS images (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL DEFAULT 1 REFERENCES projects(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'unlabeled',
    locked_by TEXT DEFAULT NULL,
    locked_at TIMESTAMPTZ DEFAULT NULL,
    completed_at TIMESTAMPTZ DEFAULT NULL,
    reviewed_by TEXT DEFAULT NULL,
    reviewed_at TIMESTAMPTZ DEFAULT NULL,
    owner TEXT DEFAULT NULL,
    CONSTRAINT uq_images_project_file_path UNIQUE (project_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_images_project_status ON images (project_id, status);
CREATE INDEX IF NOT EXISTS idx_images_project_locked ON images (project_id, locked_by);

-- 8. System Settings table
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

