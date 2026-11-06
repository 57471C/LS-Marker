import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Copy,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Hand,
  History,
  Layers,
  Loader2,
  LogOut,
  MousePointer2,
  Pentagon,
  Repeat,
  Ruler,
  Scissors,
  Search,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Unlock,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PART_TYPE_OPTIONS,
  PartMeasurementPopover,
  hasCompleteMeasurements,
} from "@/components/classes-admin";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal";
import { LabelStage, newId, round6, type StageBox } from "@/components/label-stage";
import { classFill } from "@/lib/class-color";
import {
  claimImage,
  claimImageById,
  completeImage,
  cropImage,
  fetchAdmin,
  fetchCatalogue,
  fetchCropInfo,
  fetchAiSettings,
  fetchLabel,
  fetchMaintenanceStatus,
  fetchNextImage,
  fetchNextReviewImage,
  imageSrc,
  logout,
  releaseIncomplete,
  saveLabel,
  submitReviewAction,
  uncropImage,
  unlockApprovedImage,
  updateClass,
  type Box,
  type Catalogue,
  type ClassRow,
  type CropInfo,
  type CropRect,
  type ImageRow,
  type PartType,
  type PhotoStatus,
} from "@/lib/label-client";
import { useProject } from "@/lib/project";
import { useSession } from "@/lib/session";
import {
  areAllSamModelsCached,
  getSamModelState,
  isSam2Loaded,
  subscribeSamModelState,
  type Sam2Status,
  type SamModelStateSnapshot,
} from "@/services/samService";

function toApiBoxes(boxes: StageBox[]): Box[] {
  return boxes.map((box) => ({
    classId: box.classId,
    x: round6(box.x),
    y: round6(box.y),
    w: round6(box.w),
    h: round6(box.h),
    ...(box.points && box.points.length >= 3
      ? { points: box.points.map(([px, py]) => [round6(px), round6(py)]) }
      : {}),
  }));
}

function serialize(boxes: StageBox[]): string {
  return JSON.stringify(toApiBoxes(boxes));
}

function withKeys(boxes: Box[]): StageBox[] {
  return boxes.map((box) => ({
    key: newId(),
    classId: box.classId,
    x: round6(box.x),
    y: round6(box.y),
    w: round6(box.w),
    h: round6(box.h),
    ...(box.points && box.points.length >= 3
      ? { points: box.points.map(([px, py]) => [round6(px), round6(py)]) }
      : {}),
  }));
}

