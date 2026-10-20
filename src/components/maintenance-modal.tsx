import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, Users, Wrench, X } from "lucide-react";
import { fetchBackupStatus, type BackupStatusResult } from "@/lib/label-client";

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

  useEffect(() => {
    if (!isOpen) {
      setSessions(null);
      setError(null);
      setSubmitting(false);
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
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-blue-500/15 text-blue-700 dark:text-blue-400"
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
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
              <div className="flex items-center gap-2 font-semibold text-xs">
                <AlertTriangle
                  className="size-4 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <span>MAINTENANCE MODE IS CURRENTLY ACTIVE</span>
              </div>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                Non-admin annotators cannot claim images, save labels, or alter data. Admins retain
                full access.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-950 dark:border-emerald-800/50 dark:bg-emerald-950/20 dark:text-emerald-200">
              <div className="flex items-center gap-2 font-semibold text-xs">
                <CheckCircle2
                  className="size-4 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <span>NORMAL OPERATION (Maintenance Mode is OFF)</span>
              </div>
              <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
                Staff can freely claim and label images. Enable maintenance mode before running git
                pull or applying server updates.
              </p>
            </div>
          )}

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
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised/30 p-2.5 text-xs text-muted">
              <CheckCircle2
                className="size-4 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              <span>
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
