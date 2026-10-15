import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import {
  createUser,
  deleteUser,
  fetchAdmin,
  fetchUsers,
  lockAdmin,
  resetUserPassword,
  unlockAdmin,
  type LabUser,
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
  const [username, setUsername] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [nextPassword, setNextPassword] = useState("");
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    Promise.all([fetchUsers()])
      .then(([rows]) => {
        if (cancel) return;
        setUsers(rows);
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

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <AppHeader current="settings" />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-medium tracking-tight">Settings</h1>
          <p className="max-w-xl text-sm text-muted">
            Labellers sign in with a name and password. This page is separate, and it uses the shared settings password.
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
                <input className={field} value={username} onChange={(event) => setUsername(event.target.value)} required />
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
              {users && users.length === 0 ? <li className="text-sm text-muted">No labellers yet.</li> : null}
            </ul>
            <p className="text-sm text-muted">
              {project
                ? `${project.name} uses ${project.folder}. Create another project from Projects.`
                : "Photo folders belong to a project. Open Projects to choose or create one."}
            </p>
            <div>
              <button
                type="button"
                className={btn}
                onClick={() => {
                  void run(async () => {
                    await lockAdmin();
                    setUnlocked(false);
                    setUsers(null);
                  });
                }}
              >
                Lock settings
              </button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
