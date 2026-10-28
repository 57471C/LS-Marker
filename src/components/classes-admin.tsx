import { useEffect, useState } from "react";
import { BarChart3, HelpCircle, Loader2, Ruler, X } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DatasetHealthModal } from "@/components/dataset-health-modal";
import { classFill } from "@/lib/class-color";
import {
  createClass,
  deleteClass,
  fetchCatalogue,
  fetchProjectHealth,
  importClasses,
  updateClass,
  type ClassRow,
  type PartType,
  type ProjectHealthResult,
} from "@/lib/label-client";

const field =
  "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
const fieldSm =
  "h-9 w-full rounded-sm border border-line bg-bg px-2.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink disabled:opacity-40";
const btnPrimary =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-ink px-4 text-sm font-medium text-surface disabled:opacity-40";

const PART_TYPE_OPTIONS: { value: PartType; label: string }[] = [
  { value: "none", label: "None (unset)" },
  { value: "bolt", label: "Bolt" },
  { value: "nut", label: "Nut" },
  { value: "washer", label: "Washer" },
  { value: "cable_tie", label: "Cable tie" },
  { value: "spring", label: "Spring" },
  { value: "other", label: "Other (custom)" },
];

function formatPartSummary(row: ClassRow): string | null {
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
  if (vals.length === 0) return `${label} (no dimensions)`;
  return pt === "other" ? `${label} (${vals.join(", ")})` : `${label}: ${vals.join(" × ")} mm`;
}

