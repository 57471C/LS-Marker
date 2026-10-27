import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { inkOn } from "@/lib/class-color";
import {
  encodeSam2Image,
  traceSam2WithPrompts,
  type Sam2PromptPoint,
  type Sam2Status,
} from "@/lib/sam2-client";

export type StageBox = {
  key: string;
  classId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  points?: [number, number][];
  samPrompts?: Sam2PromptPoint[];
};

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

type Corner = "nw" | "ne" | "sw" | "se";

type Drag =
  | { kind: "draw"; classId: number; x0: number; y0: number; x1: number; y1: number }
  | { kind: "move"; key: string; dx: number; dy: number }
  | { kind: "resize"; key: string; anchorX: number; anchorY: number }
  | { kind: "vertex"; key: string; index: number };

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function getMinDimension(natural?: { w: number; h: number } | null): {
  minW: number;
  minH: number;
} {
  const w = natural?.w && natural.w > 0 ? natural.w : 1000;
  const h = natural?.h && natural.h > 0 ? natural.h : 1000;
  // Allow down to ~4px x 4px (or minimum 0.0005 normalized on high-res sensors)
  return {
    minW: Math.max(0.0005, 4 / w),
    minH: Math.max(0.0005, 4 / h),
  };
}

export function polygonBBox(
  points: [number, number][],
  minW = 0.001,
  minH = 0.001,
): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const w = Math.max(minW, maxX - minX);
  const h = Math.max(minH, maxY - minY);
  return {
    x: round6(minX + w / 2),
    y: round6(minY + h / 2),
    w: round6(w),
    h: round6(h),
  };
}

function fromCorners(
  base: Pick<StageBox, "key" | "classId">,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minW = 0.001,
  minH = 0.001,
): StageBox {
  const left = clamp(Math.min(x0, x1), 0, 1);
  const right = clamp(Math.max(x0, x1), 0, 1);
  const top = clamp(Math.min(y0, y1), 0, 1);
  const bottom = clamp(Math.max(y0, y1), 0, 1);
  const w = Math.max(right - left, minW);
  const h = Math.max(bottom - top, minH);
  let x = left;
  let y = top;
  if (x + w > 1) x = 1 - w;
  if (y + h > 1) y = 1 - h;
  return {
    key: base.key,
    classId: base.classId,
    x: round6(x + w / 2),
    y: round6(y + h / 2),
    w: round6(w),
    h: round6(h),
  };
}

function styleOf(box: Pick<StageBox, "x" | "y" | "w" | "h">): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${(box.x - box.w / 2) * 100}%`,
    top: `${(box.y - box.h / 2) * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
  };
}

const HANDLES: Corner[] = ["nw", "ne", "sw", "se"];

type View = { zoom: number; x: number; y: number };
type Fit = { left: number; top: number; width: number; height: number };
type FrameSize = { w: number; h: number };

function clampView(view: View, fit: Fit, frame: FrameSize): View {
  const zoom = clamp(view.zoom, 1, 16);
  if (zoom === 1) return { zoom: 1, x: 0, y: 0 };
  const width = fit.width * zoom;
  const height = fit.height * zoom;
  const margin = Math.min(64, frame.w / 2, frame.h / 2);
  const minLeft = margin - width;
  const maxLeft = frame.w - margin;
  const minTop = margin - height;
  const maxTop = frame.h - margin;
  const left = clamp(
    frame.w / 2 + view.x - width / 2,
    Math.min(minLeft, maxLeft),
    Math.max(minLeft, maxLeft),
  );
  const top = clamp(
    frame.h / 2 + view.y - height / 2,
    Math.min(minTop, maxTop),
    Math.max(minTop, maxTop),
  );
  return {
    zoom,
    x: left - frame.w / 2 + width / 2,
    y: top - frame.h / 2 + height / 2,
  };
}

