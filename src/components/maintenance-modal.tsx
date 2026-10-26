import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  GitBranch,
  Loader2,
  ShieldAlert,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  executeGitPull,
  fetchBackupStatus,
  type BackupStatusResult,
  type GitPullResult,
} from "@/lib/label-client";

type MaintenanceModalProps = {
  isOpen: boolean;
  isMaintenance: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => Promise<void>;
};

export function MaintenanceModal({
  isOpen,
  isMaintenance,
  onClose,
  onToggle,
}: MaintenanceModalProps) {
  const [sessions, setSessions] = useState<BackupStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<GitPullResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [forceInstall, setForceInstall] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSessions(null);
      setError(null);
      setSubmitting(false);
      setPulling(false);
      setPullResult(null);
      setCountdown(null);
      return;
    }

    let mounted = true;
    setLoading(true);
    setError(null);

    fetchBackupStatus()
      .then((res) => {
        if (mounted) {
          setSessions(res);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to query active sessions");
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleToggle() {
    setSubmitting(true);
    setError(null);
    try {
      await onToggle(!isMaintenance);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update maintenance mode");
      setSubmitting(false);
    }
  }

  async function handleGitPull() {
    setPulling(true);
    setPullResult(null);
    setCountdown(null);
    try {
      const res = await executeGitPull({ restart: true, install: forceInstall });
      setPullResult(res);
      if (res.success && res.restarting) {
        let remaining = 3;
        setCountdown(remaining);
        const timer = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            clearInterval(timer);
            window.location.reload();
          } else {
            setCountdown(remaining);
          }
        }, 1000);
      }
    } catch (err: unknown) {
      setPullResult({
        ok: false,
        success: false,
        output: err instanceof Error ? err.message : "Git pull request failed",
        restarting: false,
        message: "Failed to execute git pull",
      });
    } finally {
      setPulling(false);
    }
  }

  const hasActiveSessions = Boolean(sessions?.activeCount && sessions.activeCount > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="maintenance-modal-title"
        className="flex w-full max-w-lg flex-col gap-5 rounded-xl border border-line bg-surface p-6 text-ink shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                isMaintenance
                  ? "border border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                  : "border border-blue-300 bg-blue-100 text-blue-950 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200"
              }`}
            >
              {isMaintenance ? (
                <Wrench className="size-5" aria-hidden="true" />
              ) : (
                <ShieldAlert className="size-5" aria-hidden="true" />
              )}
            </div>
            <div>
              <h2
                id="maintenance-modal-title"
                className="text-base font-semibold tracking-tight text-ink"
              >
                System Maintenance Mode
              </h2>
              <p className="text-xs text-muted">
                Safely pause user operations for database backups and software updates.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            className="press inline-flex size-8 items-center justify-center rounded-sm text-muted hover:bg-surface-raised hover:text-ink disabled:opacity-40"
            disabled={submitting}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {error ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-400">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {/* Status Banner */}
          {isMaintenance ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50/80 p-3.5 text-ink dark:border-amber-700/60 dark:bg-amber-950/30">
              <div className="flex items-center gap-2 font-bold text-xs text-amber-950 dark:text-amber-200">
                <AlertTriangle
                  className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span>MAINTENANCE MODE IS CURRENTLY ACTIVE</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink/85 dark:text-ink/90">
                Non-admin annotators cannot claim images, save labels, or alter data. Admins retain
                full access.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50/80 p-3.5 text-ink dark:border-emerald-800/60 dark:bg-emerald-950/30">
              <div className="flex items-center gap-2 font-bold text-xs text-emerald-950 dark:text-emerald-200">
                <CheckCircle2
                  className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <span>NORMAL OPERATION (Maintenance Mode is OFF)</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink/85 dark:text-ink/90">
                Staff can freely claim and label images. Enable maintenance mode before running git
                pull or applying server updates.
              </p>
            </div>
          )}

          {/* Git Pull & Server Update (Active in Maintenance Mode) */}
          {isMaintenance ? (
            <div className="rounded-lg border-2 border-amber-400 bg-amber-50/70 p-4 text-ink dark:border-amber-700/60 dark:bg-amber-950/25">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5">
                  <GitBranch
                    className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="text-sm font-bold text-ink">Update from GitHub</h3>
                    <p className="text-xs text-muted">
                      Pull latest code and restart Vite dev server.
                    </p>
                    <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={forceInstall}
                        disabled={pulling || submitting}
                        onChange={(e) => setForceInstall(e.target.checked)}
                        className="rounded-xs border-line"
                      />
                      <span>Run npm install (automatic if package.json changed)</span>
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={pulling || submitting}
                  onClick={() => void handleGitPull()}
                  className="press inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-sm bg-amber-600 px-4 text-xs font-bold text-white shadow-xs hover:bg-amber-700 active:bg-amber-800 disabled:opacity-50"
                >
                  {pulling ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      <span>
                        {forceInstall ? "Pulling & Installing…" : "Pulling & Restarting…"}
                      </span>
                    </>
                  ) : (
                    <>
                      <Download className="size-3.5" aria-hidden="true" />
                      <span>Git Pull &amp; Restart</span>
                    </>
                  )}
                </button>
              </div>

              {pullResult ? (
                <div className="mt-3 flex flex-col gap-2">
                  <div
                    className={`flex items-center gap-2 rounded-sm p-2.5 text-xs font-semibold ${
                      pullResult.success
                        ? "border border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                        : "border border-red-300 bg-red-100 text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                    }`}
                  >
                    {pullResult.success ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertTriangle className="size-4 shrink-0 text-red-600 dark:text-red-400" />
                    )}
                    <span>{pullResult.message}</span>
                    {countdown !== null ? (
                      <span className="ml-auto font-mono text-xs font-bold text-emerald-800 dark:text-emerald-300 animate-pulse">
                        Reloading in {countdown}s…
                      </span>
                    ) : null}
                  </div>
                  {pullResult.packageJsonChanged || pullResult.installed ? (
                    <p className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                      {pullResult.packageJsonChanged
                        ? "Dependencies changed: `npm install` ran automatically before server restart."
                        : "`npm install` completed before server restart."}
                    </p>
                  ) : null}
                  {pullResult.output ? (
                    <pre className="max-h-36 overflow-auto rounded-sm border border-line bg-surface p-2.5 font-mono text-[11px] leading-tight text-ink/90 whitespace-pre-wrap select-all">
                      {pullResult.output}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Active Sessions Warning */}
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface-raised/40 p-4 text-xs text-muted">
              <Loader2 className="size-4 animate-spin text-muted" aria-hidden="true" />
              <span>Checking active annotator sessions…</span>
            </div>
          ) : hasActiveSessions ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/15 dark:text-amber-200">
              <div className="flex items-center gap-2 font-medium">
                <Users className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span>
                  {sessions?.activeCount} annotator{sessions?.activeCount === 1 ? "" : "s"}{" "}
                  currently hold active leases:
                </span>
              </div>
              <p className="mt-1 font-mono text-xs font-semibold">
                {sessions?.activeUsers.join(", ")}
              </p>
              <p className="mt-1 text-muted text-[11px]">
                Enabling maintenance mode will reject new saves from these sessions until
                maintenance concludes.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50/70 p-3 text-xs dark:border-emerald-800/60 dark:bg-emerald-950/30">
              <CheckCircle2
                className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              <span className="font-medium text-emerald-950 dark:text-emerald-100">
                No annotators are currently holding active image leases. Safe to perform
                maintenance.
              </span>
            </div>
          )}

          {/* Guidelines */}
          <div className="rounded-lg border border-line bg-surface-raised/20 p-3 text-xs text-muted">
            <p className="font-semibold text-ink">What happens in Maintenance Mode:</p>
            <ul className="mt-1.5 list-inside list-disc space-y-1">
              <li>Non-admin annotators receive a maintenance notice and cannot mutate data.</li>
              <li>
                You can safely download database backups and run{" "}
                <code className="font-mono text-xs">git pull</code>.
              </li>
              <li>You can safely restart the application service with zero data-loss risk.</li>
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <button
            type="button"
            className="press inline-flex h-9 items-center justify-center rounded-sm border border-line bg-surface px-4 text-xs font-medium text-ink hover:bg-surface-raised disabled:opacity-40"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`press inline-flex h-9 items-center justify-center gap-2 rounded-sm px-4 text-xs font-semibold shadow-xs disabled:opacity-40 ${
              isMaintenance
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-amber-600 text-white hover:bg-amber-700"
            }`}
            disabled={submitting}
            onClick={() => void handleToggle()}
          >
            {submitting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <span>Updating…</span>
              </>
            ) : isMaintenance ? (
              <>
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                <span>Disable Maintenance Mode</span>
              </>
            ) : (
              <>
                <Wrench className="size-3.5" aria-hidden="true" />
                <span>Enable Maintenance Mode</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
