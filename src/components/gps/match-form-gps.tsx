"use client";

/**
 * The optional GPS step while logging a new match. The import is prepared in
 * the wizard and held here; it's attached only after the match itself has
 * been saved, and a failure never blocks or changes the saved match.
 */

import { useState } from "react";
import { MapPinned, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { GpsBackend } from "@/lib/gps/backend";
import { saveTracking } from "@/lib/gps/service";
import type { MatchFormat, Position } from "@/lib/domain";
import type { Match } from "@/lib/schema";
import { GpsImportWizard } from "@/components/gps/import-wizard";
import { QualityBadge } from "@/components/gps/metrics";
import { formatDay, formatMetric } from "@/components/gps/format";
import type { MatchGps } from "@/components/gps/match-gps";
import type { PendingGpsAttachment } from "@/components/gps/wizard-state";

export async function attachPendingGps(backend: GpsBackend | null, matchId: string, pending: PendingGpsAttachment) {
  if (!backend) {
    toast.error("Match saved, but the GPS data wasn't attached", { description: "Open the match and import the file again." });
    return;
  }
  try {
    await saveTracking(backend, { matchId, pending: pending.pending, result: pending.result, calibrationId: pending.calibrationId });
    toast.success("GPS data attached", { description: "Your match stats and progression are unchanged." });
  } catch (error) {
    toast.error("Match saved, but the GPS data couldn't be attached", {
      description: `${error instanceof Error ? error.message : "Something went wrong."} Open the match to import it again.`,
    });
  }
}

export function MatchFormGps({
  format,
  date,
  position,
  value,
  onChange,
}: {
  format: MatchFormat;
  date: string;
  position: Position;
  value: PendingGpsAttachment | null;
  onChange: (value: PendingGpsAttachment | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);

  function start() {
    setKey((current) => current + 1);
    setOpen(true);
  }

  return (
    <div>
      {value ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <MapPinned className="size-4 text-primary" aria-hidden />
              <span className="truncate">{value.pending.fileName ?? "GPS file"}</span>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <QualityBadge level={value.result.quality.level} />
              <span>{formatMetric(value.result.metrics.playingTime)} playing</span>
              <span>· {formatMetric(value.result.metrics.distance)}</span>
              <span>· attached when you save</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={start}>
              Change
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)} aria-label="Remove the GPS file from this match" data-icon="inline-start">
              <Trash2 /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            Add a GPX, TCX or FIT file from your watch or phone for a GPS heatmap and match metrics. It never changes your XP or attributes, and
            it’s only saved when you save the match.
          </p>
          <Button type="button" variant="secondary" onClick={start} data-icon="inline-start">
            <Upload /> Add GPS file
          </Button>
        </>
      )}
      {open ? (
        <GpsImportWizard key={key} open onOpenChange={setOpen} target={{ kind: "new", format, date, position }} onPending={onChange} />
      ) : null}
    </div>
  );
}

/**
 * GPS while editing a saved match. Importing saves straight away (the match
 * already exists), separately from the rest of the form.
 */
export function EditFormGps({ match, gps }: { match: Match; gps: MatchGps }) {
  const [wizardKey, setWizardKey] = useState<number | null>(null);
  const { track } = gps;
  if (match.isSample) {
    return <p className="text-sm text-muted-foreground">Demo matches can&apos;t hold GPS data. Start your own career to import a GPS file.</p>;
  }
  return (
    <div>
      {gps.loading ? (
        <div className="skeleton h-16 rounded-lg" aria-label="Loading GPS data" />
      ) : gps.error ? (
        <p role="alert" className="text-sm text-destructive">
          {gps.error}
        </p>
      ) : track ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <MapPinned className="size-4 text-primary" aria-hidden /> GPS file attached
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <QualityBadge level={track.quality} />
              <span>{formatMetric(track.summary.metrics.playingTime)} playing</span>
              <span>· {formatMetric(track.summary.metrics.distance)}</span>
              <span>· imported {formatDay(track.createdAt)}</span>
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => setWizardKey(Date.now())} disabled={!gps.backend} data-icon="inline-start">
            <RefreshCw /> Replace file
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            Add a GPX, TCX or FIT file from your watch or phone. It&apos;s saved to the match straight away and never changes your XP or attributes.
          </p>
          <Button type="button" variant="secondary" onClick={() => setWizardKey(Date.now())} disabled={!gps.backend} data-icon="inline-start">
            <Upload /> Add GPS file
          </Button>
        </>
      )}
      {wizardKey !== null ? (
        <GpsImportWizard
          key={wizardKey}
          open
          onOpenChange={(open) => !open && setWizardKey(null)}
          target={{ kind: "existing", match, hasTrack: Boolean(track) }}
          onAttached={gps.reload}
        />
      ) : null}
    </div>
  );
}
