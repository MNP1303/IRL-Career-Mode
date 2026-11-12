"use client";

/**
 * GPS on the match page. Manual zones and GPS are separate sources: the
 * match keeps its painted zones untouched, the GPS track lives in its own
 * store, and the player chooses which heatmap the page shows.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPinned, MapPinOff, RefreshCw, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState, LinkButton, SectionTitle, Segmented } from "@/components/shared/primitives";
import { HeatLayer, HeatLegend, ZoneBreakdown } from "@/components/pitch/heat-layer";
import { AttackHint, Pitch, type PitchOrientation } from "@/components/pitch/pitch";
import { LazyPitch3D, prefersLiteRendering, preloadPitch3D, supportsWebGL } from "@/components/pitch/pitch-3d-lazy";
import type { GpsBackend, HeatmapSource, TrackRow } from "@/lib/gps/backend";
import { decodeHeatmap, type DrawableGrid } from "@/lib/gps/record";
import { cleanupOrphans, loadSourceFile, removeTracking } from "@/lib/gps/service";
import { ZONE_COLS, ZONE_ROWS } from "@/lib/domain";
import { gridFromCells } from "@/lib/heatmap";
import type { Match } from "@/lib/schema";
import { useCareer } from "@/lib/store";
import { useGpsBackend } from "@/components/gps/use-gps-backend";
import { GpsHeatLegend, GpsPitch } from "@/components/gps/gps-pitch";
import { MetricList, QualityPanel } from "@/components/gps/metrics";
import { ZoneShareBars } from "@/components/gps/zone-shares";
import { GpsImportWizard, type WizardInitial } from "@/components/gps/import-wizard";
import { formatDay } from "@/components/gps/format";

const EMPTY_ZONES = new Array(ZONE_COLS * ZONE_ROWS).fill(0);
let cleanedThisSession = false;

export interface MatchGps {
  backend: GpsBackend | null;
  loading: boolean;
  error: string | null;
  track: TrackRow | null;
  heatmap: DrawableGrid | null;
  source: HeatmapSource;
  setSource: (source: HeatmapSource) => void;
  reload: () => void;
}

/** Loads a match's active GPS track (summary first, grid only when it's shown). */
export function useMatchGps(match: Match | undefined): MatchGps {
  const backend = useGpsBackend();
  const { matches } = useCareer();
  const [state, setState] = useState<{ key: string; track: TrackRow | null; error: string | null } | null>(null);
  const [heatmap, setHeatmap] = useState<{ trackId: string; grid: DrawableGrid } | null>(null);
  const [version, setVersion] = useState(0);
  const matchId = match?.id;
  const key = `${backend?.kind}:${matchId}:${version}`;

  useEffect(() => {
    if (!backend || !matchId || match?.isSample) return;
    let live = true;
    backend
      .getActiveTrack(matchId)
      .then((track) => live && setState({ key, track, error: null }))
      .catch((error: unknown) => live && setState({ key, track: null, error: error instanceof Error ? error.message : "Couldn't load GPS data." }));
    return () => {
      live = false;
    };
  }, [backend, matchId, match?.isSample, key]);

  // Once per session, tidy leftovers from interrupted saves or deleted matches.
  useEffect(() => {
    if (!backend || cleanedThisSession) return;
    cleanedThisSession = true;
    void cleanupOrphans(backend, { knownMatchIds: new Set(matches.map((item) => item.id)) }).catch(() => {
      cleanedThisSession = false;
    });
  }, [backend, matches]);

  const current = state?.key === key ? state : null;
  const track = current?.track ?? null;
  const source: HeatmapSource = track ? track.heatmapSource : "manual";

  useEffect(() => {
    if (!backend || !track || source !== "gps" || heatmap?.trackId === track.id) return;
    let live = true;
    backend
      .getHeatmap(track.id)
      .then((stored) => {
        if (live && stored) setHeatmap({ trackId: track.id, grid: decodeHeatmap(stored) });
      })
      .catch(() => live && toast.error("Couldn't load the GPS heatmap"));
    return () => {
      live = false;
    };
  }, [backend, track, source, heatmap?.trackId]);

  const setSource = useCallback(
    (next: HeatmapSource) => {
      if (!backend || !track) return;
      setState((previous) => (previous?.track ? { ...previous, track: { ...previous.track, heatmapSource: next } } : previous));
      backend.setHeatmapSource(track.id, next).catch(() => toast.error("Couldn't save your heatmap choice"));
    },
    [backend, track],
  );

  return {
    backend,
    loading: Boolean(backend && matchId && !match?.isSample && !current),
    error: current?.error ?? null,
    track,
    heatmap: track && heatmap?.trackId === track.id ? heatmap.grid : null,
    source,
    setSource,
    reload: () => setVersion((value) => value + 1),
  };
}

