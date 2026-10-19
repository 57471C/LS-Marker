# AGENTS.md — Guardrails & Engineering Standards for LS-Marker

> **MISSION-CRITICAL PRODUCTION ALERT:**  
> LS-Marker is deployed in active production with paid annotators working in real-time. Unplanned downtime, schema corruption, or accidental data pruning causes immediate operational loss. Every AI agent, assistant, or automated tool operating on this codebase must adhere strictly to these rules.

---

## 1. Zero Data-Loss Guarantee (Non-Negotiable)

* **Never Delete Completed Annotations:** Under no circumstances should rows with `status = 'completed'` or `status = 'approved'` be deleted from SQLite during sync, rescan, or cleanup routines.
* **Mark 'Missing', Never Drop:** If an image file is temporarily missing from disk during a rescan, set `status = 'missing'`. Keep all bounding boxes, review timestamps, and user associations intact.
* **Circuit Breaker on File Scans:** If a folder scan returns 0 files while the database records >0 files for that project, **abort immediately** with an error. Never prune database records during a scan, as the external drive or network share may be unmounted.
* **No Table Drops or Re-creations:** Never use `DROP TABLE` or recreate tables in production scripts. All schema changes must be strictly additive (`ALTER TABLE ADD COLUMN`).

---

## 2. Windows vs. POSIX Path Normalization

LS-Marker runs on Windows environments where directory separators clash with POSIX standards.

* **Strict Path Normalization:** Every path read from disk, passed via an API, or queried from the database must be normalized before comparison or persistence:
  ```javascript
  const normalizePath = (p) => path.normalize(p).replace(/\\/g, '/');
  ```
* **No Direct String Equality on Raw Paths:** Never execute `db_path === disk_path` without normalizing both paths first. A failure here causes the app to treat all existing photos as missing and re-import duplicates.

---

## 3. Database & Concurrency Rules (SQLite / better-sqlite3)

* **Maintain Atomic Checkouts:** Image reservations use an atomic `UPDATE ... RETURNING *` pattern with a 15-minute lease timeout (`locked_at < datetime('now', '-15 minutes')`). Never revert this to client-side index navigation or non-atomic reads.
* **Transaction Wrapping:** Any multi-step synchronization, batch import, or bulk status update must run inside a `db.transaction(...)` block.
* **Keep WAL Mode Intact:** Do not modify SQLite PRAGMAs away from `journal_mode = WAL` and `synchronous = NORMAL`.

---

## 4. Class ID & Export Stability

Object detection models (YOLO, RT-DETR) pair integer class IDs ($0, 1, 2\dots$) directly with pre-trained neural network weights.

* **Permanent Class Indices:** Numeric class IDs must be permanently anchored to the kit/database primary key (`max(id) + 1`).
* **Never Dynamically Sort Classes on Export:** Never use dynamic queries like `SELECT DISTINCT class_name ORDER BY class_name ASC` to assign export indices. Adding a new IC code in a future kit must never shift the numeric IDs of existing classes.
* **Export Parity:** The class-to-ID mapping across `data.yaml` (YOLO), `instances_*.json` (COCO), and `export_manifest.json` must be identical.

---

## 5. Dependency & Refactor Boundaries

* **No Unsolicited Major Version Bumps:** Do not upgrade libraries across major versions (e.g., do not upgrade `recharts` to v3+, do not alter `better-sqlite3` build tools) unless explicitly requested.
* **Streaming Over Buffering:** Never buffer entire datasets, multi-megabyte image arrays, or full ZIP archives into Node V8 memory. Keep TAR exports streamed and image dimension reads limited to 64 KB header buffers.
* **Expose Verification Tests:** Any new backend feature or data sync change must include a standalone verification script in `scripts/` (e.g., `scripts/verify-*.mjs`).

---

## 6. Pre-Commit Checklist for Agents

Before completing any task or reporting code as ready, the agent must verify:
1. `npm run typecheck` (`tsc --noEmit`) passes with **0 errors**.
2. `npm run lint` (`biome check .` or ESLint) passes with **0 errors**.
3. All file and image comparisons use normalized forward-slash paths.
4. No existing database columns, tables, or completed records were removed or destructively altered.