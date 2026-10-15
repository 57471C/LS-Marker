import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
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
      </nav>
      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3">
        {meta}
        {project ? <p className="max-w-40 truncate font-mono text-sm text-muted">{project.name}</p> : null}
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