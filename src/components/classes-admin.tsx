import { BarChart3, Check, FileUp, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { DatasetHealthModal } from "@/components/dataset-health-modal";
import { DuplicateCleanupModal } from "@/components/duplicate-cleanup-modal";
import { classFill } from "@/lib/class-color";
import { ColumnResizeHandle, useColumnResize } from "@/lib/use-column-resize";
import {
  createClass,
  deleteClass,
  fetchCatalogue,
  fetchProjectHealth,
  importClasses,
  updateClass,
  type ClassRow,
  type DuplicateDetectionResult,
  type PartType,
  type ProjectHealthResult,
} from "@/lib/label-client";

export const PART_TYPE_OPTIONS: { value: PartType; label: string }[] = [
  { value: "none", label: "None (unset)" },
  { value: "bolt", label: "Bolt" },
  { value: "nut", label: "Nut" },
  { value: "washer", label: "Washer" },
  { value: "cable_tie", label: "Cable tie" },
  { value: "spring", label: "Spring" },
  { value: "other", label: "Other (custom)" },
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
  const label = PART_TYPE_OPTIONS.find((o) => o.value === pt)?.label ?? pt;
  const vals: string[] = [];
  if (row.dim1_mm != null) {
    vals.push(
      pt === "other" && row.dim1_name ? `${row.dim1_name}: ${row.dim1_mm}mm` : `${row.dim1_mm}`,
    );
  }
  if (row.dim2_mm != null) {
    vals.push(
      pt === "other" && row.dim2_name ? `${row.dim2_name}: ${row.dim2_mm}mm` : `${row.dim2_mm}`,
    );
  }
  if (row.dim3_mm != null) {
    vals.push(
      pt === "other" && row.dim3_name ? `${row.dim3_name}: ${row.dim3_mm}mm` : `${row.dim3_mm}`,
    );
  }
  if (vals.length === 0) return `${label} (no dims)`;
  return pt === "other" ? `${label} (${vals.join(", ")})` : `${label}: ${vals.join(" × ")} mm`;
}

export function hasCompleteMeasurements(row: ClassRow): boolean {
  const pt = row.part_type;
  if (!pt || pt === "none") return false;
  const hasMm = (v: number | null | undefined) =>
    v !== null && v !== undefined && Number.isFinite(Number(v));
  const hasName = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

  if (pt === "bolt" || pt === "nut" || pt === "cable_tie" || pt === "spring") {
    return hasMm(row.dim1_mm) && hasMm(row.dim2_mm);
  }
  if (pt === "washer") {
    return hasMm(row.dim1_mm) && hasMm(row.dim2_mm) && hasMm(row.dim3_mm);
  }
  if (pt === "other") {
    const pairs: [boolean, boolean][] = [
      [hasName(row.dim1_name), hasMm(row.dim1_mm)],
      [hasName(row.dim2_name), hasMm(row.dim2_mm)],
      [hasName(row.dim3_name), hasMm(row.dim3_mm)],
    ];
    const anyFilled = pairs.some(([n, m]) => n && m) || hasMm(row.dim1_mm);
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

export function ClassesAdmin() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);

  // Inspector edit state
  const [editIc, setEditIc] = useState("");
  const [editDes, setEditDes] = useState("");
  const [editPartType, setEditPartType] = useState<PartType>("none");
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
  const partTypeSelectRef = useRef<HTMLSelectElement>(null);
  const dim1InputRef = useRef<HTMLInputElement>(null);
  const dim1NameInputRef = useRef<HTMLInputElement>(null);
  const focusDimensionsPendingRef = useRef(false);

  const {
    widths: colWidths,
    handleResizeStart,
    resetWidth,
  } = useColumnResize<ClassCol>("ls_marker_classes_col_widths", CLASS_COLUMNS);

  async function load() {
    const data = await fetchCatalogue();
    setClasses(data.classes);
  }

  useEffect(() => {
    let cancel = false;
    fetchCatalogue()
      .then((data) => {
        if (!cancel) setClasses(data.classes);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load classes");
      });
    return () => {
      cancel = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!classes) return [];
    if (!query.trim()) return classes;
    const q = query.toLowerCase();
    return classes.filter(
      (c) =>
        c.ic.toLowerCase().includes(q) ||
        c.des.toLowerCase().includes(q) ||
        String(c.id).includes(q),
    );
  }, [classes, query]);

  const selectedClass = useMemo(() => {
    return (classes ?? []).find((c) => c.id === selectedClassId) ?? null;
  }, [classes, selectedClassId]);

  useEffect(() => {
    if (selectedClass) {
      setEditIc(selectedClass.ic);
      setEditDes(selectedClass.des);
      setEditPartType((selectedClass.part_type as PartType) || "none");
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
    if (!selectedClassId && filtered.length > 0) {
      setSelectedClassId(filtered[0].id);
    }
  }, [filtered, selectedClassId]);

  // Scroll active row into view
  useEffect(() => {
    if (selectedClassId != null && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedClassId]);

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

  function parseOptionalMm(val: string): number | null {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) && num >= 0 ? num : null;
  }

  async function handleAddClass(e: React.FormEvent) {
    e.preventDefault();
    if (!newIc.trim() || !newDes.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createClass(newIc.trim(), newDes.trim(), newPartType);
      focusDimensionsPendingRef.current = true;
      await load();
      setQuery("");
      setSelectedClassId(created.id);
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

  async function handleSaveSelectedClass() {
    if (!selectedClass) return;
    setBusy(true);
    setError(null);
    try {
      await updateClass({
        id: selectedClass.id,
        ic: editIc.trim(),
        des: editDes.trim(),
        part_type: editPartType,
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
      await load();
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
      await load();
      setSelectedClassId(null);
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
            {PART_TYPE_OPTIONS.map((opt) => (
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
          {/* Scrollable Table Viewport */}
          <div className="flex-1 min-h-0 flex flex-col overflow-x-auto">
            <div className="min-w-full w-max flex-1 min-h-0 flex flex-col">
              {/* Table Header */}
              <div className="h-6 border-b border-[#c8c8c8] bg-[#f5f5f5] flex items-center px-2 text-[11px] font-semibold text-[#707070] shrink-0 select-none">
                <div
                  className="relative shrink-0 flex items-center pr-2"
                  style={{ width: colWidths.id }}
                >
                  <span className="truncate">ID</span>
                  <ColumnResizeHandle
                    column="id"
                    onResizeStart={handleResizeStart}
                    onReset={resetWidth}
                  />
                </div>
                <div
                  className="relative shrink-0 flex items-center pr-2"
                  style={{ width: colWidths.color }}
                >
                  <span className="truncate">Color</span>
                  <ColumnResizeHandle
                    column="color"
                    onResizeStart={handleResizeStart}
                    onReset={resetWidth}
                  />
                </div>
                <div
                  className="relative shrink-0 flex items-center pr-2 min-w-0"
                  style={{ width: colWidths.code }}
                >
                  <span className="truncate">Code</span>
                  <ColumnResizeHandle
                    column="code"
                    onResizeStart={handleResizeStart}
                    onReset={resetWidth}
                  />
                </div>
                <div
                  className="relative shrink-0 flex items-center pr-2 min-w-0"
                  style={{ width: colWidths.des }}
                >
                  <span className="truncate">Description</span>
                  <ColumnResizeHandle
                    column="des"
                    onResizeStart={handleResizeStart}
                    onReset={resetWidth}
                  />
                </div>
                <div
                  className="relative shrink-0 flex items-center pr-2 min-w-0"
                  style={{ width: colWidths.dims }}
                >
                  <span className="truncate">Dimensions</span>
                  <ColumnResizeHandle
                    column="dims"
                    onResizeStart={handleResizeStart}
                    onReset={resetWidth}
                  />
                </div>
                <div
                  className="relative shrink-0 flex items-center pr-2 min-w-0"
                  style={{ width: colWidths.status }}
                >
                  <span className="truncate">Status</span>
                  <ColumnResizeHandle
                    column="status"
                    onResizeStart={handleResizeStart}
                    onReset={resetWidth}
                  />
                </div>
                <div className="flex-1 min-w-0" />
              </div>

              {/* Table Body (Scrollable Internally) */}
              <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#f0f0f0]">
                {filtered.length === 0 ? (
                  <div className="p-4 text-center text-[#707070] text-xs">
                    {classes ? "No classes match active search." : "Loading classes..."}
                  </div>
                ) : (
                  filtered.map((row) => {
                    const isSelected = selectedClassId === row.id;
                    const complete = hasCompleteMeasurements(row);
                    const hasPartType = row.part_type && row.part_type !== "none";
                    const summary = formatPartSummary(row);

                    return (
                      <div
                        key={row.id}
                        ref={isSelected ? activeRowRef : undefined}
                        onClick={() => setSelectedClassId(row.id)}
                        className={`flex items-center px-2 py-1 cursor-pointer transition-colors text-xs border-l-2 ${
                          isSelected
                            ? "bg-[#1473e6]/10 border-[#1473e6]"
                            : "border-transparent hover:bg-[#f9f9f9]"
                        }`}
                      >
                        {/* Numeric ID */}
                        <div
                          className="shrink-0 pr-2 font-mono text-[10px] text-[#707070]"
                          style={{ width: colWidths.id }}
                        >
                          #{row.id}
                        </div>

                        {/* Color Swatch */}
                        <div
                          className="shrink-0 pr-2 flex items-center"
                          style={{ width: colWidths.color }}
                        >
                          <span
                            className="size-2.5 rounded-[1px] inline-block border border-black/15"
                            style={{ backgroundColor: classFill(row.id, row.color) }}
                          />
                        </div>

                        {/* Code */}
                        <div
                          className="shrink-0 pr-2 font-bold font-mono text-[11px] text-[#282828] truncate min-w-0"
                          style={{ width: colWidths.code }}
                        >
                          {row.ic}
                        </div>

                        {/* Description */}
                        <div
                          className="shrink-0 pr-2 text-[#707070] truncate text-[11px] min-w-0"
                          style={{ width: colWidths.des }}
                        >
                          {row.des}
                        </div>

                        {/* Dimensions Summary */}
                        <div
                          className="shrink-0 pr-2 font-mono text-[10px] text-[#707070] truncate min-w-0"
                          style={{ width: colWidths.dims }}
                        >
                          {summary ?? "—"}
                        </div>

                        {/* Status Badge */}
                        <div className="shrink-0 pr-2 min-w-0" style={{ width: colWidths.status }}>
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
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
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
                  {PART_TYPE_OPTIONS.map((opt) => (
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

                {/* Specific Fields by Type */}
                {editPartType === "bolt" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="text-[9px] text-[#707070] block">
                        Length under head (mm)
                      </label>
                      <input
                        ref={dim1InputRef}
                        type="number"
                        step="any"
                        placeholder="40"
                        value={editDim1Mm}
                        onChange={(e) => setEditDim1Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-[#707070] block">Thread Ø (mm)</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="8"
                        value={editDim2Mm}
                        onChange={(e) => setEditDim2Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                  </div>
                )}

                {editPartType === "nut" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="text-[9px] text-[#707070] block">
                        Across flats A/F (mm)
                      </label>
                      <input
                        ref={dim1InputRef}
                        type="number"
                        step="any"
                        placeholder="13"
                        value={editDim1Mm}
                        onChange={(e) => setEditDim1Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-[#707070] block">Height (mm)</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="6.5"
                        value={editDim2Mm}
                        onChange={(e) => setEditDim2Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                  </div>
                )}

                {editPartType === "washer" && (
                  <div className="grid grid-cols-3 gap-1">
                    <div>
                      <label className="text-[9px] text-[#707070] block">Outer Ø (mm)</label>
                      <input
                        ref={dim1InputRef}
                        type="number"
                        step="any"
                        placeholder="16"
                        value={editDim1Mm}
                        onChange={(e) => setEditDim1Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-[#707070] block">Inner Ø (mm)</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="8.4"
                        value={editDim2Mm}
                        onChange={(e) => setEditDim2Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-[#707070] block">Thick (mm)</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="1.6"
                        value={editDim3Mm}
                        onChange={(e) => setEditDim3Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                  </div>
                )}

                {editPartType === "cable_tie" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="text-[9px] text-[#707070] block">Length (mm)</label>
                      <input
                        ref={dim1InputRef}
                        type="number"
                        step="any"
                        placeholder="200"
                        value={editDim1Mm}
                        onChange={(e) => setEditDim1Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-[#707070] block">Width (mm)</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="4.8"
                        value={editDim2Mm}
                        onChange={(e) => setEditDim2Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                  </div>
                )}

                {editPartType === "spring" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="text-[9px] text-[#707070] block">Height (mm)</label>
                      <input
                        ref={dim1InputRef}
                        type="number"
                        step="any"
                        placeholder="35"
                        value={editDim1Mm}
                        onChange={(e) => setEditDim1Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-[#707070] block">Diameter (mm)</label>
                      <input
                        type="number"
                        step="any"
                        placeholder="12"
                        value={editDim2Mm}
                        onChange={(e) => setEditDim2Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                  </div>
                )}

                {editPartType === "other" && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex gap-1">
                      <input
                        ref={dim1NameInputRef}
                        type="text"
                        placeholder="Dim 1 name"
                        value={editDim1Name}
                        onChange={(e) => setEditDim1Name(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white"
                      />
                      <input
                        ref={dim1InputRef}
                        type="number"
                        step="any"
                        placeholder="mm"
                        value={editDim1Mm}
                        onChange={(e) => setEditDim1Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        placeholder="Dim 2 name"
                        value={editDim2Name}
                        onChange={(e) => setEditDim2Name(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white"
                      />
                      <input
                        type="number"
                        step="any"
                        placeholder="mm"
                        value={editDim2Mm}
                        onChange={(e) => setEditDim2Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        placeholder="Dim 3 name"
                        value={editDim3Name}
                        onChange={(e) => setEditDim3Name(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white"
                      />
                      <input
                        type="number"
                        step="any"
                        placeholder="mm"
                        value={editDim3Mm}
                        onChange={(e) => setEditDim3Mm(e.target.value)}
                        onKeyDown={handleDimensionKeyDown}
                        className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                      />
                    </div>
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