function StatusBadge({ status }: { status: PhotoStatus }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center rounded-[2px] bg-purple-100 px-1.5 py-0.2 text-[10px] font-semibold text-purple-900 border border-purple-300">
        Approved
      </span>
    );
  }
  if (status === "complete") {
    return (
      <span className="inline-flex items-center rounded-[2px] bg-emerald-100 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-900 border border-emerald-300">
        Complete
      </span>
    );
  }
  if (status === "incomplete") {
    return (
      <span className="inline-flex items-center rounded-[2px] bg-orange-100 px-1.5 py-0.2 text-[10px] font-semibold text-orange-900 border border-orange-300">
        Incomplete
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-[2px] bg-amber-100 px-1.5 py-0.2 text-[10px] font-semibold text-amber-900 border border-amber-300">
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

function LeaseTimer({
  claimedAt,
  isMine,
  isComplete,
  isApproved,
}: {
  claimedAt: string | null | undefined;
  isMine: boolean;
  isComplete: boolean;
  isApproved: boolean;
}) {
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    if (!claimedAt) return 0;
    const elapsed = Math.floor((Date.now() - new Date(claimedAt).getTime()) / 1000);
    return Math.max(0, 15 * 60 - elapsed);
  });

  useEffect(() => {
    if (!claimedAt || !isMine || isComplete || isApproved) {
      setSecondsLeft(0);
      return;
    }
    const update = () => {
      const elapsed = Math.floor((Date.now() - new Date(claimedAt).getTime()) / 1000);
      setSecondsLeft(Math.max(0, 15 * 60 - elapsed));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [claimedAt, isMine, isComplete, isApproved]);

  if (!isMine || isApproved) return null;
  if (isComplete) {
    return (
      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-[2px] bg-emerald-50 text-emerald-700 border border-emerald-200">
        Lease: Complete (paused)
      </span>
    );
  }

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const isExpiring = secondsLeft < 180;

  return (
    <span
      className={`font-mono text-[10px] px-1.5 py-0.5 rounded-[2px] inline-flex items-center gap-1 border ${
        isExpiring
          ? "bg-red-50 text-red-700 border-red-300 font-bold animate-pulse"
          : "bg-[#f5f5f5] text-[#282828] border-[#c8c8c8]"
      }`}
      title="15-minute lease timeout"
    >
      <span className="opacity-60">Lease:</span>
      <span>
        {mins}:{secs.toString().padStart(2, "0")}
      </span>
    </span>
  );
}

export function Labeler() {
  const { username, setUsername, admin: sessionAdmin } = useSession();
  const { current: project, openPicker } = useProject();
  const [isAdmin, setIsAdmin] = useState(sessionAdmin);
  const [isMaintenance, setIsMaintenance] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Collapsible Panes in Right Sidebar
  const [paneQueueOpen, setPaneQueueOpen] = useState(true);
  const [paneClassesOpen, setPaneClassesOpen] = useState(true);
  const [paneLayersOpen, setPaneLayersOpen] = useState(true);
  const [shapesHeight, setShapesHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 220;
    try {
      const saved = localStorage.getItem("ls_marker_shapes_pane_height");
      if (saved) {
        const val = Number(saved);
        if (!Number.isNaN(val) && val >= 60 && val <= 1000) {
          return val;
        }
      }
    } catch {
      // ignore
    }
    return 220;
  });
  const [isResizingShapes, setIsResizingShapes] = useState(false);

  // Resizable Right Sidebar Width (persisted to localStorage)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 320;
    try {
      const saved = localStorage.getItem("ls_marker_right_sidebar_width");
      if (saved) {
        const val = Number(saved);
        if (!Number.isNaN(val) && val >= 240 && val <= 1200) {
          return val;
        }
      }
    } catch {
      // ignore
    }
    return 320;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  const handleSidebarResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    setIsResizingSidebar(true);

    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onPointerMove = (ev: PointerEvent) => {
      const deltaX = startX - ev.clientX;
      const maxW = Math.max(360, window.innerWidth - 300);
      const nextW = Math.max(260, Math.min(maxW, Math.round(startW + deltaX)));
      setSidebarWidth(nextW);
      try {
        localStorage.setItem("ls_marker_right_sidebar_width", String(nextW));
      } catch {
        // ignore
      }
    };

    const onPointerUp = () => {
      setIsResizingSidebar(false);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const [classFilter, setClassFilter] = useState("");

  const handleShapesResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = shapesHeight;
    setIsResizingShapes(true);
    if (!paneLayersOpen) {
      setPaneLayersOpen(true);
    }
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";

    const onPointerMove = (ev: PointerEvent) => {
      const deltaY = startY - ev.clientY;
      const maxH = Math.max(160, window.innerHeight - 250);
      const nextH = Math.max(70, Math.min(maxH, Math.round(startH + deltaY)));
      setShapesHeight(nextH);
      try {
        localStorage.setItem("ls_marker_shapes_pane_height", String(nextH));
      } catch {
        // ignore
      }
    };

    const onPointerUp = () => {
      setIsResizingShapes(false);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  // Dimensions inline editing
  const [editingDimsClass, setEditingDimsClass] = useState<ClassRow | null>(null);
  const [showSvgDiagram, setShowSvgDiagram] = useState(false);
  const [savingDims, setSavingDims] = useState(false);
  const [dimsError, setDimsError] = useState<string | null>(null);

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
    fetchMaintenanceStatus()
      .then((res) => {
        if (!cancel) setIsMaintenance(res.maintenance);
      })
      .catch(() => {});
    fetchAiSettings()
      .then((res) => {
        if (!cancel) setAiEnabled(res.enabled);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  const [aiEnabled, setAiEnabled] = useState(true);

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
  const [indexProject, setIndexProject] = useState<number | null>(null);
  const [toolMode, setToolMode] = useState<"box" | "polygon">("box");
  const [renderMode, setRenderMode] = useState<"outline" | "filled">("outline");
  const [crosshairMode, setCrosshairMode] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [cropInfo, setCropInfo] = useState<CropInfo | null>(null);
  const [imageVersion, setImageVersion] = useState<number>(0);
  const [sam2Enabled, setSam2Enabled] = useState(false);
  const [sam2Status, setSam2Status] = useState<Sam2Status>({ state: "idle" });

  useEffect(() => {
    if (!aiEnabled && sam2Enabled) {
      setSam2Enabled(false);
      setSam2Status({ state: "idle" });
    }
  }, [aiEnabled, sam2Enabled]);
  const [samModelState, setSamModelState] = useState<SamModelStateSnapshot>(() =>
    getSamModelState(),
  );
  const [samModelsCachedOnDisk, setSamModelsCachedOnDisk] = useState(false);
  const [samCacheToast, setSamCacheToast] = useState<string | null>(null);
  const [showSam2Modal, setShowSam2Modal] = useState(false);

  useEffect(() => {
    void areAllSamModelsCached().then((cached) => {
      setSamModelsCachedOnDisk(cached);
    });
    let prevStatus = getSamModelState().samModelStatus;
    return subscribeSamModelState((snapshot) => {
      setSamModelState(snapshot);
      if (snapshot.samModelStatus === "ready" && prevStatus !== "ready") {
        setSamModelsCachedOnDisk(true);
        if (snapshot.fromCache && snapshot.loadTimeMs != null) {
          setSamCacheToast(`SAM 2.1 loaded from cache (${snapshot.loadTimeMs}ms)`);
        } else {
          setSamCacheToast("SAM 2.1 models cached");
        }
      }
      prevStatus = snapshot.samModelStatus;
    });
  }, []);

  useEffect(() => {
    if (!samCacheToast) return;
    const timer = window.setTimeout(() => setSamCacheToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [samCacheToast]);

  const undoStackRef = useRef<{ boxes: StageBox[]; selectedKey: string | null }[]>([]);
  const committedSnapshotRef = useRef<{ boxes: StageBox[]; selectedKey: string | null }>({
    boxes: [],
    selectedKey: null,
  });

  function pushUndoSnapshot(nextBoxes: StageBox[], nextSelectedKey: string | null) {
    const prev = committedSnapshotRef.current;
    if (JSON.stringify(prev.boxes) === JSON.stringify(nextBoxes)) {
      committedSnapshotRef.current = { boxes: nextBoxes, selectedKey: nextSelectedKey };
      return;
    }
    undoStackRef.current = [...undoStackRef.current.slice(-49), prev];
    committedSnapshotRef.current = { boxes: nextBoxes, selectedKey: nextSelectedKey };
  }

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
  const activeThumbnailRef = useRef<HTMLButtonElement | null>(null);

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
    void safeIndex;
    if (activeThumbnailRef.current) {
      activeThumbnailRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [safeIndex]);

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
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load catalogue");
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
    return merged.length > 0 ? merged : classes;
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
        undoStackRef.current = [];
        committedSnapshotRef.current = { boxes: next, selectedKey: null };
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

  useEffect(() => {
    void imageVersion;
    setCropMode(false);
    if (!imageName) {
      setCropInfo(null);
      return;
    }
    let cancel = false;
    fetchCropInfo(imageName)
      .then((info) => {
        if (!cancel) setCropInfo(info);
      })
      .catch(() => {
        if (!cancel) setCropInfo(null);
      });
    return () => {
      cancel = true;
    };
  }, [imageName, imageVersion]);

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

  async function save(): Promise<boolean> {
    if (!current) return false;
    setBusy(true);
    try {
      await saveLabel(current.name, toApiBoxes(boxes));
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

  async function jumpToIndex(targetIndex: number) {
    if (targetIndex < 0 || targetIndex >= images.length) return;
    if (targetIndex === safeIndex) return;
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setIndex(targetIndex);
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

  async function handleCropConfirm(rect: CropRect) {
    if (!current || isCropping) return;
    if (!isReviewMode && current.claimedBy !== username) {
      await ensureClaimed();
    }
    setIsCropping(true);
    setStatus("Cropping image…");
    try {
      const result = await cropImage(current.name, rect);
      setImageVersion(Date.now());
      setCropMode(false);
      const nextBoxes = result.boxes.map((b) => ({ ...b, key: newId() }));
      undoStackRef.current = [];
      committedSnapshotRef.current = { boxes: nextBoxes, selectedKey: null };
      setBoxes(nextBoxes);
      setSaved(serialize(nextBoxes));
      const info = await fetchCropInfo(current.name);
      setCropInfo(info);
      setStatus(`Cropped to ${result.width} × ${result.height} px`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Crop failed");
    } finally {
      setIsCropping(false);
    }
  }

  async function handleCropReset() {
    if (!current || isCropping) return;
    if (!isReviewMode && current.claimedBy !== username) {
      await ensureClaimed();
    }
    setIsCropping(true);
    setStatus("Restoring original image…");
    try {
      const result = await uncropImage(current.name);
      setImageVersion(Date.now());
      setCropMode(false);
      const nextBoxes = result.boxes.map((b) => ({ ...b, key: newId() }));
      undoStackRef.current = [];
      committedSnapshotRef.current = { boxes: nextBoxes, selectedKey: null };
      setBoxes(nextBoxes);
      setSaved(serialize(nextBoxes));
      const info = await fetchCropInfo(current.name);
      setCropInfo(info);
      setStatus("Image restored to original");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setIsCropping(false);
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

  function handleBoxesChange(nextBoxes: StageBox[], options?: { transient?: boolean }) {
    if (lockedRef.current) return;
    if (!isReviewMode && current && current.claimedBy !== username) {
      void ensureClaimed();
    }
    if (!options?.transient) {
      pushUndoSnapshot(nextBoxes, selectedKey);
    }
    setBoxes(nextBoxes);
  }

  function removeSelected() {
    if (lockedRef.current || !selectedKey) return;
    if (!isReviewMode && current && current.claimedBy !== username) {
      void ensureClaimed();
    }
    const nextBoxes = boxes.filter((box) => box.key !== selectedKey);
    pushUndoSnapshot(nextBoxes, null);
    setBoxes(nextBoxes);
    setSelectedKey(null);
  }

  function undoLast() {
    if (lockedRef.current) return;
    const prev = undoStackRef.current.pop();
    if (prev) {
      if (!isReviewMode && current && current.claimedBy !== username) {
        void ensureClaimed();
      }
      committedSnapshotRef.current = prev;
      setBoxes(prev.boxes);
      setSelectedKey(prev.selectedKey);
      return;
    }
    const last = boxes.at(-1);
    if (!last) return;
    if (!isReviewMode && current && current.claimedBy !== username) {
      void ensureClaimed();
    }
    const nextBoxes = boxes.filter((box) => box.key !== last.key);
    committedSnapshotRef.current = {
      boxes: nextBoxes,
      selectedKey: selectedKey === last.key ? null : selectedKey,
    };
    setBoxes(nextBoxes);
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
    const nextBoxes = boxes.map((box) => {
      if (box.key !== selectedKey) return box;
      const newX = round6(clampUnit(box.x + dx, box.w / 2, 1 - box.w / 2));
      const newY = round6(clampUnit(box.y + dy, box.h / 2, 1 - box.h / 2));
      const shiftX = newX - box.x;
      const shiftY = newY - box.y;
      return {
        ...box,
        x: newX,
        y: newY,
        points: box.points
          ? box.points.map(
              ([px, py]) =>
                [round6(clampUnit(px + shiftX, 0, 1)), round6(clampUnit(py + shiftY, 0, 1))] as [
                  number,
                  number,
                ],
            )
          : undefined,
      };
    });
    pushUndoSnapshot(nextBoxes, selectedKey);
    setBoxes(nextBoxes);
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
    const finalX = round6(clampUnit(x, source.w / 2, 1 - source.w / 2));
    const finalY = round6(clampUnit(y, source.h / 2, 1 - source.h / 2));
    const shiftX = finalX - source.x;
    const shiftY = finalY - source.y;
    const copy: StageBox = {
      ...source,
      key: newId(),
      x: finalX,
      y: finalY,
      points: source.points
        ? source.points.map(([px, py]) => [
            round6(clampUnit(px + shiftX, 0, 1)),
            round6(clampUnit(py + shiftY, 0, 1)),
          ])
        : undefined,
    };
    const nextBoxes = [...boxes, copy];
    pushUndoSnapshot(nextBoxes, copy.key);
    setBoxes(nextBoxes);
    setSelectedKey(copy.key);
  }

  const selectedBox = boxes.find((box) => box.key === selectedKey) ?? null;

  function toggleConvertSelected() {
    if (lockedRef.current || !selectedKey) return;
    if (!isReviewMode && current && current.claimedBy !== username) {
      void ensureClaimed();
    }
    const nextBoxes = boxes.map((box) => {
      if (box.key !== selectedKey) return box;
      if (box.points && box.points.length >= 3) {
        const { points: _removed, ...rest } = box;
        return rest;
      }
      const left = round6(clampUnit(box.x - box.w / 2, 0, 1));
      const right = round6(clampUnit(box.x + box.w / 2, 0, 1));
      const top = round6(clampUnit(box.y - box.h / 2, 0, 1));
      const bottom = round6(clampUnit(box.y + box.h / 2, 0, 1));
      return {
        ...box,
        points: [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
        ] as [number, number][],
      };
    });
    pushUndoSnapshot(nextBoxes, selectedKey);
    setBoxes(nextBoxes);
  }

  async function copyPrevious() {
    if (lockedRef.current || boxes.length > 0 || !current) return;
    const at = allImages.findIndex((image) => image.name === current.name);
    const previous = at > 0 ? allImages[at - 1] : null;
    if (!previous?.labelled) return;
    if (!isReviewMode && current && current.claimedBy !== username) {
      const ok = await ensureClaimed();
      if (!ok) return;
    }
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
    if (!isReviewMode && current && current.claimedBy !== username) {
      const ok = await ensureClaimed();
      if (!ok) return;
    }
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

  async function handleReviewApprove() {
    if (!current) return;
    setBusy(true);
    try {
      const cleaned = toApiBoxes(boxes);
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
        if (at >= 0) setIndex(at);
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
        if (at >= 0) setIndex(at);
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
        if (at >= 0) setIndex(at);
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
      const res = await releaseIncomplete(current.name, toApiBoxes(boxes));
      setSaved(serialize(boxes));
      await refreshClaims((image) => ({
        ...image,
        claimedBy: null,
        claimedAt: null,
        lockedBy: null,
        lockedAt: null,
        is_claimed: false,
        held_by: null,
        held_minutes_remaining: 0,
        status: res.status,
        labelled: false,
        completedAt: null,
      }));
      setConfirmTakeover(false);
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
      const cleaned = toApiBoxes(boxes);
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

  async function handleSaveDims() {
    if (!editingDimsClass) return;
    setSavingDims(true);
    setDimsError(null);
    try {
      const partType = editingDimsClass.part_type ?? "none";
      const cleanDim3 =
        partType === "washer" || partType === "other" ? editingDimsClass.dim3_mm : null;
      const cleanDim3Name =
        partType === "washer" || partType === "other" ? editingDimsClass.dim3_name : null;

      const updated = await updateClass({
        id: editingDimsClass.id,
        ic: editingDimsClass.ic,
        des: editingDimsClass.des,
        part_type: partType,
        dim1_name: editingDimsClass.dim1_name,
        dim1_mm: editingDimsClass.dim1_mm,
        dim2_name: editingDimsClass.dim2_name,
        dim2_mm: editingDimsClass.dim2_mm,
        dim3_name: cleanDim3Name,
        dim3_mm: cleanDim3,
      });
      setCatalogue((prev) =>
        prev
          ? {
              ...prev,
              classes: prev.classes.map((c) => (c.id === updated.id ? updated : c)),
            }
          : prev,
      );
      setEditingDimsClass(null);
      setStatus(`Saved dimensions for ${updated.ic}`);
    } catch (err) {
      setDimsError(err instanceof Error ? err.message : "Failed to update dimensions");
    } finally {
      setSavingDims(false);
    }
  }

  const position = images.length === 0 ? "0 / 0" : `${safeIndex + 1} / ${images.length}`;
  const labelledCount = allImages.filter((image) => image.labelled).length;
  const folderAt = current ? allImages.findIndex((image) => image.name === current.name) : -1;
  const previousPhoto = folderAt > 0 ? allImages[folderAt - 1] : null;
  const canDuplicate = !locked && boxes.length > 0;
  const canCopyPrevious =
    !locked && !busy && boxes.length === 0 && Boolean(previousPhoto?.labelled);

  const filteredClasses = useMemo(() => {
    if (!classFilter.trim()) return options;
    const q = classFilter.toLowerCase();
    return options.filter(
      (c) =>
        c.ic.toLowerCase().includes(q) ||
        c.des.toLowerCase().includes(q) ||
        String(c.id).includes(q),
    );
  }, [options, classFilter]);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#f0f0f0] text-[#282828] select-none text-xs">
      {/* =========================================================================
          TOP MENU BAR (Exact 28px)
      ========================================================================= */}
      <header className="h-[28px] border-b border-[#c8c8c8] bg-white px-2 flex items-center justify-between text-xs shrink-0 select-none">
        {/* Left: App Brand, Project Picker, Navigation Links */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold tracking-tight text-[#282828] px-1">LS-Marker</span>
          <span className="text-[#c8c8c8]">|</span>

          {/* Project Picker Trigger */}
          <button
            type="button"
            onClick={openPicker}
            className="press inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[#282828] hover:bg-[#f0f0f0] border border-transparent hover:border-[#c8c8c8] max-w-[150px] truncate font-medium"
            title="Switch project"
          >
            <FolderOpen className="size-3.5 shrink-0 text-[#707070]" />
            <span className="truncate">{project?.name ?? "Open Project"}</span>
          </button>

          <span className="text-[#c8c8c8]">|</span>

          {/* Nav links */}
          <nav className="flex items-center gap-1 font-medium">
            <Link
              to="/"
              className={`px-1.5 py-0.5 rounded-[2px] ${
                !isReviewMode ? "bg-[#1473e6] text-white" : "text-[#707070] hover:text-[#282828]"
              }`}
            >
              Label
            </Link>
            <button
              type="button"
              onClick={() => {
                if (isReviewMode) exitReviewMode();
                else enterReviewMode();
              }}
              className={`px-1.5 py-0.5 rounded-[2px] ${
                isReviewMode
                  ? "bg-amber-600 text-white font-semibold"
                  : "text-amber-700 hover:text-amber-900"
              }`}
            >
              Review QA
            </button>
            <Link
              to="/photos"
              className="px-1.5 py-0.5 rounded-[2px] text-[#707070] hover:text-[#282828]"
            >
              Photos
            </Link>
            <Link
              to="/admin"
              className="px-1.5 py-0.5 rounded-[2px] text-[#707070] hover:text-[#282828]"
            >
              Classes
            </Link>
            <Link
              to="/settings"
              className="px-1.5 py-0.5 rounded-[2px] text-[#707070] hover:text-[#282828]"
            >
              Settings
            </Link>
          </nav>
        </div>

        {/* Center: Current photo name, index, status badge */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] text-[#707070] max-w-[200px] truncate">
            {current?.name ?? "—"}
          </span>
          <span className="font-mono text-[11px] text-[#282828] font-semibold">{position}</span>
          {current ? <StatusBadge status={current.status} /> : null}
          {current?.claimedBy && (
            <span className="font-mono text-[10px] text-[#707070]">
              [{current.claimedBy === username ? "Yours" : current.claimedBy}]
            </span>
          )}
        </div>

        {/* Right: Lease timer, Admin status, shortcuts, user */}
        <div className="flex items-center gap-2 min-w-0">
          {/* Active Lease Countdown */}
          <LeaseTimer
            claimedAt={current?.claimedAt}
            isMine={current?.claimedBy === username}
            isComplete={current?.status === "complete"}
            isApproved={isApproved}
          />

          {/* Maintenance Mode Notice */}
          {isMaintenance && (
            <span className="px-1.5 py-0.5 rounded-[2px] bg-amber-400 text-amber-950 text-[10px] font-bold">
              MAINTENANCE
            </span>
          )}

          {/* Admin badge */}
          {isAdmin && (
            <span className="px-1 py-0.2 rounded-[2px] bg-neutral-200 text-neutral-800 text-[10px] font-mono">
              Admin
            </span>
          )}

          {/* Keyboard Shortcuts Trigger */}
          <button
            type="button"
            className="press inline-flex size-5 items-center justify-center rounded-[2px] text-[#707070] hover:text-[#282828] hover:bg-[#f0f0f0]"
            title="Keyboard shortcuts (?)"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp className="size-3.5" />
          </button>

          {/* User & Sign Out */}
          {username && (
            <div className="flex items-center gap-1 pl-1 border-l border-[#c8c8c8]">
              <span className="font-mono text-[11px] text-[#282828]">{username}</span>
              <button
                type="button"
                onClick={() => {
                  void logout().finally(() => setUsername(null));
                }}
                className="press inline-flex size-5 items-center justify-center rounded-[2px] text-[#707070] hover:text-red-600 hover:bg-[#f0f0f0]"
                title="Sign out"
              >
                <LogOut className="size-3" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* =========================================================================
          MIDDLE WORKSPACE ROW (Left Toolbox + Center Canvas + Right Sidebar)
      ========================================================================= */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* -----------------------------------------------------------------------
            LEFT TOOLBOX STRIP (Exact 36px)
        ----------------------------------------------------------------------- */}
        <aside
          aria-label="Toolbox"
          className="w-[36px] border-r border-[#c8c8c8] bg-white flex flex-col items-center py-1 gap-1 shrink-0 select-none z-10"
        >
          {/* Select Mode / Pointer */}
          <button
            type="button"
            className={`press size-7 flex items-center justify-center rounded-[2px] border ${
              toolMode === "box" && !sam2Enabled && !cropMode
                ? "bg-[#1473e6] text-white border-[#1473e6]"
                : "border-transparent text-[#505050] hover:bg-[#f0f0f0] hover:text-[#282828]"
            }`}
            title="Selection / Box Tool (1)"
            onClick={() => {
              setToolMode("box");
              setSam2Enabled(false);
              setCropMode(false);
            }}
          >
            <MousePointer2 className="size-4" />
          </button>

          {/* Box Tool */}
          <button
            type="button"
            className={`press size-7 flex items-center justify-center rounded-[2px] border ${
              toolMode === "box"
                ? "bg-[#1473e6] text-white border-[#1473e6]"
                : "border-transparent text-[#505050] hover:bg-[#f0f0f0] hover:text-[#282828]"
            }`}
            title="Box Mode (Click to draw rectangle bounding boxes)"
            onClick={() => {
              setToolMode("box");
              setSam2Enabled(false);
              setCropMode(false);
            }}
          >
            <Square className="size-4" />
          </button>

          {/* Polygon Tool */}
          <button
            type="button"
            className={`press size-7 flex items-center justify-center rounded-[2px] border ${
              toolMode === "polygon"
                ? "bg-[#1473e6] text-white border-[#1473e6]"
                : "border-transparent text-[#505050] hover:bg-[#f0f0f0] hover:text-[#282828]"
            }`}
            title="Polygon Mode (Click to switch to multi-vertex polygon markup)"
            onClick={() => {
              setToolMode("polygon");
              setSam2Enabled(false);
              setCropMode(false);
            }}
          >
            <Pentagon className="size-4" />
          </button>

          {/* Pan / Zoom Help */}
          <div
            className="size-7 flex items-center justify-center rounded-[2px] text-[#707070] cursor-help"
            title="Pan: Hold Space + Drag or Middle-click drag • Zoom: Mouse Wheel"
          >
            <Hand className="size-4" />
          </div>

          {/* SAM2.1 Polygon Trace Toggle (Hidden if disabled by administrator) */}
          {aiEnabled && (
            <button
              type="button"
              disabled={locked}
              className={`press size-7 flex items-center justify-center rounded-[2px] border ${
                sam2Enabled
                  ? "bg-purple-600 text-white border-purple-600 shadow-none"
                  : "border-transparent text-[#505050] hover:bg-[#f0f0f0] hover:text-[#282828]"
              } disabled:opacity-30`}
              title={
                sam2Enabled
                  ? `SAM 2.1 Trace Active (${sam2Status.state}) — Left-click (+) foreground, Right-click (−) background, Enter to commit`
                  : "SAM 2.1 AI Auto-Trace (Click object points to trace precise boundary)"
              }
              onClick={() => {
                if (!aiEnabled) return;
                if (!sam2Enabled) {
                  const seen =
                    typeof window !== "undefined" &&
                    window.localStorage.getItem("ls_marker_sam2_notice_seen") === "1";
                  if (!seen && !samModelsCachedOnDisk && !isSam2Loaded()) {
                    setShowSam2Modal(true);
                    return;
                  }
                  setSam2Enabled(true);
                } else {
                  setSam2Enabled(false);
                  setSam2Status({ state: "idle" });
                }
              }}
            >
              {sam2Enabled &&
              (sam2Status.state === "loading_models" ||
                sam2Status.state === "encoding" ||
                sam2Status.state === "decoding") ? (
                <Loader2 className="size-4 animate-spin text-white" />
              ) : (
                <Sparkles className="size-4" />
              )}
            </button>
          )}

          {/* Crosshairs & Coordinate readout */}
          <button
            type="button"
            className={`press size-7 flex items-center justify-center rounded-[2px] border ${
              crosshairMode
                ? "bg-[#1473e6] text-white border-[#1473e6]"
                : "border-transparent text-[#505050] hover:bg-[#f0f0f0] hover:text-[#282828]"
            }`}
            title={
              crosshairMode
                ? "Crosshairs ON (Click canvas to set 0,0 origin • Esc to clear)"
                : "Crosshair Inspection & Relative Pixel Measuring"
            }
            onClick={() => setCrosshairMode((v) => !v)}
          >
            <Crosshair className="size-4" />
          </button>

          {/* Outline vs Filled Mode */}
          <button
            type="button"
            className={`press size-7 flex items-center justify-center rounded-[2px] border ${
              renderMode === "filled"
                ? "bg-[#1473e6] text-white border-[#1473e6]"
                : "border-transparent text-[#505050] hover:bg-[#f0f0f0] hover:text-[#282828]"
            }`}
            title={
              renderMode === "filled"
                ? "Precision filled mode (handles hidden). Click for Outline mode."
                : "Outline mode (handles visible). Click for Precision filled mode."
            }
            onClick={() => setRenderMode((m) => (m === "outline" ? "filled" : "outline"))}
          >
            <Layers className="size-4" />
          </button>

          {/* Crop ROI Tool */}
          <button
            type="button"
            disabled={locked}
            className={`press size-7 flex items-center justify-center rounded-[2px] border ${
              cropMode
                ? "bg-amber-500 text-white border-amber-500"
                : cropInfo?.isCropped
                  ? "border-amber-400 text-amber-600 bg-amber-50"
                  : "border-transparent text-[#505050] hover:bg-[#f0f0f0] hover:text-[#282828]"
            } disabled:opacity-30`}
            title={
              cropMode
                ? "Crop ROI Active: Drag bounding area on canvas"
                : cropInfo?.isCropped
                  ? `Cropped (${cropInfo.current.width}×${cropInfo.current.height} px). Click to adjust or reset.`
                  : "Lossless ROI Crop: Zoom and trim image before labeling"
            }
            onClick={() => setCropMode((v) => !v)}
          >
            <Scissors className="size-4" />
          </button>

          <div className="w-5 h-[1px] bg-[#c8c8c8] my-1" />

          {/* Undo (Ctrl+Z) */}
          <button
            type="button"
            disabled={locked || boxes.length === 0}
            className="press size-7 flex items-center justify-center rounded-[2px] text-[#505050] hover:bg-[#f0f0f0] hover:text-[#282828] disabled:opacity-30"
            title="Undo last annotation change (Ctrl+Z)"
            onClick={undoLast}
          >
            <Undo2 className="size-4" />
          </button>

          {/* Duplicate (Ctrl+D) */}
          <button
            type="button"
            disabled={!canDuplicate}
            className="press size-7 flex items-center justify-center rounded-[2px] text-[#505050] hover:bg-[#f0f0f0] hover:text-[#282828] disabled:opacity-30"
            title="Duplicate selected shape (Ctrl+D)"
            onClick={duplicate}
          >
            <Copy className="size-4" />
          </button>

          {/* Copy Previous Photo Annotations */}
          <button
            type="button"
            disabled={!canCopyPrevious}
            className="press size-7 flex items-center justify-center rounded-[2px] text-[#505050] hover:bg-[#f0f0f0] hover:text-[#282828] disabled:opacity-30"
            title="Copy boxes from previous photo (only if this photo has none)"
            onClick={() => void copyPrevious()}
          >
            <History className="size-4" />
          </button>

          {/* Convert Shape (Box ↔ Polygon) */}
          {selectedBox && !locked && (
            <button
              type="button"
              className="press size-7 flex items-center justify-center rounded-[2px] text-[#1473e6] hover:bg-[#1473e6]/10"
              title={
                selectedBox.points
                  ? "Convert selected polygon to bounding box"
                  : "Convert selected box to 4-point polygon"
              }
              onClick={toggleConvertSelected}
            >
              <Repeat className="size-4" />
            </button>
          )}
        </aside>

        {/* -----------------------------------------------------------------------
            CENTER CANVAS PANEL
        ----------------------------------------------------------------------- */}
        <main
          className={`flex-1 min-w-0 min-h-0 bg-[#f0f0f0] relative flex flex-col overflow-hidden ${
            isResizingSidebar ? "pointer-events-none" : ""
          }`}
        >
          {/* Review QA Banner (if review mode is active) */}
          {isReviewMode && (
            <div className="h-[28px] bg-[#fffbe6] border-b border-[#ffe58f] px-2 flex items-center justify-between text-xs shrink-0 select-none">
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-900 uppercase tracking-wide text-[10px] bg-amber-200 px-1.5 py-0.2 rounded-[2px]">
                  Review QA
                </span>
                <span className="font-mono text-[11px] font-semibold text-[#282828]">
                  {current?.name ? `Reviewing: ${current.name}` : "No photo loaded"}
                </span>
                <span className="text-[#707070] text-[11px]">
                  | Completed by:{" "}
                  <strong className="text-[#282828]">
                    {current?.owner || current?.claimedBy || "Annotator"}
                  </strong>
                  {current?.reviewedBy && (
                    <span className="ml-1 text-purple-700">
                      (Approved by {current.reviewedBy === username ? "you" : current.reviewedBy})
                    </span>
                  )}
                </span>
                {pendingReviewCount > 0 && (
                  <span className="font-mono text-[10px] bg-amber-200 text-amber-950 font-bold px-1.5 py-0.2 rounded-[2px]">
                    {pendingReviewCount} pending
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {isApproved ? (
                  canUnlock ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setShowUnlockModal(true)}
                      className="press inline-flex items-center gap-1 rounded-[2px] bg-amber-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-amber-700"
                      title="Revoke approval and unlock photo to edit"
                    >
                      <Unlock className="size-3 text-white" />
                      <span>Unlock to Edit</span>
                    </button>
                  ) : null
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!current || busy}
                      onClick={() => void handleReviewApprove()}
                      className="press inline-flex items-center gap-1 rounded-[2px] bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                      title="Approve annotations (Hotkey: A or Enter)"
                    >
                      <Check className="size-3" />
                      <span>Approve (A)</span>
                    </button>
                    <button
                      type="button"
                      disabled={!current || busy}
                      onClick={() => void handleReviewReject()}
                      className="press inline-flex items-center gap-1 rounded-[2px] bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
                      title="Reject back to pool (Hotkey: X)"
                    >
                      <X className="size-3" />
                      <span>Reject (X)</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleNextPendingReview()}
                  className="press rounded-[2px] border border-[#c8c8c8] bg-white px-2 py-0.5 text-[11px] text-[#282828] hover:bg-[#f0f0f0] disabled:opacity-40"
                >
                  Next Pending
                </button>
                <button
                  type="button"
                  onClick={exitReviewMode}
                  className="press rounded-[2px] border border-[#c8c8c8] bg-white px-2 py-0.5 text-[11px] text-[#707070] hover:text-[#282828]"
                >
                  Exit Review
                </button>
              </div>
            </div>
          )}

          {/* Main Canvas Stage */}
          <div className="flex-1 min-h-0 relative">
            {current && catalogue?.folderOk ? (
              <LabelStage
                key={`${folderKey}/${current.name}/${imageVersion}`}
                src={imageSrc(current.name) + (imageVersion ? `&v=${imageVersion}` : "")}
                alt={current.name}
                boxes={boxes}
                hiddenKeys={hiddenKeys}
                selectedKey={selectedKey}
                activeClassId={activeClassId}
                toolMode={toolMode}
                renderMode={renderMode}
                crosshairMode={crosshairMode}
                sam2Enabled={sam2Enabled}
                cropMode={cropMode}
                isCropped={Boolean(cropInfo?.isCropped)}
                cropOriginalDims={cropInfo?.original ?? null}
                isCropping={isCropping}
                onCropConfirm={handleCropConfirm}
                onCropCancel={() => setCropMode(false)}
                onCropReset={handleCropReset}
                onSam2Status={(st) => {
                  setSam2Status(st);
                  if (st.state !== "idle") setStatus(st.message);
                }}
                onSam2Error={(msg) => setError(msg)}
                labelFor={labelFor}
                colorFor={colorFor}
                readOnly={locked}
                onChange={handleBoxesChange}
                onSelect={selectBox}
                onStartMarkup={() => {
                  if (!isReviewMode && current && current.claimedBy !== username) {
                    void ensureClaimed();
                  }
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-[#707070]">
                {catalogue?.folderError ??
                  (catalogue
                    ? allImages.length
                      ? "No images in active queue."
                      : "Project folder contains no images."
                    : "Loading project images...")}
              </div>
            )}

            {/* SAM2 Model Download / Local Cache Notification */}
            {samModelState.samModelStatus === "downloading" ? (
              <div className="pointer-events-none absolute top-2 right-2 z-30 flex w-64 flex-col gap-1 rounded-[2px] border border-purple-400 bg-white p-2 text-xs shadow-none">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="flex items-center gap-1 text-purple-900 font-medium">
                    <Loader2 className="size-3 animate-spin" />
                    Downloading SAM 2.1:
                  </span>
                  <span className="font-bold">{samModelState.downloadProgress}%</span>
                </div>
                <div className="h-1 w-full bg-neutral-200 rounded-none overflow-hidden">
                  <div
                    className="h-full bg-purple-600 transition-all duration-150"
                    style={{ width: `${samModelState.downloadProgress}%` }}
                  />
                </div>
              </div>
            ) : samCacheToast ? (
              <div className="pointer-events-none absolute top-2 right-2 z-30 flex items-center gap-1.5 rounded-[2px] border border-emerald-400 bg-white px-2 py-1 font-mono text-[11px] text-[#282828] shadow-none">
                <Check className="size-3.5 text-emerald-600" />
                <span>{samCacheToast}</span>
              </div>
            ) : null}

            {/* Error banner overlay if any */}
            {error && (
              <div className="absolute bottom-2 left-2 right-2 z-30 bg-red-50 border border-red-300 p-2 text-xs text-red-800 rounded-[2px] flex items-center justify-between">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="text-red-700 hover:text-red-950"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        </main>

        {/* -----------------------------------------------------------------------
            HORIZONTAL RESIZE SPLITTER (Between Canvas and Right Sidebar)
        ----------------------------------------------------------------------- */}
        <div
          onPointerDown={handleSidebarResizePointerDown}
          onDoubleClick={() => {
            setSidebarWidth(320);
            try {
              localStorage.setItem("ls_marker_right_sidebar_width", "320");
            } catch {
              // ignore
            }
          }}
          title="Drag to resize side panel horizontally (Double-click to reset to 320px)"
          className={`group/sidebar-resizer w-1.5 h-full cursor-col-resize select-none shrink-0 transition-colors border-l border-[#c8c8c8] flex items-center justify-center z-10 ${
            isResizingSidebar ? "bg-[#1473e6]" : "bg-[#f5f5f5] hover:bg-[#1473e6]/30"
          }`}
        >
          <div
            className={`w-0.5 h-8 rounded-full transition-colors ${
              isResizingSidebar
                ? "bg-white"
                : "bg-[#a0a0a0] group-hover/sidebar-resizer:bg-[#1473e6]"
            }`}
          />
        </div>

        {/* -----------------------------------------------------------------------
            RIGHT SIDEBAR (Resizable, Collapsible Panes)
        ----------------------------------------------------------------------- */}
        <aside
          aria-label="Side Panels"
          style={{ width: `${sidebarWidth}px` }}
          className="border-l border-[#c8c8c8] bg-white flex flex-col shrink-0 select-none overflow-hidden h-full"
        >
          {/* PANE 1: Queue Filters & Photo Claims */}
          <div className="border-b border-[#c8c8c8] flex flex-col shrink-0">
            <button
              type="button"
              onClick={() => setPaneQueueOpen((v) => !v)}
              className="h-6 px-2 bg-[#f5f5f5] hover:bg-[#ebebeb] flex items-center justify-between border-b border-[#c8c8c8] text-[11px] font-semibold text-[#282828]"
            >
              <span>QUEUE &amp; CLAIMS</span>
              {paneQueueOpen ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </button>

            {paneQueueOpen && (
              <div className="p-2 flex flex-col gap-2 bg-white">
                {/* Filter Pills */}
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
                      className={`px-1.5 py-0.5 rounded-[2px] text-[11px] font-medium border ${
                        queue === key
                          ? "bg-[#1473e6] text-white border-[#1473e6]"
                          : "bg-white text-[#282828] border-[#c8c8c8] hover:bg-[#f0f0f0]"
                      }`}
                      onClick={() => showQueue(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Claim / Release Actions */}
                {current && (
                  <div className="flex flex-col gap-1.5 pt-1 border-t border-[#f0f0f0]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[#707070]">
                        {holder === username
                          ? "Claimed by you"
                          : holder
                            ? `Claimed by ${holder}`
                            : "Available to claim"}
                      </span>
                      <StatusBadge status={current.status} />
                    </div>

                    {isApproved ? (
                      canUnlock ? (
                        <button
                          type="button"
                          className="press h-7 w-full inline-flex items-center justify-center gap-1.5 rounded-[2px] bg-amber-600 px-2 text-[11px] font-bold text-white hover:bg-amber-700"
                          onClick={() => setShowUnlockModal(true)}
                        >
                          <Unlock className="size-3 text-white" />
                          <span>Unlock to Edit</span>
                        </button>
                      ) : null
                    ) : holder === username ? (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          className="press h-7 flex-1 rounded-[2px] bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-[11px] disabled:opacity-40"
                          onClick={() => void completeCurrent()}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="press h-7 flex-1 rounded-[2px] bg-amber-500 hover:bg-amber-600 text-white font-medium text-[11px] disabled:opacity-40"
                          onClick={() => void releaseIncompleteAction()}
                        >
                          Release Incomplete
                        </button>
                      </div>
                    ) : holder ? (
                      <button
                        type="button"
                        disabled={busy}
                        className="press h-7 w-full rounded-[2px] border border-amber-400 bg-amber-100 hover:bg-amber-200 text-amber-950 font-medium text-[11px]"
                        onClick={() => {
                          if (!confirmTakeover) {
                            setConfirmTakeover(true);
                            return;
                          }
                          void claim(true);
                        }}
                      >
                        {confirmTakeover ? "Confirm Takeover" : "Take Over"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        className="press h-7 w-full rounded-[2px] bg-[#1473e6] hover:bg-[#0d62c7] text-white font-medium text-[11px]"
                        onClick={() => void claim(false)}
                      >
                        Claim Photo
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PANE 2: Classes Palette & Part Dimensions */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="h-6 px-2 bg-[#f5f5f5] flex items-center justify-between border-b border-[#c8c8c8] text-[11px] font-semibold text-[#282828] shrink-0">
              <button
                type="button"
                onClick={() => setPaneClassesOpen((v) => !v)}
                className="flex items-center gap-1.5 flex-1 text-left"
              >
                <span>CLASSES ({classes.length})</span>
                {paneClassesOpen ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
              </button>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCodesOpen((v) => !v)}
                  className={`text-[10px] font-mono px-1 rounded-[2px] border ${
                    codesOpen
                      ? "bg-[#1473e6] text-white border-[#1473e6]"
                      : "bg-white text-[#707070] border-[#c8c8c8]"
                  }`}
                  title="Toggle paste item codes on image"
                >
                  Codes {tokens.length > 0 ? `(${tokens.length})` : ""}
                </button>
              </div>
            </div>

            {paneClassesOpen && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {codesOpen ? (
                  <div className="p-2 flex flex-col gap-1.5 flex-1 min-h-0 bg-white">
                    <span className="text-[11px] font-medium text-[#707070]">
                      Paste item codes for this photo (one per line):
                    </span>
                    <textarea
                      value={codeList}
                      spellCheck={false}
                      disabled={locked}
                      placeholder={"HX-M8\nNUT-M8\nWSH-M8"}
                      onChange={(e) => setCodeList(e.target.value)}
                      className="w-full flex-1 resize-none rounded-[2px] border border-[#c8c8c8] bg-white p-1.5 font-mono text-xs text-[#282828] outline-none focus:border-[#1473e6]"
                    />
                    {tokens.length > 0 && (
                      <span className="text-[10px] text-[#707070]">
                        {picks.length} of {tokens.length} matched in database.
                        {unknownCodes.length > 0 ? ` (${unknownCodes.length} missing)` : ""}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {/* Filter bar */}
                    <div className="p-1 border-b border-[#f0f0f0] bg-white">
                      <div className="relative flex items-center">
                        <Search className="size-3 text-[#707070] absolute left-1.5" />
                        <input
                          type="text"
                          placeholder="Filter classes..."
                          value={classFilter}
                          onChange={(e) => setClassFilter(e.target.value)}
                          className="w-full h-6 pl-6 pr-2 rounded-[2px] border border-[#c8c8c8] text-[11px] bg-white text-[#282828] outline-none focus:border-[#1473e6]"
                        />
                        {classFilter && (
                          <button
                            type="button"
                            onClick={() => setClassFilter("")}
                            className="absolute right-1 text-[#707070] hover:text-[#282828]"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Classes list */}
                    <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#f0f0f0]">
                      {filteredClasses.map((row) => {
                        const isSelected = row.id === activeClassId;
                        const complete = hasCompleteMeasurements(row);
                        const hasPartType = row.part_type && row.part_type !== "none";

                        return (
                          <div
                            key={row.id}
                            className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-[#1473e6]/10 border-l-2 border-[#1473e6]"
                                : "hover:bg-[#f9f9f9]"
                            }`}
                            onClick={() => chooseClass(row.id)}
                          >
                            {/* Color chip */}
                            <span
                              className="size-2.5 rounded-[1px] shrink-0"
                              style={{ backgroundColor: colorFor(row.id) }}
                            />

                            {/* Class ID */}
                            <span className="font-mono text-[10px] text-[#707070] w-6 shrink-0">
                              #{row.id}
                            </span>

                            {/* Item Code */}
                            <span className="font-bold text-[11px] text-[#282828] shrink-0">
                              {row.ic}
                            </span>

                            {/* Description */}
                            <span
                              className="text-[11px] text-[#707070] truncate flex-1 min-w-0"
                              title={row.des}
                            >
                              {row.des}
                            </span>

                            {/* Part dimensions status tag */}
                            {complete ? (
                              <span
                                className="text-[9px] font-mono px-1 py-0.2 rounded-[2px] bg-emerald-100 text-emerald-800 shrink-0"
                                title="Dimensions complete"
                              >
                                complete
                              </span>
                            ) : hasPartType ? (
                              <span
                                className="text-[9px] font-mono px-1 py-0.2 rounded-[2px] bg-rose-100 text-rose-800 shrink-0"
                                title="Dimensions unset"
                              >
                                unset
                              </span>
                            ) : null}

                            {/* Dimension edit toggle button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingDimsClass(
                                  editingDimsClass?.id === row.id ? null : { ...row },
                                );
                                setShowSvgDiagram(false);
                              }}
                              className={`press size-5 flex items-center justify-center rounded-[2px] text-[#707070] hover:text-[#1473e6] hover:bg-[#f0f0f0] ${
                                editingDimsClass?.id === row.id ? "text-[#1473e6]" : ""
                              }`}
                              title="Edit part measurements"
                            >
                              <Ruler className="size-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Inline Dense Dimension Editor */}
                    {editingDimsClass && (
                      <div className="p-2 border-t border-[#c8c8c8] bg-[#f9f9f9] flex flex-col gap-2 shrink-0 max-h-[220px] overflow-y-auto">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[11px] text-[#282828]">
                            Dimensions: {editingDimsClass.ic} (#{editingDimsClass.id})
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingDimsClass(null)}
                            className="text-[#707070] hover:text-[#282828]"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>

                        {/* Part Type Selector */}
                        <div className="flex items-center gap-1.5">
                          <label className="text-[11px] text-[#707070] shrink-0">Type:</label>
                          <select
                            value={editingDimsClass.part_type ?? "none"}
                            onChange={(e) =>
                              setEditingDimsClass({
                                ...editingDimsClass,
                                part_type: e.target.value as PartType,
                              })
                            }
                            className="h-6 flex-1 rounded-[2px] border border-[#c8c8c8] bg-white text-[11px] px-1"
                          >
                            {PART_TYPE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>

                          {editingDimsClass.part_type &&
                            editingDimsClass.part_type !== "none" &&
                            editingDimsClass.part_type !== "other" && (
                              <button
                                type="button"
                                onClick={() => setShowSvgDiagram((v) => !v)}
                                className={`h-6 px-1.5 rounded-[2px] border text-[10px] font-medium flex items-center gap-1 ${
                                  showSvgDiagram
                                    ? "bg-[#1473e6] text-white border-[#1473e6]"
                                    : "bg-white text-[#1473e6] border-[#1473e6]"
                                }`}
                              >
                                ? Diagram
                              </button>
                            )}
                        </div>

                        {/* SVG Measurement Guide Popover */}
                        {showSvgDiagram &&
                          editingDimsClass.part_type &&
                          editingDimsClass.part_type !== "none" &&
                          editingDimsClass.part_type !== "other" && (
                            <PartMeasurementPopover
                              partType={editingDimsClass.part_type}
                              onClose={() => setShowSvgDiagram(false)}
                            />
                          )}

                        {/* Dense fields table */}
                        {editingDimsClass.part_type && editingDimsClass.part_type !== "none" && (
                          <div>
                            {editingDimsClass.part_type === "bolt" && (
                              <div className="grid grid-cols-2 gap-1.5">
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Length under head (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="40"
                                    value={editingDimsClass.dim1_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim1_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Thread Ø (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="8"
                                    value={editingDimsClass.dim2_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim2_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                              </div>
                            )}

                            {editingDimsClass.part_type === "nut" && (
                              <div className="grid grid-cols-2 gap-1.5">
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Across flats A/F (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="13"
                                    value={editingDimsClass.dim1_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim1_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Height (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="6.5"
                                    value={editingDimsClass.dim2_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim2_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                              </div>
                            )}

                            {editingDimsClass.part_type === "washer" && (
                              <div className="grid grid-cols-3 gap-1">
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Outer Ø (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="16"
                                    value={editingDimsClass.dim1_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim1_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Inner Ø (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="8.4"
                                    value={editingDimsClass.dim2_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim2_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Thick (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="1.6"
                                    value={editingDimsClass.dim3_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim3_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                              </div>
                            )}

                            {editingDimsClass.part_type === "cable_tie" && (
                              <div className="grid grid-cols-2 gap-1.5">
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Length (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="200"
                                    value={editingDimsClass.dim1_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim1_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Width (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="4.8"
                                    value={editingDimsClass.dim2_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim2_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                              </div>
                            )}

                            {editingDimsClass.part_type === "spring" && (
                              <div className="grid grid-cols-2 gap-1.5">
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Height (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="35"
                                    value={editingDimsClass.dim1_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim1_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-[#707070] block">
                                    Diameter (mm)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="12"
                                    value={editingDimsClass.dim2_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim2_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-full h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                              </div>
                            )}

                            {editingDimsClass.part_type === "other" && (
                              <div className="flex flex-col gap-1.5">
                                <div className="flex gap-1">
                                  <input
                                    type="text"
                                    placeholder="Dim 1 name"
                                    value={editingDimsClass.dim1_name ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim1_name: e.target.value,
                                      })
                                    }
                                    className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white"
                                  />
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="mm"
                                    value={editingDimsClass.dim1_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim1_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                                <div className="flex gap-1">
                                  <input
                                    type="text"
                                    placeholder="Dim 2 name"
                                    value={editingDimsClass.dim2_name ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim2_name: e.target.value,
                                      })
                                    }
                                    className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white"
                                  />
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="mm"
                                    value={editingDimsClass.dim2_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim2_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                                <div className="flex gap-1">
                                  <input
                                    type="text"
                                    placeholder="Dim 3 name (optional)"
                                    value={editingDimsClass.dim3_name ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim3_name: e.target.value,
                                      })
                                    }
                                    className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white"
                                  />
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="mm"
                                    value={editingDimsClass.dim3_mm ?? ""}
                                    onChange={(e) =>
                                      setEditingDimsClass({
                                        ...editingDimsClass,
                                        dim3_mm: e.target.value ? Number(e.target.value) : null,
                                      })
                                    }
                                    className="w-1/2 h-6 rounded-[2px] border border-[#c8c8c8] px-1 text-[11px] bg-white font-mono"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {dimsError && <span className="text-[10px] text-red-600">{dimsError}</span>}

                        <button
                          type="button"
                          disabled={savingDims}
                          onClick={() => void handleSaveDims()}
                          className="press h-6 rounded-[2px] bg-[#1473e6] text-white font-medium text-[11px] flex items-center justify-center gap-1 hover:bg-[#0d62c7] disabled:opacity-40"
                        >
                          {savingDims ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Check className="size-3" />
                          )}
                          <span>Save Dims</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PANE 3: Layer / Shape Deck (Vertically Resizable) */}
          <div
            className="flex flex-col shrink-0 overflow-hidden relative"
            style={{ height: paneLayersOpen ? `${shapesHeight}px` : undefined }}
          >
            {/* Vertical resize splitter bar */}
            <div
              onPointerDown={handleShapesResizePointerDown}
              onDoubleClick={() => {
                setShapesHeight(220);
                try {
                  localStorage.setItem("ls_marker_shapes_pane_height", "220");
                } catch {
                  // ignore
                }
              }}
              title="Drag to resize Shapes vertically (Double-click to reset)"
              className={`group/shapes-resizer h-1.5 w-full cursor-row-resize select-none shrink-0 transition-colors border-t border-[#c8c8c8] flex items-center justify-center ${
                isResizingShapes ? "bg-[#1473e6]" : "bg-[#f5f5f5] hover:bg-[#1473e6]/30"
              }`}
            >
              <div
                className={`w-8 h-[2px] rounded-full transition-colors ${
                  isResizingShapes
                    ? "bg-white"
                    : "bg-[#a0a0a0] group-hover/shapes-resizer:bg-[#1473e6]"
                }`}
              />
            </div>

            <button
              type="button"
              onClick={() => setPaneLayersOpen((v) => !v)}
              className="h-6 px-2 bg-[#f5f5f5] hover:bg-[#ebebeb] flex items-center justify-between border-b border-[#c8c8c8] text-[11px] font-semibold text-[#282828] shrink-0"
            >
              <span>SHAPES ({boxes.length})</span>
              {paneLayersOpen ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </button>

            {paneLayersOpen && (
              <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#f0f0f0] bg-white">
                {boxes.length === 0 ? (
                  <div className="p-3 text-center text-[#707070] text-[11px]">
                    No shapes on this photo.
                  </div>
                ) : (
                  boxes.map((box, idx) => {
                    const isSelected = selectedKey === box.key;
                    const isHidden = hiddenKeys.has(box.key);
                    const isPolygon = Boolean(box.points && box.points.length >= 3);

                    return (
                      <div
                        key={box.key}
                        onClick={() => selectBox(box.key)}
                        className={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-[#1473e6]/10 border-l-2 border-[#1473e6]"
                            : "hover:bg-[#f9f9f9]"
                        } ${isHidden ? "opacity-40" : ""}`}
                      >
                        {/* Shape index */}
                        <span className="font-mono text-[10px] text-[#707070] w-4 shrink-0">
                          #{idx + 1}
                        </span>

                        {/* Shape type glyph (click to convert) */}
                        <button
                          type="button"
                          disabled={locked}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedKey(box.key);
                            toggleConvertSelected();
                          }}
                          className="size-4 shrink-0 font-bold text-center text-[#707070] hover:text-[#1473e6]"
                          title={
                            isPolygon
                              ? "Polygon (click to convert to Box)"
                              : "Box (click to convert to Polygon)"
                          }
                        >
                          {isPolygon ? "⬠" : "▢"}
                        </button>

                        {/* Class color chip */}
                        <span
                          className="size-2 rounded-[1px] shrink-0"
                          style={{ backgroundColor: colorFor(box.classId) }}
                        />

                        {/* Title */}
                        <span
                          className="text-[11px] font-mono text-[#282828] truncate flex-1 min-w-0"
                          title={boxTitle(box.classId)}
                        >
                          {boxTitle(box.classId)}
                        </span>

                        {/* Visibility eye toggle */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleBox(box.key);
                          }}
                          className="press size-5 flex items-center justify-center rounded-[2px] text-[#707070] hover:text-[#282828]"
                          title={isHidden ? "Show shape" : "Hide shape"}
                        >
                          {isHidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                        </button>

                        {/* Delete shape */}
                        <button
                          type="button"
                          disabled={locked}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isReviewMode && current && current.claimedBy !== username) {
                              void ensureClaimed();
                            }
                            const next = boxes.filter((b) => b.key !== box.key);
                            pushUndoSnapshot(next, null);
                            setBoxes(next);
                            if (selectedKey === box.key) setSelectedKey(null);
                          }}
                          className="press size-5 flex items-center justify-center rounded-[2px] text-[#707070] hover:text-red-600 disabled:opacity-30"
                          title="Delete shape"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* =========================================================================
          BOTTOM FILMSTRIP PANEL (Exact 76px)
      ========================================================================= */}
      <footer className="h-[76px] border-t border-[#c8c8c8] bg-white flex items-center px-2 shrink-0 select-none overflow-hidden">
        {/* Left: Navigation and Position */}
        <div className="flex items-center gap-1.5 shrink-0 pr-2 border-r border-[#c8c8c8]">
          <button
            type="button"
            className="press size-7 flex items-center justify-center rounded-[2px] border border-[#c8c8c8] text-[#282828] hover:bg-[#f0f0f0] disabled:opacity-30"
            onClick={() => void shift(-1)}
            disabled={!current || safeIndex === 0 || busy}
            title="Previous Photo (Left Arrow)"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="flex flex-col items-center">
            <span className="font-mono text-[11px] font-semibold text-[#282828]">{position}</span>
            <span className="font-mono text-[9px] text-[#707070]">{labelledCount} labelled</span>
          </div>
          <button
            type="button"
            className="press size-7 flex items-center justify-center rounded-[2px] border border-[#c8c8c8] text-[#282828] hover:bg-[#f0f0f0] disabled:opacity-30"
            onClick={() => void shift(1)}
            disabled={!current || safeIndex >= images.length - 1 || busy}
            title="Next Photo (Right Arrow)"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* Center: Scrollable Thumbnails Filmstrip Queue */}
        <div className="flex-1 min-w-0 h-full flex items-center gap-1.5 overflow-x-auto py-1 px-2">
          {images.map((img, idx) => {
            const isActive = idx === safeIndex;
            return (
              <button
                key={img.name}
                type="button"
                ref={isActive ? activeThumbnailRef : undefined}
                onClick={() => void jumpToIndex(idx)}
                className={`h-[64px] min-w-[56px] max-w-[68px] flex flex-col items-center justify-between p-0.5 border select-none rounded-[2px] transition-colors relative shrink-0 ${
                  isActive
                    ? "border-[#1473e6] ring-1 ring-[#1473e6] bg-[#1473e6]/5"
                    : "border-[#c8c8c8] bg-white hover:bg-[#f9f9f9]"
                }`}
                title={`${img.name} (${img.status})`}
              >
                <img
                  src={imageSrc(img.name)}
                  alt=""
                  loading="lazy"
                  className="h-[38px] w-full object-cover bg-black/10 rounded-[1px]"
                />
                <div className="w-full flex items-center justify-between gap-1 px-0.5">
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${
                      img.status === "approved"
                        ? "bg-purple-600"
                        : img.status === "complete"
                          ? "bg-emerald-600"
                          : img.status === "incomplete"
                            ? "bg-amber-600"
                            : "bg-neutral-300"
                    }`}
                  />
                  <span className="font-mono text-[8.5px] truncate text-[#282828] leading-none">
                    {img.name.split("/").pop()}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: Actions & Tar Exports */}
        <div className="flex items-center gap-1.5 shrink-0 pl-2 border-l border-[#c8c8c8]">
          {/* No parts button */}
          {!isApproved && (
            <button
              type="button"
              disabled={!current || busy || locked || boxes.length > 0}
              onClick={() => void markNone()}
              className="press h-7 px-2 rounded-[2px] border border-[#c8c8c8] bg-white text-[#282828] hover:bg-[#f0f0f0] text-[11px] font-medium disabled:opacity-30"
              title="Save empty label and advance to next unlabelled (N)"
            >
              No Parts (N)
            </button>
          )}

          {/* Save button */}
          {isApproved ? (
            <span className="h-7 px-2 rounded-[2px] bg-purple-100 text-purple-900 border border-purple-300 font-bold text-[11px] inline-flex items-center gap-1">
              <Check className="size-3" />
              Approved
            </span>
          ) : (
            <button
              type="button"
              disabled={!current || busy || !dirty || locked}
              onClick={() => void save()}
              className="press h-7 px-2.5 rounded-[2px] bg-[#1473e6] text-white font-medium text-[11px] hover:bg-[#0d62c7] disabled:opacity-40"
              title="Save annotations (Ctrl+S)"
            >
              Save (Ctrl+S)
            </button>
          )}

          {/* Status text */}
          <div className="min-w-[70px] text-right font-mono text-[10px] text-[#707070]">
            {dirty ? (
              <span className="text-amber-600 font-bold">● Unsaved</span>
            ) : (
              <span>{status}</span>
            )}
          </div>
        </div>
      </footer>

      {/* =========================================================================
          MODALS: Unlock, SAM2 Notice, Shortcuts
      ========================================================================= */}
      {showUnlockModal && current && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-[2px] border border-[#c8c8c8] bg-white p-4 shadow-none">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="size-5 shrink-0" />
              <h3 className="text-sm font-semibold text-[#282828]">Unlock Approved Photo?</h3>
            </div>
            <p className="mt-2 text-xs text-[#707070] leading-relaxed">
              This photo is approved. Unlocking it revokes approval and allows editing.
            </p>
            {unlockError && (
              <p className="mt-2 rounded-[2px] border border-red-300 bg-red-50 p-1.5 text-xs text-red-700">
                {unlockError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={isUnlocking}
                onClick={() => {
                  setShowUnlockModal(false);
                  setUnlockError(null);
                }}
                className="press h-7 px-3 rounded-[2px] border border-[#c8c8c8] bg-white text-xs text-[#282828]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUnlocking}
                onClick={() => void handleConfirmUnlock()}
                className="press h-7 px-3 rounded-[2px] bg-amber-600 text-xs font-semibold text-white flex items-center gap-1"
              >
                {isUnlocking ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Unlock className="size-3" />
                )}
                <span>Unlock and Edit</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showSam2Modal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-md rounded-[2px] border border-[#c8c8c8] bg-white p-4 shadow-none">
            <div className="flex items-center gap-2 text-purple-700">
              <Sparkles className="size-5 shrink-0" />
              <h3 className="text-sm font-semibold text-[#282828]">Enable SAM 2.1 Auto-Trace</h3>
            </div>
            <div className="mt-2 flex flex-col gap-1.5 text-xs text-[#707070] leading-relaxed">
              <p>
                First activation downloads the{" "}
                <strong className="text-[#282828]">SAM 2.1 Hiera Tiny</strong> ONNX weights (~120
                MB) and permanently caches them in your browser for sub-50ms repeat loads.
              </p>
              <p>
                <strong className="text-[#282828]">Left-click</strong> foreground part points,{" "}
                <strong className="text-[#282828]">Right-click / Shift+click</strong> background
                points, and press <strong className="text-[#282828]">Enter</strong> to commit.
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSam2Modal(false)}
                className="press h-7 px-3 rounded-[2px] border border-[#c8c8c8] bg-white text-xs text-[#282828]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem("ls_marker_sam2_notice_seen", "1");
                  }
                  setShowSam2Modal(false);
                  setSam2Enabled(true);
                }}
                className="press h-7 px-3 rounded-[2px] bg-purple-600 text-xs font-semibold text-white flex items-center gap-1"
              >
                <Download className="size-3" />
                <span>Download &amp; Enable Trace</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {helpOpen && <KeyboardShortcutsModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