function hasCompleteMeasurements(row: ClassRow): boolean {
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

function PartDimensionStatusIcon({
  row,
  partSummary,
  onClick,
}: {
  row: ClassRow;
  partSummary: string | null;
  onClick: () => void;
}) {
  const complete = hasCompleteMeasurements(row);
  const pt = row.part_type ?? "none";

  if (!complete) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={partSummary ? `Incomplete dimensions: ${partSummary}` : "No measurement data"}
        aria-label={partSummary ? `Incomplete dimensions: ${partSummary}` : "No measurement data"}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100"
      >
        <Ruler className="size-3.5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={partSummary ?? "Part dimensions recorded"}
      aria-label={partSummary ?? "Part dimensions recorded"}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-emerald-300 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
    >
      {pt === "bolt" ? (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          {/* Bolt head */}
          <rect
            x="2"
            y="3.5"
            width="3.5"
            height="9"
            rx="0.8"
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          {/* Threaded shaft */}
          <rect
            x="5.5"
            y="5.5"
            width="8.5"
            height="5"
            rx="0.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <line x1="8" y1="5.5" x2="8" y2="10.5" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10.5" y1="5.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      ) : pt === "nut" ? (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          {/* Hexagon nut */}
          <polygon
            points="8,1.8 13.5,5 13.5,11 8,14.2 2.5,11 2.5,5"
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="8" r="2.3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ) : pt === "washer" ? (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          {/* Concentric washer rings */}
          <circle
            cx="8"
            cy="8"
            r="5.8"
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle
            cx="8"
            cy="8"
            r="2.5"
            fill="var(--color-surface, #fff)"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      ) : pt === "cable_tie" ? (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          {/* Cable tie head + strap */}
          <rect
            x="1.8"
            y="4.5"
            width="4"
            height="7"
            rx="1"
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M5.8 6.5 H13.5 L14.5 8 L13.5 9.5 H5.8 Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ) : pt === "spring" ? (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          {/* Spring coil */}
          <path
            d="M5 2.5 C11 2.5 11 5 8 5 C5 5 5 7.5 11 7.5 C5 7.5 5 10 11 10 C5 10 5 12.5 11 12.5 C5 12.5 5 13.5 8 13.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <Ruler className="size-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

export function ClassesAdmin() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ic, setIc] = useState("");
  const [des, setDes] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
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

  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);

  const [healthResult, setHealthResult] = useState<ProjectHealthResult | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  async function load() {
    const data = await fetchCatalogue();
    setClasses(data.classes);
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

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function parseOptionalMm(val: string): number | null {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) && num >= 0 ? num : null;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <AppHeader current="classes" />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-medium tracking-tight">Classes</h1>
            <p className="max-w-xl text-sm text-muted">
              The number is the YOLO class id stored in each label file. Ids stay put when you
              rename a code. A removed id is left blank in classes.txt and is not reused. Each class
              is given a colour on its own — you don't pick one.
            </p>
          </div>
          <div className="shrink-0">
            <button
              type="button"
              className="press inline-flex h-10 items-center gap-2 rounded-sm border border-line bg-surface px-3.5 text-xs font-medium text-ink hover:bg-surface-raised disabled:opacity-40"
              disabled={loadingHealth}
              onClick={() => void handleOpenHealth()}
              title="Inspect dataset composition & class distribution"
            >
              {loadingHealth ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <BarChart3 className="size-3.5 text-cyan-500" aria-hidden="true" />
              )}
              <span>Dataset Health</span>
            </button>
          </div>
        </div>
        {error ? (
          <p className="rounded-sm border border-line bg-surface px-3 py-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <form
          className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await createClass(ic, des);
              setIc("");
              setDes("");
            });
          }}
        >
          <label className="flex flex-col gap-2 text-sm font-medium">
            Item code
            <input
              className={field}
              value={ic}
              onChange={(event) => setIc(event.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Description
            <input
              className={field}
              value={des}
              onChange={(event) => setDes(event.target.value)}
              required
            />
          </label>
          <div className="flex items-end">
            <button type="submit" className={btnPrimary} disabled={busy}>
              Add class
            </button>
          </div>
        </form>
        <form
          className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("classes-csv");
            const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
            if (!file) return;
            void run(async () => {
              const csv = await file.text();
              const result = await importClasses(csv);
              setImportNote(
                `Added ${result.added}. Ignored ${result.skipped} duplicates${result.invalid ? ` and ${result.invalid} invalid rows` : ""}.`,
              );
              if (input instanceof HTMLInputElement) input.value = "";
            });
          }}
        >
          <label className="flex flex-col gap-2 text-sm font-medium">
            CSV
            <input
              id="classes-csv"
              name="classes-csv"
              className={field}
              type="file"
              accept=".csv,text/csv,text/plain"
            />
          </label>
          <p className="text-sm text-muted">
            Columns <span className="font-mono">ic</span> and <span className="font-mono">des</span>
            . A code already in the list is skipped.
          </p>
          {importNote ? <p className="text-sm">{importNote}</p> : null}
          <div>
            <button type="submit" className={btn} disabled={busy}>
              Upload CSV
            </button>
          </div>
        </form>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Find
          <input
            className={field}
            value={query}
            placeholder="Item code or description"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <ClassList
          classes={classes}
          query={query}
          editing={editing}
          editIc={editIc}
          editDes={editDes}
          editPartType={editPartType}
          editDim1Name={editDim1Name}
          editDim1Mm={editDim1Mm}
          editDim2Name={editDim2Name}
          editDim2Mm={editDim2Mm}
          editDim3Name={editDim3Name}
          editDim3Mm={editDim3Mm}
          showDiagramHelp={showDiagramHelp}
          pendingDelete={pendingDelete}
          busy={busy}
          onEditIc={setEditIc}
          onEditDes={setEditDes}
          onEditPartType={(pt) => {
            setEditPartType(pt);
            if (pt === "none") {
              setShowDiagramHelp(false);
            }
          }}
          onEditDim1Name={setEditDim1Name}
          onEditDim1Mm={setEditDim1Mm}
          onEditDim2Name={setEditDim2Name}
          onEditDim2Mm={setEditDim2Mm}
          onEditDim3Name={setEditDim3Name}
          onEditDim3Mm={setEditDim3Mm}
          onToggleDiagramHelp={() => setShowDiagramHelp((prev) => !prev)}
          onStartEdit={(row) => {
            setEditing(row.id);
            setEditIc(row.ic);
            setEditDes(row.des);
            const pt = (row.part_type as PartType) || "none";
            setEditPartType(pt);
            setEditDim1Name(row.dim1_name ?? "");
            setEditDim1Mm(row.dim1_mm != null ? String(row.dim1_mm) : "");
            setEditDim2Name(row.dim2_name ?? "");
            setEditDim2Mm(row.dim2_mm != null ? String(row.dim2_mm) : "");
            setEditDim3Name(row.dim3_name ?? "");
            setEditDim3Mm(row.dim3_mm != null ? String(row.dim3_mm) : "");
            setShowDiagramHelp(false);
            setPendingDelete(null);
          }}
          onCancelEdit={() => {
            setEditing(null);
            setShowDiagramHelp(false);
          }}
          onSaveEdit={(row) => {
            void run(async () => {
              await updateClass({
                id: row.id,
                ic: editIc,
                des: editDes,
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
              setEditing(null);
              setShowDiagramHelp(false);
            });
          }}
          onDelete={(row) => {
            if (pendingDelete !== row.id) {
              setPendingDelete(row.id);
              return;
            }
            void run(async () => {
              await deleteClass(row.id);
              setPendingDelete(null);
            });
          }}
        />
        <p className="max-w-xl text-sm text-muted">
          Saving a free image claims it for you. Someone else’s claim has to be taken over before
          you can change it.
        </p>
        {healthResult ? (
          <DatasetHealthModal health={healthResult} onClose={() => setHealthResult(null)} />
        ) : null}
      </main>
    </div>
  );
}