export function LabelStage({
  src,
  alt,
  boxes,
  selectedKey,
  activeClassId,
  labelFor,
  colorFor,
  readOnly,
  hiddenKeys,
  toolMode = "box",
  renderMode = "outline",
  crosshairMode = false,
  sam2Enabled = false,
  onSam2Status,
  onSam2Error,
  onChange,
  onSelect,
}: {
  src: string;
  alt: string;
  boxes: StageBox[];
  selectedKey: string | null;
  activeClassId: number | null;
  labelFor: (classId: number) => string;
  colorFor: (classId: number) => string;
  readOnly?: boolean;
  hiddenKeys?: ReadonlySet<string>;
  toolMode?: "box" | "polygon";
  renderMode?: "outline" | "filled";
  crosshairMode?: boolean;
  sam2Enabled?: boolean;
  onSam2Status?: (status: Sam2Status) => void;
  onSam2Error?: (message: string) => void;
  onChange: (boxes: StageBox[], options?: { transient?: boolean }) => void;
  onSelect: (key: string | null) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const boxesRef = useRef(boxes);
  const dragRef = useRef<Drag | null>(null);
  boxesRef.current = boxes;

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const [polyDraft, setPolyDraft] = useState<[number, number][] | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [crosshairOrigin, setCrosshairOrigin] = useState<{ x: number; y: number } | null>(null);
  const [sam2BusyPoint, setSam2BusyPoint] = useState<{ x: number; y: number } | null>(null);
  const [samPromptPoints, setSamPromptPoints] = useState<Sam2PromptPoint[]>([]);
  const [samDraftPolygon, setSamDraftPolygon] = useState<[number, number][] | null>(null);
  const polyDraftRef = useRef(polyDraft);
  polyDraftRef.current = polyDraft;
  const crosshairOriginRef = useRef(crosshairOrigin);
  crosshairOriginRef.current = crosshairOrigin;
  const samPromptPointsRef = useRef(samPromptPoints);
  samPromptPointsRef.current = samPromptPoints;
  const samDraftPolygonRef = useRef(samDraftPolygon);
  samDraftPolygonRef.current = samDraftPolygon;

  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [spaceMode, setSpaceMode] = useState<"off" | "ready" | "dragging">("off");
  const viewRef = useRef(view);
  const spaceRef = useRef(false);
  const panDrag = useRef<{
    pointerId: number;
    px: number;
    py: number;
    x: number;
    y: number;
  } | null>(null);
  viewRef.current = view;

  const prevSrc = useRef(src);
  const prevToolMode = useRef(toolMode);
  const prevCrosshair = useRef(crosshairMode);
  const prevSam2Enabled = useRef(sam2Enabled);
  if (
    prevSrc.current !== src ||
    prevToolMode.current !== toolMode ||
    prevCrosshair.current !== crosshairMode ||
    prevSam2Enabled.current !== sam2Enabled
  ) {
    if (prevSrc.current !== src || prevCrosshair.current !== crosshairMode) {
      if (crosshairOrigin) {
        setCrosshairOrigin(null);
      }
    }
    if (
      prevSrc.current !== src ||
      prevToolMode.current !== toolMode ||
      prevSam2Enabled.current !== sam2Enabled
    ) {
      if (samPromptPoints.length > 0) {
        setSamPromptPoints([]);
      }
      if (samDraftPolygon) {
        setSamDraftPolygon(null);
      }
      if (sam2BusyPoint) {
        setSam2BusyPoint(null);
      }
    }
    prevSrc.current = src;
    prevToolMode.current = toolMode;
    prevCrosshair.current = crosshairMode;
    prevSam2Enabled.current = sam2Enabled;
    if (polyDraft) {
      setPolyDraft(null);
    }
  }

  useEffect(() => {
    if (!sam2Enabled || !natural || !imgRef.current) return;
    let cancelled = false;
    encodeSam2Image(imgRef.current, src, (st) => {
      if (!cancelled) onSam2Status?.(st);
    }).catch((err: unknown) => {
      if (!cancelled) {
        const msg = err instanceof Error ? err.message : "SAM2 encoding failed";
        onSam2Status?.({ state: "error", message: msg });
        onSam2Error?.(msg);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sam2Enabled, natural, src, onSam2Status, onSam2Error]);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setFrame({ w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitted = useMemo(() => {
    if (!natural || frame.w < 1 || frame.h < 1) return null;
    const scale = Math.min(frame.w / natural.w, frame.h / natural.h);
    const width = natural.w * scale;
    const height = natural.h * scale;
    return {
      left: (frame.w - width) / 2,
      top: (frame.h - height) / 2,
      width,
      height,
    };
  }, [natural, frame]);

  const placed = useMemo(() => {
    if (!fitted) return null;
    const width = fitted.width * view.zoom;
    const height = fitted.height * view.zoom;
    return {
      left: frame.w / 2 + view.x - width / 2,
      top: frame.h / 2 + view.y - height / 2,
      width,
      height,
    };
  }, [fitted, frame, view]);

  const fittedRef = useRef(fitted);
  const frameSizeRef = useRef(frame);
  fittedRef.current = fitted;
  frameSizeRef.current = frame;

  function zoomBy(clientX: number, clientY: number, factor: number) {
    const fit = fittedRef.current;
    const fr = frameSizeRef.current;
    const el = frameRef.current;
    if (!fit || !el || fr.w < 1 || fr.h < 1) return;
    const rect = el.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    setView((prev) => {
      const width = fit.width * prev.zoom;
      const height = fit.height * prev.zoom;
      const left = fr.w / 2 + prev.x - width / 2;
      const top = fr.h / 2 + prev.y - height / 2;
      const nextZoom = clamp(prev.zoom * factor, 1, 16);
      if (nextZoom === 1) return { zoom: 1, x: 0, y: 0 };
      const nWidth = fit.width * nextZoom;
      const nHeight = fit.height * nextZoom;
      const u = width > 0 ? (mx - left) / width : 0.5;
      const v = height > 0 ? (my - top) / height : 0.5;
      return clampView(
        {
          zoom: nextZoom,
          x: mx - u * nWidth - fr.w / 2 + nWidth / 2,
          y: my - v * nHeight - fr.h / 2 + nHeight / 2,
        },
        fit,
        fr,
      );
    });
  }

  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.002);
      if (factor === 1) return;
      zoomByRef.current(event.clientX, event.clientY, factor);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function closePolygon(pts: [number, number][]) {
    if (pts.length < 3 || activeClassId == null) {
      setPolyDraft(null);
      return;
    }
    const cleanPts: [number, number][] = [];
    for (const p of pts) {
      if (cleanPts.length === 0) {
        cleanPts.push(p);
      } else {
        const last = cleanPts[cleanPts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.002) {
          cleanPts.push(p);
        }
      }
    }
    if (cleanPts.length < 3) {
      setPolyDraft(null);
      return;
    }
    const bbox = polygonBBox(cleanPts);
    const newBox: StageBox = {
      key: newId(),
      classId: activeClassId,
      ...bbox,
      points: cleanPts.map(([px, py]) => [round6(px), round6(py)]),
    };
    onChange([...boxesRef.current, newBox]);
    onSelect(newBox.key);
    setPolyDraft(null);
  }

  const closePolygonRef = useRef(closePolygon);
  closePolygonRef.current = closePolygon;

  function clearSamSession() {
    setSamPromptPoints([]);
    setSamDraftPolygon(null);
    setSam2BusyPoint(null);
  }

  function runSamPrompts(nextPrompts: Sam2PromptPoint[], indicatorPt?: { x: number; y: number }) {
    if (nextPrompts.length === 0 || !imgRef.current) {
      clearSamSession();
      return;
    }
    const imgEl = imgRef.current;
    setSamPromptPoints(nextPrompts);
    setSam2BusyPoint(indicatorPt ?? nextPrompts[nextPrompts.length - 1]);
    void traceSam2WithPrompts(imgEl, src, nextPrompts, onSam2Status)
      .then((pts) => {
        if (!pts || pts.length < 3) {
          onSam2Error?.("SAM2 could not detect a distinct object boundary for those points.");
          return;
        }
        setSamDraftPolygon(pts);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "SAM2 tracing failed";
        onSam2Status?.({ state: "error", message: msg });
        onSam2Error?.(msg);
      })
      .finally(() => {
        setSam2BusyPoint(null);
      });
  }

  function commitSamDraft() {
    const pts = samDraftPolygonRef.current;
    if (!pts || pts.length < 3 || activeClassId == null) {
      clearSamSession();
      return;
    }
    const bbox = polygonBBox(pts);
    const newBox: StageBox = {
      key: newId(),
      classId: activeClassId,
      ...bbox,
      points: pts.map(([px, py]) => [round6(px), round6(py)]),
    };
    onChange([...boxesRef.current, newBox]);
    onSelect(newBox.key);
    clearSamSession();
  }

  const commitSamDraftRef = useRef(commitSamDraft);
  commitSamDraftRef.current = commitSamDraft;
  const clearSamSessionRef = useRef(clearSamSession);
  clearSamSessionRef.current = clearSamSession;
  const runSamPromptsRef = useRef(runSamPrompts);
  runSamPromptsRef.current = runSamPrompts;

  useEffect(() => {
    function typing(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dragRef.current = null;
        setDraft(null);
        if (samPromptPointsRef.current.length > 0 || samDraftPolygonRef.current) {
          event.preventDefault();
          event.stopPropagation();
          clearSamSessionRef.current();
          return;
        }
        if (polyDraftRef.current) {
          event.preventDefault();
          event.stopPropagation();
          setPolyDraft(null);
          return;
        }
        if (crosshairOriginRef.current) {
          setCrosshairOrigin(null);
        }
        return;
      }
      if (typing(event.target)) return;

      if (event.key === "Enter") {
        if (samDraftPolygonRef.current && samDraftPolygonRef.current.length >= 3) {
          event.preventDefault();
          event.stopPropagation();
          commitSamDraftRef.current();
          return;
        }
        if (polyDraftRef.current && polyDraftRef.current.length >= 3) {
          event.preventDefault();
          event.stopPropagation();
          closePolygonRef.current(polyDraftRef.current);
          return;
        }
      }

      if (
        event.key === "Backspace" ||
        ((event.ctrlKey || event.metaKey) &&
          (event.key === "z" || event.key === "Z") &&
          !event.shiftKey)
      ) {
        if (samPromptPointsRef.current.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          const prevPts = samPromptPointsRef.current.slice(0, -1);
          if (prevPts.length === 0) {
            clearSamSessionRef.current();
          } else {
            runSamPromptsRef.current(prevPts);
          }
          return;
        }
      }

      if (event.key === "Backspace") {
        if (polyDraftRef.current && polyDraftRef.current.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          if (polyDraftRef.current.length > 1) {
            setPolyDraft(polyDraftRef.current.slice(0, -1));
          } else {
            setPolyDraft(null);
          }
          return;
        }
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (spaceRef.current) return;
        spaceRef.current = true;
        setSpaceMode(panDrag.current ? "dragging" : "ready");
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key !== "=" && event.key !== "+" && event.key !== "-" && event.key !== "_") return;
      event.preventDefault();
      const el = frameRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const factor = event.key === "-" || event.key === "_" ? 1 / 1.2 : 1.2;
      zoomByRef.current(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code !== "Space") return;
      spaceRef.current = false;
      if (!panDrag.current) setSpaceMode("off");
    }
    function onBlur() {
      spaceRef.current = false;
      if (!panDrag.current) setSpaceMode("off");
    }
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  function point(event: PointerEvent | React.MouseEvent): { x: number; y: number } | null {
    const el = overlayRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = dragRef.current;
    dragRef.current = null;
    setDraft(null);
    if (!drag) return;
    if (drag.kind === "draw") {
      const moved = Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0);
      const { minW, minH } = getMinDimension(natural);
      // Allow dragging tiny boxes (starting at ~2-3 px move)
      const minMove = Math.min(0.002, Math.max(minW, minH) * 0.7);
      if (moved < minMove) return;
      const box = fromCorners(
        { key: newId(), classId: drag.classId },
        drag.x0,
        drag.y0,
        drag.x1,
        drag.y1,
        minW,
        minH,
      );
      onChange([...boxesRef.current, box]);
      onSelect(box.key);
      return;
    }
    onChange(
      boxesRef.current.map((box) => ({
        ...box,
        x: round6(box.x),
        y: round6(box.y),
        w: round6(box.w),
        h: round6(box.h),
        points: box.points ? box.points.map(([px, py]) => [round6(px), round6(py)]) : undefined,
      })),
    );
  }

  function onFramePointerDownCapture(event: PointerEvent<HTMLDivElement>) {
    if (!spaceRef.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    panDrag.current = {
      pointerId: event.pointerId,
      px: event.clientX,
      py: event.clientY,
      x: viewRef.current.x,
      y: viewRef.current.y,
    };
    setSpaceMode("dragging");
  }

  function onFramePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = panDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const fit = fittedRef.current;
    const fr = frameSizeRef.current;
    if (!fit) return;
    setView(
      clampView(
        {
          zoom: viewRef.current.zoom,
          x: drag.x + (event.clientX - drag.px),
          y: drag.y + (event.clientY - drag.py),
        },
        fit,
        fr,
      ),
    );
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (!panDrag.current || panDrag.current.pointerId !== event.pointerId) return;
    panDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setSpaceMode(spaceRef.current ? "ready" : "off");
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const isCtrl = event.ctrlKey || event.metaKey;
    const isSamRightClick = sam2Enabled && event.button === 2;
    if (event.button !== 0 && !isSamRightClick) return;
    const here = point(event);
    if (!here) return;
    const target = event.target instanceof Element ? event.target : null;
    const cornerHandle = target?.closest("[data-corner]");
    const vertexHandle = target?.closest("[data-vertex]");
    const boxEl = target?.closest("[data-box]");
    const key = boxEl?.getAttribute("data-box");

    // In crosshair mode, zero (0,0) on first click (or when starting a new measurement outside polygon drafting)
    if (
      event.button === 0 &&
      crosshairMode &&
      (!polyDraftRef.current || polyDraftRef.current.length === 0)
    ) {
      setCrosshairOrigin({ x: here.x, y: here.y });
    }

    if (readOnly) {
      if (key) {
        onSelect(key);
      } else {
        onSelect(null);
      }
      return;
    }

    // Active polygon drafting flow
    if (!sam2Enabled && polyDraftRef.current && polyDraftRef.current.length > 0) {
      event.preventDefault();
      const first = polyDraftRef.current[0];
      const d0 = Math.hypot(here.x - first[0], here.y - first[1]);
      if (polyDraftRef.current.length >= 3 && d0 < 0.025) {
        closePolygonRef.current(polyDraftRef.current);
        return;
      }
      setPolyDraft([...polyDraftRef.current, [round6(here.x), round6(here.y)]]);
      return;
    }

    event.preventDefault();

    // Draggable vertex handle of selected polygon (when not in an active SAM2 prompt session)
    if (
      event.button === 0 &&
      !isCtrl &&
      !event.shiftKey &&
      samPromptPointsRef.current.length === 0 &&
      vertexHandle &&
      key
    ) {
      event.currentTarget.setPointerCapture(event.pointerId);
      const vIdx = Number(vertexHandle.getAttribute("data-vertex"));
      onSelect(key);
      dragRef.current = { kind: "vertex", key, index: vIdx };
      return;
    }

    // Draggable corner handle of selected box
    if (
      event.button === 0 &&
      !isCtrl &&
      !event.shiftKey &&
      samPromptPointsRef.current.length === 0 &&
      cornerHandle &&
      key
    ) {
      event.currentTarget.setPointerCapture(event.pointerId);
      const box = boxesRef.current.find((item) => item.key === key);
      if (!box) return;
      onSelect(key);
      const corner = cornerHandle.getAttribute("data-corner") as Corner;
      const left = box.x - box.w / 2;
      const top = box.y - box.h / 2;
      const right = box.x + box.w / 2;
      const bottom = box.y + box.h / 2;
      const anchor = {
        nw: { x: right, y: bottom },
        ne: { x: left, y: bottom },
        sw: { x: right, y: top },
        se: { x: left, y: top },
      }[corner];
      dragRef.current = { kind: "resize", key, anchorX: anchor.x, anchorY: anchor.y };
      return;
    }

    // SAM2.1 interactive multi-point prompt session:
    // - Left-Click: Add positive/foreground point (label = 1, green indicator)
    // - Right-Click / Shift+Left-Click: Add negative/background point (label = 0, red indicator)
    // - Enter or Double-Click: Commit polygon and clear prompt points
    // - Escape: Cancel prompt session and clear indicators
    if (sam2Enabled) {
      if (activeClassId == null || !imgRef.current) {
        return;
      }
      // Double-click commits the active SAM2 draft polygon immediately
      if (
        event.button === 0 &&
        event.detail >= 2 &&
        samDraftPolygonRef.current &&
        samDraftPolygonRef.current.length >= 3
      ) {
        commitSamDraft();
        return;
      }
      if (sam2BusyPoint) {
        return;
      }
      const isNegative = event.button === 2 || (event.button === 0 && event.shiftKey);
      const promptLabel: 0 | 1 = isNegative ? 0 : 1;
      const nextPrompts: Sam2PromptPoint[] = [
        ...samPromptPointsRef.current,
        { x: round6(here.x), y: round6(here.y), label: promptLabel },
      ];
      runSamPrompts(nextPrompts, here);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    // Click on existing shape body
    if (key) {
      const box = boxesRef.current.find((item) => item.key === key);
      if (!box) return;
      onSelect(key);
      dragRef.current = { kind: "move", key, dx: here.x - box.x, dy: here.y - box.y };
      return;
    }

    // Empty canvas click
    if (activeClassId == null) {
      onSelect(null);
      return;
    }

    if (toolMode === "polygon") {
      onSelect(null);
      setPolyDraft([[round6(here.x), round6(here.y)]]);
      return;
    }

    // Standard box draw
    onSelect(null);
    dragRef.current = {
      kind: "draw",
      classId: activeClassId,
      x0: here.x,
      y0: here.y,
      x1: here.x,
      y1: here.y,
    };
    setDraft({ x0: here.x, y0: here.y, x1: here.x, y1: here.y });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const here = point(event);
    if (!here) return;
    setCursorPos(here);

    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === "draw") {
      drag.x1 = here.x;
      drag.y1 = here.y;
      setDraft({ x0: drag.x0, y0: drag.y0, x1: here.x, y1: here.y });
      return;
    }
    if (drag.kind === "move") {
      onChange(
        boxesRef.current.map((box) => {
          if (box.key !== drag.key) return box;
          const newX = clamp(here.x - drag.dx, box.w / 2, 1 - box.w / 2);
          const newY = clamp(here.y - drag.dy, box.h / 2, 1 - box.h / 2);
          const shiftX = newX - box.x;
          const shiftY = newY - box.y;
          return {
            ...box,
            x: newX,
            y: newY,
            points: box.points
              ? box.points.map(([px, py]) => [clamp(px + shiftX, 0, 1), clamp(py + shiftY, 0, 1)])
              : undefined,
            samPrompts: box.samPrompts
              ? box.samPrompts.map((p) => ({
                  ...p,
                  x: clamp(p.x + shiftX, 0, 1),
                  y: clamp(p.y + shiftY, 0, 1),
                }))
              : undefined,
          };
        }),
        { transient: true },
      );
      return;
    }
    if (drag.kind === "vertex") {
      onChange(
        boxesRef.current.map((box) => {
          if (box.key !== drag.key || !box.points) return box;
          const nextPoints = box.points.map((pt, i) =>
            i === drag.index
              ? ([round6(clamp(here.x, 0, 1)), round6(clamp(here.y, 0, 1))] as [number, number])
              : pt,
          );
          const bbox = polygonBBox(nextPoints);
          return {
            ...box,
            ...bbox,
            points: nextPoints,
          };
        }),
        { transient: true },
      );
      return;
    }
    onChange(
      boxesRef.current.map((box) => {
        if (box.key !== drag.key) return box;
        const { minW, minH } = getMinDimension(natural);
        return fromCorners(box, drag.anchorX, drag.anchorY, here.x, here.y, minW, minH);
      }),
      { transient: true },
    );
  }

  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (readOnly) return;
    if (sam2Enabled && samDraftPolygonRef.current && samDraftPolygonRef.current.length >= 3) {
      event.preventDefault();
      event.stopPropagation();
      commitSamDraft();
      return;
    }
    if (toolMode !== "polygon") return;
    if (polyDraftRef.current && polyDraftRef.current.length >= 3) {
      event.preventDefault();
      event.stopPropagation();
      closePolygonRef.current(polyDraftRef.current);
    }
  }

  const { minW: currentMinW, minH: currentMinH } = useMemo(
    () => getMinDimension(natural),
    [natural],
  );

  const draftBox =
    draft && activeClassId != null
      ? fromCorners(
          { key: "draft", classId: activeClassId },
          draft.x0,
          draft.y0,
          draft.x1,
          draft.y1,
          currentMinW,
          currentMinH,
        )
      : null;

  return (
    <div
      ref={frameRef}
      data-pan={spaceMode === "off" ? undefined : spaceMode}
      className="relative h-full min-h-72 w-full overflow-hidden rounded-lg bg-ink"
      onPointerDownCapture={onFramePointerDownCapture}
      onPointerMove={onFramePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(event) => {
          const img = event.currentTarget;
          setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        }}
        className={
          placed ? "absolute max-w-none select-none" : "h-full w-full object-contain select-none"
        }
        style={
          placed
            ? { left: placed.left, top: placed.top, width: placed.width, height: placed.height }
            : undefined
        }
      />
      {placed ? (
        <div
          ref={overlayRef}
          className={`absolute touch-none ${
            spaceMode === "off" && (crosshairMode || sam2Enabled) ? "cursor-crosshair" : ""
          }`}
          style={placed}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onDoubleClick={onDoubleClick}
          onContextMenu={(event) => {
            if (sam2Enabled || event.ctrlKey || event.metaKey) {
              event.preventDefault();
            }
          }}
          onPointerLeave={() => setCursorPos(null)}
          role="application"
          aria-label="Draw bounding boxes and polygons"
        >
          {/* SVG layer for polygons and precision lines */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
          >
            {boxes.map((box) => {
              if (hiddenKeys?.has(box.key) || !box.points || box.points.length < 3) return null;
              const selected = box.key === selectedKey;
              const color = colorFor(box.classId);
              const isFilled = renderMode === "filled";
              return (
                <g key={box.key}>
                  <polygon
                    data-box={box.key}
                    points={box.points.map(([px, py]) => `${px * 1000},${py * 1000}`).join(" ")}
                    fill={isFilled ? color : "transparent"}
                    fillOpacity={isFilled ? (selected ? 0.35 : 0.22) : 0}
                    stroke={color}
                    strokeWidth={isFilled ? 1 : selected ? 2.5 : 1.5}
                    vectorEffect="non-scaling-stroke"
                    className={`pointer-events-auto ${spaceMode === "off" && !readOnly ? "cursor-move" : ""}`}
                    style={{
                      filter: isFilled
                        ? undefined
                        : selected
                          ? "drop-shadow(0 0 2px rgba(255,255,255,0.8))"
                          : undefined,
                    }}
                  />
                  {/* Vertex grab handles: invisible in filled mode, semi-transparent in outline mode */}
                  {selected && !readOnly
                    ? box.points.map(([px, py], vIdx) => (
                        <circle
                          key={`${box.key}-v-${px}-${py}`}
                          data-box={box.key}
                          data-vertex={vIdx}
                          cx={px * 1000}
                          cy={py * 1000}
                          r={(isFilled ? 5 : 2.7) / view.zoom}
                          className="pointer-events-auto cursor-crosshair"
                          fill={isFilled ? "transparent" : "#ffffff"}
                          fillOpacity={isFilled ? 0 : 0.55}
                          stroke={isFilled ? "transparent" : "#1c1b19"}
                          strokeOpacity={isFilled ? 0 : 0.65}
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))
                    : null}
                </g>
              );
            })}

            {/* SAM2 live interactive multi-point preview polygon & foreground/background indicators */}
            {sam2Enabled && (samDraftPolygon || samPromptPoints.length > 0) ? (
              <g className="pointer-events-none">
                {samDraftPolygon && samDraftPolygon.length >= 3 && activeClassId != null ? (
                  <polygon
                    points={samDraftPolygon
                      .map(([px, py]) => `${px * 1000},${py * 1000}`)
                      .join(" ")}
                    fill={colorFor(activeClassId)}
                    fillOpacity={0.28}
                    stroke={colorFor(activeClassId)}
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {samPromptPoints.map((pt) => (
                  <circle
                    key={`sam-draft-pt-${pt.label}-${pt.x}-${pt.y}`}
                    cx={pt.x * 1000}
                    cy={pt.y * 1000}
                    r={4 / view.zoom}
                    fill={pt.label === 1 ? "#10b981" : "#ef4444"}
                    fillOpacity={0.75}
                    stroke="#ffffff"
                    strokeOpacity={0.8}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            ) : null}

            {/* Polygon drafting preview */}
            {polyDraft && polyDraft.length > 0 && activeClassId != null ? (
              <g className="pointer-events-none">
                {polyDraft.length > 1 ? (
                  <polyline
                    points={polyDraft.map(([px, py]) => `${px * 1000},${py * 1000}`).join(" ")}
                    fill="none"
                    stroke={colorFor(activeClassId)}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {cursorPos ? (
                  <>
                    <line
                      x1={polyDraft[polyDraft.length - 1][0] * 1000}
                      y1={polyDraft[polyDraft.length - 1][1] * 1000}
                      x2={cursorPos.x * 1000}
                      y2={cursorPos.y * 1000}
                      stroke={colorFor(activeClassId)}
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      vectorEffect="non-scaling-stroke"
                    />
                    {polyDraft.length >= 2 ? (
                      <line
                        x1={cursorPos.x * 1000}
                        y1={cursorPos.y * 1000}
                        x2={polyDraft[0][0] * 1000}
                        y2={polyDraft[0][1] * 1000}
                        stroke={colorFor(activeClassId)}
                        strokeWidth={1}
                        strokeDasharray="2 3"
                        strokeOpacity={0.6}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                  </>
                ) : null}
                {polyDraft.map(([px, py], idx) => (
                  <circle
                    key={`draft-pt-${px}-${py}`}
                    cx={px * 1000}
                    cy={py * 1000}
                    r={(idx === 0 && polyDraft.length >= 3 ? 4.8 : 2.8) / view.zoom}
                    fill={idx === 0 && polyDraft.length >= 3 ? colorFor(activeClassId) : "#ffffff"}
                    fillOpacity={0.65}
                    stroke={
                      idx === 0 && polyDraft.length >= 3 ? "#ffffff" : colorFor(activeClassId)
                    }
                    strokeOpacity={0.75}
                    strokeWidth={1.25}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            ) : null}

            {/* Crosshair H & V tracking lines and (0,0) origin marker */}
            {crosshairMode && cursorPos ? (
              <g className="pointer-events-none">
                {/* Subtle dark backing lines for contrast on bright backgrounds */}
                <line
                  x1={0}
                  y1={cursorPos.y * 1000}
                  x2={1000}
                  y2={cursorPos.y * 1000}
                  stroke="rgba(0, 0, 0, 0.35)"
                  strokeWidth={1.25}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={cursorPos.x * 1000}
                  y1={0}
                  x2={cursorPos.x * 1000}
                  y2={1000}
                  stroke="rgba(0, 0, 0, 0.35)"
                  strokeWidth={1.25}
                  vectorEffect="non-scaling-stroke"
                />
                {/* Faint bright H and V crosshair lines */}
                <line
                  x1={0}
                  y1={cursorPos.y * 1000}
                  x2={1000}
                  y2={cursorPos.y * 1000}
                  stroke="rgba(255, 255, 255, 0.55)"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={cursorPos.x * 1000}
                  y1={0}
                  x2={cursorPos.x * 1000}
                  y2={1000}
                  stroke="rgba(255, 255, 255, 0.55)"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
                {crosshairOrigin ? (
                  <>
                    <line
                      x1={crosshairOrigin.x * 1000}
                      y1={crosshairOrigin.y * 1000}
                      x2={cursorPos.x * 1000}
                      y2={cursorPos.y * 1000}
                      stroke="rgba(56, 189, 248, 0.55)"
                      strokeWidth={1}
                      strokeDasharray="2 3"
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={crosshairOrigin.x * 1000}
                      cy={crosshairOrigin.y * 1000}
                      r={2.2 / view.zoom}
                      fill="rgba(56, 189, 248, 0.85)"
                      fillOpacity={0.85}
                      stroke="#ffffff"
                      strokeOpacity={0.9}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                ) : null}
              </g>
            ) : null}

            {/* SAM2 active click pulse indicator */}
            {sam2BusyPoint ? (
              <g className="pointer-events-none">
                <circle
                  cx={sam2BusyPoint.x * 1000}
                  cy={sam2BusyPoint.y * 1000}
                  r={10}
                  fill="none"
                  stroke="#a855f7"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={sam2BusyPoint.x * 1000}
                  cy={sam2BusyPoint.y * 1000}
                  r={3.5}
                  fill="#a855f7"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ) : null}
          </svg>

          {/* HTML marks for boxes and labels */}
          {boxes.map((box) => {
            if (hiddenKeys?.has(box.key)) return null;
            const selected = box.key === selectedKey;
            const color = colorFor(box.classId);
            const isPolygon = Boolean(box.points && box.points.length >= 3);
            const isFilled = renderMode === "filled";
            const isTop = box.y - box.h / 2 < 0.04;

            if (isPolygon) {
              return (
                <div
                  key={`label-${box.key}`}
                  data-box={box.key}
                  className="pointer-events-none absolute z-20"
                  style={{
                    left: `${(box.x - box.w / 2) * 100}%`,
                    top: `${(box.y - box.h / 2) * 100}%`,
                  }}
                >
                  <span
                    className={`absolute whitespace-nowrap rounded-xs px-1.5 py-0.5 font-mono text-xs shadow-xs ${
                      isTop ? "top-0 left-0" : "bottom-full left-0 mb-1"
                    }`}
                    style={{ background: color, color: inkOn(color) }}
                  >
                    {labelFor(box.classId)}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={box.key}
                data-box={box.key}
                className={`box-mark absolute ${spaceMode === "off" && !readOnly ? "cursor-move" : ""} ${selected ? "is-selected z-10" : "z-0"}`}
                style={{
                  ...styleOf(box),
                  borderWidth: isFilled ? 1 : selected ? 2 : 1.5,
                  borderStyle: "solid",
                  borderColor: color,
                  backgroundColor: isFilled ? `${color}38` : "transparent",
                  boxShadow: isFilled
                    ? selected
                      ? "0 0 0 1px rgba(0, 0, 0, 0.65)"
                      : "0 0 0 1px rgba(0, 0, 0, 0.25)"
                    : selected
                      ? `0 0 0 1px #faf9f7, 0 0 0 3px ${color}`
                      : "0 0 0 1px rgba(28, 27, 25, 0.45)",
                }}
              >
                <span
                  className={`pointer-events-none absolute whitespace-nowrap rounded-xs px-1.5 py-0.5 font-mono text-xs shadow-xs ${
                    isTop ? "top-0 left-0" : "bottom-full left-0 mb-1"
                  }`}
                  style={{ background: color, color: inkOn(color) }}
                >
                  {labelFor(box.classId)}
                </span>
                {selected && !readOnly
                  ? HANDLES.map((corner) => (
                      <span
                        key={corner}
                        data-corner={corner}
                        className={`absolute z-20 ${
                          isFilled
                            ? `h-5 w-5 opacity-0 ${
                                corner === "nw"
                                  ? "-top-2.5 -left-2.5"
                                  : corner === "ne"
                                    ? "-top-2.5 -right-2.5"
                                    : corner === "sw"
                                      ? "-bottom-2.5 -left-2.5"
                                      : "-right-2.5 -bottom-2.5"
                              }`
                            : `h-4 w-4 rounded-xs border border-ink bg-surface ${
                                corner === "nw"
                                  ? "-top-2 -left-2"
                                  : corner === "ne"
                                    ? "-top-2 -right-2"
                                    : corner === "sw"
                                      ? "-bottom-2 -left-2"
                                      : "-right-2 -bottom-2"
                              }`
                        } ${
                          spaceMode !== "off"
                            ? ""
                            : corner === "nw" || corner === "se"
                              ? "cursor-nwse-resize"
                              : "cursor-nesw-resize"
                        }`}
                      />
                    ))
                  : null}
              </div>
            );
          })}

          {draftBox ? (
            <div
              className="box-mark pointer-events-none absolute z-20 border-dashed"
              style={{
                ...styleOf(draftBox),
                borderWidth: renderMode === "filled" ? 1 : 2,
                borderColor: colorFor(draftBox.classId),
              }}
            />
          ) : null}

          {/* Polygon drawing helper pill */}
          {polyDraft && polyDraft.length > 0 ? (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface/90 px-3 py-1 font-mono text-xs text-ink shadow-md backdrop-blur-xs">
              {polyDraft.length < 3
                ? `Polygon (${polyDraft.length} pts): Click to add vertices • Esc to cancel`
                : `Polygon (${polyDraft.length} pts): Click start point, double-click, or press Enter to close • Esc to cancel`}
            </div>
          ) : null}

          {/* SAM2 multi-point prompt session helper pill */}
          {sam2Enabled && samPromptPoints.length > 0 ? (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-purple-400/60 bg-surface/95 px-3 py-1 font-mono text-xs text-ink shadow-md backdrop-blur-xs">
              {`SAM2 (${samPromptPoints.length} pt): Left-click (+) add • Right-click / Shift+Click (−) remove • Enter / Double-click commit • Esc cancel`}
            </div>
          ) : null}

          {/* Crosshair (0,0) origin label & floating mouse coordinates */}
          {crosshairMode && crosshairOrigin ? (
            <div
              className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full pb-1 font-mono text-[8px] leading-none text-sky-200/75 drop-shadow-xs select-none"
              style={{
                left: `${crosshairOrigin.x * 100}%`,
                top: `${crosshairOrigin.y * 100}%`,
              }}
            >
              (0, 0)
            </div>
          ) : null}

          {crosshairMode && cursorPos && natural ? (
            <div
              className="pointer-events-none absolute z-30 rounded-xs bg-ink/65 px-1.5 py-0.5 font-mono text-[10px] leading-tight whitespace-nowrap text-white/85 backdrop-blur-[1px]"
              style={{
                left: `${cursorPos.x * 100}%`,
                top: `${cursorPos.y * 100}%`,
                transform: `translate(${cursorPos.x > 0.82 ? "calc(-100% - 10px)" : "10px"}, ${
                  cursorPos.y > 0.9 ? "calc(-100% - 8px)" : "10px"
                })`,
              }}
            >
              {crosshairOrigin
                ? `${Math.round((cursorPos.x - crosshairOrigin.x) * natural.w)}, ${Math.round(
                    (cursorPos.y - crosshairOrigin.y) * natural.h,
                  )} px`
                : `${Math.round(cursorPos.x * natural.w)}, ${Math.round(cursorPos.y * natural.h)} px`}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
