"use client";

import { Lock, ShieldCheck } from "lucide-react";
import type { GpsBackend } from "@/lib/gps/backend";
import type { TrackingResult } from "@/lib/gps/pipeline";
import { formatDate } from "@/lib/stats";
import { storageDescription } from "@/components/gps/use-gps-backend";
import { QualityBadge } from "@/components/gps/metrics";
import { formatMetric } from "@/components/gps/format";
import type { WizardTarget } from "@/components/gps/wizard-state";

export function AttachStep({ target, result, backend, fileName }: { target: WizardTarget; result: TrackingResult; backend: GpsBackend | null; fileName: string | null }) {
  const replacing = target.kind === "existing" && target.hasTrack;
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-surface p-4">
        <p className="eyebrow">{target.kind === "existing" ? "Attach to" : "Add to the match you're logging"}</p>
        <p className="mt-1 text-base font-semibold">
          {target.kind === "existing"
            ? `${formatDate(target.match.date)} · ${target.match.format}${target.match.opponent ? ` vs ${target.match.opponent}` : ""}`
            : `${formatDate(target.date)} · ${target.format}`}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <QualityBadge level={result.quality.level} />
          <span>{fileName ?? "GPS file"}</span>
          <span>· {formatMetric(result.metrics.playingTime)} playing</span>
          <span>· {formatMetric(result.metrics.distance)}</span>
        </div>
      </section>

      {replacing ? (
        <p role="status" className="rounded-lg border border-[#f5c542]/35 bg-[#f5c542]/6 p-3 text-sm">
          This match already has GPS data. Attaching replaces it. The previous file is deleted unless another match uses it.
        </p>
      ) : null}

      <ul className="space-y-2 text-sm">
        <li className="flex gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>
            Your goals, assists, rating, position, notes, painted zones, XP and attributes stay exactly as they are. GPS data never changes your
            rating or progression.
          </span>
        </li>
        <li className="flex gap-2">
          <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>
            {target.kind === "new"
              ? "Nothing is saved yet: the GPS data is attached when you save the match."
              : backend
                ? storageDescription(backend)
                : "Checking where your data is saved…"}
          </span>
        </li>
        <li className="flex gap-2">
          <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>Your manual heatmap is kept too. You can switch between the two on the match page, or remove the GPS import at any time.</span>
        </li>
      </ul>
    </div>
  );
}
