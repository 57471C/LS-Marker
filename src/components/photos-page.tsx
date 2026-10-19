import { ChevronDown, ChevronUp, ChevronsUpDown, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import {
  deleteImage,
  fetchAdmin,
  fetchCatalogue,
  imageSrc,
  type ImageRow,
  type PhotoStatus,
} from "@/lib/label-client";
import { useProject } from "@/lib/project";
import { useSession } from "@/lib/session";

const field =
  "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";

type OwnerFilter = "any" | "mine" | "free" | "taken";
type StatusFilter = "any" | "open" | "incomplete" | "complete" | "approved";
type SortField = "file" | "labels" | "owner" | "held";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 40;

function heldFor(claimedAt: string | null, completedAt: string | null): string {
  if (!claimedAt) return "—";
  const then = new Date(claimedAt).getTime();
  if (Number.isNaN(then)) return "—";
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (Number.isNaN(end) || end < then) return "—";
  const mins = Math.round((end - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function PhotosPage() {
  const { username, admin: sessionAdmin } = useSession();
  const [isAdmin, setIsAdmin] = useState(sessionAdmin);
  const { current: project } = useProject();
  const [images, setImages] = useState<ImageRow[] | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState<OwnerFilter>("any");
  const [status, setStatus] = useState<StatusFilter>("any");
  const [sortField, setSortField] = useState<SortField>("file");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [page, setPage] = useState(0);

  const [photoToDelete, setPhotoToDelete] = useState<ImageRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setIsAdmin(sessionAdmin);
  }, [sessionAdmin]);

  useEffect(() => {
    let cancel = false;
    fetchAdmin()
      .then((unlocked) => {
        if (!cancel && unlocked) setIsAdmin(true);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    fetchCatalogue()
      .then((data) => {
        if (cancel) return;
        setImages(data.images);
        setFolderError(data.folderOk ? null : data.folderError);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load photos");
      });
    return () => {
      cancel = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (images ?? []).filter((image) => {
      if (needle && !image.name.toLowerCase().includes(needle)) return false;
      if (status === "open" && image.status !== "open") return false;
      if (status === "incomplete" && image.status !== "incomplete") return false;
      if (status === "complete" && image.status !== "complete") return false;
      if (status === "approved" && image.status !== "approved") return false;
      if (owner === "mine" && image.claimedBy !== username) return false;
      if (owner === "free" && image.claimedBy) return false;
      if (owner === "taken" && (!image.claimedBy || image.claimedBy === username)) return false;
      return true;
    });
  }, [images, query, owner, status, username]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "file") {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortField === "labels") {
        const rank = (s: PhotoStatus) =>
          s === "approved" ? 3 : s === "complete" ? 2 : s === "incomplete" ? 1 : 0;
        cmp = rank(a.status) - rank(b.status);
      } else if (sortField === "owner") {
        const aOwner = a.owner ?? "";
        const bOwner = b.owner ?? "";
        cmp = aOwner.localeCompare(bOwner, undefined, { sensitivity: "base" });
      } else if (sortField === "held") {
        const getDuration = (item: ImageRow) => {
          if (!item.claimedAt) return -1;
          const then = new Date(item.claimedAt).getTime();
          if (Number.isNaN(then)) return -1;
          const end = item.completedAt ? new Date(item.completedAt).getTime() : Date.now();
          return end - then;
        };
        cmp = getDuration(a) - getDuration(b);
      }
      if (cmp === 0) {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const shown = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const openCount = (images ?? []).filter((image) => image.status === "open").length;
  const incompleteCount = (images ?? []).filter((image) => image.status === "incomplete").length;
  const completeCount = (images ?? []).filter((image) => image.status === "complete").length;
  const approvedCount = (images ?? []).filter((image) => image.status === "approved").length;
  const mineCount = (images ?? []).filter((image) => image.claimedBy === username).length;

  async function handleDeletePhoto(item: ImageRow) {
    if (!item.id) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteImage(item.id);
      setImages((prev) =>
        prev ? prev.filter((img) => img.id !== item.id && img.name !== item.name) : null,
      );
      setPhotoToDelete(null);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete photo");
    } finally {
      setIsDeleting(false);
    }
  }

  function remember(name: string) {
    const index = (images ?? []).findIndex((image) => image.name === name);
    if (index >= 0 && project)
      sessionStorage.setItem(`part-lab-index:${project.id}`, String(index));
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(0);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <AppHeader current="photos" />
      <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-medium tracking-tight">Photos</h1>
            <p className="text-sm text-muted">
              {images == null
                ? "Loading"
                : `${images.length} scanned · ${completeCount} complete (${approvedCount} approved) · ${openCount} open · ${incompleteCount} incomplete · ${mineCount} yours`}
            </p>
          </div>
          <a
            href="/?mode=review"
            className="press inline-flex h-10 items-center justify-center gap-1.5 rounded-sm bg-amber-600 px-3.5 text-xs font-semibold text-white shadow-xs hover:bg-amber-700"
          >
            Review QA
          </a>
        </div>
        {error ? (
          <p className="rounded-sm border border-line bg-surface px-3 py-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {folderError ? (
          <p className="rounded-sm border border-line bg-surface px-3 py-2 text-sm" role="alert">
            {folderError}
          </p>
        ) : null}
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2 text-sm font-medium">
            Find
            <input
              className={field}
              value={query}
              placeholder="File name"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Labels</p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["any", "Any"],
                  ["open", "Open"],
                  ["incomplete", "Incomplete"],
                  ["complete", "Complete"],
                  ["approved", "Approved"],
                ] as const
              ).map(([key, label]) => (
                <FilterButton
                  key={key}
                  pressed={status === key}
                  onClick={() => {
                    setStatus(key);
                    setPage(0);
                  }}
                >
                  {label}
                </FilterButton>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Claim</p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["any", "Any"],
                  ["mine", "Mine"],
                  ["free", "Free"],
                  ["taken", "Taken"],
                ] as const
              ).map(([key, label]) => (
                <FilterButton
                  key={key}
                  pressed={owner === key}
                  onClick={() => {
                    setOwner(key);
                    setPage(0);
                  }}
                >
                  {label}
                </FilterButton>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="w-16 py-3 pl-3 pr-2 font-medium"> </th>
                <SortHeader
                  field="file"
                  label="File"
                  currentField={sortField}
                  currentDir={sortDir}
                  onSort={toggleSort}
                  className="py-3 pr-3 font-medium"
                />
                <SortHeader
                  field="labels"
                  label="Labels"
                  currentField={sortField}
                  currentDir={sortDir}
                  onSort={toggleSort}
                  className="w-24 py-3 pr-3 font-medium"
                />
                <SortHeader
                  field="owner"
                  label="Owner"
                  currentField={sortField}
                  currentDir={sortDir}
                  onSort={toggleSort}
                  className="w-28 py-3 pr-3 font-medium"
                />
                <th className="w-28 py-3 pr-3 font-medium">Claim</th>
                <SortHeader
                  field="held"
                  label="Held"
                  currentField={sortField}
                  currentDir={sortDir}
                  onSort={toggleSort}
                  className="hidden w-24 py-3 pr-3 font-medium sm:table-cell"
                />
                {isAdmin ? <th className="w-12 py-3 pr-3 text-right font-medium"> </th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((image) => {
                const isApproved = image.status === "approved";
                const isComplete = image.status === "complete";
                const isIncomplete = image.status === "incomplete";
                const targetUrl = isApproved || isComplete ? "/?mode=review" : "/";
                return (
                  <tr
                    key={image.name}
                    className={`transition-colors ${
                      isApproved
                        ? "bg-purple-500/5 hover:bg-purple-500/10"
                        : isComplete
                          ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                          : isIncomplete
                            ? "bg-orange-500/5 hover:bg-orange-500/10"
                            : "bg-amber-500/5 hover:bg-amber-500/10"
                    }`}
                  >
                    <td className="py-2.5 pl-3 pr-2">
                      <a href={targetUrl} onClick={() => remember(image.name)} className="block">
                        <img
                          src={imageSrc(image.name)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-12 rounded-sm bg-ink object-cover"
                        />
                      </a>
                    </td>
                    <td className="py-2.5 pr-3">
                      <a
                        href={targetUrl}
                        onClick={() => remember(image.name)}
                        className="block truncate font-mono text-sm text-ink hover:underline"
                      >
                        {image.name}
                      </a>
                    </td>
                    <td className="py-2.5 pr-3">
                      {isApproved ? (
                        <span className="inline-flex items-center rounded-sm bg-purple-500/15 px-2 py-0.5 text-xs font-medium text-purple-800">
                          Approved
                        </span>
                      ) : isComplete ? (
                        <span className="inline-flex items-center rounded-sm bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          Complete
                        </span>
                      ) : isIncomplete ? (
                        <span className="inline-flex items-center rounded-sm bg-orange-500/15 px-2 py-0.5 text-xs font-medium text-orange-800">
                          Incomplete
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-sm bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Open
                        </span>
                      )}
                    </td>
                    <td className="truncate py-2.5 pr-3 font-mono text-xs">
                      {image.owner ? (
                        <span
                          className="inline-flex items-center rounded-sm bg-ink/10 px-1.5 py-0.5 font-medium text-ink"
                          title={`Owner: ${image.owner}`}
                        >
                          Owner: {image.owner}
                        </span>
                      ) : (
                        <span className="text-muted" title="Unassigned">
                          -
                        </span>
                      )}
                    </td>
                    <td className="truncate py-2.5 pr-3 font-mono text-xs">
                      {image.claimedBy ? (
                        image.claimedBy === username ? (
                          <span className="inline-flex items-center rounded-sm bg-ink/10 px-1.5 py-0.5 font-medium text-ink">
                            {image.claimedBy} (you)
                          </span>
                        ) : (
                          <span className="text-ink">{image.claimedBy}</span>
                        )
                      ) : (
                        <span className="text-muted">Free</span>
                      )}
                    </td>
                    <td className="hidden py-2.5 pr-3 text-xs text-muted sm:table-cell">
                      {heldFor(image.claimedAt, image.completedAt)}
                    </td>
                    {isAdmin ? (
                      <td className="py-2.5 pr-3 text-right">
                        <button
                          type="button"
                          aria-label={`Delete ${image.name}`}
                          title={`Delete ${image.name}`}
                          className="press inline-flex size-8 items-center justify-center rounded-sm text-red-600 hover:bg-red-500/15 focus-visible:ring-2 focus-visible:ring-red-500"
                          onClick={() => {
                            setPhotoToDelete(image);
                            setDeleteError(null);
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {images && filtered.length === 0 ? (
          <p className="text-sm text-muted">No photos match.</p>
        ) : null}
        {pageCount > 1 ? (
          <div className="flex items-center gap-2">
            <FilterButton pressed={false} onClick={() => setPage(Math.max(0, safePage - 1))}>
              Previous
            </FilterButton>
            <p className="font-mono text-sm text-muted tabular-nums">
              {safePage + 1} / {pageCount}
            </p>
            <FilterButton
              pressed={false}
              onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            >
              Next
            </FilterButton>
          </div>
        ) : null}

        {photoToDelete ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs"
            onClick={(event) => {
              if (event.target === event.currentTarget && !isDeleting) {
                setPhotoToDelete(null);
              }
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-photo-dialog-title"
              className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-line bg-bg p-6 text-ink shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-600">
                    <Trash2 className="size-4.5" aria-hidden="true" />
                  </div>
                  <h2
                    id="delete-photo-dialog-title"
                    className="text-base font-semibold tracking-tight text-ink"
                  >
                    Delete Photo
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setPhotoToDelete(null)}
                  disabled={isDeleting}
                  aria-label="Close dialog"
                  className="press inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-ink disabled:opacity-40"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>

              <p className="text-sm leading-relaxed text-ink/80">
                Permanently delete{" "}
                <span className="font-mono font-semibold text-ink">{photoToDelete.name}</span>? This
                will remove the image, its .txt label file, and all annotations from the database.
                This action cannot be undone.
              </p>

              {deleteError ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
                  {deleteError}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2.5 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => setPhotoToDelete(null)}
                  disabled={isDeleting}
                  className="press inline-flex h-9 items-center justify-center rounded-sm border border-line bg-surface px-4 text-xs font-semibold text-ink hover:bg-surface-raised disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => void handleDeletePhoto(photoToDelete)}
                  className="press inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      <span>Deleting…</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      <span>Delete Photo</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function SortHeader({
  field,
  label,
  currentField,
  currentDir,
  onSort,
  className,
}: {
  field: SortField;
  label: string;
  currentField: SortField;
  currentDir: SortDirection;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  const active = currentField === field;
  return (
    <th className={className}>
      <button
        type="button"
        className="group inline-flex items-center gap-1 font-medium text-muted hover:text-ink focus-visible:outline-none"
        onClick={() => onSort(field)}
        title={`Sort by ${label} (${active ? (currentDir === "asc" ? "ascending" : "descending") : "click to sort"})`}
      >
        <span>{label}</span>
        <span
          className={`inline-flex transition-colors ${
            active ? "text-ink" : "text-muted/40 group-hover:text-muted"
          }`}
        >
          {active ? (
            currentDir === "asc" ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )
          ) : (
            <ChevronsUpDown className="size-3.5" />
          )}
        </span>
      </button>
    </th>
  );
}

function FilterButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={
        pressed
          ? "press inline-flex h-11 items-center rounded-sm bg-ink px-3 text-sm font-medium text-surface"
          : "press inline-flex h-11 items-center rounded-sm border border-line bg-surface px-3 text-sm font-medium text-ink"
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}
