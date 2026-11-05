import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Image as ImageIcon,
  PlusCircle,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { SyncImagesResult } from "@/lib/label-client";

type RescanModalProps = {
  result: SyncImagesResult;
  onClose: () => void;
  onOpenDuplicates?: () => void;
};

export function RescanModal({ result, onClose, onOpenDuplicates }: RescanModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
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
        className="flex w-full max-w-md flex-col gap-4 rounded-[2px] border border-[#c8c8c8] bg-white p-5 text-[#282828] shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#c8c8c8] pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[2px] border border-blue-200 bg-blue-50 text-[#1473e6]">
              <RefreshCw className="size-4" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h2
                id="rescan-dialog-title"
                className="text-sm font-semibold tracking-tight text-[#282828]"
              >
                Rescan Complete: {result.projectName}
              </h2>
              <p className="font-mono text-xs text-[#6e6e6e]">
                Disk sync &amp; image database audit
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close rescan modal"
            className="inline-flex size-7 items-center justify-center rounded-[2px] text-[#6e6e6e] hover:bg-[#e0e0e0] hover:text-[#282828]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content body */}
        <div className="flex flex-col gap-3">
          {/* Metrics summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1 rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-2.5">
              <span className="text-[11px] font-medium text-[#6e6e6e]">New Added</span>
              <div className="flex items-center gap-1.5">
                <PlusCircle className="size-3.5 text-[#1473e6]" aria-hidden="true" />
                <span className="font-mono text-lg font-bold text-[#282828]">
                  {result.newlyAdded}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-2.5">
              <span className="text-[11px] font-medium text-[#6e6e6e]">Total Active</span>
              <div className="flex items-center gap-1.5">
                <ImageIcon className="size-3.5 text-[#6e6e6e]" aria-hidden="true" />
                <span className="font-mono text-lg font-bold text-[#282828]">
                  {result.totalInProject}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-2.5">
              <span className="text-[11px] font-medium text-[#6e6e6e]">Missing Flagged</span>
              <div className="flex items-center gap-1.5">
                <AlertTriangle
                  className={`size-3.5 ${result.missingCompleted > 0 ? "text-amber-600" : "text-[#6e6e6e]"}`}
                  aria-hidden="true"
                />
                <span
                  className={`font-mono text-lg font-bold ${
                    result.missingCompleted > 0 ? "text-amber-700" : "text-[#282828]"
                  }`}
                >
                  {result.missingCompleted}
                </span>
              </div>
            </div>
          </div>

          {/* Breakdown items list */}
          <div className="rounded-[2px] border border-[#c8c8c8] bg-white px-3 py-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-[#e0e0e0]">
              <span className="text-[#6e6e6e]">New photos added:</span>
              <span className="font-mono font-semibold text-[#282828]">{result.newlyAdded}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#e0e0e0]">
              <span className="text-[#6e6e6e]">Total active photos:</span>
              <span className="font-mono font-semibold text-[#282828]">
                {result.totalInProject}
              </span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[#6e6e6e]">Missing files flagged:</span>
              <span
                className={`font-mono font-semibold ${
                  result.missingCompleted > 0 ? "text-amber-700" : "text-[#282828]"
                }`}
              >
                {result.missingCompleted}
              </span>
            </div>
            {result.pruned > 0 && (
              <div className="flex justify-between py-1.5 border-t border-[#e0e0e0]">
                <span className="text-[#6e6e6e]">Removed unlabeled photos:</span>
                <span className="font-mono font-semibold text-[#282828]">{result.pruned}</span>
              </div>
            )}
            {result.restored > 0 && (
              <div className="flex justify-between py-1.5 border-t border-[#e0e0e0]">
                <span className="text-[#6e6e6e]">Restored completed photos:</span>
                <span className="font-mono font-semibold text-emerald-700">{result.restored}</span>
              </div>
            )}
          </div>

          {/* Duplicate Files Warning */}
          {result.duplicates && result.duplicates.totalDuplicates > 0 ? (
            <div className="flex items-start justify-between gap-3 rounded-[2px] border border-amber-300 bg-amber-50 p-3 text-xs text-[#282828]">
              <div className="flex items-start gap-2.5">
                <Copy className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-amber-900">
                    Found {result.duplicates.totalDuplicates} duplicate image(s)
                    {result.duplicates.totalTxtFiles > 0
                      ? ` (and ${result.duplicates.totalTxtFiles} .txt files)`
                      : ""}
                    .
                  </span>
                  <p className="text-[11px] text-[#444]">
                    Exact SHA-256 byte matches detected. Remove extras?
                  </p>
                </div>
              </div>
              {onOpenDuplicates ? (
                <button
                  type="button"
                  onClick={onOpenDuplicates}
                  className="inline-flex shrink-0 items-center gap-1 rounded-[2px] bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                  <span>Clean Up</span>
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Amber notice if missingCompleted > 0 */}
          {result.missingCompleted > 0 ? (
            <div className="rounded-[2px] border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" />
                <p className="leading-relaxed font-medium">
                  Note: {result.missingCompleted} completed photos were not found on disk.
                  Annotations are safely preserved in the database.
                </p>
              </div>
            </div>
          ) : result.newlyAdded === 0 && result.pruned === 0 ? (
            <div className="rounded-[2px] border border-emerald-300 bg-emerald-50 p-2.5 text-xs text-emerald-900">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                <span>Database is up to date with project folder. 0 changes required.</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-[#c8c8c8] pt-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center justify-center rounded-[2px] border border-[#c8c8c8] bg-white px-3 text-xs font-semibold text-[#282828] hover:bg-[#e0e0e0]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
