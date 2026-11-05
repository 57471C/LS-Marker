import { Link } from "@tanstack/react-router";
import { CircleHelp, FolderOpen, LogOut } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { KeyboardShortcutsModal } from "@/components/keyboard-shortcuts-modal";
import { fetchMaintenanceStatus, logout } from "@/lib/label-client";
import { useProject } from "@/lib/project";
import { useSession } from "@/lib/session";

export function AppHeader({
  current,
  meta,
}: {
  current: "label" | "photos" | "classes" | "settings" | "review";
  meta?: ReactNode;
}) {
  const { username, setUsername } = useSession();
  const { current: project, openPicker } = useProject();
  const [helpOpen, setHelpOpen] = useState(false);
  const [isMaintenance, setIsMaintenance] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetchMaintenanceStatus()
      .then((res) => {
        if (!cancel) setIsMaintenance(res.maintenance);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

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

  const navItem = (key: "label" | "photos" | "classes" | "settings") =>
    current === key
      ? "px-1.5 py-0.5 rounded-[2px] bg-[#1473e6] text-white font-medium"
      : "px-1.5 py-0.5 rounded-[2px] text-[#707070] hover:text-[#282828] font-medium";

  return (
    <>
      <header className="h-[28px] border-b border-[#c8c8c8] bg-white px-2 flex items-center justify-between text-xs shrink-0 select-none">
        {/* Left: Brand, Project Picker, Navigation */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold tracking-tight text-[#282828] px-1">LS-Marker</span>
          <span className="text-[#c8c8c8]">|</span>

          {/* Project Picker Trigger */}
          <button
            type="button"
            onClick={openPicker}
            className="press inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[#282828] hover:bg-[#f0f0f0] border border-transparent hover:border-[#c8c8c8] max-w-[150px] truncate font-medium text-xs"
            title="Switch project"
          >
            <FolderOpen className="size-3.5 shrink-0 text-[#707070]" />
            <span className="truncate">{project?.name ?? "Open Project"}</span>
          </button>

          <span className="text-[#c8c8c8]">|</span>

          {/* Nav links */}
          <nav className="flex items-center gap-1 font-medium" aria-label="Sections">
            <Link to="/" className={navItem("label")}>
              Label
            </Link>
            <a
              href="/?mode=review"
              className={
                current === "review"
                  ? "px-1.5 py-0.5 rounded-[2px] bg-amber-600 text-white font-semibold"
                  : "px-1.5 py-0.5 rounded-[2px] text-amber-700 hover:text-amber-900 font-medium"
              }
            >
              Review QA
            </a>
            <Link to="/photos" className={navItem("photos")}>
              Photos
            </Link>
            <Link to="/admin" className={navItem("classes")}>
              Classes
            </Link>
            <Link to="/settings" className={navItem("settings")}>
              Settings
            </Link>
          </nav>
        </div>

        {/* Center: Metadata / Info readout */}
        {meta ? <div className="flex items-center gap-2 min-w-0">{meta}</div> : null}

        {/* Right: Maintenance status, Help modal, User & Sign Out */}
        <div className="flex items-center gap-2 min-w-0">
          {/* Maintenance Mode Notice */}
          {isMaintenance && (
            <span className="px-1.5 py-0.5 rounded-[2px] bg-amber-400 text-amber-950 text-[10px] font-bold">
              MAINTENANCE
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

      {helpOpen ? <KeyboardShortcutsModal onClose={() => setHelpOpen(false)} /> : null}
    </>
  );
}
