import { Link } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal";
import { logout } from "@/lib/label-client";
import { useProject } from "@/lib/project";
import { useSession } from "@/lib/session";

export function AppHeader({
  current,
  meta,
}: {
  current: "label" | "photos" | "classes" | "settings";
  meta?: ReactNode;
}) {
  const { username, setUsername } = useSession();
  const { current: project, openPicker } = useProject();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const tag = event.target instanceof HTMLElement ? event.target.tagName : "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        event.preventDefault();
        setHelpOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const item = (key: "label" | "photos" | "classes" | "settings") =>
    current === key
      ? "inline-flex h-11 items-center rounded-sm bg-ink px-3 text-sm font-medium text-surface"
      : "inline-flex h-11 items-center rounded-sm px-3 text-sm font-medium text-muted";

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2">
      <p className="text-lg font-medium tracking-tight text-ink">LS-Marker</p>
      <nav className="flex items-center gap-1" aria-label="Sections">
        <Link to="/" className={item("label")}>
          Label
        </Link>
        <Link to="/photos" className={item("photos")}>
          Photos
        </Link>
        <Link to="/admin" className={item("classes")}>
          Classes
        </Link>
        <Link to="/settings" className={item("settings")}>
          Settings
        </Link>
        <button
          type="button"
          className="press inline-flex size-11 items-center justify-center rounded-sm text-muted hover:bg-surface-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={() => setHelpOpen(true)}
        >
          <CircleHelp className="size-5" aria-hidden="true" />
        </button>
      </nav>
      {helpOpen ? <KeyboardShortcutsModal onClose={() => setHelpOpen(false)} /> : null}
      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3">
        {meta}
        {project ? (
          <p className="max-w-40 truncate font-mono text-sm text-muted">{project.name}</p>
        ) : null}
        {username ? (
          <button
            type="button"
            className="press inline-flex h-11 items-center rounded-sm border border-line bg-surface px-3 text-sm font-medium text-ink"
            onClick={openPicker}
          >
            Projects
          </button>
        ) : null}
        {username ? (
          <>
            <p className="truncate font-mono text-sm text-muted">{username}</p>
            <button
              type="button"
              className="press inline-flex h-11 items-center rounded-sm border border-line bg-surface px-3 text-sm font-medium text-ink"
              onClick={() => {
                void logout().finally(() => setUsername(null));
              }}
            >
              Sign out
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
