import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { fetchCatalogue, imageSrc, type ImageRow } from "@/lib/label-client";
import { useProject } from "@/lib/project";
import { useSession } from "@/lib/session";

const field =
  "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";

type OwnerFilter = "any" | "mine" | "free" | "taken";
type StatusFilter = "any" | "open" | "done";
type SortField = "file" | "labels" | "owner" | "held";
type SortDirection = "asc" | "desc";

const PAGE_SIZE = 40;

function heldFor(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function PhotosPage() {
  const { username } = useSession();
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
      if (status === "open" && image.labelled) return false;
      if (status === "done" && !image.labelled) return false;
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
        const aVal = a.labelled ? 1 : 0;
        const bVal = b.labelled ? 1 : 0;
        cmp = aVal - bVal;
      } else if (sortField === "owner") {
        const aOwner = a.claimedBy ?? "";
        const bOwner = b.claimedBy ?? "";
        cmp = aOwner.localeCompare(bOwner, undefined, { sensitivity: "base" });
      } else if (sortField === "held") {
        const aTime = a.claimedAt ? new Date(a.claimedAt).getTime() : 0;
        const bTime = b.claimedAt ? new Date(b.claimedAt).getTime() : 0;
        cmp = aTime - bTime;
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
  const openCount = (images ?? []).filter((image) => !image.labelled).length;
  const mineCount = (images ?? []).filter((image) => image.claimedBy === username).length;

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
                : `${images.length} scanned · ${openCount} open · ${mineCount} yours`}
            </p>
          </div>
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
                  ["done", "Done"],
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
            <p className="text-sm font-medium">Owner</p>
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
                <SortHeader
                  field="held"
                  label="Held"
                  currentField={sortField}
                  currentDir={sortDir}
                  onSort={toggleSort}
                  className="hidden w-24 py-3 pr-3 font-medium sm:table-cell"
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((image) => {
                const isOpen = !image.labelled;
                return (
                  <tr
                    key={image.name}
                    className={`transition-colors ${
                      isOpen
                        ? "bg-amber-500/5 hover:bg-amber-500/10"
                        : "bg-emerald-500/5 hover:bg-emerald-500/10"
                    }`}
                  >
                    <td className="py-2.5 pl-3 pr-2">
                      <Link to="/" onClick={() => remember(image.name)} className="block">
                        <img
                          src={imageSrc(image.name)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-12 rounded-sm bg-ink object-cover"
                        />
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Link
                        to="/"
                        onClick={() => remember(image.name)}
                        className="block truncate font-mono text-sm text-ink hover:underline"
                      >
                        {image.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      {isOpen ? (
                        <span className="inline-flex items-center rounded-sm bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Open
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-sm bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          Done
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
                      {heldFor(image.claimedAt)}
                    </td>
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
