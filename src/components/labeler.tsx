import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LabelStage, newId, round6, type StageBox } from "@/components/label-stage";
import { classFill } from "@/lib/class-color";
import {
  claimImage,
  claimImageById,
  completeImage,
  fetchAdmin,
  fetchCatalogue,
  fetchLabel,
  fetchNextImage,
  fetchNextReviewImage,
  imageSrc,
  lockImage,
  releaseIncomplete,
  saveLabel,
  submitReviewAction,
  unlockApprovedImage,
  type Catalogue,
  type ClassRow,
  type ImageRow,
  type PhotoStatus,
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

function StatusBadge({ status }: { status: PhotoStatus }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center rounded-sm bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-800">
        Approved
      </span>
    );
  }
  if (status === "complete") {
    return (
      <span className="inline-flex items-center rounded-sm bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-800">
        Complete
      </span>
    );
  }
  if (status === "incomplete") {
    return (
      <span className="inline-flex items-center rounded-sm bg-orange-500/15 px-2 py-0.5 text-xs font-medium text-orange-800">
        Incomplete
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-sm bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800">
      Open
    </span>
  );
}

type Queue = "all" | "open" | "incomplete" | "complete" | "approved" | "mine" | "free";

function matchesQueue(image: ImageRow, next: Queue, username: string | null): boolean {
  if (next === "mine") return image.claimedBy === username;
  if (next === "free")
    return !image.claimedBy && (image.status === "open" || image.status === "incomplete");
  if (next === "open") return image.status === "open";
  if (next === "incomplete") return image.status === "incomplete";
  if (next === "complete") return image.status === "complete" || image.status === "approved";
  if (next === "approved") return image.status === "approved";
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
  const { username, admin: sessionAdmin } = useSession();
  const [isAdmin, setIsAdmin] = useState(sessionAdmin);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  useEffect(() => {
    setIsAdmin(sessionAdmin);
  }, [sessionAdmin]);

  useEffect(() => {
    let cancel = false;
    fetchAdmin()
      .then((unlocked) => {
        if (!cancel && unlocked) setIsAdmin(true);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

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
  const [codesOpen, setCodesOpen] = useState(false);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [paneWidth, setPaneWidth] = useState(360);
  const [paneReady, setPaneReady] = useState(false);
  const [indexProject, setIndexProject] = useState<number | null>(null);
  const paneDrag = useRef<{ x: number; width: number } | null>(null);

  const [isReviewMode, setIsReviewMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("mode") === "review";
    }
    return false;
  });
  const [pendingReviewCount, setPendingReviewCount] = useState<number>(0);
  const isReviewModeRef = useRef(false);
  isReviewModeRef.current = isReviewMode;
  const canUnlock = Boolean(isAdmin || isReviewMode || username?.toLowerCase() === "admin");

  const allImages = catalogue?.images ?? [];
  const images = allImages.filter((image) => matchesQueue(image, queue, username));
  const classes = catalogue?.classes ?? [];
  const projectId = catalogue?.project?.id ?? null;
  const safeIndex = images.length === 0 ? 0 : Math.min(index, images.length - 1);
  const current = images[safeIndex] ?? null;
  const currentRef = useRef(current);
  currentRef.current = current;
  const allImagesRef = useRef(allImages);
  allImagesRef.current = allImages;
  const ready = catalogue !== null;
  const folderOk = catalogue?.folderOk ?? false;
  const imageName = current?.name ?? null;
  const folderKey = catalogue?.resolvedFolder ?? "";

  const dirty = serialize(boxes) !== saved;
  const holder = current?.claimedBy ?? null;
  const isApproved = current?.status === "approved";
  const locked = isApproved || (!isReviewMode && Boolean(holder && holder !== username));
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
    approve: async () => {},
    reject: async () => {},
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
    const stored = sessionStorage.getItem("part-lab-codes-open");
    if (stored !== null) setCodesOpen(stored === "true");
  }, []);

  useEffect(() => {
    sessionStorage.setItem("part-lab-codes-open", String(codesOpen));
  }, [codesOpen]);

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

  function exitReviewMode() {
    setIsReviewMode(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("mode");
    window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
  }

  function enterReviewMode() {
    setIsReviewMode(true);
    setQueue("all");
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "review");
    window.history.replaceState({}, "", url.pathname + url.search);
  }

  useEffect(() => {
    function onPopState() {
      const mode = new URLSearchParams(window.location.search).get("mode") === "review";
      setIsReviewMode(mode);
      if (mode) setQueue("all");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!isReviewMode || projectId == null) return;
    let cancel = false;
    fetchNextReviewImage(projectId)
      .then((res) => {
        if (cancel) return;
        setPendingReviewCount(res.pendingCount);
        const cur = currentRef.current;
        if (cur && cur.status !== "complete" && cur.status !== "approved" && res.image) {
          const at = allImagesRef.current.findIndex(
            (img) => img.name === res.image?.filePath || img.name === res.image?.name,
          );
          if (at >= 0) setIndex(at);
        }
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [isReviewMode, projectId]);

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

    const currentStatus = current?.status;
    if (
      imageName &&
      currentStatus !== "complete" &&
      currentStatus !== "approved" &&
      !isReviewMode
    ) {
      lockImage(imageName)
        .then((locked) => {
          if (cancel) return;
          setCatalogue((prev) =>
            prev
              ? {
                  ...prev,
                  images: prev.images.map((img) =>
                    img.name === imageName
                      ? {
                          ...img,
                          claimedBy: locked.claimedBy,
                          claimedAt: locked.claimedAt,
                          lockedBy: locked.claimedBy,
                          lockedAt: locked.claimedAt,
                        }
                      : img,
                  ),
                }
              : prev,
          );
        })
        .catch((err: unknown) => {
          if (cancel) return;
          const msg = err instanceof Error ? err.message : "";
          if (msg.includes("Locked by") || msg.includes("Claimed by")) {
            const match = msg.match(/(?:Locked|Claimed) by ([^\s]+)/);
            const otherUser = match ? match[1] : "another user";
            setCatalogue((prev) =>
              prev
                ? {
                    ...prev,
                    images: prev.images.map((img) =>
                      img.name === imageName
                        ? {
                            ...img,
                            claimedBy: otherUser,
                            lockedBy: otherUser,
                          }
                        : img,
                    ),
                  }
                : prev,
            );
          }
        });
    }

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
  }, [ready, folderOk, imageName, folderKey, current?.status, isReviewMode]);

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
                      status: image.status === "incomplete" ? "open" : image.status,
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

  async function ensureClaimed(): Promise<boolean> {
    if (isReviewMode || isApproved || !current) return true;
    if (current.claimedBy === username) return true;
    try {
      let res: {
        claimedBy: string;
        claimedAt: string;
        status?: PhotoStatus;
        completedAt?: string | null;
      };
      if (current.id) {
        res = await claimImageById(current.id);
      } else {
        res = await claimImage(current.name);
      }
      await refreshClaims((image) => ({
        ...image,
        claimedBy: res.claimedBy,
        claimedAt: res.claimedAt,
        lockedBy: res.claimedBy,
        lockedAt: res.claimedAt,
        status: (res.status as PhotoStatus) ?? image.status,
        completedAt: (res as { completedAt?: string | null }).completedAt ?? image.completedAt,
        is_claimed: true,
        held_by: res.claimedBy,
        held_minutes_remaining: 15,
      }));
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Image claimed by another user");
      return false;
    }
  }

  async function handleConfirmUnlock() {
    if (!current) return;
    setIsUnlocking(true);
    setUnlockError(null);
    try {
      const res = await unlockApprovedImage(current.id ?? current.name);
      await refreshClaims((img) => ({
        ...img,
        status: "complete",
        claimedBy: res.claimedBy,
        claimedAt: res.claimedAt,
        lockedBy: res.lockedBy,
        lockedAt: res.lockedAt,
        reviewedBy: null,
        reviewedAt: null,
        is_claimed: true,
        held_by: res.claimedBy,
        held_minutes_remaining: 15,
      }));
      setShowUnlockModal(false);
      setStatus("Photo unlocked for editing");
    } catch (err: unknown) {
      setUnlockError(err instanceof Error ? err.message : "Failed to unlock photo");
    } finally {
      setIsUnlocking(false);
    }
  }

  function handleBoxesChange(nextBoxes: StageBox[]) {
    if (lockedRef.current) return;
    if (!isReviewMode && current && current.claimedBy !== username) {
      void ensureClaimed();
    }
    setBoxes(nextBoxes);
  }

  function removeSelected() {
    if (lockedRef.current) return;
    if (!selectedKey) return;
    if (!isReviewMode && current && current.claimedBy !== username) {
      void ensureClaimed();
    }
    setBoxes((prev) => prev.filter((box) => box.key !== selectedKey));
    setSelectedKey(null);
  }

  function undoLast() {
    if (lockedRef.current) return;
    const last = boxes.at(-1);
    if (!last) return;
    if (!isReviewMode && current && current.claimedBy !== username) {
      void ensureClaimed();
    }
    setBoxes((prev) => prev.filter((box) => box.key !== last.key));
    if (selectedKey === last.key) setSelectedKey(null);
  }

  function unselect() {
    setSelectedKey(null);
  }

  function nudge(key: string, fast: boolean): boolean {
    if (lockedRef.current || !selectedKey) return false;
    if (!isReviewMode && current && current.claimedBy !== username) {
      void ensureClaimed();
    }
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
    if (!isReviewMode && current && current.claimedBy !== username) {
      void ensureClaimed();
    }
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
    const ok = await save();
    if (!ok) return;

    try {
      const claimed = await fetchNextImage();
      if (claimed) {
        const cat = await fetchCatalogue();
        setCatalogue(cat);
        const nextIdx = cat.images.findIndex((image) => image.name === claimed.name);
        if (nextIdx >= 0) {
          setQueue("open");
          setIndex(nextIdx);
          setStatus("Saved");
          return;
        }
      }
    } catch {
      /* fallback */
    }

    const at = allImages.findIndex((image) => image.name === name);
    const next = allImages.slice(at + 1).find((image) => !image.labelled);
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
    if (!isReviewMode && current && current.claimedBy !== username) {
      void ensureClaimed();
    }
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

  async function handleReviewApprove() {
    if (!current) return;
    setBusy(true);
    try {
      const cleaned = boxes.map((box) => ({
        classId: box.classId,
        x: round6(box.x),
        y: round6(box.y),
        w: round6(box.w),
        h: round6(box.h),
      }));
      const res = await submitReviewAction({
        project_id: projectId ?? undefined,
        image_id: current.id,
        name: current.name,
        action: "approve",
        boxes: cleaned,
      });
      setSaved(serialize(boxes));
      setPendingReviewCount(res.pendingCount);
      setCatalogue((prev) =>
        prev
          ? {
              ...prev,
              images: prev.images.map((img) =>
                img.name === current.name
                  ? {
                      ...img,
                      status: "approved",
                      owner: img.owner || username,
                      completedBy: img.owner || img.completedBy || username,
                      reviewedBy: username,
                      reviewedAt: new Date().toISOString(),
                    }
                  : img,
              ),
            }
          : prev,
      );
      setStatus(`Approved ${current.name}`);
      setError(null);
      if (res.nextImage) {
        const at = allImages.findIndex(
          (img) => img.name === res.nextImage?.filePath || img.name === res.nextImage?.name,
        );
        if (at >= 0) {
          setIndex(at);
        }
      } else {
        setStatus("All completed photos approved!");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleReviewReject() {
    if (!current) return;
    setBusy(true);
    try {
      const res = await submitReviewAction({
        project_id: projectId ?? undefined,
        image_id: current.id,
        name: current.name,
        action: "reject",
      });
      setBoxes([]);
      setSaved("[]");
      setPendingReviewCount(res.pendingCount);
      setCatalogue((prev) =>
        prev
          ? {
              ...prev,
              images: prev.images.map((img) =>
                img.name === current.name
                  ? {
                      ...img,
                      status: "open",
                      labelled: false,
                      claimedBy: null,
                      claimedAt: null,
                      completedAt: null,
                      reviewedBy: null,
                      reviewedAt: null,
                    }
                  : img,
              ),
            }
          : prev,
      );
      setStatus(`Rejected ${current.name} to pool`);
      setError(null);
      if (res.nextImage) {
        const at = allImages.findIndex(
          (img) => img.name === res.nextImage?.filePath || img.name === res.nextImage?.name,
        );
        if (at >= 0) {
          setIndex(at);
        }
      } else {
        setStatus("No more pending photos to review.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleNextPendingReview() {
    setBusy(true);
    try {
      const res = await fetchNextReviewImage(projectId ?? undefined);
      setPendingReviewCount(res.pendingCount);
      if (res.image) {
        const at = allImages.findIndex(
          (img) => img.name === res.image?.filePath || img.name === res.image?.name,
        );
        if (at >= 0) {
          setIndex(at);
        }
        setStatus(`Loaded ${res.image.name} for review`);
      } else {
        setStatus("No pending photos to review");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not fetch next review image");
    } finally {
      setBusy(false);
    }
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
    approve: handleReviewApprove,
    reject: handleReviewReject,
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

      if (isReviewModeRef.current) {
        if (
          (event.key === "a" || event.key === "A" || event.key === "Enter") &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          void actions.current.approve();
          return;
        }
        if (
          (event.key === "x" || event.key === "X") &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          void actions.current.reject();
          return;
        }
      }

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
      let res: {
        claimedBy: string;
        claimedAt: string;
        status?: PhotoStatus;
        completedAt?: string | null;
      };
      if (current.id) {
        res = await claimImageById(current.id, takeover);
      } else {
        res = await claimImage(current.name, takeover);
      }
      await refreshClaims((image) => ({
        ...image,
        claimedBy: res.claimedBy,
        claimedAt: res.claimedAt,
        lockedBy: res.claimedBy,
        lockedAt: res.claimedAt,
        status: (res.status as PhotoStatus) ?? image.status,
        completedAt: (res as { completedAt?: string | null }).completedAt ?? image.completedAt,
        is_claimed: true,
        held_by: res.claimedBy,
        held_minutes_remaining: 15,
      }));
      setConfirmTakeover(false);
      setStatus("Claimed");
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not claim");
    } finally {
      setBusy(false);
    }
  }

  async function releaseIncompleteAction() {
    if (!current) return;
    setBusy(true);
    try {
      const res = await releaseIncomplete(current.name);
      await refreshClaims((image) => ({
        ...image,
        claimedBy: null,
        claimedAt: null,
        status: res.status,
        completedAt: null,
      }));
      setStatus("Released as incomplete");
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not release");
    } finally {
      setBusy(false);
    }
  }

  async function completeCurrent() {
    if (!current) return;
    setBusy(true);
    try {
      const cleaned = boxes.map((box) => ({
        classId: box.classId,
        x: round6(box.x),
        y: round6(box.y),
        w: round6(box.w),
        h: round6(box.h),
      }));
      const res = await completeImage(current.name, cleaned);
      setSaved(serialize(boxes));
      await refreshClaims((image) => ({
        ...image,
        labelled: cleaned.length > 0,
        claimedBy: res.claimedBy,
        claimedAt: res.claimedAt,
        status: "complete",
        completedAt: res.completedAt,
      }));
      setStatus("Complete");
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not complete");
    } finally {
      setBusy(false);
    }
  }

  const position =
    images.length === 0 ? "image 0 of 0" : `image ${safeIndex + 1} of ${images.length}`;
  const labelledCount = allImages.filter((image) => image.labelled).length;
  const claimLabel = !current
    ? ""
    : isApproved
      ? "Approved"
      : holder === username
        ? "Yours"
        : holder
          ? holder
          : "Free";
  const folderAt = current ? allImages.findIndex((image) => image.name === current.name) : -1;
  const previousPhoto = folderAt > 0 ? allImages[folderAt - 1] : null;
  const canDuplicate = !locked && boxes.length > 0;
  const canCopyPrevious =
    !locked && !busy && boxes.length === 0 && Boolean(previousPhoto?.labelled);

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <AppHeader
        current={isReviewMode ? "review" : "label"}
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
            {current ? <StatusBadge status={current.status} /> : null}
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
          {isReviewMode ? (
            <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-amber-950 shadow-xs dark:border-amber-900/60 dark:bg-amber-950/80 dark:text-amber-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-sm bg-amber-200/80 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-900 dark:bg-amber-800/80 dark:text-amber-200">
                  Review QA
                </span>
                <p className="max-w-xs truncate font-mono text-sm font-semibold">
                  {current?.name ? `Reviewing: ${current.name}` : "No photo loaded"}
                </p>
                <span className="text-xs text-amber-800 dark:text-amber-300">
                  | Completed by:{" "}
                  <span className="font-semibold text-ink">
                    {current?.owner ||
                      current?.claimedBy ||
                      (current?.completedAt ? username || "You" : "Not completed")}
                  </span>
                  {current?.reviewedBy ? (
                    <span className="ml-1 text-purple-700 dark:text-purple-300 font-normal">
                      (Approved by {current.reviewedBy === username ? "you" : current.reviewedBy})
                    </span>
                  ) : null}
                </span>
                {pendingReviewCount > 0 ? (
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 font-mono text-xs font-medium text-amber-800 dark:bg-amber-800/60 dark:text-amber-200">
                    {pendingReviewCount} pending
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {isApproved ? (
                  canUnlock ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setShowUnlockModal(true)}
                      className="press inline-flex h-9 items-center gap-1.5 rounded-sm border border-amber-600 bg-amber-600/10 px-3 text-xs font-semibold text-amber-900 shadow-xs hover:bg-amber-600/20 dark:text-amber-200 disabled:opacity-40"
                      title="Revoke QA approval and unlock photo to edit"
                    >
                      <Unlock className="size-3.5" aria-hidden="true" />
                      <span>Unlock to Edit</span>
                    </button>
                  ) : null
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!current || busy}
                      onClick={() => void handleReviewApprove()}
                      className="press inline-flex h-9 items-center gap-1.5 rounded-sm bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-40"
                      title="Approve annotations (Hotkey: A or Enter)"
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                      <span>✓ Approve (A)</span>
                    </button>
                    <button
                      type="button"
                      disabled={!current || busy}
                      onClick={() => void handleReviewReject()}
                      className="press inline-flex h-9 items-center gap-1.5 rounded-sm bg-rose-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-40"
                      title="Reject back to annotator pool (Hotkey: X)"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                      <span>✕ Reject to Pool (X)</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleNextPendingReview()}
                  className="press inline-flex h-9 items-center rounded-sm border border-amber-300 bg-white/80 px-2.5 text-xs font-medium text-amber-950 hover:bg-white dark:border-amber-700 dark:bg-amber-900/60 dark:text-amber-100 disabled:opacity-40"
                  title="Fetch next completed image needing review"
                >
                  Next Pending
                </button>
                <button
                  type="button"
                  onClick={exitReviewMode}
                  className="press inline-flex h-9 items-center rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-muted hover:text-ink"
                  title="Exit review mode"
                >
                  Exit Review
                </button>
              </div>
            </div>
          ) : null}
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
                  onChange={handleBoxesChange}
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
            {isApproved ? (
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-purple-500/15 px-3 py-2 text-xs font-semibold text-purple-800 dark:text-purple-300">
                <Check className="size-3.5" aria-hidden="true" />✓ Approved by{" "}
                {current?.reviewedBy || current?.owner || "QA"}
              </span>
            ) : (
              <button
                type="button"
                className={btnPrimary}
                onClick={() => void save()}
                disabled={!current || busy || !dirty || locked}
              >
                Save
              </button>
            )}
            <button
              type="button"
              className={btn}
              onClick={() => void shift(1)}
              disabled={!current || safeIndex >= images.length - 1 || busy}
            >
              Next
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
            {!isApproved ? (
              <button
                type="button"
                className={btn}
                title="No parts in this photo. Saves an empty label and opens the next unlabelled photo."
                disabled={!current || busy || locked || boxes.length > 0}
                onClick={() => void markNone()}
              >
                No parts
              </button>
            ) : null}
            {isApproved && canUnlock ? (
              <button
                type="button"
                className="press inline-flex h-11 items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/15 px-3.5 text-xs font-semibold text-amber-800 hover:bg-amber-500/25 dark:text-amber-200"
                onClick={() => setShowUnlockModal(true)}
                title="Unlock approved photo to edit"
              >
                <Unlock className="size-4" aria-hidden="true" />
                Unlock to Edit
              </button>
            ) : null}
            <p className="ml-auto text-sm text-muted" aria-live="polite">
              {dirty ? "Unsaved" : status}
              {current?.labelled ? " · txt" : ""}
              {locked ? (isApproved ? " · approved" : " · locked") : ""}
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
          <div
            className={`flex flex-col gap-3 p-4 pb-2 ${codesOpen ? "flex-1 min-h-0" : "shrink-0"}`}
          >
            <div className="flex items-center justify-between rounded-sm border border-line bg-bg p-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-sm font-medium">Codes on this image</span>
                {tokens.length > 0 ? (
                  <span className="rounded-sm bg-ink/10 px-1.5 py-0.5 font-mono text-xs text-ink">
                    {tokens.length} {tokens.length === 1 ? "code" : "codes"}
                  </span>
                ) : (
                  <span className="text-xs text-muted">None</span>
                )}
                {unknownCodes.length > 0 ? (
                  <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700">
                    {unknownCodes.length} missing
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="press inline-flex size-8 items-center justify-center rounded-sm border border-line bg-surface text-ink hover:bg-surface-raised"
                onClick={() => setCodesOpen((prev) => !prev)}
                title={codesOpen ? "Minimise" : "Full column"}
                aria-label={codesOpen ? "Minimise" : "Full column"}
              >
                {codesOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
            </div>

            {codesOpen ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <textarea
                  className="w-full flex-1 min-h-[300px] resize-none rounded-sm border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  value={codeList}
                  spellCheck={false}
                  disabled={locked}
                  placeholder={"HX-M8\nNUT-M8\nWSH-M8"}
                  onChange={(event) => setCodeList(event.target.value)}
                  autoFocus
                />
                <div className="text-xs text-muted">
                  {tokens.length > 0 ? (
                    <p>
                      {picks.length} of {tokens.length} codes in class list.
                      {unknownCodes.length > 0 ? ` Missing: ${unknownCodes.join(", ")}` : ""}
                    </p>
                  ) : (
                    <p>Paste item codes (one per line). Class dropdown will filter to these.</p>
                  )}
                </div>
              </div>
            ) : (
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
                  value={
                    options.some((row) => row.id === activeClassId) ? (activeClassId ?? "") : ""
                  }
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
            )}
          </div>

          {!codesOpen ? (
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
                            if (!isReviewMode && current && current.claimedBy !== username) {
                              void ensureClaimed();
                            }
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
          ) : null}
          <div className="flex shrink-0 flex-col gap-3 border-t border-line p-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Queue</p>
                {!isReviewMode ? (
                  <button
                    type="button"
                    className="press inline-flex h-8 items-center rounded-sm bg-amber-600 px-2.5 text-xs font-semibold text-white shadow-xs hover:bg-amber-700"
                    onClick={enterReviewMode}
                  >
                    Review QA
                  </button>
                ) : (
                  <button
                    type="button"
                    className="press inline-flex h-8 items-center rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-muted hover:text-ink"
                    onClick={exitReviewMode}
                  >
                    Exit Review
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["all", "All"],
                    ["open", "Open"],
                    ["incomplete", "Incomplete"],
                    ["complete", "Complete"],
                    ["approved", "Approved"],
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
                {isApproved ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-sm bg-purple-500/15 px-2.5 py-1 text-xs font-semibold text-purple-800 dark:text-purple-300">
                        <Check className="size-3.5" aria-hidden="true" />
                        Approved by {current.reviewedBy || current.owner || "QA"}
                      </span>
                      <StatusBadge status={current.status} />
                    </div>
                    <p className="text-xs text-muted">
                      This photo is approved and frozen in read-only mode to safeguard ground truth.
                    </p>
                    {canUnlock ? (
                      <button
                        type="button"
                        className="press inline-flex h-10 w-full items-center justify-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/15 px-4 text-xs font-semibold text-amber-800 hover:bg-amber-500/25 dark:text-amber-200"
                        onClick={() => setShowUnlockModal(true)}
                      >
                        <Unlock className="size-4" aria-hidden="true" />
                        Unlock to Edit
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-muted">
                        {holder === username
                          ? current.status === "complete"
                            ? "Completed by you. Held time paused."
                            : "You have this image."
                          : holder
                            ? `Claimed by ${holder}. Take over to edit.`
                            : "Free. Saving claims it for you."}
                      </p>
                      <StatusBadge status={current.status} />
                    </div>
                    {holder === username ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          className="press inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-sm bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40"
                          disabled={busy}
                          onClick={() => void completeCurrent()}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          className="press inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-sm border border-yellow-500/20 bg-yellow-400 px-4 text-sm font-medium text-yellow-950 hover:bg-yellow-500 active:bg-yellow-600 disabled:opacity-40"
                          disabled={busy}
                          onClick={() => void releaseIncompleteAction()}
                        >
                          Release incomplete
                        </button>
                      </div>
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
                  </>
                )}
              </div>
            ) : null}
            <p className="text-sm text-muted break-all">
              {catalogue?.folderOk ? catalogue.resolvedFolder : (catalogue?.folderError ?? "—")}
            </p>
          </div>
        </aside>
      </div>

      {showUnlockModal && current ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unlock-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-6 shrink-0" aria-hidden="true" />
              <h3 id="unlock-dialog-title" className="text-base font-semibold text-ink">
                Unlock Approved Photo?
              </h3>
            </div>
            <p className="mt-3 text-sm text-muted leading-relaxed">
              This photo is currently approved. Unlocking it will revoke the QA approval and return
              it to &apos;In Progress&apos;. Do you want to proceed?
            </p>
            {unlockError ? (
              <p className="mt-3 rounded-sm border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
                {unlockError}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={isUnlocking}
                onClick={() => {
                  setShowUnlockModal(false);
                  setUnlockError(null);
                }}
                className="press inline-flex h-9 items-center justify-center rounded-sm border border-line bg-surface px-4 text-xs font-medium text-ink hover:bg-surface-raised"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUnlocking}
                onClick={() => void handleConfirmUnlock()}
                className="press inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-amber-600 px-4 text-xs font-semibold text-white shadow-xs hover:bg-amber-700 disabled:opacity-50"
              >
                {isUnlocking ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Unlocking...
                  </>
                ) : (
                  <>
                    <Unlock className="size-3.5" aria-hidden="true" />
                    Unlock and Edit
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
