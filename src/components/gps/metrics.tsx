"use client";

import { AlertTriangle, CheckCircle2, CircleSlash, Info } from "lucide-react";
import type { MatchMetrics } from "@/lib/gps/metrics";
import { QUALITY_META, type QualityReport } from "@/lib/gps/quality";
import { EXCLUSION_LABELS, type ExclusionReason } from "@/lib/gps/screen";
import type { MetricValue } from "@/lib/gps/types";
import { formatMetric, PROVENANCE_LABEL } from "@/components/gps/format";
import { cn } from "@/lib/utils";

const METRIC_ROWS: { key: keyof MatchMetrics; label: string }[] = [
  { key: "playingTime", label: "Playing time" },
  { key: "trackedTime", label: "Tracked time" },
  { key: "distance", label: "Distance (calculated)" },
  { key: "deviceDistance", label: "Distance (device)" },
  { key: "averageSpeed", label: "Average speed" },
  { key: "topSpeed", label: "Top speed" },
  { key: "heartRateAverage", label: "Average heart rate" },
  { key: "heartRateMax", label: "Max heart rate" },
  { key: "sprints", label: "Sprints" },
];

function ProvenanceTag({ metric }: { metric: MetricValue }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-label font-semibold tracking-wide uppercase",
        metric.provenance === "device" && "bg-foreground/10 text-foreground",
        metric.provenance === "calculated" && "bg-primary/12 text-primary",
        metric.provenance === "approximate" && "bg-[#f5c542]/14 text-[#f5c542]",
        metric.provenance === "unavailable" && "bg-foreground/5 text-muted-foreground",
      )}
    >
      {PROVENANCE_LABEL[metric.provenance]}
    </span>
  );
}

/** Every metric with where it came from; notes are shown as text, not hidden in tooltips. */
export function MetricList({ metrics, compact }: { metrics: MatchMetrics; compact?: boolean }) {
  return (
    <dl className="divide-y divide-border">
      {METRIC_ROWS.map(({ key, label }) => {
        const metric = metrics[key];
        return (
          <div key={key} className="py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="flex items-center gap-2">
                <span className={cn("stat text-base font-semibold tabular-nums", metric.value === null && "text-muted-foreground")}>{formatMetric(metric)}</span>
                <ProvenanceTag metric={metric} />
              </dd>
            </div>
            {!compact && metric.note ? <p className="mt-1 text-xs text-muted-foreground">{metric.note}</p> : null}
          </div>
        );
      })}
    </dl>
  );
}

const QUALITY_ICON = { usable: CheckCircle2, approximate: AlertTriangle, insufficient: CircleSlash } as const;

/** Status is spelled out in words and an icon, never by colour alone. */
export function QualityBadge({ level, className }: { level: QualityReport["level"]; className?: string }) {
  const Icon = QUALITY_ICON[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        level === "usable" && "border-primary/30 text-primary",
        level === "approximate" && "border-[#f5c542]/35 text-[#f5c542]",
        level === "insufficient" && "border-destructive/40 text-destructive",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span>
        <span className="sr-only">GPS quality: </span>
        {QUALITY_META[level].label}
      </span>
    </span>
  );
}

export function QualityPanel({ quality }: { quality: QualityReport }) {
  return (
    <div className="space-y-3" role="status">
      <div className="flex flex-wrap items-center gap-3">
        <QualityBadge level={quality.level} />
        <span className="text-sm text-muted-foreground">{QUALITY_META[quality.level].description}</span>
      </div>
      {quality.reasons.length ? (
        <ul className="space-y-1.5 text-sm">
          {quality.reasons.map((reason) => (
            <li key={reason.message} className="flex gap-2">
              {reason.severity === "insufficient" ? (
                <CircleSlash className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Blocks the heatmap:" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#f5c542]" aria-label="Warning:" />
              )}
              <span>{reason.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        {quality.notes.map((note) => (
          <li key={note} className="flex gap-2">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExclusionList({ excluded, outsideIntervals }: { excluded: Partial<Record<string, number>>; outsideIntervals?: number }) {
  const entries = Object.entries(excluded).filter(([, count]) => count);
  return (
    <div>
      <h3 className="eyebrow mb-2">Left out</h3>
      {entries.length || outsideIntervals ? (
        <ul className="space-y-1 text-sm">
          {outsideIntervals ? (
            <li className="flex justify-between gap-3 text-muted-foreground">
              <span>Outside your playing intervals</span>
              <span className="tabular-nums text-foreground">{outsideIntervals}</span>
            </li>
          ) : null}
          {entries.map(([reason, count]) => (
            <li key={reason} className="flex justify-between gap-3 text-muted-foreground">
              <span>{EXCLUSION_LABELS[reason as ExclusionReason] ?? reason}</span>
              <span className="tabular-nums text-foreground">{count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing: every point in your playing intervals was used.</p>
      )}
    </div>
  );
}
