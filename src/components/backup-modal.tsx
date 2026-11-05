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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
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
        className="flex w-full max-w-lg flex-col gap-4 rounded-[2px] border border-[#c8c8c8] bg-white p-5 text-[#282828] shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#c8c8c8] pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[2px] border border-blue-200 bg-blue-50 text-[#1473e6]">
              <Database className="size-4" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h2
                id="backup-dialog-title"
                className="text-sm font-semibold tracking-tight text-[#282828]"
              >
                Database Backup
              </h2>
              <p className="text-xs text-[#6e6e6e]">
                Online PostgreSQL snapshot &amp; active session audit
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={downloading}
            aria-label="Close backup modal"
            className="inline-flex size-7 items-center justify-center rounded-[2px] text-[#6e6e6e] hover:bg-[#e0e0e0] hover:text-[#282828] disabled:opacity-40"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex flex-col gap-3 text-xs">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[#6e6e6e]">
              <Loader2 className="size-4 animate-spin text-[#1473e6]" aria-hidden="true" />
              <span>Auditing active labeling sessions…</span>
            </div>
          ) : error && !status ? (
            <div className="rounded-[2px] border border-red-300 bg-red-50 p-3 text-red-700">
              <p className="font-semibold">Failed to check active sessions</p>
              <p className="mt-1 text-[11px] opacity-90">{error}</p>
            </div>
          ) : status ? (
            <>
              {status.activeCount === 0 ? (
                <div className="flex items-start gap-2.5 rounded-[2px] border border-emerald-300 bg-emerald-50 p-3 text-[#282828]">
                  <CheckCircle2
                    className="mt-0.5 size-4.5 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-xs text-emerald-800">System is idle</p>
                    <p className="text-[11px] leading-relaxed text-[#444]">
                      No annotators currently have photos checked out. It is safe to create a
                      database backup snapshot.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 rounded-[2px] border border-amber-300 bg-amber-50 p-3 text-[#282828]">
                  <AlertTriangle
                    className="mt-0.5 size-4.5 shrink-0 text-amber-600"
                    aria-hidden="true"
                  />
                  <div className="flex flex-col gap-1">
                    <p className="font-semibold text-xs text-amber-800">
                      Notice: {status.activeCount} active labeling session
                      {status.activeCount === 1 ? "" : "s"} in progress
                    </p>
                    <p className="text-[11px] leading-relaxed text-[#444]">
                      Active user{status.activeUsers.length === 1 ? "" : "s"}:{" "}
                      <span className="font-semibold text-[#282828]">
                        {status.activeUsers.join(", ")}
                      </span>
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-[#6e6e6e]">
                      Check that all users are out of the system or have saved their latest
                      annotations to avoid race conditions.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5 rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-3 text-xs text-[#6e6e6e]">
                <p className="font-semibold text-[#282828]">Snapshot details:</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>Atomic PostgreSQL transaction dump (safe, non-blocking, zero torn pages).</li>
                  <li>Captures all projects, classes, labels, user accounts, and image claims.</li>
                  <li>
                    Downloaded as a standalone{" "}
                    <code className="font-mono text-[#282828]">.sql</code> database snapshot
                    compatible with psql.
                  </li>
                </ul>
              </div>

              {error ? (
                <div className="rounded-[2px] border border-red-300 bg-red-50 p-2.5 text-xs text-red-700">
                  {error}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-[#c8c8c8] pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={downloading}
            className="inline-flex h-8 items-center justify-center rounded-[2px] border border-[#c8c8c8] bg-white px-3 text-xs font-semibold text-[#282828] hover:bg-[#e0e0e0] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={loading || downloading}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[2px] bg-[#1473e6] px-3.5 text-xs font-semibold text-white hover:bg-[#0d62c9] disabled:opacity-40"
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
