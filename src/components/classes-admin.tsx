import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { classFill } from "@/lib/class-color";
import { createClass, deleteClass, fetchCatalogue, importClasses, updateClass, type ClassRow } from "@/lib/label-client";

const field =
  "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btn =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-sm border border-line bg-surface px-4 text-sm font-medium text-ink disabled:opacity-40";
const btnPrimary =
  "press inline-flex h-11 items-center justify-center gap-2 rounded-sm bg-ink px-4 text-sm font-medium text-surface disabled:opacity-40";

export function ClassesAdmin() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ic, setIc] = useState("");
  const [des, setDes] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editIc, setEditIc] = useState("");
  const [editDes, setEditDes] = useState("");
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);

  async function load() {
    const data = await fetchCatalogue();
    setClasses(data.classes);
  }

  useEffect(() => {
    let cancel = false;
    fetchCatalogue()
      .then((data) => {
        if (!cancel) setClasses(data.classes);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load classes");
      });
    return () => {
      cancel = true;
    };
  }, []);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <AppHeader current="classes" />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-medium tracking-tight">Classes</h1>
          <p className="max-w-xl text-sm text-muted">
            The number is the YOLO class id stored in each label file. Ids stay put when you rename a code. A removed id is left blank in classes.txt and is not reused. Each class is given a colour on its own — you don't pick one.
          </p>
        </div>
        {error ? (
          <p className="rounded-sm border border-line bg-surface px-3 py-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <form
          className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await createClass(ic, des);
              setIc("");
              setDes("");
            });
          }}
        >
          <label className="flex flex-col gap-2 text-sm font-medium">
            Item code
            <input className={field} value={ic} onChange={(event) => setIc(event.target.value)} required />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Description
            <input className={field} value={des} onChange={(event) => setDes(event.target.value)} required />
          </label>
          <div className="flex items-end">
            <button type="submit" className={btnPrimary} disabled={busy}>
              Add class
            </button>
          </div>
        </form>
        <form
          className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("classes-csv");
            const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
            if (!file) return;
            void run(async () => {
              const csv = await file.text();
              const result = await importClasses(csv);
              setImportNote(
                `Added ${result.added}. Ignored ${result.skipped} duplicates${result.invalid ? ` and ${result.invalid} invalid rows` : ""}.`,
              );
              if (input instanceof HTMLInputElement) input.value = "";
            });
          }}
        >
          <label className="flex flex-col gap-2 text-sm font-medium">
            CSV
            <input id="classes-csv" name="classes-csv" className={field} type="file" accept=".csv,text/csv,text/plain" />
          </label>
          <p className="text-sm text-muted">
            Columns <span className="font-mono">ic</span> and <span className="font-mono">des</span>. A code already in the list is skipped.
          </p>
          {importNote ? <p className="text-sm">{importNote}</p> : null}
          <div>
            <button type="submit" className={btn} disabled={busy}>
              Upload CSV
            </button>
          </div>
        </form>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Find
          <input
            className={field}
            value={query}
            placeholder="Item code or description"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <ClassList
          classes={classes}
          query={query}
          editing={editing}
          editIc={editIc}
          editDes={editDes}
          pendingDelete={pendingDelete}
          busy={busy}
          onEditIc={setEditIc}
          onEditDes={setEditDes}
          onStartEdit={(row) => {
            setEditing(row.id);
            setEditIc(row.ic);
            setEditDes(row.des);
            setPendingDelete(null);
          }}
          onCancelEdit={() => setEditing(null)}
          onSaveEdit={(row) => {
            void run(async () => {
              await updateClass({ id: row.id, ic: editIc, des: editDes });
              setEditing(null);
            });
          }}
          onDelete={(row) => {
            if (pendingDelete !== row.id) {
              setPendingDelete(row.id);
              return;
            }
            void run(async () => {
              await deleteClass(row.id);
              setPendingDelete(null);
            });
          }}
        />
        <p className="max-w-xl text-sm text-muted">
          Saving a free image claims it for you. Someone else’s claim has to be taken over before you can change it.
        </p>
      </main>
    </div>
  );
}

const LIST_CAP = 80;

function ClassList({
  classes,
  query,
  editing,
  editIc,
  editDes,
  pendingDelete,
  busy,
  onEditIc,
  onEditDes,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  classes: ClassRow[] | null;
  query: string;
  editing: number | null;
  editIc: string;
  editDes: string;
  pendingDelete: number | null;
  busy: boolean;
  onEditIc: (value: string) => void;
  onEditDes: (value: string) => void;
  onStartEdit: (row: ClassRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (row: ClassRow) => void;
  onDelete: (row: ClassRow) => void;
}) {
  const needle = query.trim().toLowerCase();
  const matched = (classes ?? []).filter((row) => {
    if (!needle) return true;
    return row.ic.toLowerCase().includes(needle) || row.des.toLowerCase().includes(needle);
  });
  const shown = matched.slice(0, LIST_CAP);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        {classes == null
          ? "Loading"
          : matched.length > shown.length
            ? `Showing ${shown.length} of ${matched.length}`
            : `${matched.length} classes`}
      </p>
      <ul className="flex flex-col gap-2">
        {shown.map((row) => {
          const isEditing = editing === row.id;
          return (
            <li key={row.id} className="rounded-lg border border-line bg-surface p-3">
              {isEditing ? (
                <form
                  className="grid gap-3 sm:grid-cols-[5.5rem_1fr_1fr_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSaveEdit(row);
                  }}
                >
                  <p className="flex h-11 items-center gap-2 font-mono text-sm tabular-nums">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ background: classFill(row.id, row.color) }}
                      aria-hidden="true"
                    />
                    {row.id}
                  </p>
                  <input className={field} value={editIc} onChange={(event) => onEditIc(event.target.value)} required />
                  <input className={field} value={editDes} onChange={(event) => onEditDes(event.target.value)} required />
                  <div className="flex gap-2">
                    <button type="submit" className={btnPrimary} disabled={busy}>
                      Save
                    </button>
                    <button type="button" className={btn} onClick={onCancelEdit}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="grid items-center gap-3 sm:grid-cols-[5.5rem_8rem_1fr_auto]">
                  <p className="flex items-center gap-2 font-mono text-sm tabular-nums">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ background: classFill(row.id, row.color) }}
                      aria-hidden="true"
                    />
                    {row.id}
                  </p>
                  <p className="truncate font-mono text-sm">{row.ic}</p>
                  <p className="truncate text-sm text-muted">{row.des}</p>
                  <div className="flex gap-2">
                    <button type="button" className={btn} onClick={() => onStartEdit(row)}>
                      Edit
                    </button>
                    <button type="button" className={btn} onClick={() => onDelete(row)}>
                      {pendingDelete === row.id ? "Confirm" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {classes && matched.length === 0 ? <li className="text-sm text-muted">No classes match.</li> : null}
      </ul>
    </div>
  );
}
