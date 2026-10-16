import { useEffect, useState } from "react";
import { createProject, fetchProjects, openProject, type Project } from "@/lib/label-client";

const field =
  "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn =
  "press inline-flex h-11 items-center justify-center rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink disabled:opacity-40";
const btnPrimary =
  "press inline-flex h-11 items-center justify-center rounded-sm bg-ink px-4 text-sm font-medium text-surface disabled:opacity-40";

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
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-title"
        className="flex max-h-[85dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-bg p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="project-title" className="text-lg font-medium tracking-tight">
              Projects
            </h2>
            <p className="text-sm text-muted">
              Each project has its own photo folder and parts list. Users stay shared.
            </p>
          </div>
          {canClose ? (
            <button type="button" className={btn} onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="rounded-sm border border-line bg-surface px-3 py-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {projects == null ? <li className="text-sm text-muted">Loading</li> : null}
          {projects?.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="press flex w-full flex-col gap-1 rounded-sm border border-line bg-surface px-3 py-3 text-left disabled:opacity-40"
                disabled={busy}
                onClick={() => void choose(project.id)}
              >
                <span className="text-sm font-medium">{project.name}</span>
                <span className="truncate font-mono text-sm text-muted">{project.folder}</span>
              </button>
            </li>
          ))}
          {projects && projects.length === 0 ? (
            <li className="text-sm text-muted">No projects yet.</li>
          ) : null}
        </ul>
        {creating ? (
          <form
            className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="flex flex-col gap-2 text-sm font-medium">
              Name
              <input
                className={field}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
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
            <p className="text-sm text-muted">
              The folder must already exist. Parts start empty — import a CSV after.
            </p>
            <div className="flex gap-2">
              <button type="submit" className={btnPrimary} disabled={busy}>
                Create
              </button>
              <button type="button" className={btn} onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className={btnPrimary} onClick={() => setCreating(true)}>
            Create project
          </button>
        )}
      </div>
    </div>
  );
}
