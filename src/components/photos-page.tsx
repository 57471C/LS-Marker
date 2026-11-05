import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  ExternalLink,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";
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

type OwnerFilter = "any" | "mine" | "free" | "taken";
type StatusFilter = "any" | "open" | "incomplete" | "complete" | "approved";
type SortField = "file" | "labels" | "owner" | "held";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 50;

function parseUtcTime(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const str = String(dateStr).trim();
  if (!str) return 0;
  if (str.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(str)) {
    return new Date(str).getTime();
  }
  const iso = str.includes("T") ? `${str}Z` : `${str.replace(" ", "T")}Z`;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? new Date(str).getTime() : t;
}

function isLeaseActive(image: ImageRow): boolean {
  if (typeof image.is_claimed === "boolean") return image.is_claimed;
  const lockedAt = image.lockedAt || image.claimedAt || image.locked_at;
  const holder = image.held_by || image.lockedBy || image.claimedBy || image.locked_by;
  if (!holder || !lockedAt) return false;
  const time = parseUtcTime(lockedAt);
  if (!time) return false;
  return time > Date.now() - 15 * 60 * 1000;
}

function getActiveHolder(image: ImageRow): string | null {
  if (!isLeaseActive(image)) return null;
  return image.held_by || image.lockedBy || image.claimedBy || image.locked_by || null;
}

function getHeldMinutesRemaining(image: ImageRow): number {
  if (!isLeaseActive(image)) return 0;
  if (typeof image.held_minutes_remaining === "number") {
    return image.held_minutes_remaining;
  }
  const lockedAt = image.lockedAt || image.claimedAt || image.locked_at;
  if (!lockedAt) return 0;
  const time = parseUtcTime(lockedAt);
  if (!time) return 0;
  return Math.max(0, Math.ceil((time + 15 * 60 * 1000 - Date.now()) / 60000));
}

