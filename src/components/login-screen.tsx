import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { login } from "@/lib/label-client";

const field =
  "h-11 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
const btnPrimary =
  "press inline-flex h-11 items-center justify-center rounded-sm bg-ink px-4 text-sm font-medium text-surface disabled:opacity-40";

export function LoginScreen({ onIn }: { onIn: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <p className="text-lg font-medium tracking-tight">LS-Marker</p>
        <Link to="/settings" className="inline-flex h-11 items-center rounded-sm px-3 text-sm font-medium text-muted">
          Settings
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-medium tracking-tight">Sign in</h1>
          <p className="text-sm text-muted">Use the name and password from Settings. No email check.</p>
        </div>
        <form
          className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            login(username, password)
              .then((user) => onIn(user.username))
              .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not sign in"))
              .finally(() => setBusy(false));
          }}
        >
          <label className="flex flex-col gap-2 text-sm font-medium">
            Username
            <input
              className={field}
              autoComplete="username"
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
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? (
            <p className="text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className={btnPrimary} disabled={busy}>
            Sign in
          </button>
        </form>
      </main>
    </div>
  );
}
