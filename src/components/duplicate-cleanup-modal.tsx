import { useState } from "react";
import { AlertTriangle, CheckCircle, Copy, FileText, Loader2, Trash2, X } from "lucide-react";
import {
  cleanupProjectDuplicates,
  type DuplicateCleanupResult,
  type DuplicateDetectionResult,
} from "@/lib/label-client";

type DuplicateCleanupModalProps = {
  isOpen: boolean;
  projectId?: number;
  projectName?: string;
  duplicates: DuplicateDetectionResult;
  onClose: () => void;
  onCleanupComplete: (result: DuplicateCleanupResult) => void;
};

export function DuplicateCleanupModal({
  isOpen,
  projectId,
  projectName,
  duplicates,
  onClose,
  onCleanupComplete,
}: DuplicateCleanupModalProps) {
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DuplicateCleanupResult | null>(null);

  if (!isOpen) return null;

  async function handleConfirmCleanup() {
    setCleaning(true);
    setError(null);
    try {
      const res = await cleanupProjectDuplicates(projectId);
      setResult(res);
      onCleanupComplete(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Cleanup failed");
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-[2px] border border-[#c8c8c8] bg-white text-[#282828] shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#c8c8c8] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[2px] border border-amber-200 bg-amber-50 text-amber-700">
              <Copy className="size-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="duplicate-modal-title" className="text-sm font-semibold text-[#282828]">
                Duplicate Images Detected
              </h2>
              {projectName ? (
                <p className="text-xs text-[#6e6e6e]">Project: {projectName}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={cleaning}
            className="inline-flex size-7 items-center justify-center rounded-[2px] text-[#6e6e6e] hover:bg-[#e0e0e0] hover:text-[#282828] disabled:opacity-40"
            aria-label="Close dialog"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3.5 text-xs">
          {error ? (
            <div
              className="mb-3.5 flex items-center gap-2 rounded-[2px] border border-red-300 bg-red-50 p-2.5 text-red-700"
              role="alert"
            >
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          {result ? (
            /* Result Log Step */
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center gap-3 rounded-[2px] border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
                <CheckCircle className="size-4.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-xs text-emerald-800">{result.message}</p>
                  <p className="text-[11px] text-[#444]">
                    Database and project records have been synchronized.
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 font-semibold text-[#282828]">Removal Activity Log:</p>
                <div className="max-h-64 overflow-y-auto rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-2.5 font-mono text-[11px]">
                  {result.removed.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {result.removed.map((item) => (
                        <li
                          key={item.relPath}
                          className="flex flex-col gap-0.5 border-b border-[#e0e0e0] pb-1.5 last:border-0 last:pb-0"
                        >
                          <div className="flex items-center gap-1.5 text-red-700">
                            <Trash2 className="size-3 shrink-0" aria-hidden="true" />
                            <span className="font-semibold">{item.relPath}</span>
                            {item.hasTxt ? (
                              <span className="rounded-[2px] bg-red-100 px-1 py-0.2 text-[10px] text-red-800">
                                + label .txt
                              </span>
                            ) : null}
                          </div>
                          <p className="text-[10px] text-[#6e6e6e]">
                            Kept original: <span className="text-[#282828]">{item.kept}</span> (SHA:{" "}
                            {item.hash.slice(0, 10)}…)
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[#6e6e6e]">No files were removed.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Confirmation Step */
            <div className="flex flex-col gap-3.5">
              <div className="flex items-start gap-3 rounded-[2px] border border-amber-300 bg-amber-50 p-3 text-[#282828]">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-amber-600"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-semibold text-amber-800">
                    Found {duplicates.totalDuplicates} duplicate image(s)
                    {duplicates.totalTxtFiles > 0
                      ? ` (and ${duplicates.totalTxtFiles} associated .txt file${
                          duplicates.totalTxtFiles > 1 ? "s" : ""
                        })`
                      : ""}
                    . Remove them?
                  </p>
                  <p className="mt-1 text-[11px] text-[#444] leading-relaxed">
                    Identified by exact SHA-256 byte hash. For each duplicate set, one image is
                    safely preserved (prioritizing approved, completed, and annotated photos). Extra
                    duplicate copies and their corresponding .txt label files will be permanently
                    deleted.
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 font-semibold text-[#282828]">
                  Duplicate Sets Breakdown ({duplicates.groups.length} sets):
                </p>
                <div className="flex max-h-72 flex-col gap-2.5 overflow-y-auto pr-1">
                  {duplicates.groups.map((group, groupIdx) => (
                    <div
                      key={group.hash}
                      className="rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-2.5"
                    >
                      <div className="mb-2 flex items-center justify-between border-b border-[#e0e0e0] pb-1 text-[11px]">
                        <span className="font-mono text-[#6e6e6e]">
                          Set #{groupIdx + 1} &bull; SHA-256: {group.hash.slice(0, 12)}…
                        </span>
                        <span className="font-semibold text-[#282828]">
                          {group.extras.length + 1} identical files
                        </span>
                      </div>

                      {/* Kept File */}
                      <div className="mb-2 flex items-center justify-between rounded-[2px] border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-950">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="rounded-[2px] bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase">
                            Kept
                          </span>
                          <span className="truncate font-mono text-[11px] font-medium text-[#282828]">
                            {group.kept.relPath}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[10px] text-emerald-800">
                          <span className="capitalize">{group.kept.status}</span>
                          {group.kept.boxesCount > 0 ? (
                            <span>&bull; {group.kept.boxesCount} boxes</span>
                          ) : null}
                        </div>
                      </div>

                      {/* Extras to remove */}
                      <div className="flex flex-col gap-1 pl-2">
                        {group.extras.map((extra) => (
                          <div
                            key={extra.relPath}
                            className="flex items-center justify-between text-[11px] text-[#6e6e6e]"
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="rounded-[2px] border border-red-200 bg-red-50 px-1 py-0.2 text-[9px] font-semibold text-red-700 uppercase">
                                Remove
                              </span>
                              <span className="truncate font-mono text-red-900">
                                {extra.relPath}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
                              {extra.hasTxt ? (
                                <span className="flex items-center gap-0.5 text-[#6e6e6e]">
                                  <FileText className="size-3" aria-hidden="true" />
                                  .txt
                                </span>
                              ) : null}
                              <span className="capitalize">{extra.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#c8c8c8] px-4 py-3">
          {result ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center justify-center rounded-[2px] bg-[#1473e6] px-3.5 text-xs font-semibold text-white hover:bg-[#0d62c9]"
            >
              Close &amp; Refresh
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={cleaning}
                className="inline-flex h-8 items-center justify-center rounded-[2px] border border-[#c8c8c8] bg-white px-3 text-xs font-semibold text-[#282828] hover:bg-[#e0e0e0] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCleanup()}
                disabled={cleaning}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[2px] bg-red-600 px-3.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
              >
                {cleaning ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    <span>Removing…</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    <span>Remove {duplicates.totalDuplicates} Duplicates</span>
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
