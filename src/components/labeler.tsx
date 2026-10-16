import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Trash2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LabelStage, newId, round6, type StageBox } from "@/components/label-stage";
import { classFill } from "@/lib/class-color";
import {
  claimImage,
  fetchCatalogue,
  fetchLabel,
  imageSrc,
  releaseImage,
  saveLabel,
  type Catalogue,
  type ClassRow,
  type ImageRow,
} from "@/lib/label-client";
import { useSession } from "@/lib/session";

const field =
  "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink disabled:opacity-40";
const iconBtn =
  "press inline-flex size-11 shrink-0 items-center justify-center rounded-sm border border-line bg-surface text-ink disabled:opacity-40";
const btnPrimary =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-ink px-4 text-sm font-medium text-surface disabled:opacity-40";

const PANE_MIN = 280;
const PANE_MAX = 640;

function serialize(boxes: StageBox[]): string {
  return JSON.stringify(
    boxes.map((box) => ({
      classId: box.classId,
      x: round6(box.x),
      y: round6(box.y),
      w: round6(box.w),
      h: round6(box.h),
    })),
  );
}

function withKeys(
  boxes: { classId: number; x: number; y: number; w: number; h: number }[],
): StageBox[] {
  return boxes.map((box) => ({
    key: newId(),
    classId: box.classId,
    x: round6(box.x),
    y: round6(box.y),
    w: round6(box.w),
    h: round6(box.h),
  }));
}

type Queue = "all" | "mine" | "free" | "open";

function matchesQueue(image: ImageRow, next: Queue, username: string | null): boolean {
  if (next === "mine") return image.claimedBy === username;
  if (next === "free") return !image.claimedBy;
  if (next === "open") return !image.labelled;
  return true;
}