function SourceLabel({ gps, track }: { gps: boolean; track: TrackRow | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
      <span className="sr-only">Heatmap source:</span>
      {gps && track ? (
        <>
          <MapPinned className="size-3.5 text-primary" aria-hidden /> GPS · {track.quality === "approximate" ? "approximate" : "recorded"}
        </>
      ) : (
        <>Manual zones</>
      )}
    </span>
  );
}

function GpsHeatmapView({ track, heatmap }: { track: TrackRow; heatmap: DrawableGrid | null }) {
  const [dimension, setDimension] = useState<"2d" | "3d">("2d");
  const [failed3d, setFailed3d] = useState(false);
  const [canUse3d] = useState(() => typeof window !== "undefined" && supportsWebGL());
  const [lite] = useState(() => typeof window !== "undefined" && prefersLiteRendering());
  const { summary } = track;
  const pitch = summary.pitch;
  const scaled = Math.abs(pitch.length - 105) > 0.5 || Math.abs(pitch.width - 68) > 0.5;
  const gps = useMemo(() => (heatmap ? { grid: heatmap, pitch } : undefined), [heatmap, pitch]);
  const show3d = dimension === "3d" && canUse3d && !failed3d && gps;
  return (
    <div className="space-y-4">
      {canUse3d ? (
        <div onPointerEnter={preloadPitch3D} onFocus={preloadPitch3D}>
          <Segmented
            label="Heatmap view"
            size="sm"
            value={dimension}
            onChange={setDimension}
            options={[
              { value: "2d", label: "2D tactical" },
              { value: "3d", label: "3D pitch" },
            ]}
          />
        </div>
      ) : null}
      {failed3d ? (
        <p className="rounded-md bg-accent px-3 py-2 text-xs text-muted-foreground" role="status">
          The 3D view isn&apos;t available on this device, so you&apos;re seeing the 2D heatmap.
        </p>
      ) : null}
      {show3d ? (
        <>
          <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-[radial-gradient(ellipse_at_62%_38%,#14423a_0%,#0d1c1a_52%,#0b1112_100%)] sm:aspect-[16/10]">
            <LazyPitch3D
              grid={EMPTY_ZONES}
              hovered={null}
              onHover={() => {}}
              lite={lite}
              view="iso"
              resetKey={0}
              positions={[]}
              gps={gps}
              onFail={() => setFailed3d(true)}
              label={`3D pitch with the GPS heatmap for this match. Quality: ${track.quality}.`}
            />
          </div>
          {scaled ? (
            <p className="text-xs text-muted-foreground">
              Shown on a standard 105 × 68 m pitch, scaled from your {pitch.length} × {pitch.width} m pitch. The 2D view keeps true proportions.
            </p>
          ) : null}
        </>
      ) : heatmap ? (
        <GpsPitch grid={heatmap} pitch={pitch} label={`GPS heatmap for this match on a ${pitch.length} by ${pitch.width} metre pitch. Quality: ${track.quality}.`} />
      ) : (
        <div className="skeleton aspect-[117/80] w-full rounded-lg" aria-label="Loading the GPS heatmap" />
      )}
      <GpsHeatLegend />
      <div className="grid gap-5 sm:grid-cols-2">
        <ZoneShareBars title="Pitch thirds (time)" items={summary.zones.thirds} />
        <ZoneShareBars title="Channels (time)" items={summary.zones.channels} />
      </div>
    </div>
  );
}

/** The match heatmap: manual zones (unchanged) or GPS, with a switch when both exist. */
export function MatchHeatmapSection({ match, orientation, gps }: { match: Match; orientation: PitchOrientation; gps: MatchGps }) {
  const grid = useMemo(() => gridFromCells(match.zones), [match.zones]);
  const hasManual = match.zones.length > 0;
  const hasGps = Boolean(gps.track);
  const showGps = hasGps && (gps.source === "gps" || !hasManual);

  return (
    <section className="panel p-card">
      <SectionTitle
        title="Match heatmap"
        aside={
          hasManual || hasGps ? (
            <span className="flex flex-wrap items-center justify-end gap-2">
              <SourceLabel gps={showGps} track={gps.track} />
              {!showGps ? <AttackHint orientation={orientation} /> : null}
            </span>
          ) : null
        }
      />
      {hasManual && hasGps ? (
        <Segmented
          label="Heatmap source"
          size="sm"
          className="mb-4"
          value={showGps ? "gps" : "manual"}
          onChange={(value) => gps.setSource(value)}
          options={[
            { value: "gps", label: "GPS" },
            { value: "manual", label: "Manual zones" },
          ]}
        />
      ) : null}
      {showGps && gps.track ? (
        <GpsHeatmapView track={gps.track} heatmap={gps.heatmap} />
      ) : hasManual ? (
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_230px] lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_230px]">
          <div>
            <div className="mx-auto max-w-[min(100%,52vh)] sm:max-w-none">
              <Pitch
                decorative
                orientation={orientation}
                label={`Activity heatmap for this match, ${match.zones.length} zones recorded`}
                underlay={<HeatLayer grid={grid} />}
              />
            </div>
            <HeatLegend className="mt-3" />
          </div>
          <ZoneBreakdown grid={grid} />
        </div>
      ) : (
        <EmptyState
          icon={<MapPinOff />}
          title="No map recorded"
          action={
            <LinkButton href={`/matches/${match.id}/edit`} variant="outline" size="sm">
              Add pitch map
            </LinkButton>
          }
        >
          This match won&apos;t appear in your season heatmap until zones are added. You can also import a GPS file.
        </EmptyState>
      )}
    </section>
  );
}

