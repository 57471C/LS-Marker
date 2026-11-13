import {
  BarChart3,
  Check,
  FileUp,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { AppHeader } from "@/components/app-header";
import { DatasetHealthModal } from "@/components/dataset-health-modal";
import { DuplicateCleanupModal } from "@/components/duplicate-cleanup-modal";
import { classFill } from "@/lib/class-color";
import {
  applyRowClick,
  clampMenuPosition,
  copyPlainText,
  emptyClassSelection,
  icCodesForSelection,
  selectionForContextMenu,
  singleClassSelection,
  type ClassSelection,
} from "@/lib/class-selection";
import { buildClassSearch, filterClassSearch, mergeClassRow } from "@/lib/class-list";
import { ColumnResizeHandle, useColumnResize } from "@/lib/use-column-resize";
import {
  createClass,
  deleteClass,
  fetchClasses,
  fetchPartTypes,
  fetchProjectHealth,
  importClasses,
  updateClass,
  type ClassRow,
  type DuplicateDetectionResult,
  type PartType,
  type PartTypeDefinition,
  type ProjectHealthResult,
} from "@/lib/label-client";

export const PART_TYPE_OPTIONS: { value: PartType; label: string }[] = [
  { value: "none", label: "None (unset)" },
  { value: "bolt", label: "Bolt" },
  { value: "nut", label: "Nut" },
  { value: "washer", label: "Washer / Spacer / Crush tube" },
  { value: "label", label: "Label / Sticker" },
  { value: "cable_tie", label: "Cable tie" },
  { value: "spring", label: "Spring" },
  { value: "other", label: "Other" },
];

type ClassCol = "id" | "color" | "code" | "des" | "dims" | "status";

const CLASS_COLUMNS: Record<ClassCol, { default: number; min: number; max?: number }> = {
  id: { default: 52, min: 36, max: 120 },
  color: { default: 42, min: 30, max: 100 },
  code: { default: 130, min: 70, max: 400 },
  des: { default: 280, min: 100, max: 900 },
  dims: { default: 180, min: 90, max: 500 },
  status: { default: 80, min: 60, max: 200 },
};

export function formatPartSummary(row: ClassRow): string | null {
  const pt = row.part_type;
  if (!pt || pt === "none") return null;

  const hasNum = (v: number | null | undefined) =>
    v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0;
  const hasStr = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

  if (pt === "bolt") {
    if (hasStr(row.thread) && hasNum(row.length_mm)) {
      let s = `${row.thread?.trim()}x${row.length_mm}`;
      if (hasStr(row.head_type)) s += ` ${row.head_type?.trim()}`;
      if (hasNum(row.af_mm)) s += ` (AF: ${row.af_mm}mm)`;
      return s;
    }
  }

  if (pt === "nut") {
    if (hasStr(row.thread) && hasNum(row.af_mm)) {
      let s = `${row.thread?.trim()}, AF: ${row.af_mm}mm`;
      if (hasNum(row.height_mm)) s += `, H: ${row.height_mm}mm`;
      return s;
    }
  }

  if (pt === "washer") {
    if (hasNum(row.od_mm) && hasNum(row.id_mm) && hasNum(row.thickness_mm)) {
      return `${row.od_mm} × ${row.id_mm} × ${row.thickness_mm} mm`;
    }
  }

  if (pt === "label") {
    if (hasNum(row.width_mm) && hasNum(row.height_mm)) {
      return `${row.width_mm}x${row.height_mm}mm`;
    }
  }

  if (pt === "cable_tie") {
    if (hasNum(row.length_mm) && hasNum(row.width_mm)) {
      return `${row.length_mm}x${row.width_mm}mm`;
    }
  }

  if (pt === "spring" || pt === "other") {
    let s = "";
    if (hasNum(row.od_mm) && hasNum(row.length_mm)) {
      s = `OD: ${row.od_mm}mm, L: ${row.length_mm}mm`;
    } else if (hasNum(row.width_mm) && hasNum(row.height_mm)) {
      s = `${row.width_mm}x${row.height_mm}mm`;
    }
    if (hasStr(row.note)) {
      s = s ? `${s} (${row.note?.trim()})` : (row.note?.trim() ?? "");
    }
    if (s) return s;
  }

  // Fallback to row.dimensions (e.g. unmigrated / ambiguous free text)
  if (hasStr(row.dimensions)) return row.dimensions?.trim() ?? null;

  // Legacy fallback
  const vals: string[] = [];
  if (row.dim1_mm != null) vals.push(`${row.dim1_mm}`);
  if (row.dim2_mm != null) vals.push(`${row.dim2_mm}`);
  if (row.dim3_mm != null) vals.push(`${row.dim3_mm}`);
  if (vals.length > 0) return `${pt}: ${vals.join(" × ")} mm`;

  const label = PART_TYPE_OPTIONS.find((o) => o.value === pt)?.label ?? pt;
  return `${label} (no dims)`;
}

export function hasCompleteMeasurements(
  row: ClassRow,
  partTypeDef?: PartTypeDefinition | null,
): boolean {
  const pt = row.part_type;
  if (!pt || pt === "none") return false;
  const hasNum = (v: number | null | undefined) =>
    v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0;
  const hasStr = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

  if (partTypeDef && Array.isArray(partTypeDef.required_fields)) {
    if (partTypeDef.required_fields.length > 0) {
      for (const field of partTypeDef.required_fields) {
        const val = (row as Record<string, unknown>)[field];
        if (field.endsWith("_mm")) {
          if (!hasNum(val as number)) return false;
        } else {
          if (!hasStr(val as string)) return false;
        }
      }
      return true;
    }
    const fields = partTypeDef.fields || [];
    const anyFilled = fields.some((f) => {
      const val = (row as Record<string, unknown>)[f];
      return f.endsWith("_mm") ? hasNum(val as number) : hasStr(val as string);
    });
    return anyFilled;
  }

  if (pt === "bolt") {
    if (hasStr(row.thread) && hasNum(row.length_mm) && hasStr(row.head_type)) return true;
    return hasNum(row.dim1_mm) && hasNum(row.dim2_mm);
  }
  if (pt === "nut") {
    if (hasStr(row.thread) && hasNum(row.af_mm)) return true;
    return hasNum(row.dim1_mm) && hasNum(row.dim2_mm);
  }
  if (pt === "washer") {
    if (hasNum(row.od_mm) && hasNum(row.id_mm) && hasNum(row.thickness_mm)) return true;
    return hasNum(row.dim1_mm) && hasNum(row.dim2_mm) && hasNum(row.dim3_mm);
  }
  if (pt === "label") {
    if (hasNum(row.width_mm) && hasNum(row.height_mm)) return true;
    return hasNum(row.dim1_mm) && hasNum(row.dim2_mm);
  }
  if (pt === "cable_tie") {
    if (hasNum(row.length_mm) && hasNum(row.width_mm)) return true;
    return hasNum(row.dim1_mm) && hasNum(row.dim2_mm);
  }
  if (pt === "spring") {
    if (hasNum(row.od_mm) && hasNum(row.length_mm)) return true;
    if (hasNum(row.width_mm) && hasNum(row.height_mm)) return true;
    return hasNum(row.dim1_mm) && hasNum(row.dim2_mm);
  }
  if (pt === "other") {
    if (hasNum(row.od_mm) && hasNum(row.length_mm)) return true;
    if (hasNum(row.width_mm) && hasNum(row.height_mm)) return true;
    const pairs: [boolean, boolean][] = [
      [hasStr(row.dim1_name), hasNum(row.dim1_mm)],
      [hasStr(row.dim2_name), hasNum(row.dim2_mm)],
      [hasStr(row.dim3_name), hasNum(row.dim3_mm)],
    ];
    const anyFilled = pairs.some(([n, m]) => n && m) || hasNum(row.dim1_mm);
    const anyPartial = pairs.some(([n, m]) => n && !m);
    return anyFilled && !anyPartial;
  }
  return false;
}

export function PartMeasurementPopover({
  partType,
  onClose,
}: {
  partType: PartType;
  onClose: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Part measurement guide"
      className="relative flex flex-col gap-1.5 rounded-[2px] border border-[#c8c8c8] bg-white p-2.5 shadow-none text-xs"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-[#282828]">
          Measurement Guide: {PART_TYPE_OPTIONS.find((o) => o.value === partType)?.label}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="size-4 inline-flex items-center justify-center rounded-[2px] text-[#707070] hover:text-[#282828]"
          aria-label="Close measurement diagram"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      </div>

      {partType === "bolt" && (
        <div className="flex flex-col gap-1.5">
          <svg
            viewBox="0 0 340 120"
            className="h-24 w-full rounded-[2px] bg-[#f5f5f5] p-1 text-[#282828]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            {/* Bolt Head */}
            <rect
              x="30"
              y="28"
              width="32"
              height="54"
              rx="1"
              fill="currentColor"
              fillOpacity="0.08"
            />
            <line x1="30" y1="42" x2="62" y2="42" strokeOpacity="0.5" />
            <line x1="30" y1="68" x2="62" y2="68" strokeOpacity="0.5" />
            {/* Bolt Shank + Threads */}
            <rect x="62" y="42" width="178" height="26" fill="currentColor" fillOpacity="0.05" />
            <line x1="150" y1="42" x2="150" y2="68" strokeDasharray="2 2" />
            <line x1="165" y1="42" x2="165" y2="68" strokeOpacity="0.4" />
            <line x1="180" y1="42" x2="180" y2="68" strokeOpacity="0.4" />
            <line x1="195" y1="42" x2="195" y2="68" strokeOpacity="0.4" />
            <line x1="210" y1="42" x2="210" y2="68" strokeOpacity="0.4" />
            <line x1="225" y1="42" x2="225" y2="68" strokeOpacity="0.4" />

            {/* Length under head callout */}
            <line x1="62" y1="82" x2="62" y2="106" stroke="#1473e6" strokeWidth="1.2" />
            <line x1="240" y1="68" x2="240" y2="106" stroke="#1473e6" strokeWidth="1.2" />
            <line x1="64" y1="98" x2="238" y2="98" stroke="#1473e6" strokeWidth="1.5" />
            <polygon points="62,98 70,94 70,102" fill="#1473e6" stroke="none" />
            <polygon points="240,98 232,94 232,102" fill="#1473e6" stroke="none" />
            <text
              x="151"
              y="113"
              textAnchor="middle"
              fill="#1473e6"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Length under head (mm)
            </text>

            {/* Thread diameter callout */}
            <line x1="240" y1="42" x2="275" y2="42" stroke="#d97706" strokeWidth="1.2" />
            <line x1="240" y1="68" x2="275" y2="68" stroke="#d97706" strokeWidth="1.2" />
            <line x1="266" y1="44" x2="266" y2="66" stroke="#d97706" strokeWidth="1.5" />
            <polygon points="266,42 262,49 270,49" fill="#d97706" stroke="none" />
            <polygon points="266,68 262,61 270,61" fill="#d97706" stroke="none" />
            <text x="274" y="58" fill="#d97706" fontSize="10" fontFamily="monospace" stroke="none">
              Thread Ø
            </text>
          </svg>
          <p className="text-[10px] leading-snug text-[#6e6e6e]">
            <strong className="text-[#282828]">Length under head</strong> = underside of head to tip
            (exclude head height). <strong className="text-[#282828]">Thread diameter</strong> =
            outer diameter across threads (e.g. 8 mm for M8).
          </p>
        </div>
      )}

      {partType === "nut" && (
        <div className="flex flex-col gap-1.5">
          <svg
            viewBox="0 0 340 120"
            className="h-24 w-full rounded-[2px] bg-[#f5f5f5] p-1 text-[#282828]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <polygon
              points="75,24 115,24 132,54 115,84 75,84 58,54"
              fill="currentColor"
              fillOpacity="0.08"
            />
            <circle cx="95" cy="54" r="14" />
            <line x1="115" y1="24" x2="155" y2="24" stroke="#1473e6" strokeWidth="1.2" />
            <line x1="115" y1="84" x2="155" y2="84" stroke="#1473e6" strokeWidth="1.2" />
            <line x1="146" y1="26" x2="146" y2="82" stroke="#1473e6" strokeWidth="1.5" />
            <polygon points="146,24 142,31 150,31" fill="#1473e6" stroke="none" />
            <polygon points="146,84 142,77 150,77" fill="#1473e6" stroke="none" />
            <text
              x="95"
              y="106"
              textAnchor="middle"
              fill="#1473e6"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Across flats A/F (mm)
            </text>
            <rect
              x="215"
              y="24"
              width="34"
              height="60"
              rx="1"
              fill="currentColor"
              fillOpacity="0.08"
            />
            <line x1="215" y1="84" x2="215" y2="102" stroke="#d97706" strokeWidth="1.2" />
            <line x1="249" y1="84" x2="249" y2="102" stroke="#d97706" strokeWidth="1.2" />
            <line x1="217" y1="95" x2="247" y2="95" stroke="#d97706" strokeWidth="1.5" />
            <text
              x="232"
              y="112"
              textAnchor="middle"
              fill="#d97706"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Height (mm)
            </text>
          </svg>
          <p className="text-[10px] leading-snug text-[#6e6e6e]">
            <strong className="text-[#282828]">Across flats (A/F)</strong> = distance between two
            opposite flat sides. <strong className="text-[#282828]">Height</strong> = total
            thickness of nut face to face.
          </p>
        </div>
      )}

      {partType === "washer" && (
        <div className="flex flex-col gap-1.5">
          <svg
            viewBox="0 0 340 120"
            className="h-24 w-full rounded-[2px] bg-[#f5f5f5] p-1 text-[#282828]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="95" cy="54" r="34" fill="currentColor" fillOpacity="0.08" />
            <circle cx="95" cy="54" r="14" fill="white" />
            <line x1="61" y1="54" x2="61" y2="100" stroke="#1473e6" strokeWidth="1.2" />
            <line x1="129" y1="54" x2="129" y2="100" stroke="#1473e6" strokeWidth="1.2" />
            <line x1="63" y1="94" x2="127" y2="94" stroke="#1473e6" strokeWidth="1.5" />
            <text
              x="95"
              y="110"
              textAnchor="middle"
              fill="#1473e6"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Outer Ø (OD)
            </text>
            <line x1="81" y1="54" x2="109" y2="54" stroke="#10b981" strokeWidth="1.5" />
            <text
              x="95"
              y="15"
              textAnchor="middle"
              fill="#10b981"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Inner Ø (ID)
            </text>
            <rect x="235" y="20" width="14" height="68" fill="currentColor" fillOpacity="0.1" />
            <line x1="235" y1="96" x2="249" y2="96" stroke="#d97706" strokeWidth="1.5" />
            <text
              x="242"
              y="110"
              textAnchor="middle"
              fill="#d97706"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Thickness
            </text>
          </svg>
          <p className="text-[10px] leading-snug text-[#6e6e6e]">
            <strong className="text-[#282828]">Outer diameter</strong> = outside edge to edge.{" "}
            <strong className="text-[#282828]">Inner diameter</strong> = central hole diameter.{" "}
            <strong className="text-[#282828]">Thickness</strong> = flat face to flat face.
          </p>
        </div>
      )}

      {partType === "label" && (
        <div className="flex flex-col gap-1.5">
          <svg
            viewBox="0 0 300 100"
            className="h-20 w-full rounded-[2px] bg-[#f5f5f5] p-1 text-[#282828]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect
              x="50"
              y="20"
              width="200"
              height="50"
              rx="2"
              fill="currentColor"
              fillOpacity="0.08"
            />
            <line x1="50" y1="80" x2="250" y2="80" stroke="#1473e6" strokeWidth="1.5" />
            <polygon points="50,80 58,76 58,84" fill="#1473e6" stroke="none" />
            <polygon points="250,80 242,76 242,84" fill="#1473e6" stroke="none" />
            <text
              x="150"
              y="94"
              textAnchor="middle"
              fill="#1473e6"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Width (mm)
            </text>
            <line x1="260" y1="20" x2="260" y2="70" stroke="#d97706" strokeWidth="1.5" />
            <polygon points="260,20 256,28 264,28" fill="#d97706" stroke="none" />
            <polygon points="260,70 256,62 264,62" fill="#d97706" stroke="none" />
            <text x="268" y="48" fill="#d97706" fontSize="9" fontFamily="monospace" stroke="none">
              Height
            </text>
          </svg>
          <p className="text-[10px] leading-snug text-[#6e6e6e]">
            <strong className="text-[#282828]">Width</strong> = horizontal dimension across label.{" "}
            <strong className="text-[#282828]">Height</strong> = vertical dimension top to bottom.
          </p>
        </div>
      )}

      {partType === "cable_tie" && (
        <div className="flex flex-col gap-1.5">
          <svg
            viewBox="0 0 300 70"
            className="h-16 w-full rounded-[2px] bg-[#f5f5f5] p-1 text-[#282828]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect
              x="20"
              y="20"
              width="18"
              height="30"
              rx="1"
              fill="currentColor"
              fillOpacity="0.1"
            />
            <rect x="38" y="30" width="220" height="10" fill="currentColor" fillOpacity="0.05" />
            <line x1="20" y1="58" x2="258" y2="58" stroke="#1473e6" strokeWidth="1.5" />
            <text x="135" y="66" fill="#1473e6" fontSize="10" fontFamily="monospace" stroke="none">
              Length (mm)
            </text>
            <text x="265" y="38" fill="#d97706" fontSize="9" fontFamily="monospace" stroke="none">
              Width
            </text>
          </svg>
          <p className="text-[10px] leading-snug text-[#6e6e6e]">
            <strong className="text-[#282828]">Length</strong> = total end-to-end length.{" "}
            <strong className="text-[#282828]">Width</strong> = strap width across the flat body.
          </p>
        </div>
      )}

      {partType === "spring" && (
        <div className="flex flex-col gap-1.5">
          <svg
            viewBox="0 0 240 90"
            className="h-20 w-full rounded-[2px] bg-[#f5f5f5] p-1 text-[#282828]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M 40 45 C 50 15, 70 15, 80 45 C 90 75, 110 75, 120 45 C 130 15, 150 15, 160 45" />
            <line x1="25" y1="20" x2="25" y2="70" stroke="#d97706" strokeWidth="1.5" />
            <text x="4" y="48" fill="#d97706" fontSize="9" fontFamily="monospace" stroke="none">
              Diam
            </text>
            <line x1="40" y1="80" x2="160" y2="80" stroke="#1473e6" strokeWidth="1.5" />
            <text x="80" y="88" fill="#1473e6" fontSize="9" fontFamily="monospace" stroke="none">
              Height (mm)
            </text>
          </svg>
          <p className="text-[10px] leading-snug text-[#6e6e6e]">
            <strong className="text-[#282828]">Height</strong> = total free length end to end.{" "}
            <strong className="text-[#282828]">Diameter</strong> = outer diameter across the coil.
          </p>
        </div>
      )}

      {partType === "other" && (
        <p className="text-[10px] leading-snug text-[#6e6e6e]">
          Enter custom dimension labels (e.g. Overall length, Width, Bore) and their measured values
          in millimetres (mm).
        </p>
      )}
    </div>
  );
}

function parseOptionalMm(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

const ClassTableRow = memo(function ClassTableRow({
  row,
  selected,
  active,
  multi,
  widths,
  partType,
  orderedIds,
  selection,
  onSelection,
  onOpenMenu,
  rowRef,
}: {
  row: ClassRow;
  selected: boolean;
  active: boolean;
  multi: boolean;
  widths: Record<ClassCol, number>;
  partType: PartTypeDefinition | undefined;
  orderedIds: readonly number[];
  selection: ClassSelection;
  onSelection: (next: ClassSelection) => void;
  onOpenMenu: (x: number, y: number, rowId: number) => void;
  rowRef?: React.Ref<HTMLDivElement>;
}) {
  const complete = hasCompleteMeasurements(row, partType);
  const hasPartType = Boolean(row.part_type && row.part_type !== "none");
  const summary = formatPartSummary(row);

  return (
    <div
      ref={rowRef}
      aria-selected={selected}
      onClick={(event) => {
        if (event.button !== 0) return;
        onSelection(
          applyRowClick({
            selection,
            orderedIds,
            clickedId: row.id,
            ctrl: event.ctrlKey || event.metaKey,
            shift: event.shiftKey,
          }),
        );
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenMenu(event.clientX, event.clientY, row.id);
      }}
      className={`relative flex items-center py-1 pl-2 pr-7 cursor-pointer transition-colors text-xs border-l-2 ${
        selected
          ? multi && active
            ? "bg-[#1473e6]/20 border-[#1473e6]"
            : "bg-[#1473e6]/10 border-[#1473e6]"
          : "border-transparent hover:bg-[#f9f9f9]"
      }`}
    >
      <div
        className="shrink-0 pr-2 font-mono text-[10px] text-[#707070]"
        style={{ width: widths.id }}
      >
        #{row.id}
      </div>
      <div className="shrink-0 pr-2 flex items-center" style={{ width: widths.color }}>
        <span
          className="size-2.5 rounded-[1px] inline-block border border-black/15"
          style={{ backgroundColor: classFill(row.id, row.color) }}
        />
      </div>
      <div
        className="shrink-0 pr-2 font-bold font-mono text-[11px] text-[#282828] truncate min-w-0"
        style={{ width: widths.code }}
      >
        {row.ic}
      </div>
      <div
        className="shrink-0 pr-2 text-[#707070] truncate text-[11px] min-w-0"
        style={{ width: widths.des }}
      >
        {row.des}
      </div>
      <div
        className="shrink-0 pr-2 font-mono text-[10px] text-[#707070] truncate min-w-0"
        style={{ width: widths.dims }}
      >
        {summary ?? "—"}
      </div>
      <div className="shrink-0 pr-2 min-w-0" style={{ width: widths.status }}>
        {complete ? (
          <span className="text-[9px] font-mono px-1 py-0.2 rounded-[2px] bg-emerald-100 text-emerald-800">
            complete
          </span>
        ) : hasPartType ? (
          <span className="text-[9px] font-mono px-1 py-0.2 rounded-[2px] bg-rose-100 text-rose-800">
            unset
          </span>
        ) : (
          <span className="text-[9px] font-mono px-1 py-0.2 rounded-[2px] bg-neutral-100 text-neutral-500">
            none
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0" />
      {selected && (
        <button
          type="button"
          aria-label="Class row menu"
          aria-haspopup="menu"
          title="Class actions"
          className="press absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[2px] border border-transparent text-[#707070] hover:border-[#c8c8c8] hover:bg-white hover:text-[#282828]"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpenMenu(event.clientX, event.clientY, row.id);
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      )}
    </div>
  );
});

const ClassTable = memo(function ClassTable({
  rows,
  loading,
  selection,
  orderedIds,
  colWidths,
  partTypesMap,
  onResizeStart,
  onResetWidth,
  onSelection,
  onOpenMenu,
  activeRowRef,
}: {
  rows: ClassRow[];
  loading: boolean;
  selection: ClassSelection;
  orderedIds: readonly number[];
  colWidths: Record<ClassCol, number>;
  partTypesMap: Map<string, PartTypeDefinition>;
  onResizeStart: (column: ClassCol, event: ReactPointerEvent) => void;
  onResetWidth: (column: ClassCol) => void;
  onSelection: (next: ClassSelection) => void;
  onOpenMenu: (x: number, y: number, rowId: number) => void;
  activeRowRef: React.RefObject<HTMLDivElement | null>;
}) {
  const multi = selection.ids.size > 1;
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-x-auto">
      <div className="min-w-full w-max flex-1 min-h-0 flex flex-col">
        <div className="h-6 border-b border-[#c8c8c8] bg-[#f5f5f5] flex items-center px-2 text-[11px] font-semibold text-[#707070] shrink-0 select-none">
          <div className="relative shrink-0 flex items-center pr-2" style={{ width: colWidths.id }}>
            <span className="truncate">ID</span>
            <ColumnResizeHandle column="id" onResizeStart={onResizeStart} onReset={onResetWidth} />
          </div>
          <div
            className="relative shrink-0 flex items-center pr-2"
            style={{ width: colWidths.color }}
          >
            <span className="truncate">Color</span>
            <ColumnResizeHandle
              column="color"
              onResizeStart={onResizeStart}
              onReset={onResetWidth}
            />
          </div>
          <div
            className="relative shrink-0 flex items-center pr-2 min-w-0"
            style={{ width: colWidths.code }}
          >
            <span className="truncate">Code</span>
            <ColumnResizeHandle
              column="code"
              onResizeStart={onResizeStart}
              onReset={onResetWidth}
            />
          </div>
          <div
            className="relative shrink-0 flex items-center pr-2 min-w-0"
            style={{ width: colWidths.des }}
          >
            <span className="truncate">Description</span>
            <ColumnResizeHandle column="des" onResizeStart={onResizeStart} onReset={onResetWidth} />
          </div>
          <div
            className="relative shrink-0 flex items-center pr-2 min-w-0"
            style={{ width: colWidths.dims }}
          >
            <span className="truncate">Dimensions</span>
            <ColumnResizeHandle
              column="dims"
              onResizeStart={onResizeStart}
              onReset={onResetWidth}
            />
          </div>
          <div
            className="relative shrink-0 flex items-center pr-2 min-w-0"
            style={{ width: colWidths.status }}
          >
            <span className="truncate">Status</span>
            <ColumnResizeHandle
              column="status"
              onResizeStart={onResizeStart}
              onReset={onResetWidth}
            />
          </div>
          <div className="flex-1 min-w-0" />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#f0f0f0]">
          {rows.length === 0 ? (
            <div className="p-4 text-center text-[#707070] text-xs">
              {loading ? "Loading classes..." : "No classes match active search."}
            </div>
          ) : (
            rows.map((row) => {
              const selected = selection.ids.has(row.id);
              const active = selection.activeId === row.id;
              return (
                <ClassTableRow
                  key={row.id}
                  row={row}
                  selected={selected}
                  active={active}
                  multi={multi}
                  widths={colWidths}
                  partType={partTypesMap.get(row.part_type || "")}
                  orderedIds={orderedIds}
                  selection={selection}
                  onSelection={onSelection}
                  onOpenMenu={onOpenMenu}
                  rowRef={active ? activeRowRef : undefined}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});

export function ClassesAdmin() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<ClassSelection>(() => emptyClassSelection());
  const [codeMenu, setCodeMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  // Inspector edit state
  const [editIc, setEditIc] = useState("");
  const [editDes, setEditDes] = useState("");
  const [editPartType, setEditPartType] = useState<PartType>("none");
  const [editThread, setEditThread] = useState("");
  const [editLengthMm, setEditLengthMm] = useState("");
  const [editHeadType, setEditHeadType] = useState("");
  const [editAfMm, setEditAfMm] = useState("");
  const [editHeightMm, setEditHeightMm] = useState("");
  const [editOdMm, setEditOdMm] = useState("");
  const [editIdMm, setEditIdMm] = useState("");
  const [editThicknessMm, setEditThicknessMm] = useState("");
  const [editWidthMm, setEditWidthMm] = useState("");
  const [editNote, setEditNote] = useState("");
  const [springOtherMode, setSpringOtherMode] = useState<"od_length" | "width_height">("od_length");
  const [editDim1Name, setEditDim1Name] = useState("");
  const [editDim1Mm, setEditDim1Mm] = useState("");
  const [editDim2Name, setEditDim2Name] = useState("");
  const [editDim2Mm, setEditDim2Mm] = useState("");
  const [editDim3Name, setEditDim3Name] = useState("");
  const [editDim3Mm, setEditDim3Mm] = useState("");
  const [showDiagramHelp, setShowDiagramHelp] = useState(false);

  // Quick add state
  const [showAddClass, setShowAddClass] = useState(false);
  const [newIc, setNewIc] = useState("");
  const [newDes, setNewDes] = useState("");
  const [newPartType, setNewPartType] = useState<PartType>("none");

  const [busy, setBusy] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  const [healthResult, setHealthResult] = useState<ProjectHealthResult | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [duplicatesResult, setDuplicatesResult] = useState<DuplicateDetectionResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const newIcInputRef = useRef<HTMLInputElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const codeMenuRef = useRef<HTMLDivElement>(null);
  const partTypeSelectRef = useRef<HTMLSelectElement>(null);
  const dim1InputRef = useRef<HTMLInputElement>(null);
  const dim1NameInputRef = useRef<HTMLInputElement>(null);
  const focusDimensionsPendingRef = useRef(false);

  const {
    widths: colWidths,
    handleResizeStart,
    resetWidth,
  } = useColumnResize<ClassCol>("ls_marker_classes_col_widths", CLASS_COLUMNS);

  const [partTypes, setPartTypes] = useState<PartTypeDefinition[]>([]);
  const partTypesMap = useMemo(() => {
    const map = new Map<string, PartTypeDefinition>();
    for (const pt of partTypes) {
      map.set(pt.id, pt);
    }
    return map;
  }, [partTypes]);

  const partTypeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "none", label: "None (unset)" }];
    const seen = new Set<string>(["none"]);
    for (const pt of partTypes) {
      if (!pt.archived || pt.id === editPartType || pt.id === newPartType) {
        opts.push({
          value: pt.id,
          label: pt.archived ? `${pt.name} (Archived)` : pt.name,
        });
        seen.add(pt.id);
      }
    }
    for (const d of PART_TYPE_OPTIONS) {
      if (!seen.has(d.value)) {
        opts.push(d);
        seen.add(d.value);
      }
    }
    return opts;
  }, [partTypes, editPartType, newPartType]);

  async function load() {
    const [rows, pts] = await Promise.all([fetchClasses(), fetchPartTypes(true).catch(() => [])]);
    setClasses(rows);
    setPartTypes(pts);
  }

  useEffect(() => {
    let cancel = false;
    Promise.all([fetchClasses(), fetchPartTypes(true).catch(() => [])])
      .then(([rows, pts]) => {
        if (!cancel) {
          setClasses(rows);
          setPartTypes(pts);
        }
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load classes");
      });
    return () => {
      cancel = true;
    };
  }, []);

  const classSearch = useMemo(() => buildClassSearch(classes ?? []), [classes]);
  const filtered = useMemo(
    () => filterClassSearch(classes ?? [], classSearch, query),
    [classes, classSearch, query],
  );

  const selectedClass = useMemo(() => {
    return (classes ?? []).find((c) => c.id === selection.activeId) ?? null;
  }, [classes, selection.activeId]);

  const filteredIds = useMemo(() => filtered.map((row) => row.id), [filtered]);

  useEffect(() => {
    if (selectedClass) {
      setEditIc(selectedClass.ic);
      setEditDes(selectedClass.des);
      setEditPartType((selectedClass.part_type as PartType) || "none");
      setEditThread(
        selectedClass.thread ??
          (selectedClass.part_type === "bolt" && selectedClass.dim2_mm
            ? `M${selectedClass.dim2_mm}`
            : ""),
      );
      setEditLengthMm(
        selectedClass.length_mm != null
          ? String(selectedClass.length_mm)
          : selectedClass.dim1_mm != null &&
              (selectedClass.part_type === "bolt" || selectedClass.part_type === "cable_tie")
            ? String(selectedClass.dim1_mm)
            : "",
      );
      setEditHeadType(selectedClass.head_type ?? (selectedClass.part_type === "bolt" ? "Hex" : ""));
      setEditAfMm(
        selectedClass.af_mm != null
          ? String(selectedClass.af_mm)
          : selectedClass.part_type === "nut" && selectedClass.dim1_mm != null
            ? String(selectedClass.dim1_mm)
            : "",
      );
      setEditHeightMm(
        selectedClass.height_mm != null
          ? String(selectedClass.height_mm)
          : selectedClass.part_type === "nut" && selectedClass.dim2_mm != null
            ? String(selectedClass.dim2_mm)
            : selectedClass.part_type === "label" && selectedClass.dim2_mm != null
              ? String(selectedClass.dim2_mm)
              : "",
      );
      setEditOdMm(
        selectedClass.od_mm != null
          ? String(selectedClass.od_mm)
          : selectedClass.dim1_mm != null && selectedClass.part_type === "washer"
            ? String(selectedClass.dim1_mm)
            : selectedClass.dim2_mm != null && selectedClass.part_type === "spring"
              ? String(selectedClass.dim2_mm)
              : "",
      );
      setEditIdMm(
        selectedClass.id_mm != null
          ? String(selectedClass.id_mm)
          : selectedClass.dim2_mm != null && selectedClass.part_type === "washer"
            ? String(selectedClass.dim2_mm)
            : "",
      );
      setEditThicknessMm(
        selectedClass.thickness_mm != null
          ? String(selectedClass.thickness_mm)
          : selectedClass.dim3_mm != null && selectedClass.part_type === "washer"
            ? String(selectedClass.dim3_mm)
            : "",
      );
      setEditWidthMm(
        selectedClass.width_mm != null
          ? String(selectedClass.width_mm)
          : selectedClass.dim1_mm != null && selectedClass.part_type === "label"
            ? String(selectedClass.dim1_mm)
            : selectedClass.dim2_mm != null && selectedClass.part_type === "cable_tie"
              ? String(selectedClass.dim2_mm)
              : "",
      );
      setEditNote(selectedClass.note ?? "");
      setSpringOtherMode(
        selectedClass.width_mm != null && selectedClass.height_mm != null
          ? "width_height"
          : "od_length",
      );
      setEditDim1Name(selectedClass.dim1_name ?? "");
      setEditDim1Mm(selectedClass.dim1_mm != null ? String(selectedClass.dim1_mm) : "");
      setEditDim2Name(selectedClass.dim2_name ?? "");
      setEditDim2Mm(selectedClass.dim2_mm != null ? String(selectedClass.dim2_mm) : "");
      setEditDim3Name(selectedClass.dim3_name ?? "");
      setEditDim3Mm(selectedClass.dim3_mm != null ? String(selectedClass.dim3_mm) : "");
      setShowDiagramHelp(false);
      setPendingDeleteId(null);
    }
  }, [selectedClass]);

  // Default selection
  useEffect(() => {
    if (selection.activeId == null && filtered.length > 0) {
      const first = filtered[0];
      if (first) setSelection(singleClassSelection(first.id));
    }
  }, [filtered, selection.activeId]);

  // Scroll active row into view
  useEffect(() => {
    if (selection.activeId != null && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }, [selection.activeId]);

  useEffect(() => {
    if (!copyNote) return;
    const timer = setTimeout(() => setCopyNote(null), 2000);
    return () => clearTimeout(timer);
  }, [copyNote]);

  useEffect(() => {
    if (!codeMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCodeMenu(null);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && codeMenuRef.current?.contains(target)) return;
      setCodeMenu(null);
    };
    const onWheel = () => setCodeMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [codeMenu]);

  // Focus IC input when quick add drawer opens
  useEffect(() => {
    if (showAddClass) {
      const timer = setTimeout(() => {
        newIcInputRef.current?.focus();
        newIcInputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showAddClass]);

  // Focus right panel dimensions after saving a newly added class
  useEffect(() => {
    if (focusDimensionsPendingRef.current && selectedClass) {
      focusDimensionsPendingRef.current = false;
      const timer = setTimeout(() => {
        if (dim1InputRef.current) {
          dim1InputRef.current.focus();
          dim1InputRef.current.select();
        } else if (dim1NameInputRef.current) {
          dim1NameInputRef.current.focus();
          dim1NameInputRef.current.select();
        } else if (partTypeSelectRef.current) {
          partTypeSelectRef.current.focus();
        }
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [selectedClass]);

  async function handleAddClass(e: React.FormEvent) {
    e.preventDefault();
    if (!newIc.trim() || !newDes.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createClass(newIc.trim(), newDes.trim(), newPartType);
      focusDimensionsPendingRef.current = true;
      setClasses((prev) => mergeClassRow(prev, created));
      setQuery("");
      setSelection(singleClassSelection(created.id));
      setNewIc("");
      setNewDes("");
      setNewPartType("none");
      setShowAddClass(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create class");
    } finally {
      setBusy(false);
    }
  }

  const handleDimensionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSaveSelectedClass();
    }
  };

  const previewDimensions = useMemo(() => {
    const isCustom = ![
      "none",
      "bolt",
      "nut",
      "washer",
      "label",
      "cable_tie",
      "spring",
      "other",
    ].includes(editPartType);
    const def = partTypesMap.get(editPartType);
    if (def?.display_format?.includes("{")) {
      const vals: Record<string, string> = {
        thread: editThread.trim(),
        length_mm: editLengthMm.trim(),
        head_type: editHeadType.trim(),
        af_mm: editAfMm.trim(),
        height_mm: editHeightMm.trim(),
        od_mm: editOdMm.trim(),
        id_mm: editIdMm.trim(),
        thickness_mm: editThicknessMm.trim(),
        width_mm: editWidthMm.trim(),
        note: editNote.trim(),
      };
      let formatted = def.display_format.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => vals[k] || "");
      formatted = formatted
        .replace(/\(\s*\)/g, "")
        .replace(/,\s*,/g, ",")
        .replace(/,\s*\)/g, ")")
        .replace(/\s+/g, " ")
        .trim();
      if (formatted && /\d/.test(formatted)) {
        return formatted;
      }
    }
    return formatPartSummary({
      id: selectedClass?.id ?? 0,
      ic: editIc,
      des: editDes,
      color: "#000",
      part_type: editPartType,
      thread: editThread.trim() || null,
      length_mm:
        isCustom ||
        editPartType === "bolt" ||
        editPartType === "cable_tie" ||
        ((editPartType === "spring" || editPartType === "other") && springOtherMode === "od_length")
          ? parseOptionalMm(editLengthMm)
          : null,
      head_type: editHeadType.trim() || null,
      af_mm: parseOptionalMm(editAfMm),
      height_mm:
        isCustom ||
        editPartType === "nut" ||
        editPartType === "label" ||
        ((editPartType === "spring" || editPartType === "other") &&
          springOtherMode === "width_height")
          ? parseOptionalMm(editHeightMm)
          : null,
      od_mm:
        isCustom ||
        editPartType === "washer" ||
        ((editPartType === "spring" || editPartType === "other") && springOtherMode === "od_length")
          ? parseOptionalMm(editOdMm)
          : null,
      id_mm: isCustom || editPartType === "washer" ? parseOptionalMm(editIdMm) : null,
      thickness_mm: isCustom || editPartType === "washer" ? parseOptionalMm(editThicknessMm) : null,
      width_mm:
        isCustom ||
        editPartType === "label" ||
        editPartType === "cable_tie" ||
        ((editPartType === "spring" || editPartType === "other") &&
          springOtherMode === "width_height")
          ? parseOptionalMm(editWidthMm)
          : null,
      note:
        isCustom || editPartType === "spring" || editPartType === "other"
          ? editNote.trim() || null
          : null,
    });
  }, [
    selectedClass,
    editIc,
    editDes,
    editPartType,
    editThread,
    editLengthMm,
    editHeadType,
    editAfMm,
    editHeightMm,
    editOdMm,
    editIdMm,
    editThicknessMm,
    editWidthMm,
    editNote,
    springOtherMode,
    partTypesMap,
  ]);

  async function handleSaveSelectedClass() {
    if (!selectedClass) return;
    setBusy(true);
    setError(null);
    try {
      const isCustom = ![
        "none",
        "bolt",
        "nut",
        "washer",
        "label",
        "cable_tie",
        "spring",
        "other",
      ].includes(editPartType);
      const updated = await updateClass({
        id: selectedClass.id,
        ic: editIc.trim(),
        des: editDes.trim(),
        part_type: editPartType,
        thread:
          isCustom || editPartType === "bolt" || editPartType === "nut"
            ? editThread.trim() || null
            : null,
        length_mm:
          isCustom ||
          editPartType === "bolt" ||
          editPartType === "cable_tie" ||
          ((editPartType === "spring" || editPartType === "other") &&
            springOtherMode === "od_length")
            ? parseOptionalMm(editLengthMm)
            : null,
        head_type: isCustom || editPartType === "bolt" ? editHeadType.trim() || null : null,
        af_mm:
          isCustom || editPartType === "bolt" || editPartType === "nut"
            ? parseOptionalMm(editAfMm)
            : null,
        height_mm:
          isCustom ||
          editPartType === "nut" ||
          editPartType === "label" ||
          ((editPartType === "spring" || editPartType === "other") &&
            springOtherMode === "width_height")
            ? parseOptionalMm(editHeightMm)
            : null,
        od_mm:
          isCustom ||
          editPartType === "washer" ||
          ((editPartType === "spring" || editPartType === "other") &&
            springOtherMode === "od_length")
            ? parseOptionalMm(editOdMm)
            : null,
        id_mm: isCustom || editPartType === "washer" ? parseOptionalMm(editIdMm) : null,
        thickness_mm:
          isCustom || editPartType === "washer" ? parseOptionalMm(editThicknessMm) : null,
        width_mm:
          isCustom ||
          editPartType === "label" ||
          editPartType === "cable_tie" ||
          ((editPartType === "spring" || editPartType === "other") &&
            springOtherMode === "width_height")
            ? parseOptionalMm(editWidthMm)
            : null,
        note:
          isCustom || editPartType === "spring" || editPartType === "other"
            ? editNote.trim() || null
            : null,
        dim1_name: editPartType === "other" ? editDim1Name.trim() || null : null,
        dim1_mm: editPartType === "none" ? null : parseOptionalMm(editDim1Mm),
        dim2_name: editPartType === "other" ? editDim2Name.trim() || null : null,
        dim2_mm: editPartType === "none" ? null : parseOptionalMm(editDim2Mm),
        dim3_name: editPartType === "other" ? editDim3Name.trim() || null : null,
        dim3_mm:
          editPartType === "washer" || editPartType === "other"
            ? parseOptionalMm(editDim3Mm)
            : null,
      });
      setClasses((prev) => mergeClassRow(prev, updated));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update class");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteClass(id: number) {
    setBusy(true);
    setError(null);
    try {
      await deleteClass(id);
      setPendingDeleteId(null);
      setClasses((prev) => (prev ? prev.filter((row) => row.id !== id) : prev));
      setSelection(emptyClassSelection());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete class");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportCsv(file: File) {
    setBusy(true);
    setImportNote(null);
    setError(null);
    try {
      const csv = await file.text();
      const result = await importClasses(csv);
      setImportNote(`Imported: +${result.added} added, ${result.skipped} skipped duplicates.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "CSV import failed");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const openCodeMenu = useCallback(
    (clientX: number, clientY: number, rowId: number) => {
      const next = selectionForContextMenu(selection, rowId);
      if (next !== selection) setSelection(next);
      const text = icCodesForSelection(filtered, next.ids);
      const pos = clampMenuPosition(clientX, clientY, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setCodeMenu({ ...pos, text });
    },
    [filtered, selection],
  );

  async function handleCopyAllCodes(text: string) {
    try {
      await copyPlainText(text);
      setCodeMenu(null);
      const count = text.length === 0 ? 0 : text.split("\n").length;
      setCopyNote(count === 1 ? "Copied 1 code" : `Copied ${count} codes`);
    } catch (err: unknown) {
      setCodeMenu(null);
      setError(err instanceof Error ? err.message : "Could not copy codes to the clipboard");
    }
  }

  async function handleOpenHealth() {
    setLoadingHealth(true);
    setError(null);
    try {
      const result = await fetchProjectHealth();
      setHealthResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dataset health");
    } finally {
      setLoadingHealth(false);
    }
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#f0f0f0] text-[#282828] select-none text-xs">
      {/* 28px Top Bar */}
      <AppHeader current="classes" />

      {/* Toolbar (28px) */}
      <div className="h-7 border-b border-[#c8c8c8] bg-white px-2 flex items-center justify-between gap-2 shrink-0 select-none text-xs">
        {/* Left: Search & Quick Actions */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="relative flex items-center">
            <Search className="size-3 text-[#707070] absolute left-1.5" />
            <input
              type="text"
              placeholder="Filter classes..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-5 w-40 pl-5 pr-1.5 rounded-[2px] border border-[#c8c8c8] bg-white text-[11px] outline-none focus:border-[#1473e6]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-1 text-[#707070] hover:text-[#282828]"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <span className="text-[#c8c8c8]">|</span>

          {/* Add Class Toggle */}
          <button
            type="button"
            onClick={() => {
              setShowAddClass((v) => {
                const next = !v;
                if (next) {
                  setTimeout(() => newIcInputRef.current?.focus(), 50);
                }
                return next;
              });
            }}
            className="press h-5 px-2 rounded-[2px] bg-[#1473e6] hover:bg-[#0d62c7] text-white border border-[#1473e6] text-[11px] font-semibold flex items-center gap-1 shadow-sm"
            title="Add a new class"
          >
            <Plus className="size-3 stroke-[2.5]" />
            <span>+ Add Class</span>
          </button>

          {/* Import CSV Trigger */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="press h-5 px-2 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-[11px] font-medium flex items-center gap-1"
            title="Import classes CSV (columns: ic, des)"
          >
            <FileUp className="size-3 text-[#707070]" />
            <span>Import CSV</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportCsv(file);
            }}
          />

          {importNote && (
            <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded-[2px] border border-emerald-200">
              {importNote}
            </span>
          )}
          {copyNote && (
            <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded-[2px] border border-emerald-200">
              {copyNote}
            </span>
          )}
        </div>

        {/* Right: Dataset Health & Total Counts */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[10px] text-[#707070]">
            {classes ? `${classes.length} anchored classes` : "Loading classes..."}
          </span>

          <button
            type="button"
            disabled={loadingHealth}
            onClick={() => void handleOpenHealth()}
            className="press h-5 px-2 rounded-[2px] border border-[#c8c8c8] bg-white hover:bg-[#f0f0f0] text-[#282828] text-[11px] font-medium flex items-center gap-1 disabled:opacity-40"
            title="Inspect dataset health and composition"
          >
            {loadingHealth ? (
              <Loader2 className="size-3 animate-spin text-[#1473e6]" />
            ) : (
              <BarChart3 className="size-3 text-[#1473e6]" />
            )}
            <span>Dataset Health</span>
          </button>
        </div>
      </div>

      {/* Inline Quick Add Class Form (Collapsible drawer) */}
      {showAddClass && (
        <form
          onSubmit={(e) => void handleAddClass(e)}
          className="h-8 border-b border-[#c8c8c8] bg-[#f9f9f9] px-2 flex items-center gap-2 shrink-0 text-xs"
        >
          <span className="font-semibold text-[11px] text-[#282828]">New Class:</span>
          <input
            ref={newIcInputRef}
            type="text"
            placeholder="Item code (e.g. HX-M8)"
            value={newIc}
            onChange={(e) => setNewIc(e.target.value)}
            required
            className="h-5 w-32 px-1.5 rounded-[2px] border border-[#c8c8c8] bg-white text-[11px] outline-none focus:border-[#1473e6]"
          />
          <input
            type="text"
            placeholder="Description (e.g. Hex Head Bolt M8)"
            value={newDes}
            onChange={(e) => setNewDes(e.target.value)}
            required
            className="h-5 flex-1 max-w-sm px-1.5 rounded-[2px] border border-[#c8c8c8] bg-white text-[11px] outline-none focus:border-[#1473e6]"
          />
          <select
            value={newPartType}
            onChange={(e) => setNewPartType(e.target.value as PartType)}
            className="h-5 rounded-[2px] border border-[#c8c8c8] bg-white text-[11px] px-1 outline-none focus:border-[#1473e6] text-[#282828]"
            title="Part Type"
          >
            {partTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            className="press h-5 px-2 rounded-[2px] bg-[#1473e6] text-white text-[11px] font-medium hover:bg-[#0d62c7] disabled:opacity-50"
          >
            Save Class
          </button>
          <button
            type="button"
            onClick={() => setShowAddClass(false)}
            className="text-[#707070] hover:text-[#282828]"
          >
            <X className="size-3.5" />
          </button>
        </form>
      )}

      {/* Error notification */}
      {error && (
        <div className="p-1.5 bg-red-50 border-b border-red-200 text-red-800 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Main Workspace (Table on Left + Inspector on Right) */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* Left: Dense Tabular List */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-white overflow-hidden">
          <ClassTable
            rows={filtered}
            loading={classes === null}
            selection={selection}
            orderedIds={filteredIds}
            colWidths={colWidths}
            partTypesMap={partTypesMap}
            onResizeStart={handleResizeStart}
            onResetWidth={resetWidth}
            onSelection={setSelection}
            onOpenMenu={openCodeMenu}
            activeRowRef={activeRowRef}
          />
        </div>

        {/* Right: Inspector Pane (320px) */}
        <aside
          aria-label="Class Inspector"
          className="w-[320px] border-l border-[#c8c8c8] bg-white flex flex-col shrink-0 overflow-y-auto select-none h-full"
        >
          <div className="h-6 px-2 bg-[#f5f5f5] flex items-center justify-between border-b border-[#c8c8c8] text-[11px] font-semibold text-[#282828] shrink-0">
            <span>CLASS INSPECTOR</span>
            {selectedClass && (
              <span className="font-mono text-[10px] text-[#707070]">#{selectedClass.id}</span>
            )}
          </div>

          {selectedClass ? (
            <div className="p-3 flex flex-col gap-3">
              {/* Header Card */}
              <div className="flex items-center gap-2 p-2 bg-[#f9f9f9] border border-[#c8c8c8] rounded-[2px]">
                <span
                  className="size-6 rounded-[2px] shrink-0 border border-black/20"
                  style={{ backgroundColor: classFill(selectedClass.id, selectedClass.color) }}
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-bold font-mono text-xs text-[#282828] truncate">
                    {selectedClass.ic}
                  </span>
                  <span className="text-[10px] font-mono text-[#707070]">
                    Permanent Anchor ID: #{selectedClass.id}
                  </span>
                </div>
              </div>

              {/* Code and Description Inputs */}
              <div className="flex flex-col gap-2">
                <div>
                  <label className="text-[10px] uppercase font-bold text-[#707070] block mb-0.5">
                    Item Code (IC)
                  </label>
                  <input
                    type="text"
                    value={editIc}
                    onChange={(e) => setEditIc(e.target.value)}
                    onKeyDown={handleDimensionKeyDown}
                    className="w-full h-6 px-1.5 rounded-[2px] border border-[#c8c8c8] bg-white text-[11px] font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-[#707070] block mb-0.5">
                    Description (DES)
                  </label>
                  <input
                    type="text"
                    value={editDes}
                    onChange={(e) => setEditDes(e.target.value)}
                    onKeyDown={handleDimensionKeyDown}
                    className="w-full h-6 px-1.5 rounded-[2px] border border-[#c8c8c8] bg-white text-[11px]"
                  />
                </div>
              </div>

              {/* Part Type and Dimensions */}
              <div className="flex flex-col gap-2 pt-2 border-t border-[#f0f0f0]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-[#707070]">
                    Part Dimensions
                  </span>
                  {editPartType !== "none" && editPartType !== "other" && (
                    <button
                      type="button"
                      onClick={() => setShowDiagramHelp((v) => !v)}
                      className={`h-5 px-1.5 rounded-[2px] border text-[10px] font-medium flex items-center gap-1 ${
                        showDiagramHelp
                          ? "bg-[#1473e6] text-white border-[#1473e6]"
                          : "bg-white text-[#1473e6] border-[#1473e6]"
                      }`}
                    >
                      ? Diagram
                    </button>
                  )}
                </div>

                <select
                  ref={partTypeSelectRef}
                  value={editPartType}
                  onChange={(e) => {
                    const pt = e.target.value as PartType;
                    setEditPartType(pt);
                    if (pt === "none") setShowDiagramHelp(false);
                  }}
                  onKeyDown={handleDimensionKeyDown}
                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] bg-white text-[11px] px-1"
                >
                  {partTypeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {showDiagramHelp && editPartType !== "none" && editPartType !== "other" && (
                  <PartMeasurementPopover
                    partType={editPartType}
                    onClose={() => setShowDiagramHelp(false)}
                  />
                )}

                {/* Specific Structured Fields by Type */}
                {editPartType === "bolt" && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="text-[9px] font-semibold text-[#505050] block">
                          Thread *{" "}
                          <span className="text-[8px] text-[#707070] font-normal">
                            (e.g. M6, M8)
                          </span>
                        </label>
                        <input
                          ref={dim1InputRef}
                          type="text"
                          placeholder="M8"
                          value={editThread}
                          onChange={(e) => setEditThread(e.target.value)}
                          onKeyDown={handleDimensionKeyDown}
                          className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-semibold text-[#505050] block">
                          Length under head (mm) *
                        </label>
                        <input
                          type="number"
                          step="any"
                          placeholder="30"
                          value={editLengthMm}
                          onChange={(e) => setEditLengthMm(e.target.value)}
                          onKeyDown={handleDimensionKeyDown}
                          className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="text-[9px] font-semibold text-[#505050] block">
                          Head type *
                        </label>
                        <input
                          type="text"
                          list="bolt-head-types"
                          placeholder="Hex"
                          value={editHeadType}
                          onChange={(e) => setEditHeadType(e.target.value)}
                          onKeyDown={handleDimensionKeyDown}
                          className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white"
                        />
                        <datalist id="bolt-head-types">
                          <option value="Hex" />
                          <option value="Socket" />
                          <option value="Button" />
                          <option value="Countersunk" />
                          <option value="Flange" />
                          <option value="Pan" />
                        </datalist>
                      </div>
                      <div>
                        <label className="text-[9px] text-[#707070] block">
                          Across flats A/F (mm){" "}
                          <span className="text-[8px] text-[#909090]">(optional)</span>
                        </label>
                        <input
                          type="number"
                          step="any"
                          placeholder="13"
                          value={editAfMm}
                          onChange={(e) => setEditAfMm(e.target.value)}
                          onKeyDown={handleDimensionKeyDown}
                          className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {editPartType === "nut" && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <label className="text-[9px] font-semibold text-[#505050] block">
                          Thread *{" "}
                          <span className="text-[8px] text-[#707070] font-normal">(e.g. M8)</span>
                        </label>
                        <input
                          ref={dim1InputRef}
                          type="text"
                          placeholder="M8"
                          value={editThread}
                          onChange={(e) => setEditThread(e.target.value)}
                          onKeyDown={handleDimensionKeyDown}
                          className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-semibold text-[#505050] block">
                          Across flats A/F (mm) *
                        </label>
                        <input
                          type="number"
                          step="any"
                          placeholder="13"
                          value={editAfMm}
                          onChange={(e) => setEditAfMm(e.target.value)}
                          onKeyDown={handleDimensionKeyDown}
                          className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] text-[#707070] block">
                        Height (mm) <span className="text-[8px] text-[#909090]">(optional)</span>
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="6.5"
                        value={editHeightMm}
                        onChange={(e) => setEditHeightMm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                  </div>
                )}

                {editPartType === "washer" && (
                  <div className="grid grid-cols-3 gap-1">
                    <div>
                      <label className="text-[9px] font-semibold text-[#505050] block">
                        Outer Ø (mm) *
                      </label>
                      <input
                        ref={dim1InputRef}
                        type="number"
                        step="any"
                        placeholder="16"
                        value={editOdMm}
                        onChange={(e) => setEditOdMm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-semibold text-[#505050] block">
                        Inner Ø (mm) *
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="8.4"
                        value={editIdMm}
                        onChange={(e) => setEditIdMm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-semibold text-[#505050] block">
                        Thick (mm) *
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="1.6"
                        value={editThicknessMm}
                        onChange={(e) => setEditThicknessMm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                  </div>
                )}

                {editPartType === "label" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="text-[9px] font-semibold text-[#505050] block">
                        Width (mm) *
                      </label>
                      <input
                        ref={dim1InputRef}
                        type="number"
                        step="any"
                        placeholder="130"
                        value={editWidthMm}
                        onChange={(e) => setEditWidthMm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-semibold text-[#505050] block">
                        Height (mm) *
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="37"
                        value={editHeightMm}
                        onChange={(e) => setEditHeightMm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                  </div>
                )}

                {editPartType === "cable_tie" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="text-[9px] font-semibold text-[#505050] block">
                        Length (mm) *
                      </label>
                      <input
                        ref={dim1InputRef}
                        type="number"
                        step="any"
                        placeholder="200"
                        value={editLengthMm}
                        onChange={(e) => setEditLengthMm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-semibold text-[#505050] block">
                        Width (mm) *
                      </label>
                      <input
                        type="number"
                        step="any"
                        placeholder="4.8"
                        value={editWidthMm}
                        onChange={(e) => setEditWidthMm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                  </div>
                )}

                {(editPartType === "spring" || editPartType === "other") && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-[#707070] font-semibold">Mode:</span>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="springOtherMode"
                          checked={springOtherMode === "od_length"}
                          onChange={() => setSpringOtherMode("od_length")}
                          className="size-3"
                        />
                        <span>OD × Length</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="springOtherMode"
                          checked={springOtherMode === "width_height"}
                          onChange={() => setSpringOtherMode("width_height")}
                          className="size-3"
                        />
                        <span>Width × Height</span>
                      </label>
                    </div>

                    {springOtherMode === "od_length" ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="text-[9px] font-semibold text-[#505050] block">
                            Outer Ø (mm) *
                          </label>
                          <input
                            ref={dim1InputRef}
                            type="number"
                            step="any"
                            placeholder="12"
                            value={editOdMm}
                            onChange={(e) => setEditOdMm(e.target.value)}
                            onKeyDown={handleDimensionKeyDown}
                            className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-[#505050] block">
                            Length (mm) *
                          </label>
                          <input
                            type="number"
                            step="any"
                            placeholder="35"
                            value={editLengthMm}
                            onChange={(e) => setEditLengthMm(e.target.value)}
                            onKeyDown={handleDimensionKeyDown}
                            className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="text-[9px] font-semibold text-[#505050] block">
                            Width (mm) *
                          </label>
                          <input
                            ref={dim1InputRef}
                            type="number"
                            step="any"
                            placeholder="20"
                            value={editWidthMm}
                            onChange={(e) => setEditWidthMm(e.target.value)}
                            onKeyDown={handleDimensionKeyDown}
                            className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-[#505050] block">
                            Height (mm) *
                          </label>
                          <input
                            type="number"
                            step="any"
                            placeholder="40"
                            value={editHeightMm}
                            onChange={(e) => setEditHeightMm(e.target.value)}
                            onKeyDown={handleDimensionKeyDown}
                            className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-[9px] text-[#707070] block">Note (optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. Left-hand wind, compression"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white"
                      />
                    </div>
                  </div>
                )}

                {/* Dynamic custom part class fields */}
                {editPartType !== "none" &&
                  !["bolt", "nut", "washer", "label", "cable_tie", "spring", "other"].includes(
                    editPartType,
                  ) && (
                    <div className="flex flex-col gap-2">
                      {(() => {
                        const def = partTypesMap.get(editPartType);
                        const fields = def?.fields ?? [];
                        const reqs = new Set(def?.required_fields ?? []);
                        if (fields.length === 0) {
                          return (
                            <p className="text-[10px] text-[#707070] italic">
                              No structured metrology fields defined for this class.
                            </p>
                          );
                        }
                        return (
                          <div className="grid grid-cols-2 gap-2">
                            {fields.includes("thread") && (
                              <div>
                                <label className="text-[9px] font-semibold text-[#505050] block">
                                  Thread {reqs.has("thread") && "*"}
                                </label>
                                <input
                                  type="text"
                                  placeholder="e.g. M8"
                                  value={editThread}
                                  onChange={(e) => setEditThread(e.target.value)}
                                  onKeyDown={handleDimensionKeyDown}
                                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                />
                              </div>
                            )}
                            {fields.includes("length_mm") && (
                              <div>
                                <label className="text-[9px] font-semibold text-[#505050] block">
                                  Length (mm) {reqs.has("length_mm") && "*"}
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="mm"
                                  value={editLengthMm}
                                  onChange={(e) => setEditLengthMm(e.target.value)}
                                  onKeyDown={handleDimensionKeyDown}
                                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                />
                              </div>
                            )}
                            {fields.includes("head_type") && (
                              <div>
                                <label className="text-[9px] font-semibold text-[#505050] block">
                                  Head Type {reqs.has("head_type") && "*"}
                                </label>
                                <input
                                  type="text"
                                  placeholder="e.g. Hex, Socket"
                                  value={editHeadType}
                                  onChange={(e) => setEditHeadType(e.target.value)}
                                  onKeyDown={handleDimensionKeyDown}
                                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                />
                              </div>
                            )}
                            {fields.includes("af_mm") && (
                              <div>
                                <label className="text-[9px] font-semibold text-[#505050] block">
                                  Across Flats AF (mm) {reqs.has("af_mm") && "*"}
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="mm"
                                  value={editAfMm}
                                  onChange={(e) => setEditAfMm(e.target.value)}
                                  onKeyDown={handleDimensionKeyDown}
                                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                />
                              </div>
                            )}
                            {fields.includes("height_mm") && (
                              <div>
                                <label className="text-[9px] font-semibold text-[#505050] block">
                                  Height (mm) {reqs.has("height_mm") && "*"}
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="mm"
                                  value={editHeightMm}
                                  onChange={(e) => setEditHeightMm(e.target.value)}
                                  onKeyDown={handleDimensionKeyDown}
                                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                />
                              </div>
                            )}
                            {fields.includes("od_mm") && (
                              <div>
                                <label className="text-[9px] font-semibold text-[#505050] block">
                                  Outer Ø OD (mm) {reqs.has("od_mm") && "*"}
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="mm"
                                  value={editOdMm}
                                  onChange={(e) => setEditOdMm(e.target.value)}
                                  onKeyDown={handleDimensionKeyDown}
                                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                />
                              </div>
                            )}
                            {fields.includes("id_mm") && (
                              <div>
                                <label className="text-[9px] font-semibold text-[#505050] block">
                                  Inner Ø ID (mm) {reqs.has("id_mm") && "*"}
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="mm"
                                  value={editIdMm}
                                  onChange={(e) => setEditIdMm(e.target.value)}
                                  onKeyDown={handleDimensionKeyDown}
                                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                />
                              </div>
                            )}
                            {fields.includes("thickness_mm") && (
                              <div>
                                <label className="text-[9px] font-semibold text-[#505050] block">
                                  Thickness (mm) {reqs.has("thickness_mm") && "*"}
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="mm"
                                  value={editThicknessMm}
                                  onChange={(e) => setEditThicknessMm(e.target.value)}
                                  onKeyDown={handleDimensionKeyDown}
                                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                />
                              </div>
                            )}
                            {fields.includes("width_mm") && (
                              <div>
                                <label className="text-[9px] font-semibold text-[#505050] block">
                                  Width (mm) {reqs.has("width_mm") && "*"}
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="mm"
                                  value={editWidthMm}
                                  onChange={(e) => setEditWidthMm(e.target.value)}
                                  onKeyDown={handleDimensionKeyDown}
                                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                />
                              </div>
                            )}
                            {fields.includes("note") && (
                              <div className="col-span-2">
                                <label className="text-[9px] font-semibold text-[#505050] block">
                                  Note / Detail {reqs.has("note") && "*"}
                                </label>
                                <input
                                  type="text"
                                  placeholder="Material, color or custom note"
                                  value={editNote}
                                  onChange={(e) => setEditNote(e.target.value)}
                                  onKeyDown={handleDimensionKeyDown}
                                  className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                {editPartType === "none" && (
                  <p className="text-[10px] text-[#707070] italic">
                    Select a part type to enter structured metrology.
                  </p>
                )}

                {/* Generated canonical string display */}
                {editPartType !== "none" && (
                  <div className="flex flex-col gap-1 p-2 bg-[#f8fafc] border border-[#cbd5e1] rounded-[2px]">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-[#64748b] uppercase font-semibold text-[9px] tracking-wide">
                        Display String:
                      </span>
                      <span className="font-mono font-bold text-[#0f172a]">
                        {previewDimensions || "—"}
                      </span>
                    </div>
                    {selectedClass.dimensions && selectedClass.dimensions !== previewDimensions && (
                      <div className="text-[9px] text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-[2px] border border-amber-200">
                        Original text:{" "}
                        <span className="font-mono font-medium">{selectedClass.dimensions}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-[#f0f0f0]">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSaveSelectedClass()}
                  className="press h-7 w-full rounded-[2px] bg-[#1473e6] hover:bg-[#0d62c7] text-white font-semibold text-xs flex items-center justify-center gap-1.5"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  <span>Save Class Changes</span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (pendingDeleteId !== selectedClass.id) {
                      setPendingDeleteId(selectedClass.id);
                    } else {
                      void handleDeleteClass(selectedClass.id);
                    }
                  }}
                  className={`press h-7 w-full rounded-[2px] border font-medium text-xs flex items-center justify-center gap-1.5 ${
                    pendingDeleteId === selectedClass.id
                      ? "bg-red-600 text-white border-red-600"
                      : "border-[#c8c8c8] text-red-600 hover:bg-red-50"
                  }`}
                >
                  <Trash2 className="size-3.5" />
                  <span>
                    {pendingDeleteId === selectedClass.id ? "Confirm Delete" : "Delete Class"}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-[#707070] text-xs">
              Select a class row from the table to inspect and edit its item code, description, and
              measurements.
            </div>
          )}
        </aside>
      </div>

      {/* Dataset Health Modal */}
      {healthResult && (
        <DatasetHealthModal
          health={healthResult}
          onClose={() => setHealthResult(null)}
          onOpenDuplicates={() => {
            if (healthResult.duplicates) {
              setDuplicatesResult(healthResult.duplicates);
            }
          }}
        />
      )}

      {codeMenu &&
        createPortal(
          <div
            ref={codeMenuRef}
            role="menu"
            aria-label="Class selection"
            className="fixed z-50 min-w-[148px] rounded-[2px] border border-[#c8c8c8] bg-white py-0.5 text-xs"
            style={{ left: codeMenu.x, top: codeMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              className="press flex w-full items-center px-2 py-1 text-left text-[11px] text-[#282828] hover:bg-[#1473e6]/10"
              onClick={() => void handleCopyAllCodes(codeMenu.text)}
            >
              Copy all codes
            </button>
          </div>,
          document.body,
        )}

      {/* Duplicate Cleanup Modal */}
      {duplicatesResult && (
        <DuplicateCleanupModal
          isOpen={true}
          projectId={healthResult?.projectId}
          projectName={healthResult?.projectName}
          duplicates={duplicatesResult}
          onClose={() => setDuplicatesResult(null)}
          onCleanupComplete={async () => {
            await load();
            try {
              const updatedHealth = await fetchProjectHealth();
              setHealthResult(updatedHealth);
            } catch {
              /* ignore */
            }
          }}
        />
      )}
    </div>
  );
}
