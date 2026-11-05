import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Copy,
  Image as ImageIcon,
  Layers,
  Trash2,
  X,
} from "lucide-react";
import type { ProjectHealthResult } from "@/lib/label-client";

type DatasetHealthModalProps = {
  health: ProjectHealthResult;
  onClose: () => void;
  onOpenDuplicates?: () => void;
};

export function DatasetHealthModal({ health, onClose, onOpenDuplicates }: DatasetHealthModalProps) {
  const { summary, classes } = health;

  const missingClasses = classes.filter((c) => c.status === "missing");
  const lowClasses = classes.filter((c) => c.status === "low");
  const hasIssues = missingClasses.length > 0 || lowClasses.length > 0;

  const missingDimClasses = classes.filter((c) => c.dimensionsStatus === "missing");
  const missingDimCount = summary.missingDimensionsCount ?? missingDimClasses.length;
  const completeDimCount = classes.filter((c) => c.dimensionsStatus === "complete").length;

  const completedPct =
    summary.totalImages > 0 ? Math.round((summary.completedImages / summary.totalImages) * 100) : 0;

  const cleanPct =
    summary.completedImages > 0
      ? Math.round((summary.cleanImages / summary.completedImages) * 100)
      : 0;

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
        aria-labelledby="health-dialog-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-[2px] border border-[#c8c8c8] bg-white p-5 text-[#282828] shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#c8c8c8] pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-[2px] border border-cyan-200 bg-cyan-50 text-cyan-700">
              <BarChart3 className="size-4" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h2
                id="health-dialog-title"
                className="text-sm font-semibold tracking-tight text-[#282828]"
              >
                Dataset Health: {health.projectName}
              </h2>
              <p className="font-mono text-xs text-[#6e6e6e]">
                Class balance &amp; annotation distribution audit
                {" · "}
                {missingDimCount > 0 ? (
                  <span className="font-semibold text-amber-700">
                    {missingDimCount} {missingDimCount === 1 ? "class" : "classes"} missing
                    dimensions
                  </span>
                ) : completeDimCount > 0 ? (
                  <span className="text-emerald-700">0 classes missing dimensions</span>
                ) : (
                  <span>No part dimensions configured</span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="inline-flex size-7 items-center justify-center rounded-[2px] text-[#6e6e6e] hover:bg-[#e0e0e0] hover:text-[#282828]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable content body */}
        <div className="flex flex-col gap-3.5 overflow-y-auto pr-1">
          {/* Header Metric Cards */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="flex flex-col gap-1 rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-2.5">
              <div className="flex items-center justify-between text-xs text-[#6e6e6e]">
                <span>Annotated Progress</span>
                <ImageIcon className="size-3.5 text-[#6e6e6e]" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-lg font-bold text-[#282828]">
                  {summary.completedImages}
                </span>
                <span className="font-mono text-xs text-[#6e6e6e]">
                  / {summary.totalImages} ({completedPct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-[2px] bg-[#e0e0e0]">
                <div
                  className="h-full bg-[#1473e6] transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, completedPct))}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-2.5">
              <div className="flex items-center justify-between text-xs text-[#6e6e6e]">
                <span>Total Annotations</span>
                <Layers className="size-3.5 text-[#6e6e6e]" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-lg font-bold text-[#282828]">
                  {summary.totalBoxes}
                </span>
                <span className="text-xs text-[#6e6e6e]">boxes drawn</span>
              </div>
              <p className="text-[11px] text-[#6e6e6e]">
                {summary.completedImages > 0
                  ? (summary.totalBoxes / summary.completedImages).toFixed(1)
                  : "0"}{" "}
                boxes/completed photo
              </p>
            </div>

            <div className="flex flex-col gap-1 rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-2.5">
              <div className="flex items-center justify-between text-xs text-[#6e6e6e]">
                <span>Negative Samples</span>
                <CheckCircle2 className="size-3.5 text-emerald-600" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-lg font-bold text-[#282828]">
                  {summary.cleanImages}
                </span>
                <span className="font-mono text-xs text-[#6e6e6e]">clean photos ({cleanPct}%)</span>
              </div>
              <p className="text-[11px] text-[#6e6e6e]">0 bounding boxes (clean bench)</p>
            </div>
          </div>

          {/* Lead Insight Alert */}
          {hasIssues ? (
            <div
              className={`rounded-[2px] border p-3 ${
                missingClasses.length > 0
                  ? "border-red-300 bg-red-50 text-red-900"
                  : "border-amber-300 bg-amber-50 text-amber-900"
              }`}
            >
              <div className="flex items-start gap-2.5">
                {missingClasses.length > 0 ? (
                  <AlertCircle className="size-4 shrink-0 text-red-600 mt-0.5" />
                ) : (
                  <AlertTriangle className="size-4 shrink-0 text-amber-600 mt-0.5" />
                )}
                <div className="flex flex-col gap-1 text-xs">
                  <span className="font-semibold tracking-wide uppercase">
                    Lead Insight: Class Imbalance Warning
                  </span>
                  <p className="leading-relaxed">
                    Models trained with &lt;15 samples of an IC code will struggle to generalize and
                    converge.
                    {missingClasses.length > 0 && (
                      <span className="block mt-0.5 font-medium text-red-700">
                        Missing (0 samples): {missingClasses.map((c) => c.name).join(", ")}.
                      </span>
                    )}
                    {lowClasses.length > 0 && (
                      <span className="block mt-0.5 font-medium text-amber-700">
                        Low (&lt;15 samples):{" "}
                        {lowClasses.map((c) => `${c.name} (${c.count})`).join(", ")}.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          ) : classes.length > 0 ? (
            <div className="rounded-[2px] border border-emerald-300 bg-emerald-50 p-3 text-emerald-900">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                <div className="flex flex-col gap-0.5 text-xs">
                  <span className="font-semibold tracking-wide uppercase">All Classes Healthy</span>
                  <p className="leading-relaxed text-emerald-800">
                    All {classes.length} classes have 15 or more bounding boxes. Dataset
                    distribution is ready for training.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[2px] border border-[#c8c8c8] bg-[#f9f9f9] p-3 text-[#6e6e6e] text-xs">
              No classes registered for this project.
            </div>
          )}

          {/* Duplicate Files Warning */}
          {health.duplicates && health.duplicates.totalDuplicates > 0 ? (
            <div className="flex items-start justify-between gap-3 rounded-[2px] border border-amber-300 bg-amber-50 p-3 text-xs text-[#282828]">
              <div className="flex items-start gap-2.5">
                <Copy className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold uppercase tracking-wide text-amber-900">
                    {health.duplicates.totalDuplicates} Duplicate Image(s) Detected
                  </span>
                  <p className="leading-relaxed text-[#444]">
                    Found {health.duplicates.totalDuplicates} exact duplicate file(s) across{" "}
                    {health.duplicates.duplicateSets} set(s)
                    {health.duplicates.totalTxtFiles > 0
                      ? ` (and ${health.duplicates.totalTxtFiles} associated .txt file${
                          health.duplicates.totalTxtFiles > 1 ? "s" : ""
                        })`
                      : ""}
                    . Exact SHA-256 byte matches. Remove them?
                  </p>
                </div>
              </div>
              {onOpenDuplicates ? (
                <button
                  type="button"
                  onClick={onOpenDuplicates}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-[2px] bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  <span>Clean Up</span>
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Separate Part Dimensions Warning (does not block All Classes Healthy) */}
          {missingDimCount > 0 && (
            <div className="rounded-[2px] border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="flex flex-col gap-0.5 text-xs">
                  <span className="font-semibold uppercase tracking-wide">
                    {missingDimCount} {missingDimCount === 1 ? "class" : "classes"} missing
                    dimensions
                  </span>
                  <p className="leading-relaxed text-[#444]">
                    Part type is assigned but one or more expected measurement values (mm) are
                    blank:{" "}
                    <span className="font-medium text-[#282828]">
                      {missingDimClasses.map((c) => c.name).join(", ")}
                    </span>
                    . Reference metadata only — training exports remain unaffected.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Class Breakdown Table */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold uppercase tracking-wider text-[#6e6e6e]">
                Class Breakdown ({classes.length} registered)
              </span>
              <span className="font-mono text-[#6e6e6e]">Target: &ge;15 samples/class</span>
            </div>

            <div className="overflow-x-auto rounded-[2px] border border-[#c8c8c8] bg-white">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#c8c8c8] bg-[#f0f0f0] font-semibold uppercase tracking-wider text-[#6e6e6e]">
                    <th className="px-3 py-2">IC Code (Class)</th>
                    <th className="px-3 py-2 font-mono text-right">Box Count</th>
                    <th className="px-3 py-2">Distribution (%)</th>
                    <th className="px-3 py-2 text-center">Dimensions</th>
                    <th className="px-3 py-2 text-center">Health Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e0e0e0] font-mono">
                  {classes.map((cls) => {
                    return (
                      <tr key={cls.id} className="hover:bg-[#f5f5f5] transition-colors">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="size-2.5 shrink-0 rounded-[2px]"
                              style={{ backgroundColor: cls.color || "#0e7490" }}
                            />
                            <div className="flex flex-col">
                              <span className="font-bold text-[#282828]">{cls.name}</span>
                              {cls.description ? (
                                <span className="font-sans text-[11px] text-[#6e6e6e]">
                                  {cls.description}
                                </span>
                              ) : null}
                            </div>
                            <span className="ml-auto rounded-[2px] bg-[#e0e0e0] px-1 py-0.5 text-[10px] text-[#6e6e6e]">
                              #{cls.id}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-[#282828]">
                          {cls.count}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="h-1.5 w-full flex-1 overflow-hidden rounded-[2px] bg-[#e0e0e0]">
                              <div
                                className="h-full bg-[#1473e6]"
                                style={{
                                  width: `${Math.min(100, Math.max(0, cls.percentage))}%`,
                                }}
                              />
                            </div>
                            <span className="w-10 text-right text-[11px] text-[#6e6e6e]">
                              {cls.percentage.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {cls.dimensionsStatus === "complete" ? (
                            <span className="inline-flex items-center rounded-[2px] border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              Complete
                            </span>
                          ) : cls.dimensionsStatus === "missing" ? (
                            <span className="inline-flex items-center rounded-[2px] border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              Missing
                            </span>
                          ) : (
                            <span className="text-[#6e6e6e]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {cls.status === "healthy" ? (
                            <span className="inline-flex items-center rounded-[2px] border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              Healthy ({cls.count})
                            </span>
                          ) : cls.status === "low" ? (
                            <span className="inline-flex items-center rounded-[2px] border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              Low ({cls.count})
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-[2px] border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                              Missing (0)
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {classes.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-[#6e6e6e] font-sans">
                        No classes found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