/** GPS tracking for the match: import, review, re-trim/recalibrate, replace or remove. */
export function MatchGpsPanel({ match, gps }: { match: Match; gps: MatchGps }) {
  const [wizard, setWizard] = useState<{ initial?: WizardInitial; key: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { track, backend } = gps;

  async function reopen() {
    if (!backend || !track) return;
    setBusy(true);
    try {
      const { row, bytes } = await loadSourceFile(backend, track);
      setWizard({ key: Date.now(), initial: { bytes, fileName: row.fileName, summary: track.summary, calibrationId: track.calibrationId } });
    } catch (error) {
      toast.error("Couldn't open the original file", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!backend) return;
    setBusy(true);
    try {
      await removeTracking(backend, match.id);
      toast("GPS data removed", { description: "The match, its stats and your painted zones are unchanged." });
      gps.reload();
    } catch (error) {
      toast.error("Couldn't remove the GPS data", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section className="panel p-card">
      <SectionTitle title="GPS tracking" />
      {match.isSample ? (
        <p className="text-sm text-muted-foreground">Demo matches can&apos;t hold GPS data. Start your own career to import a GPS file.</p>
      ) : gps.loading ? (
        <div className="skeleton h-24 rounded-lg" aria-label="Loading GPS data" />
      ) : gps.error ? (
        <p role="alert" className="text-sm text-destructive">
          {gps.error}
        </p>
      ) : track ? (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Imported {formatDay(track.createdAt)}. GPS never changes your rating, stats or progression.
          </p>
          <QualityPanel quality={track.summary.quality} />
          <MetricList metrics={track.summary.metrics} />
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button size="sm" variant="secondary" onClick={reopen} disabled={busy} data-icon="inline-start">
              <SlidersHorizontal /> Re-trim or recalibrate
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setWizard({ key: Date.now() })} disabled={busy} data-icon="inline-start">
              <RefreshCw /> Replace file
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setConfirming(true)} disabled={busy} data-icon="inline-start">
              <Trash2 /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add a GPX, TCX or FIT file from your watch or phone for a GPS heatmap and match metrics. Your painted zones stay as they are.
          </p>
          <Button variant="secondary" onClick={() => setWizard({ key: Date.now() })} disabled={!backend} data-icon="inline-start">
            <Upload /> Import GPS file
          </Button>
        </div>
      )}

      {wizard ? (
        <GpsImportWizard
          key={wizard.key}
          open
          onOpenChange={(open) => !open && setWizard(null)}
          target={{ kind: "existing", match, hasTrack: Boolean(track) }}
          initial={wizard.initial}
          onAttached={gps.reload}
        />
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this match&apos;s GPS data?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the GPS heatmap, metrics and the stored original file. The match itself, its stats and your painted zones stay exactly as
              they are. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep GPS data</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove} disabled={busy}>
              Remove GPS data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
