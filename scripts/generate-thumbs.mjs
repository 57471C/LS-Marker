/**
 * Build local JPEG thumbs for images already registered in the database.
 *
 * Originals are read and never modified. Files are written only under
 * data/thumbs/{projectId}/, with the original relative name and a .jpg extension.
 * GET /api/thumb/:projectId/:filename generates a missing thumb on first request,
 * so this script is optional. Catalogue rescan does not pre-generate thumbs.
 *
 * Usage:
 *   node scripts/generate-thumbs.mjs
 *   node scripts/generate-thumbs.mjs --project 3
 */
import { getDb } from "./db.mjs";
import { ensureThumb } from "./labelling-api.mjs";

const root = process.cwd();
const projectArg = process.argv.indexOf("--project");
const onlyProject = projectArg >= 0 ? Number(process.argv[projectArg + 1]) : null;
if (projectArg >= 0 && (!Number.isInteger(onlyProject) || onlyProject <= 0)) {
  console.error("Usage: node scripts/generate-thumbs.mjs [--project id]");
  process.exit(1);
}

const db = await getDb(root);
try {
  const rows = onlyProject
    ? await db
        .prepare(
          "SELECT project_id, file_path FROM images WHERE project_id = ? AND status != 'missing'",
        )
        .all(onlyProject)
    : await db.prepare("SELECT project_id, file_path FROM images WHERE status != 'missing'").all();

  let ready = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await ensureThumb(row.project_id, row.file_path, { root, db });
      ready++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${row.project_id} ${row.file_path}: ${message}`);
    }
  }
  console.log(`thumbs ready ${ready}; failed ${failed}`);
  if (failed) process.exitCode = 1;
} finally {
  await db.close();
}
