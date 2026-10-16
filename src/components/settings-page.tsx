import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import {
  createUser,
  deleteProject,
  deleteUser,
  downloadYoloExport,
  fetchAdmin,
  fetchProjects,
  fetchUsers,
  lockAdmin,
  resetUserPassword,
  unlockAdmin,
  type LabUser,
  type Project,
} from "@/lib/label-client";
import { useProject } from "@/lib/project";

const field =
  "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink disabled:opacity-40";
const btnPrimary =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-ink px-4 text-sm font-medium text-surface disabled:opacity-40";

export function SettingsPage() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [users, setUsers] = useState<LabUser[] | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [username, setUsername] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [nextPassword, setNextPassword] = useState("");
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { current: project } = useProject();

  useEffect(() => {
    let cancel = false;
    fetchAdmin()
      .then((open) => {
        if (!cancel) setUnlocked(open);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not check settings");
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    let cancel = false;
    Promise.all([fetchUsers(), fetchProjects()])
      .then(([userRows, projectRows]) => {
        if (cancel) return;
        setUsers(userRows);
        setProjects(projectRows);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load settings");
      });
    return () => {
      cancel = true;
    };
  }, [unlocked]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(p: Project) {
    setExportingId(p.id);
    setError(null);
    try {
      await downloadYoloExport(p.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportingId(null);
    }
  }

  async function handleDeleteProject() {
    if (!projectToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProject(projectToDelete.id, adminPassword);
      setProjectToDelete(null);
      setAdminPassword("");
      const nextProjects = await fetchProjects();
      setProjects(nextProjects);
      if (project?.id === projectToDelete.id) {
        window.location.reload();
      }
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete project");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <AppHeader current="settings" />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-medium tracking-tight">Settings</h1>
          <p className="max-w-xl text-sm text-muted">
            Manage projects, download YOLO dataset exports, and configure labeller user accounts.
          </p>
        </div>
        {error ? (
          <p className="rounded-sm border border-line bg-surface px-3 py-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {unlocked === null ? <p className="text-sm text-muted">Checking the lock…</p> : null}
        {unlocked === false ? (
          <form
            className="flex max-w-sm flex-col gap-3 rounded-xl border border-line bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await unlockAdmin(password);
                setPassword("");
                setUnlocked(true);
              });
            }}
          >
            <label className="flex flex-col gap-2 text-sm font-medium">
              Settings password
              <input
                className={field}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <p className="text-sm text-muted">The shared password is admin.</p>
            <button type="submit" className={btnPrimary} disabled={busy}>
              Unlock
            </button>
          </form>
        ) : null}
        {unlocked ? (
          <>
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold tracking-tight">Projects</h2>
                <p className="text-sm text-muted">
                  Available projects with photo counts and completion status.
                </p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-raised/40 text-xs font-semibold uppercase tracking-wider text-muted">
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Path</th>
                      <th className="px-4 py-3">Photo QTY/Complete</th>
                      <th className="px-4 py-3 text-right">Commands</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(projects ?? []).map((p) => (
                      <tr key={p.id} className="hover:bg-surface-raised/20">
                        <td className="px-4 py-3 font-medium text-ink">
                          <div className="flex items-center gap-2">
                            <span>{p.name}</span>
                            {project?.id === p.id ? (
                              <span className="rounded-sm bg-ink/10 px-1.5 py-0.5 text-xs text-muted">
                                active
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td
                          className="max-w-xs truncate px-4 py-3 font-mono text-xs text-muted"
                          title={p.resolvedFolder}
                        >
                          {p.folder}
                        </td>
                        <td className="px-4 py-3">
                          {p.folderOk ? (
                            <span className="font-mono text-sm">
                              {p.totalPhotos ?? 0} / {p.completePhotos ?? 0}
                            </span>
                          ) : (
                            <span
                              className="text-xs text-red-500"
                              title={p.folderError || "Folder missing"}
                            >
                              Folder missing
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center justify-end gap-2">
                            <button
                              type="button"
                              className="press inline-flex h-9 items-center rounded-sm border border-line bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-raised disabled:opacity-40"
                              disabled={
                                exportingId === p.id || !p.folderOk || (p.totalPhotos ?? 0) === 0
                              }
                              onClick={() => void handleExport(p)}
                              title="Zip images and txt files"
                            >
                              {exportingId === p.id ? "Exporting…" : "Export Yolo"}
                            </button>
                            <button
                              type="button"
                              className="press inline-flex h-9 items-center rounded-sm border border-line bg-surface px-3 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-40"
                              onClick={() => {
                                setProjectToDelete(p);
                                setAdminPassword("");
                                setDeleteError(null);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {projects && projects.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted">
                          No projects available.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold tracking-tight">Labellers</h2>
                <p className="text-sm text-muted">Add new labellers or manage user passwords.</p>
              </div>

              <form
                className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await createUser(username, userPassword);
                    setUsers(await fetchUsers());
                    setUsername("");
                    setUserPassword("");
                  });
                }}
              >
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Username
                  <input
                    className={field}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Password
                  <input
                    className={field}
                    type="password"
                    autoComplete="new-password"
                    value={userPassword}
                    onChange={(event) => setUserPassword(event.target.value)}
                    required
                  />
                </label>
                <div className="flex items-end">
                  <button type="submit" className={btnPrimary} disabled={busy}>
                    Add user
                  </button>
                </div>
              </form>
              <ul className="flex flex-col gap-2">
                {(users ?? []).map((user) => (
                  <li key={user.id} className="rounded-lg border border-line bg-surface p-3">
                    {editing === user.id ? (
                      <form
                        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run(async () => {
                            await resetUserPassword(user.id, nextPassword);
                            setEditing(null);
                            setNextPassword("");
                          });
                        }}
                      >
                        <p className="flex h-11 items-center font-mono text-sm">{user.username}</p>
                        <input
                          className={field}
                          type="password"
                          autoComplete="new-password"
                          placeholder="New password"
                          value={nextPassword}
                          onChange={(event) => setNextPassword(event.target.value)}
                          required
                        />
                        <div className="flex gap-2">
                          <button type="submit" className={btnPrimary} disabled={busy}>
                            Save
                          </button>
                          <button type="button" className={btn} onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="min-w-0 flex-1 font-mono text-sm">{user.username}</p>
                        <button
                          type="button"
                          className={btn}
                          onClick={() => {
                            setEditing(user.id);
                            setNextPassword("");
                            setPendingDelete(null);
                          }}
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          className={btn}
                          onClick={() => {
                            if (pendingDelete !== user.id) {
                              setPendingDelete(user.id);
                              return;
                            }
                            void run(async () => {
                              await deleteUser(user.id);
                              setUsers(await fetchUsers());
                              setPendingDelete(null);
                            });
                          }}
                        >
                          {pendingDelete === user.id ? "Confirm" : "Delete"}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
                {users && users.length === 0 ? (
                  <li className="text-sm text-muted">No labellers yet.</li>
                ) : null}
              </ul>
            </section>

            <div>
              <button
                type="button"
                className={btn}
                onClick={() => {
                  void run(async () => {
                    await lockAdmin();
                    setUnlocked(false);
                    setUsers(null);
                    setProjects(null);
                  });
                }}
              >
                Lock settings
              </button>
            </div>
          </>
        ) : null}

        {projectToDelete ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-project-title"
              className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-line bg-bg p-5 shadow-lg"
            >
              <div className="flex flex-col gap-1">
                <h2 id="delete-project-title" className="text-base font-semibold text-ink">
                  Delete project &ldquo;{projectToDelete.name}&rdquo;?
                </h2>
                <p className="text-sm text-muted">
                  This will clear the .txt files and db records for this project, and leave the
                  photos and folder structure alone.
                </p>
              </div>

              <div className="break-all rounded-sm border border-line bg-surface p-2.5 font-mono text-xs text-muted">
                {projectToDelete.resolvedFolder || projectToDelete.folder}
              </div>

              {deleteError ? (
                <p
                  className="rounded-sm border border-line bg-surface px-3 py-2 text-sm text-red-600"
                  role="alert"
                >
                  {deleteError}
                </p>
              ) : null}

              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleDeleteProject();
                }}
              >
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Admin password
                  <input
                    className={field}
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter admin password"
                    value={adminPassword}
                    onChange={(event) => setAdminPassword(event.target.value)}
                    required
                    autoFocus
                  />
                </label>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    className={btn}
                    onClick={() => {
                      setProjectToDelete(null);
                      setAdminPassword("");
                      setDeleteError(null);
                    }}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="press inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"
                    disabled={deleting || !adminPassword}
                  >
                    {deleting ? "Deleting…" : "Confirm Delete"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