function StatusBadge({ status }: { status: PhotoStatus }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center rounded-[2px] bg-purple-100 px-1.5 py-0.2 text-[10px] font-semibold text-purple-900 border border-purple-300">
        Approved
      </span>
    );
  }
  if (status === "complete") {
    return (
      <span className="inline-flex items-center rounded-[2px] bg-emerald-100 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-900 border border-emerald-300">
        Complete
      </span>
    );
  }
  if (status === "incomplete") {
    return (
      <span className="inline-flex items-center rounded-[2px] bg-orange-100 px-1.5 py-0.2 text-[10px] font-semibold text-orange-900 border border-orange-300">
        Incomplete
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-[2px] bg-amber-100 px-1.5 py-0.2 text-[10px] font-semibold text-amber-950 border border-amber-300">
      Open
    </span>
  );
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

  const [selectedPhoto, setSelectedPhoto] = useState<ImageRow | null>(null);
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
      const holder = getActiveHolder(image);
      if (owner === "mine" && (!holder || holder !== username)) return false;
      if (
        owner === "free" &&
        (holder || (image.status !== "open" && image.status !== "incomplete"))
      )
        return false;
      if (owner === "taken" && (!holder || holder === username)) return false;
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
        cmp = getHeldMinutesRemaining(a) - getHeldMinutesRemaining(b);
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

  useEffect(() => {
    if (!selectedPhoto && shown.length > 0) {
      setSelectedPhoto(shown[0]);
    } else if (selectedPhoto && !sorted.some((img) => img.name === selectedPhoto.name)) {
      setSelectedPhoto(shown[0] ?? null);
    }
  }, [shown, selectedPhoto, sorted]);

  const openCount = (images ?? []).filter((image) => image.status === "open").length;
  const incompleteCount = (images ?? []).filter((image) => image.status === "incomplete").length;
  const completeCount = (images ?? []).filter((image) => image.status === "complete").length;
  const approvedCount = (images ?? []).filter((image) => image.status === "approved").length;
  const mineCount = (images ?? []).filter((image) => getActiveHolder(image) === username).length;

  async function handleDeletePhoto(item: ImageRow) {
    if (!item.id) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteImage(item.id);
      setImages((prev) =>
        prev ? prev.filter((img) => img.id !== item.id && img.name !== item.name) : null,
      );
      if (selectedPhoto?.id === item.id) setSelectedPhoto(null);
      setPhotoToDelete(null);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete photo");
    } finally {
      setIsDeleting(false);
    }
  }

  function rememberAndOpen(name: string, reviewMode = false) {
    const idx = (images ?? []).findIndex((image) => image.name === name);
    if (idx >= 0 && project) {
      sessionStorage.setItem(`part-lab-index:${project.id}`, String(idx));
    }
    window.location.href = reviewMode ? "/?mode=review" : "/";
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
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#f0f0f0] text-[#282828] select-none text-xs">
      {/* 28px Top Bar */}
      <AppHeader current="photos" />

      {/* Dense Toolbar (28px) */}
      <div className="h-7 border-b border-[#c8c8c8] bg-white px-2 flex items-center justify-between gap-2 shrink-0 select-none text-xs">
        {/* Left: Find & Filters */}
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Search Input */}
          <div className="relative flex items-center">
            <Search className="size-3 text-[#707070] absolute left-1.5" />
            <input
              type="text"
              placeholder="Filter file name..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              className="h-5 w-36 pl-5 pr-1.5 rounded-[2px] border border-[#c8c8c8] bg-white text-[11px] outline-none focus:border-[#1473e6]"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setPage(0);
                }}
                className="absolute right-1 text-[#707070] hover:text-[#282828]"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <span className="text-[#c8c8c8]">|</span>

          {/* Status Filters */}
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-[#707070] uppercase font-bold mr-0.5">Status:</span>
            {(
              [
                ["any", "All"],
                ["open", "Open"],
                ["incomplete", "Incomplete"],
                ["complete", "Complete"],
                ["approved", "Approved"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`px-1.5 py-0.2 rounded-[2px] text-[11px] font-medium border ${
                  status === key
                    ? "bg-[#1473e6] text-white border-[#1473e6]"
                    : "bg-white text-[#282828] border-[#c8c8c8] hover:bg-[#f0f0f0]"
                }`}
                onClick={() => {
                  setStatus(key);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="text-[#c8c8c8]">|</span>

          {/* Claim Filters */}
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-[#707070] uppercase font-bold mr-0.5">Claim:</span>
            {(
              [
                ["any", "Any"],
                ["mine", "Mine"],
                ["free", "Free"],
                ["taken", "Taken"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`px-1.5 py-0.2 rounded-[2px] text-[11px] font-medium border ${
                  owner === key
                    ? "bg-[#1473e6] text-white border-[#1473e6]"
                    : "bg-white text-[#282828] border-[#c8c8c8] hover:bg-[#f0f0f0]"
                }`}
                onClick={() => {
                  setOwner(key);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Summary Counts & Review QA Action */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[10px] text-[#707070]">
            {images == null
              ? "Loading..."
              : `${images.length} files • ${completeCount} complete (${approvedCount} approved) • ${openCount} open • ${incompleteCount} incomplete • ${mineCount} mine`}
          </span>

          <a
            href="/?mode=review"
            className="press inline-flex items-center rounded-[2px] bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-amber-700"
          >
            Review QA
          </a>
        </div>
      </div>

      {/* Main Workspace (Filmstrip Table on Left + Inspector Pane on Right) */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
        {/* Left: Photos Table List */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-white overflow-hidden">
          {error && (
            <div className="p-2 bg-red-50 border-b border-red-200 text-red-800 text-xs">
              {error}
            </div>
          )}
          {folderError && (
            <div className="p-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs">
              {folderError}
            </div>
          )}

          {/* Table Header */}
          <div className="h-6 border-b border-[#c8c8c8] bg-[#f5f5f5] flex items-center px-2 text-[11px] font-semibold text-[#707070] shrink-0 select-none">
            <div className="w-10">Thumb</div>
            <div className="flex-1 min-w-0 pr-2">
              <button
                type="button"
                onClick={() => toggleSort("file")}
                className="inline-flex items-center gap-1 hover:text-[#282828]"
              >
                <span>File Name</span>
                {sortField === "file" ? (
                  sortDir === "asc" ? (
                    <ChevronUp className="size-3 text-[#1473e6]" />
                  ) : (
                    <ChevronDown className="size-3 text-[#1473e6]" />
                  )
                ) : (
                  <ChevronsUpDown className="size-3 opacity-40" />
                )}
              </button>
            </div>
            <div className="w-24">
              <button
                type="button"
                onClick={() => toggleSort("labels")}
                className="inline-flex items-center gap-1 hover:text-[#282828]"
              >
                <span>Status</span>
                {sortField === "labels" ? (
                  sortDir === "asc" ? (
                    <ChevronUp className="size-3 text-[#1473e6]" />
                  ) : (
                    <ChevronDown className="size-3 text-[#1473e6]" />
                  )
                ) : (
                  <ChevronsUpDown className="size-3 opacity-40" />
                )}
              </button>
            </div>
            <div className="w-28">
              <button
                type="button"
                onClick={() => toggleSort("owner")}
                className="inline-flex items-center gap-1 hover:text-[#282828]"
              >
                <span>Owner</span>
                {sortField === "owner" ? (
                  sortDir === "asc" ? (
                    <ChevronUp className="size-3 text-[#1473e6]" />
                  ) : (
                    <ChevronDown className="size-3 text-[#1473e6]" />
                  )
                ) : (
                  <ChevronsUpDown className="size-3 opacity-40" />
                )}
              </button>
            </div>
            <div className="w-24">Claim</div>
            <div className="w-16">
              <button
                type="button"
                onClick={() => toggleSort("held")}
                className="inline-flex items-center gap-1 hover:text-[#282828]"
              >
                <span>Held</span>
                {sortField === "held" ? (
                  sortDir === "asc" ? (
                    <ChevronUp className="size-3 text-[#1473e6]" />
                  ) : (
                    <ChevronDown className="size-3 text-[#1473e6]" />
                  )
                ) : (
                  <ChevronsUpDown className="size-3 opacity-40" />
                )}
              </button>
            </div>
            {isAdmin && <div className="w-10 text-right">Delete</div>}
          </div>

          {/* Table Rows (Scrollable Internally) */}
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#f0f0f0]">
            {shown.length === 0 ? (
              <div className="p-4 text-center text-[#707070] text-xs">
                {images ? "No photos match active filters." : "Loading photos..."}
              </div>
            ) : (
              shown.map((image) => {
                const isSelected = selectedPhoto?.name === image.name;
                const activeHolder = getActiveHolder(image);
                const isMine = Boolean(activeHolder && activeHolder === username);
                const isTaken = Boolean(activeHolder && activeHolder !== username);

                return (
                  <div
                    key={image.name}
                    onClick={() => setSelectedPhoto(image)}
                    onDoubleClick={() =>
                      rememberAndOpen(
                        image.name,
                        image.status === "complete" || image.status === "approved",
                      )
                    }
                    className={`flex items-center px-2 py-1 cursor-pointer transition-colors text-xs ${
                      isSelected
                        ? "bg-[#1473e6]/10 border-l-2 border-[#1473e6]"
                        : "hover:bg-[#f9f9f9]"
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-10 shrink-0">
                      <img
                        src={imageSrc(image.name)}
                        alt=""
                        loading="lazy"
                        className="size-7 rounded-[1px] object-cover bg-black/10 border border-[#c8c8c8]"
                      />
                    </div>

                    {/* File Name */}
                    <div className="flex-1 min-w-0 pr-2">
                      <span className="font-mono text-[11px] text-[#282828] truncate block">
                        {image.name}
                      </span>
                    </div>

                    {/* Status Badge */}
                    <div className="w-24 shrink-0">
                      <StatusBadge status={image.status} />
                    </div>

                    {/* Owner */}
                    <div className="w-28 shrink-0 font-mono text-[11px] text-[#707070] truncate">
                      {image.owner ?? "—"}
                    </div>

                    {/* Claim */}
                    <div className="w-24 shrink-0">
                      {image.status === "approved" ? (
                        <span className="text-[#707070] text-[10px]">Locked</span>
                      ) : isMine ? (
                        <span className="text-blue-700 bg-blue-50 border border-blue-200 px-1 rounded-[2px] text-[10px] font-bold">
                          Mine
                        </span>
                      ) : isTaken ? (
                        <span className="text-amber-800 bg-amber-50 border border-amber-200 px-1 rounded-[2px] text-[10px]">
                          {activeHolder}
                        </span>
                      ) : (
                        <span className="text-[#707070] bg-neutral-100 px-1 rounded-[2px] text-[10px]">
                          Free
                        </span>
                      )}
                    </div>

                    {/* Held Minutes */}
                    <div className="w-16 shrink-0 font-mono text-[11px] text-[#707070]">
                      {image.status === "approved"
                        ? "—"
                        : activeHolder
                          ? `${getHeldMinutesRemaining(image)}m`
                          : "—"}
                    </div>

                    {/* Delete Action (Admin only) */}
                    {isAdmin && (
                      <div className="w-10 shrink-0 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPhotoToDelete(image);
                            setDeleteError(null);
                          }}
                          className="press size-6 inline-flex items-center justify-center rounded-[2px] text-[#707070] hover:text-red-600 hover:bg-[#f0f0f0]"
                          title="Delete photo"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Pagination Bar */}
          {pageCount > 1 && (
            <div className="h-7 border-t border-[#c8c8c8] bg-[#f5f5f5] px-2 flex items-center justify-between text-xs shrink-0 select-none">
              <span className="font-mono text-[11px] text-[#707070]">
                Page {safePage + 1} of {pageCount} ({sorted.length} photos)
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage === 0}
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                  className="press size-5 flex items-center justify-center rounded-[2px] border border-[#c8c8c8] bg-white text-[#282828] disabled:opacity-30"
                  title="Previous Page"
                >
                  <ChevronLeft className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                  className="press size-5 flex items-center justify-center rounded-[2px] border border-[#c8c8c8] bg-white text-[#282828] disabled:opacity-30"
                  title="Next Page"
                >
                  <ChevronRight className="size-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Inspector Pane (320px) */}
        <aside
          aria-label="Photo Inspector"
          className="w-[320px] border-l border-[#c8c8c8] bg-white flex flex-col shrink-0 overflow-y-auto select-none h-full"
        >
          {/* Header */}
          <div className="h-6 px-2 bg-[#f5f5f5] flex items-center justify-between border-b border-[#c8c8c8] text-[11px] font-semibold text-[#282828] shrink-0">
            <span>PHOTO INSPECTOR</span>
            {selectedPhoto && (
              <span className="font-mono text-[10px] text-[#707070]">
                #{selectedPhoto.id ?? "—"}
              </span>
            )}
          </div>

          {selectedPhoto ? (
            <div className="p-3 flex flex-col gap-3">
              {/* Photo Large Preview */}
              <div className="w-full h-48 bg-[#242424] border border-[#c8c8c8] rounded-[2px] flex items-center justify-center overflow-hidden relative group">
                <img
                  src={imageSrc(selectedPhoto.name)}
                  alt={selectedPhoto.name}
                  className="max-h-full max-w-full object-contain"
                />
                <button
                  type="button"
                  onClick={() =>
                    rememberAndOpen(
                      selectedPhoto.name,
                      selectedPhoto.status === "complete" || selectedPhoto.status === "approved",
                    )
                  }
                  className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1.5 text-white font-medium text-xs transition-opacity"
                >
                  <ExternalLink className="size-4" />
                  <span>Open in Workspace</span>
                </button>
              </div>

              {/* Photo Information Table */}
              <div className="flex flex-col gap-2 bg-[#f9f9f9] border border-[#c8c8c8] rounded-[2px] p-2 text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-bold text-[#707070]">File Name</span>
                  <span className="font-mono text-[11px] text-[#282828] break-all select-all font-semibold">
                    {selectedPhoto.name}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#e5e5e5]">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#707070] block">
                      Status
                    </span>
                    <StatusBadge status={selectedPhoto.status} />
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#707070] block">
                      Owner
                    </span>
                    <span className="font-mono text-[11px] text-[#282828]">
                      {selectedPhoto.owner ?? "Unassigned"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#e5e5e5]">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#707070] block">
                      Claim State
                    </span>
                    <span className="font-mono text-[11px] text-[#282828]">
                      {getActiveHolder(selectedPhoto) ?? "Free"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-[#707070] block">
                      Lease
                    </span>
                    <span className="font-mono text-[11px] text-[#282828]">
                      {isLeaseActive(selectedPhoto)
                        ? `${getHeldMinutesRemaining(selectedPhoto)}m left`
                        : "Inactive"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Primary Actions */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-[#f0f0f0]">
                <button
                  type="button"
                  onClick={() => rememberAndOpen(selectedPhoto.name, false)}
                  className="press h-7 w-full rounded-[2px] bg-[#1473e6] hover:bg-[#0d62c7] text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-none"
                >
                  <ExternalLink className="size-3.5" />
                  <span>Open in Workspace</span>
                </button>

                {(selectedPhoto.status === "complete" || selectedPhoto.status === "approved") && (
                  <button
                    type="button"
                    onClick={() => rememberAndOpen(selectedPhoto.name, true)}
                    className="press h-7 w-full rounded-[2px] bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5"
                  >
                    <span>Inspect in Review QA</span>
                  </button>
                )}

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoToDelete(selectedPhoto);
                      setDeleteError(null);
                    }}
                    className="press h-7 w-full rounded-[2px] border border-red-300 text-red-700 hover:bg-red-50 font-medium text-xs flex items-center justify-center gap-1.5 mt-2"
                  >
                    <Trash2 className="size-3.5" />
                    <span>Delete Photo from Disk</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-[#707070] text-xs">
              Select a photo from the table to inspect details.
            </div>
          )}
        </aside>
      </div>

      {/* Delete Confirmation Modal */}
      {photoToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-[2px] border border-[#c8c8c8] bg-white p-4 shadow-none">
            <div className="flex items-center gap-2 text-red-600">
              <Trash2 className="size-5 shrink-0" />
              <h3 className="text-sm font-semibold text-[#282828]">Delete Photo?</h3>
            </div>
            <p className="mt-2 text-xs text-[#707070] leading-relaxed">
              Permanently delete{" "}
              <strong className="font-mono text-[#282828]">{photoToDelete.name}</strong>? This will
              remove the image and its corresponding label file from disk.
            </p>
            {deleteError && (
              <p className="mt-2 rounded-[2px] border border-red-300 bg-red-50 p-1.5 text-xs text-red-700">
                {deleteError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setPhotoToDelete(null)}
                className="press h-7 px-3 rounded-[2px] border border-[#c8c8c8] bg-white text-xs text-[#282828]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDeletePhoto(photoToDelete)}
                className="press h-7 px-3 rounded-[2px] bg-red-600 text-xs font-semibold text-white flex items-center gap-1"
              >
                {isDeleting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