function clampUnit(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseCodes(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const token = part.trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

export function Labeler() {
  const { username } = useSession();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [boxes, setBoxes] = useState<StageBox[]>([]);
  const [saved, setSaved] = useState("[]");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeClassId, setActiveClassId] = useState<number | null>(null);
  const [status, setStatus] = useState("Loading");
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Queue>("all");
  const [confirmTakeover, setConfirmTakeover] = useState(false);
  const [codeList, setCodeList] = useState("");
  const [codesHydrated, setCodesHydrated] = useState(false);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [paneWidth, setPaneWidth] = useState(360);
  const [paneReady, setPaneReady] = useState(false);
  const [indexProject, setIndexProject] = useState<number | null>(null);
  const paneDrag = useRef<{ x: number; width: number } | null>(null);

  const allImages = catalogue?.images ?? [];
  const images = allImages.filter((image) => matchesQueue(image, queue, username));
  const classes = catalogue?.classes ?? [];
  const projectId = catalogue?.project?.id ?? null;
  const safeIndex = images.length === 0 ? 0 : Math.min(index, images.length - 1);
  const current = images[safeIndex] ?? null;
  const ready = catalogue !== null;
  const folderOk = catalogue?.folderOk ?? false;
  const imageName = current?.name ?? null;
  const folderKey = catalogue?.resolvedFolder ?? "";

  const dirty = serialize(boxes) !== saved;
  const holder = current?.claimedBy ?? null;
  const locked = Boolean(holder && holder !== username);
  const lockedRef = useRef(false);
  lockedRef.current = locked;

  const boxListRef = useRef<HTMLUListElement>(null);
  const actions = useRef({
    shift: (_delta: number) => {},
    save: async () => false,
    remove: () => {},
    undo: () => {},
    unselect: () => {},
    nudge: (_key: string, _fast: boolean): boolean => false,
    duplicate: () => {},
    markNone: async () => {},
  });

  const latestBoxKey = boxes[boxes.length - 1]?.key ?? "";

  useEffect(() => {
    const el = boxListRef.current;
    if (!el || !latestBoxKey) return;
    el.scrollTop = el.scrollHeight;
  }, [latestBoxKey]);

  useEffect(() => {
    const stored = Number(sessionStorage.getItem("part-lab-pane"));
    if (Number.isFinite(stored)) setPaneWidth(Math.min(PANE_MAX, Math.max(PANE_MIN, stored)));
    setPaneReady(true);
  }, []);

  useEffect(() => {
    if (!paneReady) return;
    sessionStorage.setItem("part-lab-pane", String(paneWidth));
  }, [paneWidth, paneReady]);

  useEffect(() => {
    if (projectId == null) return;
    const stored = sessionStorage.getItem(`part-lab-codes:${projectId}`);
    setCodeList(stored ?? "");
    setCodesHydrated(true);
  }, [projectId]);

  useEffect(() => {
    if (!codesHydrated || projectId == null) return;
    sessionStorage.setItem(`part-lab-codes:${projectId}`, codeList);
  }, [codeList, codesHydrated, projectId]);

  useEffect(() => {
    if (projectId == null) return;
    const stored = Number(sessionStorage.getItem(`part-lab-index:${projectId}`));
    if (Number.isInteger(stored) && stored >= 0) setIndex(stored);
    setIndexProject(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!ready || projectId == null || indexProject !== projectId) return;
    sessionStorage.setItem(`part-lab-index:${projectId}`, String(safeIndex));
  }, [safeIndex, ready, projectId, indexProject]);

  useEffect(() => {
    let cancel = false;
    fetchCatalogue()
      .then((data) => {
        if (cancel) return;
        setCatalogue(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load");
      });
    return () => {
      cancel = true;
    };
  }, []);

  const tokens = useMemo(() => parseCodes(codeList), [codeList]);
  const picks = useMemo(() => {
    const byIc = new Map(classes.map((row) => [row.ic.trim().toLowerCase(), row]));
    return tokens.flatMap((token) => {
      const row = byIc.get(token.toLowerCase());
      return row ? [row] : [];
    });
  }, [classes, tokens]);
  const unknownCodes = tokens.filter(
    (token) => !picks.some((row) => row.ic.trim().toLowerCase() === token.toLowerCase()),
  );
  const drawnClassKey = useMemo(() => {
    const ids = new Set<number>();
    for (const box of boxes) ids.add(box.classId);
    return [...ids].sort((a, b) => a - b).join(",");
  }, [boxes]);
  const options = useMemo(() => {
    const drawn = new Set(drawnClassKey.split(",").filter(Boolean).map(Number));
    const seen = new Set<number>();
    const merged: ClassRow[] = [];
    for (const row of picks) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    for (const row of classes) {
      if (!drawn.has(row.id) || seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    return merged;
  }, [picks, classes, drawnClassKey]);

  useEffect(() => {
    setActiveClassId((prev) =>
      prev != null && options.some((row) => row.id === prev) ? prev : (options[0]?.id ?? null),
    );
  }, [options]);

  useEffect(() => {
    setHiddenKeys(new Set());
    if (!ready || !folderOk || !imageName || !folderKey) {
      setBoxes([]);
      setSaved("[]");
      setSelectedKey(null);
      setStatus(!ready ? "Loading" : "No images");
      return;
    }
    let cancel = false;
    setBoxes([]);
    setSaved("[]");
    setSelectedKey(null);
    setStatus("Loading");
    fetchLabel(imageName)
      .then((loaded) => {
        if (cancel) return;
        const next = withKeys(loaded);
        setBoxes(next);
        setSaved(serialize(next));
        setSelectedKey(null);
        setStatus("Saved");
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setError(err instanceof Error ? err.message : "Could not read labels");
          setStatus("Error");
        }
      });
    return () => {
      cancel = true;
    };
  }, [ready, folderOk, imageName, folderKey]);

  function labelFor(classId: number): string {
    const row = classes.find((item) => item.id === classId);
    return row ? row.ic : `#${classId}`;
  }

  function boxTitle(classId: number): string {
    const row = classes.find((item) => item.id === classId);
    return row ? `${row.ic}  ${row.des}` : `#${classId}`;
  }

  function colorFor(classId: number): string {
    const row = classes.find((item) => item.id === classId);
    return classFill(classId, row?.color);
  }

  function classLine(row: ClassRow): string {
    return `${row.id}  ${row.ic}  ${row.des}`;
  }

  async function save(): Promise<boolean> {
    if (!current) return false;
    setBusy(true);
    try {
      await saveLabel(
        current.name,
        boxes.map((box) => ({
          classId: box.classId,
          x: round6(box.x),
          y: round6(box.y),
          w: round6(box.w),
          h: round6(box.h),
        })),
      );
      setSaved(serialize(boxes));
      setStatus("Saved");
      setCatalogue((prev) =>
        prev
          ? {
              ...prev,
              images: prev.images.map((image) =>
                image.name === current.name
                  ? {
                      ...image,
                      labelled: true,
                      claimedBy: image.claimedBy ?? username,
                      claimedAt: image.claimedAt ?? new Date().toISOString(),
                    }
                  : image,
              ),
            }
          : prev,
      );
      setError(null);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStatus("Save failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function shift(delta: number) {
    if (images.length === 0) return;
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setIndex((value) => {
      const currentIndex = Math.min(value, images.length - 1);
      return Math.min(images.length - 1, Math.max(0, currentIndex + delta));
    });
  }

  function removeSelected() {
    if (lockedRef.current) return;
    if (!selectedKey) return;
    setBoxes((prev) => prev.filter((box) => box.key !== selectedKey));
    setSelectedKey(null);
  }

  function undoLast() {
    if (lockedRef.current) return;
    const last = boxes.at(-1);
    if (!last) return;
    setBoxes((prev) => prev.filter((box) => box.key !== last.key));
    if (selectedKey === last.key) setSelectedKey(null);
  }

  function unselect() {
    setSelectedKey(null);
  }

  function nudge(key: string, fast: boolean): boolean {
    if (lockedRef.current || !selectedKey) return false;
    const step = fast ? 0.01 : 0.002;
    const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
    const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
    if (dx === 0 && dy === 0) return false;
    setBoxes((prev) =>
      prev.map((box) => {
        if (box.key !== selectedKey) return box;
        return {
          ...box,
          x: round6(clampUnit(box.x + dx, box.w / 2, 1 - box.w / 2)),
          y: round6(clampUnit(box.y + dy, box.h / 2, 1 - box.h / 2)),
        };
      }),
    );
    return true;
  }

  function duplicate() {
    if (lockedRef.current) return;
    const source = boxes.find((box) => box.key === selectedKey) ?? boxes.at(-1);
    if (!source) return;
    let x = source.x + 0.02;
    let y = source.y + 0.02;
    if (x + source.w / 2 > 1 || y + source.h / 2 > 1) {
      x = source.x - 0.02;
      y = source.y - 0.02;
    }
    const copy: StageBox = {
      ...source,
      key: newId(),
      x: round6(clampUnit(x, source.w / 2, 1 - source.w / 2)),
      y: round6(clampUnit(y, source.h / 2, 1 - source.h / 2)),
    };
    setBoxes((prev) => [...prev, copy]);
    setSelectedKey(copy.key);
  }

  async function copyPrevious() {
    if (lockedRef.current || boxes.length > 0 || !current) return;
    const at = allImages.findIndex((image) => image.name === current.name);
    const previous = at > 0 ? allImages[at - 1] : null;
    if (!previous?.labelled) return;
    setBusy(true);
    try {
      const loaded = await fetchLabel(previous.name);
      if (loaded.length === 0) {
        setStatus("Previous photo has no boxes");
        return;
      }
      setBoxes(withKeys(loaded));
      setSelectedKey(null);
      setStatus("Copied from previous photo");
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not copy boxes");
    } finally {
      setBusy(false);
    }
  }

  async function markNone() {
    if (!current || lockedRef.current || boxes.length > 0) return;
    const name = current.name;
    const at = allImages.findIndex((image) => image.name === name);
    const next = allImages.slice(at + 1).find((image) => !image.labelled);
    const ok = await save();
    if (!ok) return;
    const open = allImages.filter((image) => image.name !== name && !image.labelled);
    setQueue("open");
    if (open.length === 0) {
      setIndex(0);
      setStatus("No open photos");
      return;
    }
    const landing = next ? open.findIndex((image) => image.name === next.name) : 0;
    setIndex(Math.max(0, landing));
    setStatus("Saved");
  }

  function chooseClass(id: number) {
    if (lockedRef.current) return;
    setActiveClassId(id);
    if (!selectedKey) return;
    setBoxes((prev) =>
      prev.map((box) => (box.key === selectedKey ? { ...box, classId: id } : box)),
    );
  }

  function selectBox(key: string | null) {
    setSelectedKey(key);
    if (!key) return;
    const box = boxes.find((item) => item.key === key);
    if (box) setActiveClassId(box.classId);
  }

  function toggleBox(key: string) {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function resizePane(clientX: number) {
    const drag = paneDrag.current;
    if (!drag) return;
    const next = drag.width + (drag.x - clientX);
    setPaneWidth(Math.min(PANE_MAX, Math.max(PANE_MIN, next)));
  }

  actions.current = {
    shift,
    save,
    remove: removeSelected,
    undo: undoLast,
    unselect,
    nudge,
    duplicate,
    markNone,
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        actions.current.unselect();
        return;
      }
      const tag = event.target instanceof HTMLElement ? event.target.tagName : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown"
      ) {
        if (actions.current.nudge(event.key, event.shiftKey)) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void actions.current.shift(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void actions.current.shift(1);
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        actions.current.remove();
      } else if (
        (event.key === "z" || event.key === "Z") &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey
      ) {
        event.preventDefault();
        actions.current.undo();
      } else if ((event.key === "s" || event.key === "S") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void actions.current.save();
      } else if (
        (event.key === "d" || event.key === "D") &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey
      ) {
        event.preventDefault();
        actions.current.duplicate();
      } else if (
        (event.key === "n" || event.key === "N") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        void actions.current.markNone();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function showQueue(next: Queue) {
    const name = current?.name ?? null;
    const rows = allImages.filter((image) => matchesQueue(image, next, username));
    const found = name ? rows.findIndex((image) => image.name === name) : -1;
    setQueue(next);
    setIndex(found >= 0 ? found : 0);
    setConfirmTakeover(false);
  }

  async function refreshClaims(patch: (image: ImageRow) => ImageRow) {
    setCatalogue((prev) =>
      prev
        ? {
            ...prev,
            images: prev.images.map((image) =>
              image.name === current?.name ? patch(image) : image,
            ),
          }
        : prev,
    );
  }

  async function claim(takeover = false) {
    if (!current) return;
    setBusy(true);
    try {
      await claimImage(current.name, takeover);
      const at = new Date().toISOString();
      await refreshClaims((image) => ({ ...image, claimedBy: username, claimedAt: at }));
      setConfirmTakeover(false);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not claim");
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    if (!current) return;
    setBusy(true);
    try {
      await releaseImage(current.name);
      await refreshClaims((image) => ({ ...image, claimedBy: null, claimedAt: null }));
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not release");
    } finally {
      setBusy(false);
    }
  }

  const position =
    images.length === 0 ? "image 0 of 0" : `image ${safeIndex + 1} of ${images.length}`;
  const labelledCount = allImages.filter((image) => image.labelled).length;
  const claimLabel = !current ? "" : holder === username ? "Yours" : holder ? holder : "Free";
  const folderAt = current ? allImages.findIndex((image) => image.name === current.name) : -1;
  const previousPhoto = folderAt > 0 ? allImages[folderAt - 1] : null;
  const canDuplicate = !locked && boxes.length > 0;
  const canCopyPrevious =
    !locked && !busy && boxes.length === 0 && Boolean(previousPhoto?.labelled);

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <AppHeader
        current="label"
        meta={
          <>
            <p className="max-w-44 truncate font-mono text-sm text-muted tabular-nums sm:max-w-xs">
              {current?.name ?? "—"}
            </p>
            <p className="font-mono text-sm text-ink tabular-nums">{position}</p>
            {catalogue ? (
              <p className="font-mono text-sm text-muted tabular-nums">
                {labelledCount} of {allImages.length} labelled
              </p>
            ) : null}
            {current ? <p className="font-mono text-sm text-muted">{claimLabel}</p> : null}
          </>
        }
      />
      {error ? (
        <p className="border-b border-line bg-surface px-4 py-2 text-sm text-ink" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-80 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 p-3">
            {current && catalogue?.folderOk ? (
              <div className="relative h-full min-h-72">
                <LabelStage
                  key={`${folderKey}/${current.name}`}
                  src={imageSrc(current.name)}
                  alt={current.name}
                  boxes={boxes}
                  hiddenKeys={hiddenKeys}
                  selectedKey={selectedKey}
                  activeClassId={activeClassId}
                  labelFor={labelFor}
                  colorFor={colorFor}
                  readOnly={locked}
                  onChange={setBoxes}
                  onSelect={selectBox}
                />
                <div className="pointer-events-none absolute top-2 left-2 z-30 flex gap-1">
                  <button
                    type="button"
                    className="press pointer-events-auto inline-flex h-10 items-center rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-ink disabled:opacity-40"
                    disabled={!canDuplicate}
                    title="Copy the selected box, or the last one. Ctrl+D"
                    onClick={duplicate}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="press pointer-events-auto inline-flex h-10 items-center rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-ink disabled:opacity-40"
                    disabled={!canCopyPrevious}
                    title="Copy every box from the previous photo. Only when this photo has none."
                    onClick={() => void copyPrevious()}
                  >
                    Previous boxes
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-72 items-center justify-center rounded-lg bg-ink px-6 text-center text-sm text-surface">
                {catalogue?.folderError ??
                  (catalogue
                    ? allImages.length
                      ? "Nothing in this queue."
                      : "This folder has no images."
                    : "Loading images")}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-3">
            <button
              type="button"
              className={btn}
              onClick={() => void shift(-1)}
              disabled={!current || safeIndex === 0 || busy}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Previous
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => void save()}
              disabled={!current || busy || !dirty || locked}
            >
              Save
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => void shift(1)}
              disabled={!current || safeIndex >= images.length - 1 || busy}
            >
              Next
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={btn}
              title="No parts in this photo. Saves an empty label and opens the next unlabelled photo."
              disabled={!current || busy || locked || boxes.length > 0}
              onClick={() => void markNone()}
            >
              No parts
            </button>
            <p className="ml-auto text-sm text-muted" aria-live="polite">
              {dirty ? "Unsaved" : status}
              {current?.labelled ? " · txt" : ""}
              {locked ? " · locked" : ""}
            </p>
          </div>
        </section>
        <hr
          aria-orientation="vertical"
          aria-label="Resize class pane"
          aria-valuemin={PANE_MIN}
          aria-valuemax={PANE_MAX}
          aria-valuenow={paneWidth}
          tabIndex={0}
          className="pane-resize m-0 h-auto w-2 shrink-0 cursor-col-resize touch-none self-stretch border-0 border-l border-line bg-surface focus-visible:ring-2 focus-visible:ring-accent"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            paneDrag.current = { x: event.clientX, width: paneWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => resizePane(event.clientX)}
          onPointerUp={(event) => {
            paneDrag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={(event) => {
            paneDrag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            event.stopPropagation();
            const delta = event.key === "ArrowLeft" ? 24 : -24;
            setPaneWidth((width) => Math.min(PANE_MAX, Math.max(PANE_MIN, width + delta)));
          }}
        />
        <aside
          className="class-pane flex max-h-96 min-h-0 flex-col overflow-hidden border-t border-line bg-surface lg:max-h-none lg:border-t-0"
          style={{ "--pane-width": `${paneWidth}px` } as CSSProperties}
        >
          <div className="flex shrink-0 flex-col gap-4 p-4 pb-2">
            <label className="flex flex-col gap-2 text-sm font-medium">
              Codes on this image
              <textarea
                className="min-h-24 w-full rounded-sm border border-line bg-bg px-3 py-2 font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
                value={codeList}
                spellCheck={false}
                disabled={locked}
                placeholder={"HX-M8\nNUT-M8"}
                onChange={(event) => setCodeList(event.target.value)}
              />
            </label>
            {tokens.length > 0 ? (
              <p className="text-sm text-muted">
                {picks.length} of {tokens.length} codes are in the class list.
                {unknownCodes.length > 0 ? ` Missing: ${unknownCodes.join(", ")}` : ""}
              </p>
            ) : options.length > 0 ? (
              <p className="text-sm text-muted">
                Classes already on this image are in the menu. Paste codes to add others.
              </p>
            ) : (
              <p className="text-sm text-muted">
                Paste item codes. The class menu only lists those.
              </p>
            )}
            <label className="flex flex-col gap-2 text-sm font-medium">
              <span className="flex items-center gap-2">
                Class
                <span className="font-normal text-muted">
                  {selectedKey ? "selected box" : "next box"}
                </span>
                {activeClassId != null ? (
                  <span
                    className="size-3 rounded-full"
                    style={{ background: colorFor(activeClassId) }}
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              <select
                className={field}
                value={options.some((row) => row.id === activeClassId) ? (activeClassId ?? "") : ""}
                disabled={options.length === 0 || locked}
                onChange={(event) => chooseClass(Number(event.target.value))}
              >
                {options.length === 0 ? <option value="">Paste item codes</option> : null}
                {options.map((row) => (
                  <option key={row.id} value={row.id}>
                    {classLine(row)}
                  </option>
                ))}
              </select>
              <span className="text-sm font-normal text-muted">
                {selectedKey
                  ? "Changing this updates the selected box."
                  : "Used for the next box you draw."}
              </span>
            </label>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-4">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Boxes</span>
              <span className="font-mono text-muted tabular-nums">{boxes.length}</span>
            </div>
            {boxes.length === 0 ? (
              <p className="pb-2 text-sm text-muted">
                Drag on the image. The selected class is written into the YOLO file.
              </p>
            ) : (
              <ul
                ref={boxListRef}
                className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-2"
              >
                {boxes.map((box, boxIndex) => {
                  const hidden = hiddenKeys.has(box.key);
                  return (
                    <li key={box.key} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => selectBox(box.key)}
                        className={`press h-11 min-w-0 flex-1 truncate rounded-sm px-3 text-left font-mono text-sm ${
                          hidden ? "opacity-40" : ""
                        } ${box.key === selectedKey ? "bg-ink text-surface" : "bg-bg text-ink"}`}
                        style={{ boxShadow: `inset 4px 0 0 ${colorFor(box.classId)}` }}
                      >
                        {boxIndex + 1} {boxTitle(box.classId)}
                      </button>
                      <button
                        type="button"
                        className={iconBtn}
                        aria-pressed={!hidden}
                        aria-label={`${hidden ? "Show" : "Hide"} box ${boxIndex + 1}`}
                        onClick={() => toggleBox(box.key)}
                      >
                        {hidden ? (
                          <EyeOff className="size-4" aria-hidden="true" />
                        ) : (
                          <Eye className="size-4" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={iconBtn}
                        disabled={locked}
                        aria-label={`Delete box ${boxIndex + 1}`}
                        onClick={() => {
                          setBoxes((prev) => prev.filter((item) => item.key !== box.key));
                          if (selectedKey === box.key) setSelectedKey(null);
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-3 border-t border-line p-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Queue</p>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["all", "All"],
                    ["open", "Open"],
                    ["mine", "Mine"],
                    ["free", "Free"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={
                      queue === key
                        ? "press inline-flex h-11 items-center rounded-sm bg-ink px-3 text-sm font-medium text-surface"
                        : "press inline-flex h-11 items-center rounded-sm border border-line bg-surface px-3 text-sm font-medium text-ink"
                    }
                    onClick={() => showQueue(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {current ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted">
                  {holder === username
                    ? "You have this image. Release it when you are done."
                    : holder
                      ? `Claimed by ${holder}. Take over to edit.`
                      : "Free. Saving claims it for you."}
                </p>
                {holder === username ? (
                  <button
                    type="button"
                    className={btn}
                    disabled={busy}
                    onClick={() => void release()}
                  >
                    Release
                  </button>
                ) : holder ? (
                  <button
                    type="button"
                    className={btn}
                    disabled={busy}
                    onClick={() => {
                      if (!confirmTakeover) {
                        setConfirmTakeover(true);
                        return;
                      }
                      void claim(true);
                    }}
                  >
                    {confirmTakeover ? "Confirm takeover" : "Take over"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={btn}
                    disabled={busy}
                    onClick={() => void claim(false)}
                  >
                    Claim
                  </button>
                )}
              </div>
            ) : null}
            <p className="text-sm text-muted break-all">
              {catalogue?.folderOk ? catalogue.resolvedFolder : (catalogue?.folderError ?? "—")}
            </p>
            <p className="text-sm text-muted">
              Drag the divider to widen this pane. Hold Space and drag to pan. Ctrl with the wheel,
              or Ctrl and − =, zooms. Ctrl+Z removes the last box. Esc clears the selection. Arrows
              move a selected box, Shift for a bigger step. Ctrl+D duplicates it. N marks this photo
              as having no parts.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
