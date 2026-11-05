import { useEffect, useState } from "react";
import { FolderKanban, Plus, X } from "lucide-react";
import { createProject, fetchProjects, openProject, type Project } from "@/lib/label-client";

const field =
  "h-8 w-full rounded-[2px] border border-[#c8c8c8] bg-white px-2.5 text-xs text-[#282828] outline-none focus:border-[#1473e6]";
const btn =
  "inline-flex h-8 items-center justify-center rounded-[2px] border border-[#c8c8c8] bg-white px-3 text-xs font-semibold text-[#282828] hover:bg-[#e0e0e0] disabled:opacity-40";
const btnPrimary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[2px] bg-[#1473e6] px-3.5 text-xs font-semibold text-white hover:bg-[#0d62c9] disabled:opacity-40";

export function ProjectSplash({ canClose, onClose }: { canClose: boolean; onClose: () => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetchProjects()
      .then((rows) => {
        if (!cancel) setProjects(rows);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load projects");
      });
    return () => {
      cancel = true;
    };
  }, []);

  async function choose(id: number) {
    setBusy(true);
    setError(null);
    try {
      await openProject(id);
      window.location.assign("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open project");
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await createProject(name.trim(), folder.trim());
      window.location.assign("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create project");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-title"
        className="flex max-h-[85dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-[2px] border border-[#c8c8c8] bg-white p-5 text-[#282828] shadow-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#c8c8c8] pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[2px] border border-blue-200 bg-blue-50 text-[#1473e6]">
              <FolderKanban className="size-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="project-title"
                className="text-sm font-semibold tracking-tight text-[#282828]"
              >
                Projects
              </h2>
              <p className="text-xs text-[#6e6e6e]">
                Each project has its own photo folder and parts list.
              </p>
            </div>
          </div>
          {canClose ? (
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-[2px] text-[#6e6e6e] hover:bg-[#e0e0e0] hover:text-[#282828]"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {error ? (
          <p
            className="rounded-[2px] border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {projects == null ? <li className="text-xs text-[#6e6e6e]">Loading…</li> : null}
          {projects?.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="flex w-full flex-col gap-0.5 rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] px-3 py-2 text-left hover:bg-[#f0f0f0] disabled:opacity-40"
                disabled={busy}
                onClick={() => void choose(project.id)}
              >
                <span className="text-xs font-semibold text-[#282828]">{project.name}</span>
                <span className="truncate font-mono text-[11px] text-[#6e6e6e]">
                  {project.folder}
                </span>
              </button>
            </li>
          ))}
          {projects && projects.length === 0 ? (
            <li className="text-xs text-[#6e6e6e]">No projects yet.</li>
          ) : null}
        </ul>
        {creating ? (
          <form
            className="flex flex-col gap-2.5 rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-3 text-xs"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="flex flex-col gap-1 font-medium text-[#282828]">
              Name
              <input
                className={field}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 font-medium text-[#282828]">
              Photo folder
              <input
                className={field}
                value={folder}
                spellCheck={false}
                placeholder="D:\photos\job-14"
                onChange={(event) => setFolder(event.target.value)}
                required
              />
            </label>
            <p className="text-[11px] text-[#6e6e6e]">The folder must already exist on disk.</p>
            <div className="flex gap-2 pt-1">
              <button type="submit" className={btnPrimary} disabled={busy}>
                Create Project
              </button>
              <button type="button" className={btn} onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className={btnPrimary} onClick={() => setCreating(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            <span>Create New Project</span>
          </button>
        )}
      </div>
    </div>
  );
}
