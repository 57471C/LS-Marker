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
  {
    title: "Review & QA Mode",
    items: [
      { keys: ["A", "/ Enter"], description: "Approve current photo & load next pending" },
      { keys: ["X"], description: "Reject photo back to annotator pool" },
    ],
  },
];

function KeyCap({ label }: { label: string }) {
  return (
    <kbd className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-[2px] border border-[#c8c8c8] bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#282828]">
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-[2px] border border-[#c8c8c8] bg-white text-[#282828] shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-[#c8c8c8] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-[2px] border border-blue-200 bg-blue-50 text-[#1473e6]">
              <Keyboard className="size-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="shortcuts-title"
                className="text-sm font-semibold tracking-tight text-[#282828]"
              >
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-[#6e6e6e]">Speed up your labelling workflow</p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-[2px] text-[#6e6e6e] hover:bg-[#e0e0e0] hover:text-[#282828]"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid flex-1 gap-3.5 overflow-y-auto p-4 sm:grid-cols-2">
          {SHORTCUT_SECTIONS.map((section) => (
            <div
              key={section.title}
              className="flex flex-col gap-2 rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-3"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6e6e6e]">
                {section.title}
              </h3>
              <ul className="flex flex-col divide-y divide-[#e0e0e0]">
                {section.items.map((item) => (
                  <li
                    key={item.description}
                    className="flex items-center justify-between gap-3 py-1.5 text-xs"
                  >
                    <span className="text-[#282828]">{item.description}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, idx) => (
                        <span key={k} className="inline-flex items-center gap-1">
                          {idx > 0 && !k.startsWith("/") ? (
                            <span className="text-[10px] text-[#6e6e6e]">+</span>
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

        <div className="flex items-center justify-between border-t border-[#c8c8c8] bg-[#f9f9f9] px-4 py-2.5 text-xs text-[#6e6e6e]">
          <span>
            Press <KeyCap label="Esc" /> to close
          </span>
          <button
            type="button"
            className="inline-flex h-7 items-center justify-center rounded-[2px] border border-[#c8c8c8] bg-white px-3 text-xs font-medium text-[#282828] hover:bg-[#e0e0e0]"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
