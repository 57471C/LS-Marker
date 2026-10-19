import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Archive, CheckCircle2, Download, FileText, Loader2, X } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DatasetHealthModal } from "@/components/dataset-health-modal";
import { RescanModal } from "@/components/rescan-modal";
import {
  checkProjectExif,
  createUser,
  deleteProject,
  deleteUser,
  downloadDatasetExport,
  fetchAdmin,
  fetchProjectHealth,
  fetchProjects,
  fetchUsers,
  lockAdmin,
  resetUserPassword,
  syncProjectImages,
  unlockAdmin,
  type DatasetExportType,
  type ExifCheckResult,
  type ExportFormat,
  type ExportScope,
  type LabUser,
  type Project,
  type ProjectHealthResult,
  type SyncImagesResult,
} from "@/lib/label-client";
import { useProject } from "@/lib/project";

const field =
  "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink disabled:opacity-40";
const btnPrimary =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-ink px-4 text-sm font-medium text-surface disabled:opacity-40";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

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

  const [projectToExport, setProjectToExport] = useState<Project | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("yolo");
  const [exportType, setExportType] = useState<DatasetExportType>("labels_only");
  const [exportScope, setExportScope] = useState<ExportScope>("all");
  const [trainSplit, setTrainSplit] = useState<number>(80);
  const [isExporting, setIsExporting] = useState(false);
  const [bytesExported, setBytesExported] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [checkingExifProjectId, setCheckingExifProjectId] = useState<number | null>(null);
  const [exifResult, setExifResult] = useState<ExifCheckResult | null>(null);

  const [checkingHealthProjectId, setCheckingHealthProjectId] = useState<number | null>(null);
  const [healthResult, setHealthResult] = useState<ProjectHealthResult | null>(null);

  const [syncingProjectId, setSyncingProjectId] = useState<number | null>(null);
  const [syncResult, setSyncResult] = useState<SyncImagesResult | null>(null);

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

  function openExportModal(p: Project, format: ExportFormat = "yolo") {
    setProjectToExport(p);
    setExportFormat(format);
    setExportType("labels_only");
    setExportScope("all");
    setTrainSplit(80);
    setExportError(null);
    setBytesExported(0);
    setIsExporting(false);
  }

  function closeExportModal() {
    if (exportAbortRef.current) {
      exportAbortRef.current.abort();
      exportAbortRef.current = null;
    }
    setIsExporting(false);
    setBytesExported(0);
    setExportError(null);
    setProjectToExport(null);
  }

  async function handleStartExport() {
    if (!projectToExport || isExporting) return;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    setIsExporting(true);
    setBytesExported(0);
    setExportError(null);
    try {
      await downloadDatasetExport({
        projectId: projectToExport.id,
        format: exportFormat,
        exportType,
        trainSplit,
        scope: exportScope,
        signal: controller.signal,
        onProgress: (loaded) => setBytesExported(loaded),
      });
      setProjectToExport(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      exportAbortRef.current = null;
      setIsExporting(false);
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

  async function handleCheckExif(p: Project) {
    setCheckingExifProjectId(p.id);
    setError(null);
    try {
      const result = await checkProjectExif(p.id);
      setExifResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to check EXIF");
    } finally {
      setCheckingExifProjectId(null);
    }
  }

  async function handleCheckHealth(p: Project) {
    setCheckingHealthProjectId(p.id);
    setError(null);
    try {
      const result = await fetchProjectHealth(p.id);
      setHealthResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load project health");
    } finally {
      setCheckingHealthProjectId(null);
    }
  }

  async function handleRescan(p: Project) {
    setSyncingProjectId(p.id);
    setError(null);
    try {
      const result = await syncProjectImages(p.id);
      setSyncResult(result);
      const nextProjects = await fetchProjects();
      setProjects(nextProjects);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Rescan failed");
    } finally {
      setSyncingProjectId(null);
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
                              {p.approvedPhotos !== undefined && p.approvedPhotos > 0 ? (
                                <span className="ml-1 text-xs text-purple-600 dark:text-purple-400 font-normal">
                                  ({p.approvedPhotos} approved)
                                </span>
                              ) : null}
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
                              disabled={!p.folderOk || (p.totalPhotos ?? 0) === 0}
                              onClick={() => openExportModal(p)}
                              title="Export dataset (YOLO / COCO JSON)"
                            >
                              Export
                            </button>
                            <button
                              type="button"
                              className="press inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-raised disabled:opacity-40"
                              disabled={
                                !p.folderOk ||
                                (p.totalPhotos ?? 0) === 0 ||
                                checkingExifProjectId === p.id
                              }
                              onClick={() => void handleCheckExif(p)}
                              title="Check images for EXIF orientation tags"
                            >
                              {checkingExifProjectId === p.id ? (
                                <>
                                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                  <span>Checking…</span>
                                </>
                              ) : (
                                "Check EXIF"
                              )}
                            </button>
                            <button
                              type="button"
                              className="press inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-raised disabled:opacity-40"
                              disabled={!p.folderOk || checkingHealthProjectId === p.id}
                              onClick={() => void handleCheckHealth(p)}
                              title="Inspect dataset composition & class distribution"
                            >
                              {checkingHealthProjectId === p.id ? (
                                <>
                                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                  <span>Loading…</span>
                                </>
                              ) : (
                                "Health"
                              )}
                            </button>
                            <button
                              type="button"
                              className="press inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-xs font-medium text-ink hover:bg-surface-raised disabled:opacity-40"
                              disabled={!p.folderOk || syncingProjectId === p.id}
                              onClick={() => void handleRescan(p)}
                              title="Rescan and synchronize photos from disk folder"
                            >
                              {syncingProjectId === p.id ? (
                                <>
                                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                                  <span>Rescanning…</span>
                                </>
                              ) : (
                                "Rescan"
                              )}
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

        {projectToExport ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs"
            onClick={(event) => {
              if (event.target === event.currentTarget && !isExporting) {
                closeExportModal();
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="export-dialog-title"
              className="flex w-full max-w-xl flex-col gap-5 rounded-xl border border-line bg-bg p-6 text-ink shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
                <div className="flex flex-col gap-1">
                  <h2
                    id="export-dialog-title"
                    className="text-base font-semibold tracking-tight text-ink"
                  >
                    Export {exportFormat === "coco" ? "COCO JSON" : "YOLO"} Dataset:{" "}
                    {projectToExport.name}
                  </h2>
                  <p className="font-mono text-xs text-muted">
                    {projectToExport.resolvedFolder || projectToExport.folder} &middot;{" "}
                    {projectToExport.completePhotos ?? 0} labeled /{" "}
                    {projectToExport.totalPhotos ?? 0} total photos
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeExportModal}
                  aria-label="Close export modal"
                  className="press inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-ink"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>

              {/* Format selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink">Format</label>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface p-1">
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={() => setExportFormat("yolo")}
                    className={`press flex h-9 items-center justify-center rounded-md text-xs font-semibold transition-all ${
                      exportFormat === "yolo"
                        ? "bg-ink text-surface shadow-xs"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    YOLO
                  </button>
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={() => setExportFormat("coco")}
                    className={`press flex h-9 items-center justify-center rounded-md text-xs font-semibold transition-all ${
                      exportFormat === "coco"
                        ? "bg-blue-600 text-white shadow-xs"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    COCO JSON
                  </button>
                </div>
              </div>

              {/* Include Images (Scope) selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-ink">Include Images</label>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface p-1">
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={() => setExportScope("all")}
                    className={`press flex h-9 items-center justify-center rounded-md text-xs font-semibold transition-all ${
                      exportScope === "all"
                        ? "bg-ink text-surface shadow-xs"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    All Completed
                  </button>
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={() => setExportScope("approved")}
                    className={`press flex h-9 items-center justify-center rounded-md text-xs font-semibold transition-all ${
                      exportScope === "approved"
                        ? "bg-purple-600 text-white shadow-xs"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    Approved Only
                  </button>
                </div>
                {exportScope === "approved" ? (
                  <p className="text-[11px] text-purple-700">
                    Only photos that have passed QA review will be packaged into the dataset.
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-3" role="radiogroup" aria-label="Export Method">
                <label
                  className={`flex cursor-pointer items-start gap-3.5 rounded-lg border p-4 transition-colors ${
                    exportType === "labels_only"
                      ? "border-blue-500 bg-blue-50/70"
                      : "border-line bg-surface hover:bg-surface-raised/60"
                  } ${isExporting ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    name="dataset-export-type"
                    value="labels_only"
                    checked={exportType === "labels_only"}
                    disabled={isExporting}
                    onChange={() => setExportType("labels_only")}
                    className="sr-only"
                  />
                  <div
                    className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border ${
                      exportType === "labels_only"
                        ? "border-blue-200 bg-blue-100 text-blue-700"
                        : "border-line bg-bg text-muted"
                    }`}
                  >
                    <FileText className="size-4" aria-hidden="true" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {exportFormat === "coco"
                          ? "Reference / Annotations Only"
                          : "Labels Only (Fast / Reference)"}
                      </span>
                      {exportType === "labels_only" ? (
                        <CheckCircle2
                          className="size-4 shrink-0 text-blue-600"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-muted">
                      {exportFormat === "coco"
                        ? "Best for Detectron2 / MMDetection on local storage. Exports annotations/instances_train.json and instances_val.json referencing existing image filenames, plus export_manifest.json. Instant download (< 5 MB)."
                        : "Best if you train on the same machine where images reside. Images remain in their original folders; exports YOLO label files, train/val path lists, and data.yaml. Instant download (< 5 MB)."}
                    </p>
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-3.5 rounded-lg border p-4 transition-colors ${
                    exportType === "full_tar"
                      ? "border-blue-500 bg-blue-50/70"
                      : "border-line bg-surface hover:bg-surface-raised/60"
                  } ${isExporting ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    name="dataset-export-type"
                    value="full_tar"
                    checked={exportType === "full_tar"}
                    disabled={isExporting}
                    onChange={() => setExportType("full_tar")}
                    className="sr-only"
                  />
                  <div
                    className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border ${
                      exportType === "full_tar"
                        ? "border-blue-200 bg-blue-100 text-blue-700"
                        : "border-line bg-bg text-muted"
                    }`}
                  >
                    <Archive className="size-4" aria-hidden="true" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">
                        Full Dataset (.tar stream)
                      </span>
                      {exportType === "full_tar" ? (
                        <CheckCircle2
                          className="size-4 shrink-0 text-blue-600"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-muted">
                      {exportFormat === "coco"
                        ? "Streams images/train/, images/val/, and annotations/instances_train.json, instances_val.json directly as an uncompressed TAR archive. Ready for immediate remote training runs."
                        : "Streams images and label pairs directly as an uncompressed TAR archive. Safe for huge datasets, collision-proof filenames, with zero memory overhead."}
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="train-val-split" className="text-xs font-medium text-ink">
                    Train / Val Split
                  </label>
                  <span className="font-mono text-xs font-semibold text-blue-600">
                    {trainSplit}% Train / {100 - trainSplit}% Val
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    id="train-val-split"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    disabled={isExporting}
                    value={trainSplit}
                    onChange={(event) => setTrainSplit(Number(event.target.value))}
                    className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-line accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={isExporting}
                      aria-label="Train split percentage"
                      value={trainSplit}
                      onChange={(event) => {
                        const val = Number(event.target.value);
                        if (Number.isFinite(val)) {
                          setTrainSplit(Math.max(0, Math.min(100, Math.round(val))));
                        }
                      }}
                      className="h-8 w-16 rounded-sm border border-line bg-bg px-2 text-right font-mono text-xs text-ink outline-none focus-visible:border-blue-600 disabled:opacity-50"
                    />
                    <span className="font-mono text-xs text-muted">%</span>
                  </div>
                </div>
              </div>

              {isExporting ? (
                <div
                  className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-2.5">
                    <Loader2 className="size-4 animate-spin text-blue-600" aria-hidden="true" />
                    <span>
                      Streaming{" "}
                      {exportFormat === "coco"
                        ? exportType === "labels_only"
                          ? "COCO annotations archive"
                          : "full COCO dataset archive"
                        : exportType === "labels_only"
                          ? "YOLO labels-only archive"
                          : "full YOLO dataset archive"}
                      …
                    </span>
                  </div>
                  <span className="font-mono font-semibold text-blue-800">
                    {formatBytes(bytesExported)}
                  </span>
                </div>
              ) : null}

              {exportError ? (
                <p
                  className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700"
                  role="alert"
                >
                  {exportError}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-2.5 border-t border-line pt-4">
                <button
                  type="button"
                  onClick={closeExportModal}
                  className="press inline-flex h-10 items-center justify-center rounded-sm border border-line bg-surface px-4 text-xs font-medium text-ink hover:bg-surface-raised"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => void handleStartExport()}
                  className="press inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-blue-600 px-5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Streaming Export…
                    </>
                  ) : (
                    <>
                      <Download className="size-4" aria-hidden="true" />
                      Download Export
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
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

        {exifResult ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setExifResult(null);
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="exif-dialog-title"
              className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-line bg-bg p-6 text-ink shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
                <div className="flex items-center gap-3">
                  {exifResult.flaggedCount === 0 ? (
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700">
                      <CheckCircle2 className="size-5" aria-hidden="true" />
                    </div>
                  ) : (
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
                      <AlertTriangle className="size-5" aria-hidden="true" />
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5">
                    <h2
                      id="exif-dialog-title"
                      className="text-base font-semibold tracking-tight text-ink"
                    >
                      EXIF Orientation Diagnostic: {exifResult.projectName}
                    </h2>
                    <p className="font-mono text-xs text-muted">
                      {exifResult.totalImages} images scanned &middot; {exifResult.flaggedCount}{" "}
                      flagged
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExifResult(null)}
                  aria-label="Close modal"
                  className="press inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-ink"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>

              {exifResult.flaggedCount === 0 ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-medium text-emerald-900">
                    All clear: Checked {exifResult.totalImages} images in &ldquo;
                    {exifResult.projectName}&rdquo;. 0 EXIF orientation tags detected. Coordinates
                    will align 1:1.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-medium text-amber-900">
                      Warning: Found {exifResult.flaggedCount} of {exifResult.totalImages} images
                      with EXIF orientation tags. These images may render rotated in browsers while
                      reading unrotated dimensions during model training.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-muted">Flagged image files:</span>
                    <div className="max-h-60 overflow-y-auto rounded-lg border border-line bg-surface p-2 font-mono text-xs text-amber-950 divide-y divide-line">
                      {exifResult.flaggedFiles.map((file) => (
                        <div key={file} className="py-1.5 px-2 break-all">
                          {file}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => setExifResult(null)}
                  className="press inline-flex h-9 items-center justify-center rounded-sm border border-line bg-surface px-4 text-xs font-semibold text-ink hover:bg-surface-raised"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {healthResult ? (
          <DatasetHealthModal health={healthResult} onClose={() => setHealthResult(null)} />
        ) : null}

        {syncResult ? (
          <RescanModal result={syncResult} onClose={() => setSyncResult(null)} />
        ) : null}
      </main>
    </div>
  );
}
