import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { inkOn } from "@/lib/class-color";

export type StageBox = {
  key: string;
  classId: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

function newId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}


type Corner = "nw" | "ne" | "sw" | "se";

type Drag =
  | { kind: "draw"; classId: number; x0: number; y0: number; x1: number; y1: number }
  | { kind: "move"; key: string; dx: number; dy: number }
  | { kind: "resize"; key: string; anchorX: number; anchorY: number };

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function fromCorners(
  base: Pick<StageBox, "key" | "classId">,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): StageBox {
  const left = clamp(Math.min(x0, x1), 0, 1);
  const right = clamp(Math.max(x0, x1), 0, 1);
  const top = clamp(Math.min(y0, y1), 0, 1);
  const bottom = clamp(Math.max(y0, y1), 0, 1);
  const w = Math.max(right - left, 0.008);
  const h = Math.max(bottom - top, 0.008);
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
  const left = clamp(frame.w / 2 + view.x - width / 2, Math.min(minLeft, maxLeft), Math.max(minLeft, maxLeft));
  const top = clamp(frame.h / 2 + view.y - height / 2, Math.min(minTop, maxTop), Math.max(minTop, maxTop));
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
  onChange: (boxes: StageBox[]) => void;
  onSelect: (key: string | null) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const boxesRef = useRef(boxes);
  const dragRef = useRef<Drag | null>(null);
  boxesRef.current = boxes;

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [spaceMode, setSpaceMode] = useState<"off" | "ready" | "dragging">("off");
  const viewRef = useRef(view);
  const spaceRef = useRef(false);
  const panDrag = useRef<{ pointerId: number; px: number; py: number; x: number; y: number } | null>(null);
  viewRef.current = view;

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
        return;
      }
      if (typing(event.target)) return;
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
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  function point(event: PointerEvent): { x: number; y: number } | null {
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
      if (moved < 0.01) return;
      const box = fromCorners(
        { key: newId(), classId: drag.classId },
        drag.x0,
        drag.y0,
        drag.x1,
        drag.y1,
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
    if (readOnly || event.button !== 0) return;
    const here = point(event);
    if (!here) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest("[data-corner]");
    const boxEl = target?.closest("[data-box]");
    const key = boxEl?.getAttribute("data-box");

    if (handle && key) {
      const box = boxesRef.current.find((item) => item.key === key);
      if (!box) return;
      onSelect(key);
      const corner = handle.getAttribute("data-corner") as Corner;
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

    if (key) {
      const box = boxesRef.current.find((item) => item.key === key);
      if (!box) return;
      onSelect(key);
      dragRef.current = { kind: "move", key, dx: here.x - box.x, dy: here.y - box.y };
      return;
    }

    onSelect(null);
    if (activeClassId == null) return;
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
    const drag = dragRef.current;
    if (!drag) return;
    const here = point(event);
    if (!here) return;
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
          return {
            ...box,
            x: clamp(here.x - drag.dx, box.w / 2, 1 - box.w / 2),
            y: clamp(here.y - drag.dy, box.h / 2, 1 - box.h / 2),
          };
        }),
      );
      return;
    }
    onChange(
      boxesRef.current.map((box) => {
        if (box.key !== drag.key) return box;
        return fromCorners(box, drag.anchorX, drag.anchorY, here.x, here.y);
      }),
    );
  }

  const draftBox =
    draft && activeClassId != null
      ? fromCorners(
          { key: "draft", classId: activeClassId },
          draft.x0,
          draft.y0,
          draft.x1,
          draft.y1,
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
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(event) => {
          const img = event.currentTarget;
          setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        }}
        className={placed ? "absolute max-w-none select-none" : "h-full w-full object-contain select-none"}
        style={
          placed
            ? { left: placed.left, top: placed.top, width: placed.width, height: placed.height }
            : undefined
        }
      />
      {placed ? (
        <div
          ref={overlayRef}
          className="absolute touch-none"
          style={placed}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          role="application"
          aria-label="Draw bounding boxes"
        >
          {boxes.map((box) => {
            if (hiddenKeys?.has(box.key)) return null;
            const selected = box.key === selectedKey;
            const color = colorFor(box.classId);
            return (
              <div
                key={box.key}
                data-box={box.key}
                className={`box-mark absolute ${spaceMode === "off" ? "cursor-move" : ""} ${selected ? "is-selected z-10" : "z-0"}`}
                style={{
                  ...styleOf(box),
                  borderColor: color,
                  boxShadow: selected
                    ? `0 0 0 1px #faf9f7, 0 0 0 3px ${color}`
                    : "0 0 0 1px rgba(28, 27, 25, 0.45)",
                }}
              >
                <span
                  className="pointer-events-none absolute bottom-full left-0 mb-1 max-w-full truncate rounded-xs px-1.5 py-0.5 font-mono text-xs"
                  style={{ background: color, color: inkOn(color) }}
                >
                  {labelFor(box.classId)}
                </span>
                {selected
                  ? HANDLES.map((corner) => (
                      <span
                        key={corner}
                        data-corner={corner}
                        className={`absolute z-20 h-4 w-4 rounded-xs border border-ink bg-surface ${
                          corner === "nw"
                            ? "-top-2 -left-2"
                            : corner === "ne"
                              ? "-top-2 -right-2"
                              : corner === "sw"
                                ? "-bottom-2 -left-2"
                                : "-right-2 -bottom-2"
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
              style={{ ...styleOf(draftBox), borderColor: colorFor(draftBox.classId) }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
