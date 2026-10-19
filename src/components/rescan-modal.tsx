import {
  AlertTriangle,
  CheckCircle2,
  Image as ImageIcon,
  PlusCircle,
  RefreshCw,
  X,
} from "lucide-react";
import type { SyncImagesResult } from "@/lib/label-client";

type RescanModalProps = {
  result: SyncImagesResult;
  onClose: () => void;
};

export function RescanModal({ result, onClose }: RescanModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rescan-dialog-title"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-line bg-bg p-6 text-ink shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-700">
              <RefreshCw className="size-4.5" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h2
                id="rescan-dialog-title"
                className="text-base font-semibold tracking-tight text-ink"
              >
                Rescan Complete: {result.projectName}
              </h2>
              <p className="font-mono text-xs text-muted">Disk sync &amp; image database audit</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close rescan modal"
            className="press inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex flex-col gap-3">
          {/* Metrics summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3">
              <span className="text-[11px] font-medium text-muted">New Added</span>
              <div className="flex items-center gap-1.5">
                <PlusCircle className="size-3.5 text-blue-600" aria-hidden="true" />
                <span className="font-mono text-lg font-bold text-ink">{result.newlyAdded}</span>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3">
              <span className="text-[11px] font-medium text-muted">Total Active</span>
              <div className="flex items-center gap-1.5">
                <ImageIcon className="size-3.5 text-ink/70" aria-hidden="true" />
                <span className="font-mono text-lg font-bold text-ink">
                  {result.totalInProject}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3">
              <span className="text-[11px] font-medium text-muted">Missing Flagged</span>
              <div className="flex items-center gap-1.5">
                <AlertTriangle
                  className={`size-3.5 ${result.missingCompleted > 0 ? "text-amber-600" : "text-muted"}`}
                  aria-hidden="true"
                />
                <span
                  className={`font-mono text-lg font-bold ${
                    result.missingCompleted > 0 ? "text-amber-700" : "text-ink"
                  }`}
                >
                  {result.missingCompleted}
                </span>
              </div>
            </div>
          </div>

          {/* Breakdown items list */}
          <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-line/60">
              <span className="text-muted">New photos added:</span>
              <span className="font-mono font-semibold text-ink">{result.newlyAdded}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-line/60">
              <span className="text-muted">Total active photos:</span>
              <span className="font-mono font-semibold text-ink">{result.totalInProject}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-muted">Missing files flagged:</span>
              <span
                className={`font-mono font-semibold ${
                  result.missingCompleted > 0 ? "text-amber-700" : "text-ink"
                }`}
              >
                {result.missingCompleted}
              </span>
            </div>
            {result.pruned > 0 && (
              <div className="flex justify-between py-1.5 border-t border-line/60">
                <span className="text-muted">Removed unlabeled photos:</span>
                <span className="font-mono font-semibold text-ink">{result.pruned}</span>
              </div>
            )}
            {result.restored > 0 && (
              <div className="flex justify-between py-1.5 border-t border-line/60">
                <span className="text-muted">Restored completed photos:</span>
                <span className="font-mono font-semibold text-emerald-700">{result.restored}</span>
              </div>
            )}
          </div>

          {/* Amber notice if missingCompleted > 0 */}
          {result.missingCompleted > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="size-4.5 shrink-0 text-amber-600 mt-0.5" />
                <p className="leading-relaxed font-medium">
                  Note: {result.missingCompleted} completed photos were not found on disk.
                  Annotations are safely preserved in the database.
                </p>
              </div>
            </div>
          ) : result.newlyAdded === 0 && result.pruned === 0 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                <span>Database is up to date with project folder. 0 changes required.</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-line pt-3">
          <button
            type="button"
            onClick={onClose}
            className="press inline-flex h-9 items-center justify-center rounded-sm border border-line bg-surface px-4 text-xs font-semibold text-ink hover:bg-surface-raised"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
