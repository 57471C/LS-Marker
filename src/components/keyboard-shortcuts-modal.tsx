import { useEffect } from "react";
import { X, Keyboard } from "lucide-react";

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: "Navigation",
    items: [
      { keys: ["→"], description: "Next photo (when no box is selected)" },
      { keys: ["←"], description: "Previous photo (when no box is selected)" },
      { keys: ["Space", "Drag"], description: "Pan image canvas" },
    ],
  },
  {
    title: "Zoom & View",
    items: [
      { keys: ["Ctrl", "Scroll"], description: "Zoom in / out at pointer" },
      { keys: ["Ctrl", "+", "/ -"], description: "Zoom in / out" },
      { keys: ["Ctrl", "0"], description: "Reset zoom & fit to screen" },
      { keys: ["Drag divider"], description: "Widen or shrink side panel" },
    ],
  },
  {
    title: "Bounding Boxes",
    items: [
      { keys: ["Click & Drag"], description: "Draw a new box" },
      { keys: ["Esc"], description: "Deselect active box" },
      { keys: ["↑", "↓", "←", "→"], description: "Nudge selected box" },
      { keys: ["Shift", "Arrows"], description: "Nudge selected box 5× faster" },
      { keys: ["Ctrl", "D"], description: "Duplicate selected or last box" },
      { keys: ["Del", "/ Backspace"], description: "Delete selected box" },
      { keys: ["Ctrl", "Z"], description: "Undo last drawn box" },
    ],
  },
  {
    title: "Workflow & Labelling",
    items: [
      { keys: ["Ctrl", "S"], description: "Save boxes to disk" },
      { keys: ["N"], description: "Mark photo as having no parts (empty)" },
      { keys: ["?"], description: "Open this keyboard shortcuts guide" },
    ],
  },
];

function KeyCap({ label }: { label: string }) {
  return (
    <kbd className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-sm border border-line bg-surface-raised px-1.5 py-0.5 font-mono text-xs font-semibold text-ink shadow-[0_1px_1px_rgba(0,0,0,0.08)]">
      {label}
    </kbd>
  );
}

export function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-xl border border-line bg-bg shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-md bg-ink/5 text-ink">
              <Keyboard className="size-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="shortcuts-title" className="text-base font-semibold tracking-tight text-ink">
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-muted">Speed up your labelling workflow</p>
            </div>
          </div>
          <button
            type="button"
            className="press inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-ink"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid flex-1 gap-5 overflow-y-auto p-5 sm:grid-cols-2">
          {SHORTCUT_SECTIONS.map((section) => (
            <div
              key={section.title}
              className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {section.title}
              </h3>
              <ul className="flex flex-col divide-y divide-line/60">
                {section.items.map((item) => (
                  <li
                    key={item.description}
                    className="flex items-center justify-between gap-3 py-2 text-xs"
                  >
                    <span className="text-ink">{item.description}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, idx) => (
                        <span key={k} className="inline-flex items-center gap-1">
                          {idx > 0 && !k.startsWith("/") ? (
                            <span className="text-[10px] text-muted">+</span>
                          ) : null}
                          <KeyCap label={k} />
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-line bg-surface px-5 py-3 text-xs text-muted">
          <span>
            Press <KeyCap label="Esc" /> to close
          </span>
          <button
            type="button"
            className="press inline-flex h-8 items-center justify-center rounded-sm border border-line bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-raised"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
