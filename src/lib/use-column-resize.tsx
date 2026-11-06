import type React from "react";
import { useCallback, useRef, useState } from "react";

export interface ColumnDef {
  default: number;
  min?: number;
  max?: number;
}

export function useColumnResize<T extends string>(
  storageKey: string,
  definitions: Record<T, ColumnDef>,
) {
  const [widths, setWidths] = useState<Record<T, number>>(() => {
    const initial: Partial<Record<T, number>> = {};
    let saved: Record<string, number> | null = null;
    try {
      const item = localStorage.getItem(storageKey);
      if (item) {
        saved = JSON.parse(item);
      }
    } catch {
      // ignore
    }

    for (const key of Object.keys(definitions) as T[]) {
      const def = definitions[key];
      const savedVal = saved?.[key];
      if (typeof savedVal === "number" && !Number.isNaN(savedVal)) {
        const min = def.min ?? 20;
        const max = def.max ?? 1200;
        initial[key] = Math.max(min, Math.min(max, savedVal));
      } else {
        initial[key] = def.default;
      }
    }
    return initial as Record<T, number>;
  });

  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const [resizingCol, setResizingCol] = useState<T | null>(null);

  const handleResizeStart = useCallback(
    (col: T, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth = widthsRef.current[col];
      const def = definitions[col];
      const min = def?.min ?? 20;
      const max = def?.max ?? 1200;

      setResizingCol(col);

      const prevUserSelect = document.body.style.userSelect;
      const prevCursor = document.body.style.cursor;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      let currentW = startWidth;

      const onPointerMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        const nextW = Math.max(min, Math.min(max, Math.round(startWidth + delta)));
        currentW = nextW;
        setWidths((prev) => ({
          ...prev,
          [col]: nextW,
        }));
      };

      const onPointerUp = () => {
        setResizingCol(null);
        document.body.style.userSelect = prevUserSelect;
        document.body.style.cursor = prevCursor;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);

        try {
          const updated = {
            ...widthsRef.current,
            [col]: currentW,
          };
          localStorage.setItem(storageKey, JSON.stringify(updated));
        } catch {
          // ignore
        }
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [definitions, storageKey],
  );

  const resetWidth = useCallback(
    (col: T) => {
      const def = definitions[col];
      if (!def) return;
      setWidths((prev) => {
        const next = { ...prev, [col]: def.default };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [definitions, storageKey],
  );

  const resetAllWidths = useCallback(() => {
    const next: Partial<Record<T, number>> = {};
    for (const key of Object.keys(definitions) as T[]) {
      next[key] = definitions[key].default;
    }
    setWidths(next as Record<T, number>);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [definitions, storageKey]);

  return {
    widths,
    resizingCol,
    handleResizeStart,
    resetWidth,
    resetAllWidths,
  };
}

export function ColumnResizeHandle<T extends string>({
  column,
  onResizeStart,
  onReset,
}: {
  column: T;
  onResizeStart: (col: T, e: React.PointerEvent) => void;
  onReset?: (col: T) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      tabIndex={-1}
      onPointerDown={(e) => onResizeStart(column, e)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset?.(column);
      }}
      className="absolute right-0 top-0 bottom-0 w-2.5 -mr-1 cursor-col-resize z-10 select-none flex items-center justify-center group"
      title="Drag to resize, double-click to reset"
    >
      <div className="w-[1px] h-3 bg-[#c8c8c8] group-hover:bg-[#1473e6] group-hover:w-[2px] transition-colors" />
    </div>
  );
}
