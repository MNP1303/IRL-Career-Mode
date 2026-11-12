"use client";

import { useState } from "react";
import { CircleSlash, Loader2 } from "lucide-react";
import type { TrackingResult } from "@/lib/gps/pipeline";
import { ZoneShareBars } from "@/components/gps/zone-shares";
import { GpsHeatLegend, GpsPitch, PlacementLegend } from "@/components/gps/gps-pitch";
import { ExclusionList, MetricList, QualityPanel } from "@/components/gps/metrics";
import { formatClock, formatDuration } from "@/components/gps/format";

export function HeatmapStep({ result, processing, error, manualHref }: { result: TrackingResult | null; processing: boolean; error: string | null; manualHref?: string }) {
  const [showPoints, setShowPoints] = useState(false);
  if (!result) {
    return (
      <div className="grid min-h-60 place-items-center text-sm text-muted-foreground" role="status">
        {processing ? (
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Building the heatmap…
          </span>
        ) : (
          (error ?? "Go back and finish the earlier steps.")
        )}
      </div>
    );
  }
  const insufficient = result.quality.level === "insufficient";
  return (
    <div className="space-y-6">
      <QualityPanel quality={result.quality} />
      {insufficient ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/8 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-destructive">
            <CircleSlash className="size-4" aria-hidden /> No heatmap for this recording
          </p>
          <p className="mt-1">
            The reasons are listed above. Try adjusting your playing intervals or the pitch corners. Or{" "}
            {manualHref ? (
              <a href={manualHref} className="text-primary underline-offset-4 hover:underline">
                paint your zones by hand
              </a>
            ) : (
              "paint your zones by hand in the match form"
            )}{" "}
            instead.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <GpsPitch
              grid={result.grid}
              pitch={result.pitch}
              points={showPoints ? result.preview : undefined}
              label={`GPS heatmap: time spent across a ${result.pitch.length} by ${result.pitch.width} metre pitch. Quality: ${result.quality.level}.`}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <GpsHeatLegend />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" className="size-4 accent-[#c8ff00]" checked={showPoints} onChange={(event) => setShowPoints(event.target.checked)} />
                Show recorded positions
              </label>
            </div>
            {showPoints ? (
              <div className="mt-2">
                <PlacementLegend />
              </div>
            ) : null}
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <ZoneShareBars title="Pitch thirds (time)" items={result.zones.thirds} />
              <ZoneShareBars title="Channels (time)" items={result.zones.channels} />
            </div>
          </div>
          <div className="space-y-5">
            <section>
              <h3 className="eyebrow mb-1">Metrics</h3>
              <MetricList metrics={result.metrics} />
            </section>
          </div>
        </div>
      )}
      <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
        <ExclusionList excluded={result.counts.excluded} outsideIntervals={result.counts.outsideIntervals} />
        <div>
          <h3 className="eyebrow mb-2">Playing intervals</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {result.intervals.map((interval, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span>
                  {formatClock(interval.start)} – {formatClock(interval.end)}
                  {interval.switchedEnds ? " · ends switched" : ""}
                </span>
                <span className="tabular-nums text-foreground">{formatDuration(interval.end - interval.start)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {result.counts.inBounds.toLocaleString("en-GB")} positions on the pitch, {result.counts.nearLines.toLocaleString("en-GB")} just outside the lines
            (counted where recorded). Algorithm v{result.algorithmVersion}.
          </p>
        </div>
      </div>
    </div>
  );
}
