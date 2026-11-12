import path from "node:path";
import { getDb } from "./db.mjs";
import { formatCanonicalDimensions } from "./labelling-api.mjs";

/**
 * Infer bolt head type from description or text.
 * @param {string} text
 * @returns {string}
 */
export function inferHeadType(text) {
  const s = String(text || "").toLowerCase();
  if (s.includes("countersunk") || s.includes("csk")) return "Countersunk";
  if (s.includes("button") || s.includes("butthd")) return "Button";
  if (
    s.includes("socket") ||
    s.includes("allen") ||
    s.includes("cap screw") ||
    s.includes("shcs") ||
    s.includes("capsrw") ||
    s.includes("cap srw")
  )
    return "Socket";
  if (s.includes("flange")) return "Flange";
  if (s.includes("pan")) return "Pan";
  if (s.includes("hex") || s.includes("setscrew") || s.includes("set screw") || s.includes("coach"))
    return "Hex";
  return "Hex";
}

/**
 * Extract thread identifier (e.g. "M6", "M8", "3/8 UNC", "1/4 UNC") from a string.
 * @param {string} text
 * @returns {string | null}
 */
export function extractThread(text) {
  if (!text) return null;
  const m = String(text).match(/\bM([0-9]+(?:\.[0-9]+)?)\b/i);
  if (m) return `M${m[1]}`;
  const imp = String(text).match(/\b([0-9]+\/[0-9]+(?:")?\s*(?:UNC|UNF|BSW|BSF)?)\b/i);
  if (imp) return imp[1].replace(/"/g, "").trim();
  return null;
}

/**
 * Parse legacy free-text or existing class row dimensions into structured metrology.
 * Returns:
 * - null if row has no dimensions/text
 * - { status: "ambiguous", originalText: string }
 * - { status: "parsed", structured: object, canonicalText: string }
 *
 * @param {string | null | undefined} rawText
 * @param {Record<string, any>} row
 */
export function parseLegacyDimensions(rawText, row = {}) {
  const text = (rawText || "").trim();
  const ic = String(row.ic || "");
  const des = String(row.des || "");
  let pt = row.part_type ? String(row.part_type).trim().toLowerCase() : null;

  // Infer part_type if 'other' or missing, based on des / ic keywords
  const combined = `${des} ${ic}`.toLowerCase();
  if (!pt || pt === "none" || pt === "other") {
    if (/\blabel\b|\bsticker\b/i.test(combined)) {
      pt = "label";
    } else if (/\bcrush\s*tube\b|\bspacer\b|\bwasher\b/i.test(combined)) {
      pt = "washer";
    } else if (/\bcable\s*tie\b/i.test(combined)) {
      pt = "cable_tie";
    } else if (/\bspring\b/i.test(combined)) {
      pt = "spring";
    } else if (/\bnut\b/i.test(combined)) {
      pt = "nut";
    } else if (/\bbolt\b|\bsetscrew\b|\bset\s*screw\b/i.test(combined)) {
      pt = "bolt";
    }
  }

  // 1. If structured fields are already filled, regenerate canonical text
  if (row.thread || row.length_mm != null || row.od_mm != null || row.width_mm != null) {
    const structured = {
      part_type: pt || (row.thread ? "bolt" : row.od_mm ? "washer" : row.width_mm ? "label" : null),
      thread: row.thread || null,
      length_mm: row.length_mm != null ? Number(row.length_mm) : null,
      head_type: row.head_type || null,
      af_mm: row.af_mm != null ? Number(row.af_mm) : null,
      height_mm: row.height_mm != null ? Number(row.height_mm) : null,
      od_mm: row.od_mm != null ? Number(row.od_mm) : null,
      id_mm: row.id_mm != null ? Number(row.id_mm) : null,
      thickness_mm: row.thickness_mm != null ? Number(row.thickness_mm) : null,
      width_mm: row.width_mm != null ? Number(row.width_mm) : null,
      note: row.note || null,
    };
    const canonical = formatCanonicalDimensions(structured);
    return {
      status: "parsed",
      structured,
      canonicalText: canonical || text,
    };
  }

  // If no text and no dims at all, return null
  if (!text && row.dim1_mm == null && row.dim2_mm == null && row.dim3_mm == null) {
    return null;
  }

  const effectiveText = text || "";

  // Helper to extract named dims from row
  const getDim = (...names) => {
    const lowerNames = names.map((n) => n.toLowerCase());
    for (const idx of [1, 2, 3]) {
      const dName = String(row[`dim${idx}_name`] || "")
        .trim()
        .toLowerCase();
      const dVal = row[`dim${idx}_mm`];
      if (dVal != null && lowerNames.includes(dName)) {
        return Number(dVal);
      }
    }
    return null;
  };

  // 2. Bolt patterns:
  // e.g. "Bolt: 16 × 6 mm", "Bolt: 16 x 6 mm", "Bolt: 16*6mm" (stored as L x dia)
  if (pt === "bolt" || effectiveText.match(/^Bolt:/i)) {
    const boltMatch = effectiveText.match(/^Bolt:\s*([0-9.]+)\s*[×xX*]\s*([0-9.]+)\s*mm/i);
    const mThreadLenMatch = effectiveText.match(
      /\bM([0-9]+(?:\.[0-9]+)?)\s*[×xX*]\s*([0-9.]+)(?:\s*mm)?(?:\s+([A-Za-z]+))?/i,
    );

    let len = null;
    let dia = null;
    let thread = null;
    let head = null;

    if (boltMatch) {
      len = Number(boltMatch[1]);
      dia = Number(boltMatch[2]);
      thread = `M${dia}`;
      head = inferHeadType(`${des} ${ic} ${effectiveText}`);
    } else if (mThreadLenMatch) {
      thread = `M${mThreadLenMatch[1]}`;
      len = Number(mThreadLenMatch[2]);
      head = mThreadLenMatch[3] ? inferHeadType(mThreadLenMatch[3]) : inferHeadType(`${des} ${ic}`);
    } else if (row.dim1_mm != null) {
      len = Number(row.dim1_mm);
      dia = row.dim2_mm != null ? Number(row.dim2_mm) : null;
      thread = extractThread(des) || extractThread(ic) || (dia ? `M${dia}` : null);
      head = inferHeadType(`${des} ${ic}`);
    }

    if (thread && len != null) {
      const structured = {
        part_type: "bolt",
        thread,
        length_mm: len,
        head_type: head || "Hex",
        af_mm: null,
        height_mm: null,
        od_mm: null,
        id_mm: null,
        thickness_mm: null,
        width_mm: null,
        note: null,
      };
      return {
        status: "parsed",
        structured,
        canonicalText: formatCanonicalDimensions(structured),
      };
    }
    return {
      status: "ambiguous",
      originalText: effectiveText || `${des} (${row.dim1_mm || ""})`,
    };
  }

  // 3. Nut patterns:
  // e.g. "Nut: M8, AF: 13mm" or "Nut: 13 × 6.5 mm" (requires thread in des/ic)
  if (
    pt === "nut" ||
    effectiveText.toLowerCase().startsWith("nut:") ||
    des.toLowerCase().includes("nut")
  ) {
    const nutAfHeightMatch = effectiveText.match(
      /(?:Nut:\s*)?(?:(M[0-9]+|[0-9]+\/[0-9]+(?:\s*UNC)?)[,\s]+)?(?:AF:?\s*)?([0-9.]+)(?:\s*[×xX*]\s*([0-9.]+))?\s*mm?/i,
    );
    const thread = nutAfHeightMatch?.[1] || extractThread(des) || extractThread(ic);
    const af = nutAfHeightMatch?.[2]
      ? Number(nutAfHeightMatch[2])
      : row.dim1_mm != null
        ? Number(row.dim1_mm)
        : null;
    const h = nutAfHeightMatch?.[3]
      ? Number(nutAfHeightMatch[3])
      : row.dim2_mm != null
        ? Number(row.dim2_mm)
        : null;

    if (thread && af != null) {
      const structured = {
        part_type: "nut",
        thread,
        length_mm: null,
        head_type: null,
        af_mm: af,
        height_mm: h,
        od_mm: null,
        id_mm: null,
        thickness_mm: null,
        width_mm: null,
        note: null,
      };
      return {
        status: "parsed",
        structured,
        canonicalText: formatCanonicalDimensions(structured),
      };
    }
    // Missing thread -> AMBIGUOUS!
    return {
      status: "ambiguous",
      originalText: effectiveText || `Nut: ${row.dim1_mm || ""} mm`,
    };
  }

  // 4. Label / Sticker patterns:
  if (pt === "label" || effectiveText.toLowerCase().startsWith("label:")) {
    const labelLhMatch = effectiveText.match(
      /(?:L|W|Width):\s*([0-9.]+)\s*mm?,\s*(?:H|Height):\s*([0-9.]+)\s*mm?/i,
    );
    const labelPrefixMatch = effectiveText.match(/^Label:\s*([0-9.]+)\s*[×xX*]\s*([0-9.]+)\s*mm/i);

    let w = null;
    let h = null;

    if (labelLhMatch) {
      w = Number(labelLhMatch[1]);
      h = Number(labelLhMatch[2]);
    } else if (labelPrefixMatch) {
      w = Number(labelPrefixMatch[1]);
      h = Number(labelPrefixMatch[2]);
    } else if (row.dim1_mm != null && row.dim2_mm != null) {
      const dimL = getDim("l", "length", "w", "width");
      const dimH = getDim("h", "height");
      if (dimL != null && dimH != null) {
        w = dimL;
        h = dimH;
      } else {
        w = Number(row.dim1_mm);
        h = Number(row.dim2_mm);
      }
    }

    if (w != null && h != null) {
      const structured = {
        part_type: "label",
        thread: null,
        length_mm: null,
        head_type: null,
        af_mm: null,
        height_mm: h,
        od_mm: null,
        id_mm: null,
        thickness_mm: null,
        width_mm: w,
        note: null,
      };
      return {
        status: "parsed",
        structured,
        canonicalText: formatCanonicalDimensions(structured),
      };
    }
    return {
      status: "ambiguous",
      originalText: effectiveText || `Label: ${row.dim1_mm || ""}x${row.dim2_mm || ""} mm`,
    };
  }

  // 5. Washer / Spacer / Crush tube:
  if (pt === "washer") {
    const washerMatch = effectiveText.match(
      /(?:Washer:\s*)?([0-9.]+)\s*[×xX*]\s*([0-9.]+)\s*[×xX*]\s*([0-9.]+)\s*mm?/i,
    );
    let od = getDim("od", "outer diameter", "diameter");
    let id = getDim("id", "inner diameter");
    let thk = getDim("thickness", "thk", "l", "length", "h", "height");

    // Check if dims were named w and h (e.g. Crush Tube with w=18.8, h=61)
    if (od == null && getDim("w") != null) {
      od = getDim("w");
    }

    if (washerMatch) {
      od = Number(washerMatch[1]);
      id = Number(washerMatch[2]);
      thk = Number(washerMatch[3]);
    } else if (od == null && row.dim1_mm != null) {
      od = Number(row.dim1_mm);
      id = row.dim2_mm != null ? Number(row.dim2_mm) : null;
      thk = row.dim3_mm != null ? Number(row.dim3_mm) : null;
    }

    if (od != null && (id != null || thk != null)) {
      const structured = {
        part_type: "washer",
        thread: null,
        length_mm: null,
        head_type: null,
        af_mm: null,
        height_mm: null,
        od_mm: od,
        id_mm: id,
        thickness_mm: thk,
        width_mm: null,
        note: null,
      };
      return {
        status: "parsed",
        structured,
        canonicalText: formatCanonicalDimensions(structured),
      };
    }
    return {
      status: "ambiguous",
      originalText: effectiveText || `Washer: ${row.dim1_mm || ""}`,
    };
  }

  // 6. Cable tie:
  if (pt === "cable_tie") {
    const cableTieMatch = effectiveText.match(/^Cable tie:\s*([0-9.]+)\s*[×xX*]\s*([0-9.]+)\s*mm/i);
    let len = getDim("length", "l");
    let w = getDim("width", "w");

    if (cableTieMatch) {
      len = Number(cableTieMatch[1]);
      w = Number(cableTieMatch[2]);
    } else if (len == null && row.dim1_mm != null) {
      len = Number(row.dim1_mm);
      w = row.dim2_mm != null ? Number(row.dim2_mm) : null;
    }

    if (len != null && w != null) {
      const structured = {
        part_type: "cable_tie",
        thread: null,
        length_mm: len,
        head_type: null,
        af_mm: null,
        height_mm: null,
        od_mm: null,
        id_mm: null,
        thickness_mm: null,
        width_mm: w,
        note: null,
      };
      return {
        status: "parsed",
        structured,
        canonicalText: formatCanonicalDimensions(structured),
      };
    }
  }

  // 7. Spring:
  if (pt === "spring") {
    const springMatch = effectiveText.match(/^Spring:\s*([0-9.]+)\s*[×xX*]\s*([0-9.]+)\s*mm/i);
    let h = getDim("height", "h", "length", "l");
    let d = getDim("diameter", "od", "d");

    if (springMatch) {
      h = Number(springMatch[1]);
      d = Number(springMatch[2]);
    } else if (h == null && row.dim1_mm != null) {
      h = Number(row.dim1_mm);
      d = row.dim2_mm != null ? Number(row.dim2_mm) : null;
    }

    if (h != null && d != null) {
      const structured = {
        part_type: "spring",
        thread: null,
        length_mm: h,
        head_type: null,
        af_mm: null,
        height_mm: null,
        od_mm: d,
        id_mm: null,
        thickness_mm: null,
        width_mm: null,
        note: null,
      };
      return {
        status: "parsed",
        structured,
        canonicalText: formatCanonicalDimensions(structured),
      };
    }
  }

  // 8. Other:
  if (pt === "other" && (row.dim1_mm != null || effectiveText)) {
    const w = getDim("w", "width");
    const h = getDim("h", "height");
    const od = getDim("od", "diameter");
    const l = getDim("l", "length");

    if (w != null && h != null) {
      const structured = {
        part_type: "other",
        thread: null,
        length_mm: null,
        head_type: null,
        af_mm: null,
        height_mm: h,
        od_mm: null,
        id_mm: null,
        thickness_mm: null,
        width_mm: w,
        note: row.dim3_name ? `${row.dim3_name}: ${row.dim3_mm}` : null,
      };
      return {
        status: "parsed",
        structured,
        canonicalText: formatCanonicalDimensions(structured),
      };
    }

    if (w != null && l != null) {
      const structured = {
        part_type: "other",
        thread: null,
        length_mm: l,
        head_type: null,
        af_mm: null,
        height_mm: null,
        od_mm: null,
        id_mm: null,
        thickness_mm: null,
        width_mm: w,
        note: row.dim3_name ? `${row.dim3_name}: ${row.dim3_mm}` : null,
      };
      return {
        status: "parsed",
        structured,
        canonicalText: `${w}x${l}mm`,
      };
    }

    if (od != null && (l != null || h != null)) {
      const structured = {
        part_type: "other",
        thread: null,
        length_mm: l != null ? l : h,
        head_type: null,
        af_mm: null,
        height_mm: null,
        od_mm: od,
        id_mm: null,
        thickness_mm: null,
        width_mm: null,
        note: row.dim3_name ? `${row.dim3_name}: ${row.dim3_mm}` : null,
      };
      return {
        status: "parsed",
        structured,
        canonicalText: formatCanonicalDimensions(structured),
      };
    }
  }

  // 9. If there was text but it didn't match any clear pattern -> AMBIGUOUS
  if (effectiveText) {
    return {
      status: "ambiguous",
      originalText: effectiveText,
    };
  }

  return null;
}

/**
 * Run migration on a database connection (Postgres adapter).
 * @param {any} db
 * @param {string} dbName
 * @param {boolean} dryRun
 */
export async function migrateDatabaseDimensions(db, dbName = "database", dryRun = false) {
  console.log(`\n=== Running Dimensions Migration on [${dbName}] (dryRun=${dryRun}) ===`);
  const rows = await db
    .prepare(
      `SELECT project_id, id, ic, des, part_type,
              thread, length_mm, head_type, af_mm, height_mm,
              od_mm, id_mm, thickness_mm, width_mm, note, dimensions,
              dim1_name, dim1_mm, dim2_name, dim2_mm, dim3_name, dim3_mm
       FROM classes ORDER BY project_id, id`,
    )
    .all();

  console.log(`Found ${rows.length} class rows.`);
  let migratedCount = 0;
  let ambiguousCount = 0;
  let unsetCount = 0;

  const updateStmt = db.prepare(
    `UPDATE classes
     SET part_type = ?, thread = ?, length_mm = ?, head_type = ?,
         af_mm = ?, height_mm = ?, od_mm = ?, id_mm = ?,
         thickness_mm = ?, width_mm = ?, note = ?, dimensions = ?
     WHERE project_id = ? AND id = ?`,
  );

  for (const row of rows) {
    const rawText = row.dimensions;
    const result = parseLegacyDimensions(rawText, row);

    if (!result) {
      unsetCount++;
      continue;
    }

    if (result.status === "parsed") {
      migratedCount++;
      console.log(
        `✓ [MIGRATED] Project ${row.project_id} #${row.id} (${row.ic}): "${rawText || ""}" -> "${result.canonicalText}"`,
      );
      if (!dryRun) {
        const s = result.structured;
        await updateStmt.run(
          s.part_type,
          s.thread,
          s.length_mm,
          s.head_type,
          s.af_mm,
          s.height_mm,
          s.od_mm,
          s.id_mm,
          s.thickness_mm,
          s.width_mm,
          s.note,
          result.canonicalText,
          row.project_id,
          row.id,
        );
      }
    } else if (result.status === "ambiguous") {
      ambiguousCount++;
      console.log(
        `? [AMBIGUOUS] Project ${row.project_id} #${row.id} (${row.ic}): Kept original text "${result.originalText}"`,
      );
      if (!dryRun && row.dimensions !== result.originalText) {
        // Preserve original text in dimensions column while leaving structured columns blank
        await updateStmt.run(
          row.part_type,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          result.originalText,
          row.project_id,
          row.id,
        );
      }
    }
  }

  console.log(`\nMigration Summary for [${dbName}]:`);
  console.log(`- Total scanned: ${rows.length}`);
  console.log(`- Migrated to structured metrology: ${migratedCount}`);
  console.log(`- Ambiguous (original text kept for staff review): ${ambiguousCount}`);
  console.log(`- Unset (no dimensions): ${unsetCount}\n`);

  return { total: rows.length, migratedCount, ambiguousCount, unsetCount };
}

// CLI execution
const isCli =
  process.argv[1] &&
  (import.meta.url.endsWith(path.basename(process.argv[1])) ||
    import.meta.url.toLowerCase() ===
      new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href.toLowerCase());

if (isCli) {
  const isDryRun = process.argv.includes("--dry-run");
  const root = process.cwd();

  // Migrate Postgres database if accessible
  try {
    const pgDb = await getDb(root);
    await migrateDatabaseDimensions(pgDb, "PostgreSQL", isDryRun);
  } catch (err) {
    console.error("[warning] PostgreSQL migration error:", err.message);
  }

  process.exit(0);
}
