import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { fetchCatalogue, downloadYoloExport, imageSrc, type ImageRow } from "@/lib/label-client";
import { useSession } from "@/lib/session";
import { useProject } from "@/lib/project";

const field =
  "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";

type OwnerFilter = "any" | "mine" | "free" | "taken";
type StatusFilter = "any" | "open" | "done";

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
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const openCount = (images ?? []).filter((image) => !image.labelled).length;
  const mineCount = (images ?? []).filter((image) => image.claimedBy === username).length;

  function remember(name: string) {
    const index = (images ?? []).findIndex((image) => image.name === name);
    if (index >= 0 && project) sessionStorage.setItem(`part-lab-index:${project.id}`, String(index));
  }

  async function runExport() {
    setExporting(true);
    setError(null);
    try {
      await downloadYoloExport();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
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
          <button
            type="button"
            className="btn-blue press inline-flex h-11 items-center rounded-sm px-4 text-sm font-medium disabled:opacity-40"
            disabled={exporting || images == null || images.length === 0 || Boolean(folderError)}
            onClick={() => void runExport()}
          >
            {exporting ? "Exporting" : "Export YOLO"}
          </button>
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
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="w-16 py-2 pr-2 font-medium"> </th>
                <th className="py-2 pr-3 font-medium">File</th>
                <th className="w-20 py-2 pr-3 font-medium">Labels</th>
                <th className="w-24 py-2 pr-3 font-medium">Owner</th>
                <th className="hidden w-20 py-2 font-medium sm:table-cell">Held</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((image) => (
                <tr key={image.name} className="border-b border-line">
                  <td className="py-2 pr-2">
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
                  <td className="py-2 pr-3">
                    <Link
                      to="/"
                      onClick={() => remember(image.name)}
                      className="block truncate font-mono text-sm text-ink"
                    >
                      {image.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-muted">{image.labelled ? "Done" : "Open"}</td>
                  <td className="truncate py-2 pr-3 font-mono">{image.claimedBy ?? "Free"}</td>
                  <td className="hidden py-2 text-muted sm:table-cell">{heldFor(image.claimedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {images && filtered.length === 0 ? <p className="text-sm text-muted">No photos match.</p> : null}
        {pageCount > 1 ? (
          <div className="flex items-center gap-2">
            <FilterButton pressed={false} onClick={() => setPage(Math.max(0, safePage - 1))}>
              Previous
            </FilterButton>
            <p className="font-mono text-sm text-muted tabular-nums">
              {safePage + 1} / {pageCount}
            </p>
            <FilterButton pressed={false} onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}>
              Next
            </FilterButton>
          </div>
        ) : null}
      </main>
    </div>
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
