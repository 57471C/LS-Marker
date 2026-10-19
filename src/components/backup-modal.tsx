import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Download, Loader2, X } from "lucide-react";
import {
  downloadDatabaseBackup,
  fetchBackupStatus,
  type BackupStatusResult,
} from "@/lib/label-client";

type BackupModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function BackupModal({ isOpen, onClose }: BackupModalProps) {
  const [status, setStatus] = useState<BackupStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStatus(null);
      setError(null);
      setDownloading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    setError(null);

    fetchBackupStatus()
      .then((res) => {
        if (mounted) {
          setStatus(res);
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

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      await downloadDatabaseBackup();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to download database backup");
      setDownloading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs"
      onClick={(event) => {
        if (event.target === event.currentTarget && !downloading) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-dialog-title"
        className="flex w-full max-w-lg flex-col gap-5 rounded-xl border border-line bg-bg p-6 text-ink shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-700">
              <Database className="size-4.5" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h2
                id="backup-dialog-title"
                className="text-base font-semibold tracking-tight text-ink"
              >
                Database Backup
              </h2>
              <p className="font-mono text-xs text-muted">
                Online SQLite snapshot &amp; active session audit
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={downloading}
            aria-label="Close backup modal"
            className="press inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-ink disabled:opacity-40"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex flex-col gap-4 text-sm">
          {loading ? (
            <div className="flex items-center justify-center gap-2.5 py-8 text-muted">
              <Loader2 className="size-5 animate-spin text-accent" aria-hidden="true" />
              <span>Auditing active labeling sessions…</span>
            </div>
          ) : error && !status ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-red-600 dark:text-red-400">
              <p className="font-medium">Failed to check active sessions</p>
              <p className="mt-1 text-xs opacity-90">{error}</p>
            </div>
          ) : status ? (
            <>
              {status.activeCount === 0 ? (
                <div className="flex items-start gap-3 rounded-lg border border-emerald-300 bg-emerald-50/70 p-4 text-ink">
                  <CheckCircle2
                    className="mt-0.5 size-5 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-sm text-ink">System is idle</p>
                    <p className="text-xs leading-relaxed text-ink/80">
                      No annotators currently have photos checked out. It is safe to create a
                      database backup snapshot.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50/70 p-4 text-ink">
                  <AlertTriangle
                    className="mt-0.5 size-5 shrink-0 text-amber-600"
                    aria-hidden="true"
                  />
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-sm text-ink">
                      Notice: {status.activeCount} active labeling session
                      {status.activeCount === 1 ? "" : "s"} in progress
                    </p>
                    <p className="text-xs leading-relaxed text-ink/80">
                      Active user{status.activeUsers.length === 1 ? "" : "s"}:{" "}
                      <span className="font-semibold text-ink">
                        {status.activeUsers.join(", ")}
                      </span>
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-ink/80">
                      Check that all users are out of the system or have saved their latest
                      annotations to avoid race conditions.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5 text-xs text-muted">
                <p className="font-medium text-ink">Snapshot details:</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>Uses SQLite online backup API (WAL-safe, non-blocking, zero torn pages).</li>
                  <li>Captures all projects, classes, labels, user accounts, and image claims.</li>
                  <li>
                    Downloaded as a standalone <code className="font-mono text-ink">.sqlite</code>{" "}
                    database snapshot.
                  </li>
                </ul>
              </div>

              {error ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                  {error}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 border-t border-line pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={downloading}
            className="press inline-flex h-9 items-center justify-center rounded-sm border border-line bg-surface px-4 text-xs font-semibold text-ink hover:bg-surface-raised disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={loading || downloading}
            className="press inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-ink px-4 text-xs font-semibold text-surface hover:opacity-90 disabled:opacity-40"
          >
            {downloading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <span>Generating Snapshot…</span>
              </>
            ) : (
              <>
                <Download className="size-3.5" aria-hidden="true" />
                <span>Download Backup Snapshot</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
