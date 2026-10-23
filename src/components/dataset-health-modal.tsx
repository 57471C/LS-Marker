import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Image as ImageIcon,
  Layers,
  X,
} from "lucide-react";
import type { ProjectHealthResult } from "@/lib/label-client";

type DatasetHealthModalProps = {
  health: ProjectHealthResult;
  onClose: () => void;
};

export function DatasetHealthModal({ health, onClose }: DatasetHealthModalProps) {
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
        aria-labelledby="health-dialog-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-xl border border-line bg-bg p-6 text-ink shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-700">
              <BarChart3 className="size-5" aria-hidden="true" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h2
                id="health-dialog-title"
                className="text-base font-semibold tracking-tight text-ink"
              >
                Dataset Health: {health.projectName}
              </h2>
              <p className="font-mono text-xs text-muted">
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
            className="press inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable content body */}
        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          {/* Header Metric Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Annotated Progress</span>
                <ImageIcon className="size-3.5 text-muted" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-xl font-bold text-ink">
                  {summary.completedImages}
                </span>
                <span className="font-mono text-xs text-muted">
                  / {summary.totalImages} ({completedPct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-cyan-600 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, completedPct))}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Total Annotations</span>
                <Layers className="size-3.5 text-muted" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-xl font-bold text-ink">{summary.totalBoxes}</span>
                <span className="text-xs text-muted">boxes drawn</span>
              </div>
              <p className="text-[11px] text-muted">
                {summary.completedImages > 0
                  ? (summary.totalBoxes / summary.completedImages).toFixed(1)
                  : "0"}{" "}
                boxes/completed photo
              </p>
            </div>

            <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Negative Samples</span>
                <CheckCircle2 className="size-3.5 text-emerald-600" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-xl font-bold text-ink">{summary.cleanImages}</span>
                <span className="font-mono text-xs text-muted">clean photos ({cleanPct}%)</span>
              </div>
              <p className="text-[11px] text-muted">0 bounding boxes (clean bench)</p>
            </div>
          </div>

          {/* Lead Insight Alert */}
          {hasIssues ? (
            <div
              className={`rounded-lg border p-3.5 ${
                missingClasses.length > 0
                  ? "border-red-200 bg-red-50 text-red-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              <div className="flex items-start gap-2.5">
                {missingClasses.length > 0 ? (
                  <AlertCircle className="size-4.5 shrink-0 text-red-600 mt-0.5" />
                ) : (
                  <AlertTriangle className="size-4.5 shrink-0 text-amber-600 mt-0.5" />
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
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-emerald-900">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600" />
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
            <div className="rounded-lg border border-line bg-surface p-3.5 text-muted text-xs">
              No classes registered for this project.
            </div>
          )}

          {/* Separate Part Dimensions Warning (does not block All Classes Healthy) */}
          {missingDimCount > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-amber-900">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 size-4.5 shrink-0 text-amber-600" />
                <div className="flex flex-col gap-0.5 text-xs">
                  <span className="font-semibold uppercase tracking-wide">
                    {missingDimCount} {missingDimCount === 1 ? "class" : "classes"} missing
                    dimensions
                  </span>
                  <p className="leading-relaxed text-amber-800">
                    Part type is assigned but one or more expected measurement values (mm) are
                    blank:{" "}
                    <span className="font-medium">
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
              <span className="font-semibold uppercase tracking-wider text-muted">
                Class Breakdown ({classes.length} registered)
              </span>
              <span className="font-mono text-muted">Target: &ge;15 samples/class</span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-surface-raised/50 font-semibold uppercase tracking-wider text-muted">
                    <th className="px-3 py-2.5">IC Code (Class)</th>
                    <th className="px-3 py-2.5 font-mono text-right">Box Count</th>
                    <th className="px-3 py-2.5">Distribution (%)</th>
                    <th className="px-3 py-2.5 text-center">Dimensions</th>
                    <th className="px-3 py-2.5 text-center">Health Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line font-mono">
                  {classes.map((cls) => {
                    return (
                      <tr key={cls.id} className="hover:bg-surface-raised/40 transition-colors">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: cls.color || "#0e7490" }}
                            />
                            <div className="flex flex-col">
                              <span className="font-bold text-ink">{cls.name}</span>
                              {cls.description ? (
                                <span className="font-sans text-[11px] text-muted">
                                  {cls.description}
                                </span>
                              ) : null}
                            </div>
                            <span className="ml-auto rounded bg-ink/5 px-1 py-0.5 text-[10px] text-muted">
                              #{cls.id}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-ink">{cls.count}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="h-1.5 w-full flex-1 overflow-hidden rounded-full bg-line">
                              <div
                                className="h-full rounded-full bg-cyan-600"
                                style={{
                                  width: `${Math.min(100, Math.max(0, cls.percentage))}%`,
                                }}
                              />
                            </div>
                            <span className="w-10 text-right text-[11px] text-muted">
                              {cls.percentage.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {cls.dimensionsStatus === "complete" ? (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              Complete
                            </span>
                          ) : cls.dimensionsStatus === "missing" ? (
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              Missing
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {cls.status === "healthy" ? (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              Healthy ({cls.count})
                            </span>
                          ) : cls.status === "low" ? (
                            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              Low ({cls.count})
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                              Missing (0)
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {classes.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-muted font-sans">
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
