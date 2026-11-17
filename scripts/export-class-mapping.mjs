import fs from "node:fs";
import path from "node:path";

export const DEFAULT_EXPORT_CLASS_MAPPING = {
  ic_overrides: {},
  ic_prefixes: {
    "2BBMN": "nut",
    "2BBN": "nut",
    "2BBW": "washer",
    "2BB": "bolt",
    "2VD": "label",
    WSH: "washer",
    NUT: "nut",
    BLT: "bolt",
    BOLT: "bolt",
  },
  description_patterns: [
    { pattern: "\\b(label|sticker)\\b", part_type: "label" },
    { pattern: "\\b(crush\\s*tube|spacer|washer)\\b", part_type: "washer" },
    { pattern: "\\bcable\\s*tie\\b", part_type: "cable_tie" },
    { pattern: "\\bspring\\b", part_type: "spring" },
    { pattern: "\\bnut\\b", part_type: "nut" },
    {
      pattern: "\\b(bolt|setscrew|set\\s*screw|cap\\s*screw|shcs|coach)\\b",
      part_type: "bolt",
    },
  ],
  part_type_aliases: {
    spacer: "washer",
    crush_tube: "washer",
    sticker: "label",
  },
  fallback: "other",
};

/**
 * Normalize a part type string using configured aliases.
 * @param {string | null | undefined} value
 * @param {Record<string, string>} aliases
 * @returns {string}
 */
function normalizePartTypeName(value, aliases) {
  const cleaned = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!cleaned || cleaned === "none") return "";
  return aliases[cleaned] ?? cleaned;
}

/**
 * Load export-class-mapping.json from the workspace root, merged with defaults.
 * Compiles prefix entries (sorted longest-first) and regex patterns once per load.
 * @param {string} [root]
 */
export function loadExportClassMapping(root = process.cwd()) {
  let raw = {};
  const configPath = path.join(root, "export-class-mapping.json");
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        raw = parsed;
      }
    } catch (err) {
      console.warn(
        `[export-class-mapping] Failed to parse ${configPath}, using defaults:`,
        err.message,
      );
    }
  }

  const aliases = {};
  const mergedAliases = {
    ...DEFAULT_EXPORT_CLASS_MAPPING.part_type_aliases,
    ...(raw.part_type_aliases && typeof raw.part_type_aliases === "object"
      ? raw.part_type_aliases
      : {}),
  };
  for (const [k, v] of Object.entries(mergedAliases)) {
    const key = String(k).trim().toLowerCase();
    const val = String(v).trim().toLowerCase();
    if (key && val) aliases[key] = val;
  }

  const overrides = new Map();
  const mergedOverrides = {
    ...DEFAULT_EXPORT_CLASS_MAPPING.ic_overrides,
    ...(raw.ic_overrides && typeof raw.ic_overrides === "object" ? raw.ic_overrides : {}),
  };
  for (const [k, v] of Object.entries(mergedOverrides)) {
    const key = String(k).trim().toUpperCase();
    const val = normalizePartTypeName(v, aliases);
    if (key && val) overrides.set(key, val);
  }

  const mergedPrefixes = {
    ...DEFAULT_EXPORT_CLASS_MAPPING.ic_prefixes,
    ...(raw.ic_prefixes && typeof raw.ic_prefixes === "object" ? raw.ic_prefixes : {}),
  };
  const prefixes = Object.entries(mergedPrefixes)
    .map(([prefix, partType]) => ({
      prefix: String(prefix).trim().toUpperCase(),
      part_type: normalizePartTypeName(partType, aliases),
    }))
    .filter((entry) => Boolean(entry.prefix) && Boolean(entry.part_type))
    .sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));

  const rawPatterns = Array.isArray(raw.description_patterns)
    ? raw.description_patterns
    : DEFAULT_EXPORT_CLASS_MAPPING.description_patterns;
  const descriptionPatterns = [];
  for (const entry of rawPatterns) {
    if (!entry || typeof entry !== "object") continue;
    const partType = normalizePartTypeName(entry.part_type, aliases);
    if (!entry.pattern || !partType) continue;
    try {
      descriptionPatterns.push({
        regex: new RegExp(String(entry.pattern), "i"),
        part_type: partType,
      });
    } catch (err) {
      console.warn(
        `[export-class-mapping] Invalid regex "${entry.pattern}", skipping:`,
        err.message,
      );
    }
  }

  const fallback =
    normalizePartTypeName(raw.fallback, aliases) || DEFAULT_EXPORT_CLASS_MAPPING.fallback;

  return {
    aliases,
    overrides,
    prefixes,
    descriptionPatterns,
    fallback,
  };
}

/**
 * Resolve a class row to its coarse export part type.
 * Resolution order:
 * 1. Explicit `ic_overrides` entry in export-class-mapping.json
 * 2. Database `part_type` (when set and not "none")
 * 3. `description_patterns` matched against `des`
 * 4. `ic_prefixes` (longest prefix first) matched against `ic`
 * 5. `fallback` (default: "other")
 *
 * @param {{ ic?: string | null, des?: string | null, part_type?: string | null }} cls
 * @param {ReturnType<typeof loadExportClassMapping>} [mapping]
 * @returns {string}
 */
export function resolveExportPartType(cls, mapping = loadExportClassMapping()) {
  const icUpper = String(cls?.ic ?? "")
    .trim()
    .toUpperCase();

  if (icUpper && mapping.overrides.has(icUpper)) {
    return mapping.overrides.get(icUpper);
  }

  const dbPartType = normalizePartTypeName(cls?.part_type, mapping.aliases);
  if (dbPartType) {
    return dbPartType;
  }

  const des = String(cls?.des ?? "").trim();
  if (des) {
    for (const rule of mapping.descriptionPatterns) {
      if (rule.regex.test(des)) {
        return rule.part_type;
      }
    }
  }

  if (icUpper) {
    for (const rule of mapping.prefixes) {
      if (icUpper.startsWith(rule.prefix)) {
        return rule.part_type;
      }
    }
  }

  return mapping.fallback;
}