const LIST_CAP = 80;

function ClassList({
  classes,
  query,
  editing,
  editIc,
  editDes,
  editPartType,
  editDim1Name,
  editDim1Mm,
  editDim2Name,
  editDim2Mm,
  editDim3Name,
  editDim3Mm,
  showDiagramHelp,
  pendingDelete,
  busy,
  onEditIc,
  onEditDes,
  onEditPartType,
  onEditDim1Name,
  onEditDim1Mm,
  onEditDim2Name,
  onEditDim2Mm,
  onEditDim3Name,
  onEditDim3Mm,
  onToggleDiagramHelp,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  classes: ClassRow[] | null;
  query: string;
  editing: number | null;
  editIc: string;
  editDes: string;
  editPartType: PartType;
  editDim1Name: string;
  editDim1Mm: string;
  editDim2Name: string;
  editDim2Mm: string;
  editDim3Name: string;
  editDim3Mm: string;
  showDiagramHelp: boolean;
  pendingDelete: number | null;
  busy: boolean;
  onEditIc: (value: string) => void;
  onEditDes: (value: string) => void;
  onEditPartType: (value: PartType) => void;
  onEditDim1Name: (value: string) => void;
  onEditDim1Mm: (value: string) => void;
  onEditDim2Name: (value: string) => void;
  onEditDim2Mm: (value: string) => void;
  onEditDim3Name: (value: string) => void;
  onEditDim3Mm: (value: string) => void;
  onToggleDiagramHelp: () => void;
  onStartEdit: (row: ClassRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (row: ClassRow) => void;
  onDelete: (row: ClassRow) => void;
}) {
  const needle = query.trim().toLowerCase();
  const matched = (classes ?? []).filter((row) => {
    if (!needle) return true;
    return row.ic.toLowerCase().includes(needle) || row.des.toLowerCase().includes(needle);
  });
  const shown = matched.slice(0, LIST_CAP);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        {classes == null
          ? "Loading"
          : matched.length > shown.length
            ? `Showing ${shown.length} of ${matched.length}`
            : `${matched.length} classes`}
      </p>
      <ul className="flex flex-col gap-2">
        {shown.map((row) => {
          const isEditing = editing === row.id;
          const partSummary = formatPartSummary(row);
          return (
            <li key={row.id} className="rounded-lg border border-line bg-surface p-3">
              {isEditing ? (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSaveEdit(row);
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-[5.5rem_1fr_1fr_auto]">
                    <p className="flex h-11 items-center gap-2 font-mono text-sm tabular-nums">
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ background: classFill(row.id, row.color) }}
                        aria-hidden="true"
                      />
                      {row.id}
                    </p>
                    <input
                      className={field}
                      value={editIc}
                      onChange={(event) => onEditIc(event.target.value)}
                      placeholder="Item code"
                      required
                    />
                    <input
                      className={field}
                      value={editDes}
                      onChange={(event) => onEditDes(event.target.value)}
                      placeholder="Description"
                      required
                    />
                    <div className="flex gap-2">
                      <button type="submit" className={btnPrimary} disabled={busy}>
                        Save
                      </button>
                      <button type="button" className={btn} onClick={onCancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </div>

                  {/* Optional Part Dimensions Section */}
                  <div className="flex flex-col gap-3 rounded-lg border border-line bg-bg/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Ruler className="size-4 text-muted" aria-hidden="true" />
                        <span className="text-xs font-semibold tracking-wide text-ink">
                          Part Dimensions (Optional Reference Metadata)
                        </span>
                      </div>
                      {editPartType !== "none" ? (
                        <button
                          type="button"
                          onClick={onToggleDiagramHelp}
                          className={`press inline-flex h-7 items-center gap-1 rounded-sm border px-2 text-xs font-medium transition-colors ${
                            showDiagramHelp
                              ? "border-cyan-500 bg-cyan-500/15 text-cyan-800 dark:text-cyan-200"
                              : "border-line bg-surface text-muted hover:text-ink"
                          }`}
                          title="Show measurement guide diagram"
                          aria-expanded={showDiagramHelp}
                        >
                          <HelpCircle className="size-3.5" aria-hidden="true" />
                          <span>? How to measure</span>
                        </button>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                        Part type
                        <select
                          className={fieldSm}
                          value={editPartType}
                          onChange={(event) => onEditPartType(event.target.value as PartType)}
                        >
                          {PART_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      {editPartType === "bolt" ? (
                        <>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Length under head (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="e.g. 40"
                              className={fieldSm}
                              value={editDim1Mm}
                              onChange={(e) => onEditDim1Mm(e.target.value)}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Thread diameter (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="e.g. 8"
                              className={fieldSm}
                              value={editDim2Mm}
                              onChange={(e) => onEditDim2Mm(e.target.value)}
                            />
                          </label>
                        </>
                      ) : null}

                      {editPartType === "nut" ? (
                        <>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Across flats / A/F (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="e.g. 13"
                              className={fieldSm}
                              value={editDim1Mm}
                              onChange={(e) => onEditDim1Mm(e.target.value)}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Height (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="e.g. 6.5"
                              className={fieldSm}
                              value={editDim2Mm}
                              onChange={(e) => onEditDim2Mm(e.target.value)}
                            />
                          </label>
                        </>
                      ) : null}

                      {editPartType === "cable_tie" ? (
                        <>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Length (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="e.g. 200"
                              className={fieldSm}
                              value={editDim1Mm}
                              onChange={(e) => onEditDim1Mm(e.target.value)}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Width (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="e.g. 4.8"
                              className={fieldSm}
                              value={editDim2Mm}
                              onChange={(e) => onEditDim2Mm(e.target.value)}
                            />
                          </label>
                        </>
                      ) : null}

                      {editPartType === "spring" ? (
                        <>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Height (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="e.g. 35"
                              className={fieldSm}
                              value={editDim1Mm}
                              onChange={(e) => onEditDim1Mm(e.target.value)}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Diameter (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="e.g. 12"
                              className={fieldSm}
                              value={editDim2Mm}
                              onChange={(e) => onEditDim2Mm(e.target.value)}
                            />
                          </label>
                        </>
                      ) : null}
                    </div>

                    {editPartType === "washer" ? (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                          Outer diameter (mm)
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="e.g. 24"
                            className={fieldSm}
                            value={editDim1Mm}
                            onChange={(e) => onEditDim1Mm(e.target.value)}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                          Inner diameter (mm)
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="e.g. 8.4"
                            className={fieldSm}
                            value={editDim2Mm}
                            onChange={(e) => onEditDim2Mm(e.target.value)}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                          Thickness (mm)
                          <input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="e.g. 2"
                            className={fieldSm}
                            value={editDim3Mm}
                            onChange={(e) => onEditDim3Mm(e.target.value)}
                          />
                        </label>
                      </div>
                    ) : null}

                    {editPartType === "other" ? (
                      <div className="flex flex-col gap-2">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Dimension 1 Name
                            <input
                              type="text"
                              placeholder="e.g. Overall length"
                              className={fieldSm}
                              value={editDim1Name}
                              onChange={(e) => onEditDim1Name(e.target.value)}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Dimension 1 (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="mm"
                              className={fieldSm}
                              value={editDim1Mm}
                              onChange={(e) => onEditDim1Mm(e.target.value)}
                            />
                          </label>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Dimension 2 Name (optional)
                            <input
                              type="text"
                              placeholder="e.g. Width / OD"
                              className={fieldSm}
                              value={editDim2Name}
                              onChange={(e) => onEditDim2Name(e.target.value)}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Dimension 2 (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="mm"
                              className={fieldSm}
                              value={editDim2Mm}
                              onChange={(e) => onEditDim2Mm(e.target.value)}
                            />
                          </label>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Dimension 3 Name (optional)
                            <input
                              type="text"
                              placeholder="e.g. Height / Thickness"
                              className={fieldSm}
                              value={editDim3Name}
                              onChange={(e) => onEditDim3Name(e.target.value)}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                            Dimension 3 (mm)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              placeholder="mm"
                              className={fieldSm}
                              value={editDim3Mm}
                              onChange={(e) => onEditDim3Mm(e.target.value)}
                            />
                          </label>
                        </div>
                      </div>
                    ) : null}

                    {showDiagramHelp && editPartType !== "none" ? (
                      <PartMeasurementPopover
                        partType={editPartType}
                        onClose={onToggleDiagramHelp}
                      />
                    ) : null}
                  </div>
                </form>
              ) : (
                <div className="grid items-center gap-3 sm:grid-cols-[5.5rem_8rem_1fr_auto]">
                  <p className="flex items-center gap-2 font-mono text-sm tabular-nums">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ background: classFill(row.id, row.color) }}
                      aria-hidden="true"
                    />
                    {row.id}
                  </p>
                  <p className="truncate font-mono text-sm">{row.ic}</p>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="truncate text-sm text-muted">{row.des}</p>
                    {partSummary ? (
                      <p className="font-mono text-xs text-cyan-700 dark:text-cyan-300">
                        {partSummary}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <PartDimensionStatusIcon
                      row={row}
                      partSummary={partSummary}
                      onClick={() => onStartEdit(row)}
                    />
                    <button type="button" className={btn} onClick={() => onStartEdit(row)}>
                      Edit
                    </button>
                    <button type="button" className={btn} onClick={() => onDelete(row)}>
                      {pendingDelete === row.id ? "Confirm" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {classes && matched.length === 0 ? (
          <li className="text-sm text-muted">No classes match.</li>
        ) : null}
      </ul>
    </div>
  );
}

function PartMeasurementPopover({
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
      className="relative flex flex-col gap-2 rounded-md border border-cyan-500/40 bg-surface p-3 shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">
          Measurement Guide: {PART_TYPE_OPTIONS.find((o) => o.value === partType)?.label}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-6 items-center justify-center rounded-xs text-muted hover:text-ink"
          aria-label="Close measurement diagram"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      {partType === "bolt" ? (
        <div className="flex flex-col gap-2">
          <svg
            viewBox="0 0 340 120"
            className="h-28 w-full rounded bg-bg/80 p-2 text-ink"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            {/* Bolt Head */}
            <rect
              x="30"
              y="28"
              width="32"
              height="54"
              rx="2"
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
            <line x1="62" y1="82" x2="62" y2="106" stroke="#0891b2" strokeWidth="1.2" />
            <line x1="240" y1="68" x2="240" y2="106" stroke="#0891b2" strokeWidth="1.2" />
            <line x1="64" y1="98" x2="238" y2="98" stroke="#0891b2" strokeWidth="1.75" />
            <polygon points="62,98 70,94 70,102" fill="#0891b2" stroke="none" />
            <polygon points="240,98 232,94 232,102" fill="#0891b2" stroke="none" />
            <text
              x="151"
              y="113"
              textAnchor="middle"
              fill="#0891b2"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Length under head (mm)
            </text>

            {/* Thread diameter callout */}
            <line x1="240" y1="42" x2="275" y2="42" stroke="#d97706" strokeWidth="1.2" />
            <line x1="240" y1="68" x2="275" y2="68" stroke="#d97706" strokeWidth="1.2" />
            <line x1="266" y1="44" x2="266" y2="66" stroke="#d97706" strokeWidth="1.75" />
            <polygon points="266,42 262,49 270,49" fill="#d97706" stroke="none" />
            <polygon points="266,68 262,61 270,61" fill="#d97706" stroke="none" />
            <text x="274" y="58" fill="#d97706" fontSize="10" fontFamily="monospace" stroke="none">
              Thread Ø
            </text>
          </svg>
          <p className="text-xs text-muted">
            <strong>Length</strong> = underside of head to tip (exclude head height).{" "}
            <strong>Thread diameter</strong> = outer diameter across threads (e.g. 8 mm for M8).
          </p>
        </div>
      ) : null}

      {partType === "nut" ? (
        <div className="flex flex-col gap-2">
          <svg
            viewBox="0 0 340 120"
            className="h-28 w-full rounded bg-bg/80 p-2 text-ink"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            {/* Top Hex View */}
            <polygon
              points="75,24 115,24 132,54 115,84 75,84 58,54"
              fill="currentColor"
              fillOpacity="0.08"
            />
            <circle cx="95" cy="54" r="14" />

            {/* Across Flats callout */}
            <line x1="115" y1="24" x2="155" y2="24" stroke="#0891b2" strokeWidth="1.2" />
            <line x1="115" y1="84" x2="155" y2="84" stroke="#0891b2" strokeWidth="1.2" />
            <line x1="146" y1="26" x2="146" y2="82" stroke="#0891b2" strokeWidth="1.75" />
            <polygon points="146,24 142,31 150,31" fill="#0891b2" stroke="none" />
            <polygon points="146,84 142,77 150,77" fill="#0891b2" stroke="none" />
            <text
              x="95"
              y="106"
              textAnchor="middle"
              fill="#0891b2"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Across flats A/F (mm)
            </text>

            {/* Side Profile View */}
            <rect
              x="215"
              y="24"
              width="34"
              height="60"
              rx="2"
              fill="currentColor"
              fillOpacity="0.08"
            />
            <line x1="215" y1="40" x2="249" y2="40" strokeOpacity="0.5" />
            <line x1="215" y1="68" x2="249" y2="68" strokeOpacity="0.5" />

            {/* Height callout */}
            <line x1="215" y1="84" x2="215" y2="102" stroke="#d97706" strokeWidth="1.2" />
            <line x1="249" y1="84" x2="249" y2="102" stroke="#d97706" strokeWidth="1.2" />
            <line x1="217" y1="95" x2="247" y2="95" stroke="#d97706" strokeWidth="1.75" />
            <polygon points="215,95 222,91 222,99" fill="#d97706" stroke="none" />
            <polygon points="249,95 242,91 242,99" fill="#d97706" stroke="none" />
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
          <p className="text-xs text-muted">
            <strong>Across flats (A/F)</strong> = distance between two opposite flat sides (spanner
            size). <strong>Height</strong> = total thickness of nut from face to face.
          </p>
        </div>
      ) : null}

      {partType === "washer" ? (
        <div className="flex flex-col gap-2">
          <svg
            viewBox="0 0 340 120"
            className="h-28 w-full rounded bg-bg/80 p-2 text-ink"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            {/* Washer Front View */}
            <circle cx="95" cy="54" r="34" fill="currentColor" fillOpacity="0.08" />
            <circle cx="95" cy="54" r="14" fill="var(--color-bg)" />

            {/* Outer diameter callout */}
            <line x1="61" y1="54" x2="61" y2="100" stroke="#0891b2" strokeWidth="1.2" />
            <line x1="129" y1="54" x2="129" y2="100" stroke="#0891b2" strokeWidth="1.2" />
            <line x1="63" y1="94" x2="127" y2="94" stroke="#0891b2" strokeWidth="1.75" />
            <polygon points="61,94 68,90 68,98" fill="#0891b2" stroke="none" />
            <polygon points="129,94 122,90 122,98" fill="#0891b2" stroke="none" />
            <text
              x="95"
              y="110"
              textAnchor="middle"
              fill="#0891b2"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Outer Ø (OD)
            </text>

            {/* Inner diameter callout */}
            <line x1="81" y1="54" x2="109" y2="54" stroke="#10b981" strokeWidth="1.75" />
            <polygon points="81,54 87,51 87,57" fill="#10b981" stroke="none" />
            <polygon points="109,54 103,51 103,57" fill="#10b981" stroke="none" />
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

            {/* Side Thickness View */}
            <rect x="235" y="20" width="14" height="68" fill="currentColor" fillOpacity="0.1" />
            <line x1="235" y1="96" x2="249" y2="96" stroke="#d97706" strokeWidth="1.75" />
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
          <p className="text-xs text-muted">
            <strong>Outer diameter</strong> = outside edge to edge. <strong>Inner diameter</strong>{" "}
            = central hole diameter. <strong>Thickness</strong> = flat face to flat face.
          </p>
        </div>
      ) : null}

      {partType === "cable_tie" ? (
        <div className="flex flex-col gap-2">
          <svg
            viewBox="0 0 340 120"
            className="h-28 w-full rounded bg-bg/80 p-2 text-ink"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            {/* Cable Tie Head + Strap */}
            <rect
              x="28"
              y="38"
              width="22"
              height="24"
              rx="2"
              fill="currentColor"
              fillOpacity="0.1"
            />
            <polygon
              points="50,43 265,43 280,50 265,57 50,57"
              fill="currentColor"
              fillOpacity="0.06"
            />
            {/* Overall Length callout */}
            <line x1="28" y1="66" x2="28" y2="98" stroke="#0891b2" strokeWidth="1.2" />
            <line x1="280" y1="54" x2="280" y2="98" stroke="#0891b2" strokeWidth="1.2" />
            <line x1="30" y1="90" x2="278" y2="90" stroke="#0891b2" strokeWidth="1.75" />
            <polygon points="28,90 36,86 36,94" fill="#0891b2" stroke="none" />
            <polygon points="280,90 272,86 272,94" fill="#0891b2" stroke="none" />
            <text
              x="154"
              y="106"
              textAnchor="middle"
              fill="#0891b2"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Length (mm)
            </text>

            {/* Strap Width callout */}
            <line x1="292" y1="43" x2="292" y2="57" stroke="#d97706" strokeWidth="1.75" />
            <text x="300" y="54" fill="#d97706" fontSize="10" fontFamily="monospace" stroke="none">
              Width
            </text>
          </svg>
          <p className="text-xs text-muted">
            <strong>Length</strong> = total end-to-end length including locking head and tail.{" "}
            <strong>Width</strong> = strap width across the flat body.
          </p>
        </div>
      ) : null}

      {partType === "spring" ? (
        <div className="flex flex-col gap-2">
          <svg
            viewBox="0 0 340 120"
            className="h-28 w-full rounded bg-bg/80 p-2 text-ink"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            {/* Helical compression spring coils */}
            <path
              d="M130,25 C170,25 170,39 140,41 C110,43 110,57 170,57 C110,57 110,73 170,73 C110,73 110,89 170,89 C110,89 110,101 150,101"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {/* Height (Free Length) vertical callout on the right */}
            <line x1="185" y1="25" x2="225" y2="25" stroke="#0891b2" strokeWidth="1.2" />
            <line x1="185" y1="101" x2="225" y2="101" stroke="#0891b2" strokeWidth="1.2" />
            <line x1="215" y1="27" x2="215" y2="99" stroke="#0891b2" strokeWidth="1.75" />
            <polygon points="215,25 211,33 219,33" fill="#0891b2" stroke="none" />
            <polygon points="215,101 211,93 219,93" fill="#0891b2" stroke="none" />
            <text x="228" y="67" fill="#0891b2" fontSize="10" fontFamily="monospace" stroke="none">
              Height
            </text>

            {/* Diameter horizontal callout on the top */}
            <line x1="110" y1="22" x2="110" y2="10" stroke="#d97706" strokeWidth="1.2" />
            <line x1="170" y1="22" x2="170" y2="10" stroke="#d97706" strokeWidth="1.2" />
            <line x1="112" y1="14" x2="168" y2="14" stroke="#d97706" strokeWidth="1.75" />
            <polygon points="110,14 118,10 118,18" fill="#d97706" stroke="none" />
            <polygon points="170,14 162,10 162,18" fill="#d97706" stroke="none" />
            <text
              x="140"
              y="8"
              textAnchor="middle"
              fill="#d97706"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Diameter
            </text>
          </svg>
          <p className="text-xs text-muted">
            <strong>Height</strong> = total free length from end to end without load.{" "}
            <strong>Diameter</strong> = outer diameter across the coil.
          </p>
        </div>
      ) : null}

      {partType === "other" ? (
        <div className="flex flex-col gap-2">
          <svg
            viewBox="0 0 340 100"
            className="h-24 w-full rounded bg-bg/80 p-2 text-ink"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <rect
              x="85"
              y="20"
              width="140"
              height="44"
              rx="4"
              fill="currentColor"
              fillOpacity="0.07"
            />
            <line x1="85" y1="78" x2="225" y2="78" stroke="#0891b2" strokeWidth="1.75" />
            <polygon points="85,78 93,74 93,82" fill="#0891b2" stroke="none" />
            <polygon points="225,78 217,74 217,82" fill="#0891b2" stroke="none" />
            <text
              x="155"
              y="92"
              textAnchor="middle"
              fill="#0891b2"
              fontSize="10"
              fontFamily="monospace"
              stroke="none"
            >
              Dim 1 (mm)
            </text>
            <line x1="240" y1="20" x2="240" y2="64" stroke="#d97706" strokeWidth="1.75" />
            <text x="250" y="45" fill="#d97706" fontSize="10" fontFamily="monospace" stroke="none">
              Dim 2 (mm)
            </text>
          </svg>
          <p className="text-xs text-muted">
            Enter custom dimension labels (e.g. Overall length, Width, Bore) and their measured
            values in millimetres (mm).
          </p>
        </div>
      ) : null}
    </div>
  );
}
